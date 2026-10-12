import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { queryClient } from "@/lib/queryClient";
import { costIssue } from "@/lib/prep";
import { EMPTY_COMP, EMPTY_ING } from "@/components/CatalogEditors";
import { portionTextFor } from "@/components/BentoEditor";
import type { Component, Ingredient, MenuItem } from "@/types";

// AI fill-in (simplification proposal §3-2): for menu dishes that have no composition yet, generate recipe drafts in one go with draftRecipe and link them back to the items.
// Dishes with the same name are generated once (sides shared by several bentos become one semi-finished component); ingredients with an existing name are reused.
// Drafts are marked ai_draft and unit prices are always left at 0 for the vendor to fill in (costs aren't faked).

interface Catalog {
  ingredients: Ingredient[];
  components: Component[];
  componentsById: Record<string, Component>;
  ingredientsById: Record<string, Ingredient>;
}

interface Draft {
  component: Omit<Component, "id" | "ingredients">;
  ingredients: (Omit<Ingredient, "id"> & { grams: number })[];
}

/** Position of a dish in an item, used to write the new component_id back after filling */
type Ref =
  | { kind: "main"; i: number }
  | { kind: "fixed"; i: number }
  | { kind: "slot"; i: number }
  | { kind: "cand"; i: number; j: number }
  | { kind: "rice" } // the rice recipe has no ingredients: fill in place, no item change needed
  | { kind: "whole" }; // a single item with no composition at all: create one from the item name

interface Target { item: MenuItem; ref: Ref; name: string; componentId: string | null }

const isBentoItem = (item: MenuItem) => (item.item_type ? item.item_type === "bento" : (item.slots?.length ?? 0) > 0);

/** Dishes in an item that still need a recipe (not linked, recipe deleted, recipe without ingredients); a missing unit price doesn't count since AI can't fill prices */
export function recipeTargets(item: MenuItem, catalog: Catalog): Target[] {
  const out: Target[] = [];
  const push = (ref: Ref, name: string, componentId: string | null | undefined) => {
    if (!name && !componentId) return;
    const issue = costIssue(componentId, catalog.componentsById, catalog.ingredientsById);
    if (issue && issue.kind !== "no_price") out.push({ item, ref, name: name || catalog.componentsById[componentId ?? ""]?.name || "", componentId: componentId ?? null });
  };
  if (isBentoItem(item)) {
    const mains = item.mains?.length ? item.mains : item.main ? [item.main] : [];
    mains.forEach((m, i) => push({ kind: "main", i }, m.name, m.component_id));
    if (item.rice_component_id) {
      const issue = costIssue(item.rice_component_id, catalog.componentsById, catalog.ingredientsById);
      if (issue?.kind === "no_ingredients") out.push({ item, ref: { kind: "rice" }, name: catalog.componentsById[item.rice_component_id].name, componentId: item.rice_component_id });
    }
  }
  (item.fixed ?? []).forEach((f, i) => push({ kind: "fixed", i }, f.name, f.component_id));
  (item.slots ?? []).forEach((s, i) => {
    if (s.default?.name) push({ kind: "slot", i }, s.default.name, s.default.component_id);
    s.candidates.forEach((c, j) => c.name && push({ kind: "cand", i, j }, c.name, c.component_id));
  });
  if (!isBentoItem(item) && !item.component_id && !(item.fixed ?? []).length) out.push({ item, ref: { kind: "whole" }, name: item.name, componentId: null });
  return out;
}

async function runPool<T>(tasks: (() => Promise<T>)[], size: number, onDone: () => void): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
      onDone();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return results;
}

export interface FillResult { drafted: number; linked: number; items: number; failed: string[] }

/**
 * Fills every dish in items that lacks a recipe. onProgress(done, total) is used to draw progress.
 */
export async function aiFillMenu(vendorId: string, items: MenuItem[], catalog: Catalog, onProgress?: (done: number, total: number) => void): Promise<FillResult> {
  const targets = items.flatMap((item) => recipeTargets(item, catalog));
  // Dishes to draft: an existing component without ingredients → fill it, keyed by id; not linked → link to an existing component with the same name if it has a recipe, otherwise create one keyed by name
  const byName = new Map(catalog.components.map((c) => [c.name.trim(), c]));
  const jobs = new Map<string, { name: string; componentId: string | null }>();
  const resolved = new Map<string, string>(); // job key → component id
  const keyOf = (t: Target) => {
    const existing = t.componentId ? catalog.componentsById[t.componentId] : undefined;
    if (existing) return `id:${existing.id}`;
    return `name:${t.name.trim()}`;
  };
  for (const t of targets) {
    const key = keyOf(t);
    if (jobs.has(key) || resolved.has(key)) continue;
    const existing = t.componentId ? catalog.componentsById[t.componentId] : undefined;
    const same = !existing ? byName.get(t.name.trim()) : undefined;
    if (same && !costIssue(same.id, catalog.componentsById, catalog.ingredientsById)) resolved.set(key, same.id);
    else jobs.set(key, { name: existing?.name ?? t.name.trim(), componentId: existing?.id ?? same?.id ?? null });
  }

  const entries = [...jobs.entries()];
  let done = 0;
  onProgress?.(0, entries.length);
  const call = httpsCallable(functions, "draftRecipe");
  const drafts = await runPool(entries.map(([, job]) => async () => (await call({ vendor_id: vendorId, name: job.name })).data as Draft), 3, () => onProgress?.(++done, entries.length));

  // Writes happen sequentially so ingredients with the same name aren't created twice
  const ingByName = new Map(catalog.ingredients.map((i) => [i.name.trim(), i]));
  const newIngredients: Record<string, Ingredient> = {};
  const newComponents: Record<string, Component> = {};
  const failed: string[] = [];
  for (let k = 0; k < entries.length; k++) {
    const [key, job] = entries[k];
    const r = drafts[k];
    if (r.status !== "fulfilled" || !r.value?.ingredients?.length) {
      failed.push(job.name);
      continue;
    }
    const lines: { ingredient_id: string; grams: number }[] = [];
    for (const d of r.value.ingredients) {
      const { grams, ...rest } = d;
      let ing = ingByName.get(String(rest.name).trim());
      if (!ing) {
        const data = { ...EMPTY_ING, ...rest, unit_price: 0, supplier_id: null };
        const ref = await addDoc(collection(db, "vendors", vendorId, "ingredients"), data);
        ing = { id: ref.id, ...data } as Ingredient;
        ingByName.set(ing.name.trim(), ing);
        newIngredients[ing.id] = ing;
      }
      lines.push({ ingredient_id: ing.id, grams: Number(grams) || 0 });
    }
    const fields = { ...EMPTY_COMP, ...r.value.component, name: job.name, ingredients: lines, ai_draft: true };
    let id = job.componentId;
    if (id) await updateDoc(doc(db, "vendors", vendorId, "components", id), fields);
    else id = (await addDoc(collection(db, "vendors", vendorId, "components"), fields)).id;
    newComponents[id] = { id, ...fields } as Component;
    resolved.set(key, id);
  }

  // Write the new component_id back to the items (portion text is updated too)
  const compById = { ...catalog.componentsById, ...newComponents };
  const ingById = { ...catalog.ingredientsById, ...newIngredients };
  const pt = (id: string | null | undefined, name: string) => portionTextFor(id ? compById[id] : undefined, ingById, name);
  const linkedIds = new Map<Target, string>();
  for (const t of targets) {
    const id = resolved.get(keyOf(t));
    if (id && id !== t.componentId) linkedIds.set(t, id);
  }
  // Only touch items whose component_id changed; recipes filled in place need no item change
  const touched = new Set([...linkedIds.keys()].map((t) => t.item));
  let itemCount = 0;
  for (const item of touched) {
    const mine = targets.filter((t) => t.item === item);
    const idFor = (match: (r: Ref) => boolean, current: string | null | undefined) => {
      const t = mine.find((x) => match(x.ref));
      return (t && linkedIds.get(t)) || current || null;
    };
    const mains = (item.mains ?? []).map((m, i) => {
      const component_id = idFor((r) => r.kind === "main" && r.i === i, m.component_id);
      return { ...m, component_id, portion_text: pt(component_id, m.name) };
    });
    const legacyMainId = !item.mains?.length && item.main ? idFor((r) => r.kind === "main" && r.i === 0, item.main.component_id) : null;
    const main = mains[0] ? { name: mains[0].name, component_id: mains[0].component_id, portion_text: mains[0].portion_text } : item.main ? { ...item.main, component_id: legacyMainId, portion_text: pt(legacyMainId, item.main.name) } : null;
    let fixed = (item.fixed ?? []).map((f, i) => {
      const component_id = idFor((r) => r.kind === "fixed" && r.i === i, f.component_id);
      return { ...f, component_id, portion_text: pt(component_id, f.name) };
    });
    const whole = mine.find((t) => t.ref.kind === "whole");
    const wholeId = whole && resolved.get(keyOf(whole));
    if (wholeId) fixed = [{ name: item.name, component_id: wholeId, portions: 1, portion_text: pt(wholeId, item.name) }];
    const slots = (item.slots ?? []).map((s, i) => {
      const defaultId = idFor((r) => r.kind === "slot" && r.i === i, s.default.component_id);
      return {
        ...s,
        default: { ...s.default, component_id: defaultId, portion_text: pt(defaultId, s.default.name) },
        candidates: s.candidates.map((c, j) => {
          const component_id = idFor((r) => r.kind === "cand" && r.i === i && r.j === j, c.component_id);
          return { ...c, component_id, portion_text: pt(component_id, c.name) };
        }),
      };
    });
    await updateDoc(doc(db, "menu_items", item.id), { mains, main, fixed, slots });
    itemCount++;
  }

  await queryClient.invalidateQueries({ queryKey: ["vendorCatalog", vendorId] });
  await queryClient.invalidateQueries({ queryKey: ["vendorMenu", vendorId] });
  return { drafted: entries.length - failed.length, linked: linkedIds.size, items: itemCount, failed };
}
