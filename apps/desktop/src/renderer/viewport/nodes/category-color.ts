// Deterministic colour per device category — a stable hash into a fixed palette (no config needed;
// a new category gets a consistent colour). Distinct from STATUS_COLOR (the monitoring status ring).
const PALETTE = [0x4f86f7, 0x35c46a, 0xf5a623, 0xb36ae2, 0xe5484d, 0x21c0c0, 0xe28f3a, 0x8a8f98];

export function categoryColor(category: string): number {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
