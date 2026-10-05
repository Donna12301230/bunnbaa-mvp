// 備料與採購的確定性計算（規格 §5）。純函式：份數、生料用量、流程時間軸、出餐標籤、
// 叫貨量進位與分日到貨。AI 不參與任何數量運算，Gemini 只把結果轉成口語提示。

const { rawAmount } = require("./bento");
const { toMinutes, fromMinutes } = require("./calendar");

const PACKING_MINUTES = 20; // 取餐開始前留給裝盒、貼標籤
const OVERNIGHT_ADVANCE_HOURS = 8; // 可提前 ≥ 8 小時的半成品排到「前一晚」

/** 這些狀態的鎖定都要出餐（轉讓中也還是要做） */
const ACTIVE_LOCK_STATUSES = ["locked", "for_resale", "for_gift"];

function add(map, key, amount) {
  if (!key || !(amount > 0)) return;
  map.set(key, (map.get(key) || 0) + amount);
}

/**
 * 一筆鎖定要用到哪些半成品、各幾份（份＝該半成品的 portion_grams）。
 * 回傳 Map<component_id, portions>。
 */
function componentPortionsForLock(lock, item, componentsById, config) {
  const out = new Map();
  if (!item) return out;
  // 主菜：訂單選的（mains 各自定價）優先，舊資料用品項的固定主菜
  const mainId = lock.main_component_id || item.main?.component_id || (Array.isArray(item.mains) ? item.mains[0]?.component_id : null);
  if (mainId) add(out, mainId, 1);
  if (!mainId && item.component_id) add(out, item.component_id, 1); // 單品（非便當）
  // 備料組成／固定附餐（例：經典便當的滷蛋、蛋餅的餅皮＋蛋），portions 沒設＝1 份
  for (const f of item.fixed || []) add(out, f.component_id, Number(f.portions) > 0 ? Number(f.portions) : 1);
  const riceId = item.rice_component_id;
  if (riceId) {
    const riceGrams = Number(componentsById[riceId]?.portion_grams) || 0;
    let portions = lock.rice === "less" ? 0.5 : 1;
    if (lock.rice === "add") portions += riceGrams > 0 ? (config.riceAddGrams || 100) / riceGrams : 0.5;
    add(out, riceId, portions);
  }
  // 預測用的虛擬訂單、舊資料沒有 slots：一律當成全部預設配菜
  const slots = Array.isArray(lock.slots) && lock.slots.length > 0
    ? lock.slots
    : (item.slots || []).map((s) => ({ removed: false, wished: null, default_component_id: s.default?.component_id }));
  slots.forEach((slot, i) => {
    if (slot.removed) return;
    if (slot.backup_used) {
      add(out, slot.resolved_component_id, slot.portion_level ?? 1); // 許願未成立，遞補備案
      return;
    }
    const wishedOk = slot.wished && slot.resolved === slot.wished;
    const componentId = wishedOk
      ? slot.wished_component_id
      : slot.default_component_id || item.slots?.[i]?.default?.component_id;
    add(out, componentId, wishedOk ? slot.portion_level ?? 1 : 1);
  });
  // 第四道「加菜」：四道都放進便當（「備案」只在遞補時用到，上面已算）
  const extra = lock.extra_side;
  if (extra?.mode === "addon") add(out, extra.resolved_component_id || extra.component_id, extra.portion_level ?? 1);
  return out;
}

/** 多筆鎖定合計的半成品份數 */
function componentPortions(locks, itemsById, componentsById, config) {
  const total = new Map();
  for (const lock of locks) {
    const per = componentPortionsForLock(lock, itemsById[lock.menu_item_id], componentsById, config);
    for (const [id, n] of per) add(total, id, n);
  }
  return total;
}

/** 半成品份數 → 各原物料生料用量（原物料的 unit，例如 g 或 個） */
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
 * 流程時間軸（§5.4）：從取餐開始時間往回推。倒推＋設備容量貪婪分配：
 * 1. 取餐前 PACKING_MINUTES 分鐘裝盒貼標籤。
 * 2. 可提前 ≥ 8 小時的半成品排到「前一晚」。
 * 3. 其餘依總工時由長到短，每道菜拆成 ceil(份數 / 每批容量) 批，
 *    每批排在該設備目前最晚可用時間之前（同設備不重疊，不同設備可並行）。
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
      overnight.push({ component_id: componentId, name: comp.name, portions: count });
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
      });
    }
  }
  slots.sort((a, b) => a.start.localeCompare(b.start));
  return {
    overnight: overnight.map((o) => ({ ...o, task: `${o.name} ${o.portions} 份` })),
    slots,
    packing: { start: fromMinutes(packStart), task: "裝盒、貼出餐標籤" },
  };
}

/** 出餐標籤（§6.3）：每盒一張，不印姓名 */
function buildLabels(locks, itemsById) {
  return locks
    .map((lock) => {
      const item = itemsById[lock.menu_item_id];
      const sides = (lock.slots || []).map((s) => (s.removed ? `${s.category || "配菜"}：不要` : s.resolved || s.default_dish)).filter(Boolean);
      const extra = lock.extra_side;
      if (extra?.mode === "addon" && (extra.resolved || extra.dish)) sides.push(`＋${extra.resolved || extra.dish}`);
      for (const c of lock.custom_options || []) sides.push(`${c.label}：${c.choice}`);
      const rice = lock.rice === "add" ? "白飯一碗半" : lock.rice === "less" ? "白飯半碗" : null;
      return {
        lock_id: lock.id,
        pickup_code: lock.pickup_code || lock.id.slice(-4).toUpperCase(),
        pickup_window: lock.pickup_window,
        meal_period: lock.meal_period || null,
        item: lock.item_name || item?.name || "",
        main: lock.main_dish || item?.main?.name || null,
        fixed: (item?.fixed || []).map((f) => f.name),
        sides,
        rice,
        note: lock.note || null,
      };
    })
    .sort((a, b) => a.pickup_code.localeCompare(b.pickup_code));
}

/** 叫貨量依採購單位無條件進位（例如蛋以盒計）。回傳 { units, amount } */
function roundToPurchaseUnit(amount, ingredient) {
  const size = Number(ingredient?.purchase_unit_size) > 0 ? Number(ingredient.purchase_unit_size) : 1;
  const units = amount > 0 ? Math.ceil(amount / size - 1e-9) : 0;
  return { units, amount: units * size };
}

/**
 * 分日到貨（§5.3）：保存天數 ≤ 3 天（葉菜類）建議分批，每批最多涵蓋 shelf_days 天；
 * 其他一次在週一到。byDay: [{ date, amount }]（週一到週五）。
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
