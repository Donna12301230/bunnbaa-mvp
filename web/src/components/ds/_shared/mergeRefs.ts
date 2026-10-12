import type { MutableRefObject, Ref, RefCallback } from 'react';

/** Merges multiple refs (the external ref from forwardRef + the component's internal ref). */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as MutableRefObject<T | null>).current = node;
    }
  };
}
