import type { BinanceHolding } from "./types";

/** Bu tutarın altındaki coin bakiyeleri varlık listesinde gösterilmez. */
export const MIN_VISIBLE_HOLDING_TRY = 50;

export function holdingValueTry(holding: Pick<BinanceHolding, "total" | "price_try" | "value_try">): number | null {
  const reported = Number(holding.value_try);
  if (holding.value_try != null && Number.isFinite(reported)) return reported;
  const total = Number(holding.total || 0);
  const price = Number(holding.price_try || 0);
  if (total > 0 && price > 0) return total * price;
  return null;
}

/** TRY hariç, bakiyesi olan ve piyasa değeri 50 TL ve üstü olan varlık. */
export function isVisibleHolding(holding: BinanceHolding): boolean {
  if (holding.asset === "TRY" || !(Number(holding.total) > 0)) return false;
  const value = holdingValueTry(holding);
  if (value == null) return true;
  return value >= MIN_VISIBLE_HOLDING_TRY;
}
