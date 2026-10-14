/** Joins classNames, skipping falsy values. The design system doesn't depend on tailwind-merge. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
