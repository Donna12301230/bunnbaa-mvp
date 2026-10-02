// 成長獎勵（規格 §8）：回饋池分配演算法與不放回抽樣。純函式，給 closeRewardPeriod／
// drawTicket 用；web/src/lib/rewards.ts 有同一份（試算顯示用）。

const { COUPON_TIERS, BASE_TIER } = require("./config");

/**
 * 分配演算法（§8.4）
 * 1. 每張抽獎券先配一張保底券：成本 N × 保底折抵
 * 2. 升級預算 B = P − N × 保底折抵
 * 3. 各等級升級張數 = floor(B × 權重 ÷ 升級成本)
 * 4. 頭獎保證：免費餐券為 0 且剩餘預算 ≥ 95 時，先配 1 張
 * 5. 剩餘預算繼續升級半價券，直到不足 45
 * 6. 保底張數 = N − 高階張數；未分配餘額回歸店家
 * 高階總張數不會超過 N（券數不能多於抽獎券）。
 */
function allocatePool(pool, tickets, tiers = COUPON_TIERS, base = BASE_TIER) {
  const N = Math.max(0, Math.floor(tickets));
  const P = Math.max(0, Math.floor(pool));
  const counts = Object.fromEntries(tiers.map((t) => [t.code, 0]));
  if (N === 0) return { counts: { ...counts, [base.code]: 0 }, spent: 0, leftover: P };
  const baseCost = N * base.discount;
  if (baseCost > P) {
    // 回饋池連保底都不夠（規格限制保底 ≤ 100 × 回饋比例，正常不會發生）：能發幾張保底就發幾張
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

/** 各等級剩餘張數加權隨機（不放回：呼叫端抽中後把該等級減一） */
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
