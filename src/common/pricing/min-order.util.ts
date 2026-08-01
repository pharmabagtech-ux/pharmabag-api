/**
 * The minimum order value rule.
 *
 * PharmaBag is wholesale: every line of an order has to be worth at least
 * 20,000 rupees. Confirmed with the client on 2026-08-01 — the figure is
 * GST-INCLUSIVE, and it applies PER LINE, not to the order as a whole. A bag
 * holding six products carries six independent floors.
 *
 * Until now the rule lived entirely in the buyer's browser. The API only ever
 * checked `quantity >= product.minimumOrderQuantity`, and that stored figure is
 * stale on almost every listing — it was saved before the current pricing rules
 * and asks for roughly half the floor. Anything that was not the buyer app, or
 * a buyer app that had not recomputed, could check out well under it.
 *
 * Mirrors `minimumOrderQuantity` in pharmabag-web packages/utils/src/validators
 * and `priceLine` in apps/buyer/src/lib/pricing. Keep the three in step: if the
 * API and the browser disagree about what a line is worth, the buyer is shown a
 * quantity the server then rejects.
 */

export const MIN_ORDER_VALUE = 20000;

/**
 * What a cart line is worth, GST included.
 *
 * Rounds exactly as the bag does — subtotal and GST rounded separately — so the
 * value the server tests is the value the buyer was shown.
 */
export function lineOrderValue(
  unitPrice: number,
  quantity: number,
  gstPercent: number,
): number {
  const subtotal = unitPrice * quantity;
  return Math.round(subtotal) + Math.round(subtotal * (gstPercent / 100));
}

/**
 * The smallest quantity of this line that clears the floor.
 *
 * Rounded up to a whole scheme lot, where the lot is the BUY quantity and never
 * buy + get: the free unit is not billed, so it is not part of the step. A
 * 4-plus-1 moves in fours.
 */
export function minQuantityForOrderValue(
  unitPrice: number,
  gstPercent: number,
  discountMeta?: { buy?: number; get?: number } | null,
  minOrderValue: number = MIN_ORDER_VALUE,
): number {
  if (!unitPrice || unitPrice <= 0) return 0;

  const perUnitWithGst = unitPrice * (1 + gstPercent / 100);
  if (perUnitWithGst <= 0) return 0;

  const raw = Math.ceil(minOrderValue / perUnitWithGst);
  const buy = discountMeta?.buy ?? 0;
  const get = discountMeta?.get ?? 0;
  const lot = get > 0 ? buy : 0;
  return lot > 1 ? Math.ceil(raw / lot) * lot : raw;
}

/**
 * Null when the line clears the floor, otherwise a message naming what it is
 * worth and the quantity that would carry it over.
 *
 * Returns rather than throws so callers keep their own exception type.
 */
export function checkMinimumOrderValue(
  unitPrice: number,
  quantity: number,
  gstPercent: number,
  discountMeta?: { buy?: number; get?: number } | null,
  minOrderValue: number = MIN_ORDER_VALUE,
): string | null {
  const value = lineOrderValue(unitPrice, quantity, gstPercent);
  if (value >= minOrderValue) return null;

  const required = minQuantityForOrderValue(
    unitPrice,
    gstPercent,
    discountMeta,
    minOrderValue,
  );

  const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  // A quantity is only worth suggesting when we could work one out and it is
  // actually larger than what was asked for.
  if (required > quantity) {
    return (
      `${quantity} units comes to ${money(value)}, below the ` +
      `${money(minOrderValue)} minimum order value. Order at least ` +
      `${required} units of this product.`
    );
  }

  return (
    `${quantity} units comes to ${money(value)}, below the ` +
    `${money(minOrderValue)} minimum order value.`
  );
}
