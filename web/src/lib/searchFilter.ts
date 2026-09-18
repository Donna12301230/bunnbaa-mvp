// 搜尋關鍵字過濾：不雅字詞黑名單
const BLOCKED_WORDS = [
  // 常見中文不雅詞
  "幹", "他媽", "他X", "靠北", "靠杯", "去死", "死去",
  "白癡", "智障", "腦殘", "廢物", "爛貨", "賤", "婊",
  "幹你", "操你", "屌", "雞巴", "屄", "妓",
  // 英文
  "fuck", "shit", "bitch", "asshole", "dick", "pussy",
  "cunt", "bastard", "damn", "wtf", "stfu",
];

export function isClean(keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return !BLOCKED_WORDS.some(w => lower.includes(w.toLowerCase()));
}
