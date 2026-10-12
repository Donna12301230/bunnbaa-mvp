// User avatars: there's no real photo upload, so DiceBear (free, no key, deterministic:
// the same seed always gives the same image) generates cartoon portraits, kept separate from real food/vendor photos.
export function avatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}
