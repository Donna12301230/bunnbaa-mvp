/** 串接 className，略過 falsy 值。設計系統不依賴 tailwind-merge。 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
