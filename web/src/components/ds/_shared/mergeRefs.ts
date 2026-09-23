import type { MutableRefObject, Ref, RefCallback } from 'react';

/** 合併多個 ref（forwardRef 的外部 ref + 元件內部 ref）。 */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as MutableRefObject<T | null>).current = node;
    }
  };
}
