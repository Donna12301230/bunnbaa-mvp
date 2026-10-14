// Deterministic prep and purchasing calculations. Pure functions: portions, raw ingredient amounts, process timeline, pickup labels,
// rounding of order quantities and split-day deliveries. AI does no quantity math; Gemini only turns the results into spoken-style hints.

const { rawAmount } = require("./bento");
const { toMinutes, fromMinutes } = require("./calendar");

const PACKING_MINUTES = 20; // reserved before pickup starts for boxing and labeling
const OVERNIGHT_ADVANCE_HOURS = 8; // components that can be made ≥ 8 hours ahead go to "the night before"

/** Locks in these statuses all need to be cooked (still made while listed for resale) */
const ACTIVE_LOCK_STATUSES = ["locked", "for_resale", "for_gift"];

function add(map, key, amount) {
  if (!key || !(amount > 0)) return;
  map.set(key, (map.get(key) || 0) + amount);
}

/**
 * Which components a lock uses, and how many portions of each (portion = that component's portion_grams).
 * Returns Map<component_id, portions>.
 */
function componentPortionsForLock(lock, item, componentsById, config) {
  const out = new Map();
  if (!item) return out;
  // Main: the one chosen on the order (mains are priced separately) takes priority; legacy data uses the item's fixed main
  const mainId = lock.main_component_id || item.main?.component_id || (Array.isArray(item.mains) ? item.mains[0]?.component_id : null);
  if (mainId) add(out, mainId, 1);
  if (!mainId && item.component_id) add(out, item.component_id, 1); // single item (not a bento)
  // Prep components / fixed sides (e.g. the braised egg in the classic bento, the wrapper + egg of a danbing); portions unset = 1 portion
  for (const f of item.fixed || []) add(out, f.component_id, Number(f.portions) > 0 ? Number(f.portions) : 1);
  const riceId = item.rice_component_id;
  if (riceId) {
    const riceGrams = Number(componentsById[riceId]?.portion_grams) || 0;
    let portions = lock.rice === "less" ? 0.5 : 1;
    if (lock.rice === "add") portions += riceGrams > 0 ? (config.riceAddGrams || 100) / riceGrams : 0.5;
    add(out, riceId, portions);
  }
  // Virtual orders used for forecasts, and legacy data, have no slots: treat them as all default sides
  const slots = Array.isArray(lock.slots) && lock.slots.length > 0
    ? lock.slots
    : (item.slots || []).map((s) => ({ removed: false, wished: null, default_component_id: s.default?.component_id }));
  slots.forEach((slot, i) => {
    if (slot.removed) return;
    if (slot.backup_used) {
      add(out, slot.resolved_component_id, slot.portion_level ?? 1); // wish didn't go ahead, fill in with the backup
      return;
    }
    const wishedOk = slot.wished && slot.resolved === slot.wished;
    const componentId = wishedOk
      ? slot.wished_component_id
      : slot.default_component_id || item.slots?.[i]?.default?.component_id;
    add(out, componentId, wishedOk ? slot.portion_level ?? 1 : 1);
  });
  // Fourth side as "add-on": all four go into the bento ("backup" is only used when filling in, already counted above)
  const extra = lock.extra_side;
  if (extra?.mode === "addon") add(out, extra.resolved_component_id || extra.component_id, extra.portion_level ?? 1);
  return out;
}

/** Total component portions across several locks */
function componentPortions(locks, itemsById, componentsById, config) {
  const total = new Map();
  for (const lock of locks) {
    const per = componentPortionsForLock(lock, itemsById[lock.menu_item_id], componentsById, config);
    for (const [id, n] of per) add(total, id, n);
  }
  return total;
}

/** Component portions → raw amount of each ingredient (in the ingredient's unit, e.g. g or pieces) */
function rawNeeds(portionsByComponent, componentsById, ingredientsById) {
  const needs = new Map();
  for (const [componentId, portions] of portionsByComponent) {
    const comp = componentsById[componentId];
    if (!comp) continue;
    for (const line of comp.ingredients || []) {
      const ing = ingredientsById[line.ingredient_id];
      if (!ing) continue;
      add(needs, line.ingredient_id, rawAmount((Number(line.grams) || 0) * portions, ing));
    }
  }
  return needs;
}

/**
 * Process timeline: worked backwards from the pickup start time. Backward scheduling + greedy allocation by equipment capacity:
 * 1. Boxing and labeling in the PACKING_MINUTES minutes before pickup.
 * 2. Components that can be made ≥ 8 hours ahead go to "the night before".
 * 3. The rest, ordered by total work time from longest to shortest; each dish is split into ceil(portions / batch capacity) batches,
 *    each placed before the latest free time of its equipment (no overlap on the same equipment; different equipment can run in parallel).
 */
function buildTimeline(portionsByComponent, componentsById, pickupStart) {
  const packStart = toMinutes(pickupStart) - PACKING_MINUTES;
  const overnight = [];
  const jobs = [];
  for (const [componentId, portions] of portionsByComponent) {
    const comp = componentsById[componentId];
    if (!comp || !(portions > 0)) continue;
    const count = Math.ceil(portions);
    const capacity = Number(comp.batch_capacity) > 0 ? Number(comp.batch_capacity) : count;
    const batches = Math.max(1, Math.ceil(count / capacity));
    const minutes = Number(comp.prep_minutes) > 0 ? Number(comp.prep_minutes) : 20;
    if (Number(comp.advance_hours) >= OVERNIGHT_ADVANCE_HOURS) {
      overnight.push({ component_id: componentId, name: comp.name, name_en: comp.name_en || comp.name, portions: count });
      continue;
    }
    jobs.push({ componentId, comp, count, capacity, batches, minutes, total: batches * minutes });
  }
  jobs.sort((a, b) => b.total - a.total);
  const equipmentFree = new Map();
  const slots = [];
  for (const job of jobs) {
    const equipment = job.comp.equipment || "工作台";
    for (let b = job.batches - 1; b >= 0; b--) {
      const end = equipmentFree.get(equipment) ?? packStart;
      const start = end - job.minutes;
      equipmentFree.set(equipment, start);
      const batchPortions = Math.min(job.capacity, job.count - b * job.capacity);
      slots.push({
        start: fromMinutes(start),
        end: fromMinutes(end),
        equipment,
        component_id: job.componentId,
        task: job.batches > 1
          ? `${job.comp.name}（第 ${b + 1}/${job.batches} 批，${batchPortions} 份）`
          : `${job.comp.name} ${job.count} 份`,
        // English copy for the English vendor UI (the plan is generated once, outside any request language)
        task_en: job.batches > 1
          ? `${job.comp.name_en || job.comp.name} (batch ${b + 1}/${job.batches}, ${batchPortions})`
          : `${job.comp.name_en || job.comp.name} × ${job.count}`,
      });
    }
  }
  slots.sort((a, b) => a.start.localeCompare(b.start));
  return {
    overnight: overnight.map((o) => ({ ...o, task: `${o.name} ${o.portions} 份`, task_en: `${o.name_en} × ${o.portions}` })),
    slots,
    packing: { start: fromMinutes(packStart), task: "裝盒、貼出餐標籤" },
  };
}

/** Pickup labels: one per box, no names printed */
function buildLabels(locks, itemsById) {
  return locks
    .map((lock) => {
      const item = itemsById[lock.menu_item_id];
      const sides = (lock.slots || []).map((s) => (s.removed ? `${s.category || "配菜"}：不要` : s.resolved || s.default_dish)).filter(Boolean);
      const extra = lock.extra_side;
      if (extra?.mode === "addon" && (extra.resolved || extra.dish)) sides.push(`＋${extra.resolved || extra.dish}`);
      for (const c of lock.custom_options || []) sides.push(`${c.label}：${c.choice}`);
      const rice = lock.rice === "add" ? "白飯一碗半" : lock.rice === "less" ? "白飯半碗" : null;
      // English copy of the label text for the English vendor UI: dish names from the order's (or item's) dish_names_en
      const names = lock.dish_names_en || item?.dish_names_en || {};
      const n = (s) => (s && names[s]) || s;
      const main = lock.main_dish || item?.main?.name || null;
      const sidesEn = (lock.slots || []).map((s) => (s.removed ? `${s.category ? n(s.category) : "Side"}: none` : n(s.resolved || s.default_dish))).filter(Boolean);
      if (extra?.mode === "addon" && (extra.resolved || extra.dish)) sidesEn.push(`+ ${n(extra.resolved || extra.dish)}`);
      for (const c of lock.custom_options || []) sidesEn.push(`${n(c.label)}: ${n(c.choice)}`);
      return {
        lock_id: lock.id,
        pickup_code: lock.pickup_code || lock.id.slice(-4).toUpperCase(),
        pickup_window: lock.pickup_window,
        meal_period: lock.meal_period || null,
        item: lock.item_name || item?.name || "",
        main,
        fixed: (item?.fixed || []).map((f) => f.name),
        sides,
        rice,
        note: lock.note || null,
        en: {
          item: lock.item_name_en || item?.name_en || lock.item_name || item?.name || "",
          main: main ? n(main) : null,
          fixed: (item?.fixed || []).map((f) => n(f.name)),
          sides: sidesEn,
          rice: lock.rice === "add" ? "1.5 bowls of rice" : lock.rice === "less" ? "Half bowl of rice" : null,
        },
      };
    })
    .sort((a, b) => a.pickup_code.localeCompare(b.pickup_code));
}

/** Order quantity rounded up to the purchase unit (e.g. eggs by the box). Returns { units, amount } */
function roundToPurchaseUnit(amount, ingredient) {
  const size = Number(ingredient?.purchase_unit_size) > 0 ? Number(ingredient.purchase_unit_size) : 1;
  const units = amount > 0 ? Math.ceil(amount / size - 1e-9) : 0;
  return { units, amount: units * size };
}

/**
 * Split-day delivery: items with shelf life ≤ 3 days (leafy greens) are best delivered in batches, each covering at most shelf_days days;
 * everything else arrives once on Monday. byDay: [{ date, amount }] (Monday to Friday).
 */
function splitDeliveries(byDay, ingredient) {
  const shelf = Number(ingredient?.shelf_days) || 0;
  const total = byDay.reduce((s, d) => s + d.amount, 0);
  if (!(shelf > 0 && shelf <= 3)) return [{ date: byDay[0]?.date, amount: total }];
  const span = Math.max(1, Math.min(shelf, 3));
  const deliveries = [];
  for (let i = 0; i < byDay.length; i += span) {
    const chunk = byDay.slice(i, i + span);
    deliveries.push({ date: chunk[0].date, amount: chunk.reduce((s, d) => s + d.amount, 0) });
  }
  return deliveries.filter((d) => d.amount > 0);
}

module.exports = {
  ACTIVE_LOCK_STATUSES, componentPortionsForLock, componentPortions, rawNeeds, buildTimeline, buildLabels,
  roundToPurchaseUnit, splitDeliveries,
};
