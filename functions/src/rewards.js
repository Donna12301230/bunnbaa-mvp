// Growth rewards: reward pool allocation algorithm and sampling without replacement. Pure functions used by closeRewardPeriod /
// drawTicket; web/src/lib/rewards.ts has the same code (for preview calculations).

const { COUPON_TIERS, BASE_TIER } = require("./config");

/**
 * Allocation algorithm
 * 1. Every draw ticket first gets a base coupon: cost N × base discount
 * 2. Upgrade budget B = P − N × base discount
 * 3. Upgrades per tier = floor(B × weight ÷ upgrade cost)
 * 4. Grand-prize guarantee: if free-meal coupons are 0 and remaining budget ≥ 95, allocate 1 first
 * 5. Keep upgrading to half-price coupons with the remaining budget until it drops below 45
 * 6. Base coupons = N − higher-tier coupons; any unallocated balance goes back to the vendor
 * The total of higher-tier coupons never exceeds N (no more coupons than draw tickets).
 */
function allocatePool(pool, tickets, tiers = COUPON_TIERS, base = BASE_TIER) {
  const N = Math.max(0, Math.floor(tickets));
  const P = Math.max(0, Math.floor(pool));
  const counts = Object.fromEntries(tiers.map((t) => [t.code, 0]));
  if (N === 0) return { counts: { ...counts, [base.code]: 0 }, spent: 0, leftover: P };
  const baseCost = N * base.discount;
  if (baseCost > P) {
    // The reward pool can't even cover base coupons (the spec caps base ≤ 100 × reward rate, so this shouldn't happen): issue as many base coupons as it can
    const baseCount = Math.floor(P / base.discount);
    return { counts: { ...counts, [base.code]: baseCount }, spent: baseCount * base.discount, leftover: P - baseCount * base.discount };
  }
  const budget = P - baseCost;
  let remaining = budget;
  let upgraded = 0;
  for (const tier of tiers) {
    const n = Math.min(Math.floor((budget * tier.weight) / tier.cost), N - upgraded);
    counts[tier.code] = n;
    upgraded += n;
    remaining -= n * tier.cost;
  }
  const top = tiers[0];
  if (counts[top.code] === 0 && remaining >= top.cost && upgraded < N) {
    counts[top.code] = 1;
    upgraded += 1;
    remaining -= top.cost;
  }
  const filler = tiers[tiers.length - 1];
  while (remaining >= filler.cost && upgraded < N) {
    counts[filler.code] += 1;
    upgraded += 1;
    remaining -= filler.cost;
  }
  counts[base.code] = N - upgraded;
  const spent = P - remaining;
  return { counts, spent, leftover: remaining };
}

/** Weighted random pick by remaining count per tier (without replacement: the caller decrements that tier after a draw) */
function pickTier(remaining, random = Math.random) {
  const entries = Object.entries(remaining).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;
  let roll = random() * total;
  for (const [code, n] of entries) {
    if (roll < n) return code;
    roll -= n;
  }
  return entries[entries.length - 1][0];
}

function tierInfo(code) {
  return COUPON_TIERS.find((t) => t.code === code) || (code === BASE_TIER.code ? BASE_TIER : null);
}

module.exports = { allocatePool, pickTier, tierInfo };
