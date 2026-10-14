import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Component, Ingredient, Supplier } from "@/types";

/** The vendor's ingredients, semi-finished components and small suppliers (vendors/{id}/ingredients|components|suppliers, readable and writable only by the vendor owner) */
export function useVendorCatalog(vendorId: string | undefined) {
  return useQuery({
    queryKey: ["vendorCatalog", vendorId],
    queryFn: async () => {
      const [ing, comp, sup] = await Promise.all([
        getDocs(collection(db, "vendors", vendorId!, "ingredients")),
        getDocs(collection(db, "vendors", vendorId!, "components")),
        getDocs(collection(db, "vendors", vendorId!, "suppliers")),
      ]);
      const ingredients = ing.docs.map((d) => ({ id: d.id, ...d.data() }) as Ingredient).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      const components = comp.docs.map((d) => ({ id: d.id, ...d.data() }) as Component).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      const suppliers = sup.docs.map((d) => ({ id: d.id, ...d.data() }) as Supplier);
      return {
        ingredients,
        components,
        suppliers,
        ingredientsById: Object.fromEntries(ingredients.map((i) => [i.id, i])) as Record<string, Ingredient>,
        componentsById: Object.fromEntries(components.map((c) => [c.id, c])) as Record<string, Component>,
      };
    },
    enabled: !!vendorId,
  });
}
