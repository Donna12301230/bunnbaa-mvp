// 位置工具：距離、步行時間、geohash。常用地點只存粗略 geohash（7 碼約 150 公尺，
// 規格 §14.2），不存定位軌跡。functions/src/common.js 有同一套 geohash 解碼。

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let latRange = [-90, 90];
  let lngRange = [-180, 180];
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const range = even ? lngRange : latRange;
    const value = even ? lng : lat;
    const mid = (range[0] + range[1]) / 2;
    if (value >= mid) {
      ch |= 1 << (4 - bit);
      range[0] = mid;
    } else {
      range[1] = mid;
    }
    if (even) lngRange = range;
    else latRange = range;
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function decodeGeohash(hash: string): { lat: number; lng: number } | null {
  if (!hash) return null;
  const lat = [-90, 90];
  const lng = [-180, 180];
  let even = true;
  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) return null;
    for (let b = 4; b >= 0; b--) {
      const range = even ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((idx >> b) & 1) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lng: (lng[0] + lng[1]) / 2 };
}

export function distanceMeters(a: { lat: number; lng: number } | null, b: { lat: number | null | undefined; lng: number | null | undefined }): number {
  if (!a || b.lat == null || b.lng == null) return Infinity;
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 步行時間（分鐘），以每分鐘 80 公尺估 */
export function walkMinutes(meters: number): number {
  return Math.ceil(meters / 80);
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  });
}
