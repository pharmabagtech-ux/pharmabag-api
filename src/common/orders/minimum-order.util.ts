/**
 * The Rs 20,000 minimum.
 *
 * A buyer must take at least Rs 20,000 of any single listing. The rule is PER
 * LINE and GST-INCLUSIVE (settled 2026-08-01).
 *
 * It has only ever been enforced in the browser: the storefront works out the
 * qualifying quantity and the stepper refuses to go below it. The API never
 * checked it at all. Every cart and checkout endpoint trusted the quantity it
 * was handed, so an order placed outside the UI - a stale tab, a replayed
 * request, a script, a client built against the API later - was accepted
 * short, and nobody downstream could explain why.
 *
 * `cart.service.ts` did compare against `product.minimumOrderQuantity`, but
 * that is the seller's stored figure, written when the listing was created and
 * never recomputed since. Around a hundred live listings still carry a value
 * below what Rs 20,000 now requires, so that check passes orders this one
 * rejects. Both are kept: the seller may legitimately demand MORE than the
 * platform floor, never less.
 *
 * The figures used here are the ones the invoice is built from - the cart
 * item's own `unitPrice` snapshot and the LISTING's `gstPercent` (never the
 * master catalogue's, which is null across the board). That matters. Deriving
 * a fresh price here instead would let this check reject an order at a
 * different price from the one the buyer was shown and will be billed.
 */

/** Platform floor, per order line, inclusive of GST. */
export const MIN_ORDER_VALUE_INR = 20000;

/**
 * Charged when a listing carries no GST of its own. Must stay in step with
 * the same fallback in `orders.service.ts` and `settlement.util.ts` - if they
 * disagree, this check and the invoice disagree.
 */
export const FALLBACK_GST_PERCENT = 12;

/**
 * Float dust guard. Quantity x price x tax rarely lands on an exact rupee, and
 * a line the storefront computed as exactly Rs 20,000 can arrive here as
 * 19999.999999996. Rounding to paise before comparing keeps this check on the
 * lenient side of the boundary, which is the only safe direction: rejecting a
 * valid order is a worse failure than accepting one a fraction of a paisa
 * short.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

export type LotMeta = {
  buy?: number | null;
  get?: number | null;
} | null;

/** GST-inclusive value of one order line, rounded to paise. */
export function lineValueWithGst(
  quantity: number,
  unitPrice: number,
  gstPercent?: number | null,
): number {
  const gst = gstPercent ?? FALLBACK_GST_PERCENT;
  return round2(quantity * unitPrice * (1 + gst / 100));
}

/** Whether a line clears the Rs 20,000 floor. */
export function meetsMinimumOrderValue(
  quantity: number,
  unitPrice: number,
  gstPercent?: number | null,
): boolean {
  return lineValueWithGst(quantity, unitPrice, gstPercent) >= MIN_ORDER_VALUE_INR;
}

/**
 * The scheme lot: `buy`, NEVER `buy + get`.
 *
 * On "buy 4 get 1" the buyer orders in 4s and the free unit rides along. A lot
 * of 5 would bill the buyer for the unit they were meant to get free.
 *
 * Listings with no bonus scheme step by 1 - the step size for those is still
 * an open question for Rishi, and 1 is the answer that cannot overcharge.
 */
export function listingLotSize(
  discountType?: string | null,
  discountMeta?: LotMeta,
): number {
  const carriesBonus =
    discountType === 'SAME_PRODUCT_BONUS' ||
    discountType === 'DIFFERENT_PRODUCT_BONUS' ||
    discountType === 'PTR_PLUS_SAME_PRODUCT_BONUS' ||
    discountType === 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS';

  if (!carriesBonus) return 1;

  const buy = discountMeta?.buy;
  if (typeof buy !== 'number' || !Number.isFinite(buy) || buy < 1) return 1;
  return Math.floor(buy);
}

/**
 * Smallest quantity whose GST-inclusive line value reaches Rs 20,000, rounded
 * UP to a whole scheme lot.
 *
 * Derived by division and then VERIFIED by the same comparison the guard uses,
 * rather than trusted. Division alone lands one lot out whenever the quotient
 * falls a hair either side of a whole number - the exact fault that shipped in
 * the storefront and had to be fixed there separately (Budecort came out at
 * 1533 units where 1536 were needed). Computing and checking with one function
 * means the answer this returns is the answer the guard accepts, by
 * construction.
 */
export function minimumQuantityForValue(
  unitPrice: number,
  gstPercent?: number | null,
  lot = 1,
): number {
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return 1;

  const step = Math.max(1, Math.floor(lot));
  const gst = gstPercent ?? FALLBACK_GST_PERCENT;

  const raw = MIN_ORDER_VALUE_INR / (unitPrice * (1 + gst / 100));
  let qty = Math.max(1, Math.ceil(raw - 1e-9));

  // Settle any residual float error against the real comparison, in BOTH
  // directions. Division answers the exact-arithmetic question; the guard
  // answers the rounded-to-paise one, and near the boundary those differ by a
  // unit. Walking up alone would hand the buyer a minimum one unit above what
  // the guard would actually have accepted - a quantity the storefront then
  // has no way to justify.
  while (!meetsMinimumOrderValue(qty, unitPrice, gstPercent)) qty++;
  while (qty > 1 && meetsMinimumOrderValue(qty - 1, unitPrice, gstPercent)) qty--;

  // Round up to a whole lot. This only ever increases the quantity, so the
  // line still clears the floor.
  return Math.ceil(qty / step) * step;
}

/**
 * What a buyer must actually take: the higher of the platform floor and the
 * seller's own stored minimum.
 */
export function effectiveMinimumQuantity(
  unitPrice: number,
  gstPercent?: number | null,
  storedMinimum?: number | null,
  lot = 1,
): number {
  const floor = minimumQuantityForValue(unitPrice, gstPercent, lot);
  const stored = storedMinimum && storedMinimum > 0 ? storedMinimum : 1;
  return Math.max(floor, stored);
}

/**
 * Message shown when a line falls short. States the shortfall in both the
 * units the buyer has to act on and the rupees the rule is written in.
 */
export function minimumOrderMessage(
  productName: string,
  requiredQuantity: number,
  currentValue: number,
): string {
  return (
    `"${productName}" is below the Rs ${MIN_ORDER_VALUE_INR.toLocaleString('en-IN')} ` +
    `minimum per product (currently Rs ${currentValue.toLocaleString('en-IN', {
      maximumFractionDigits: 2,
    })} including GST). ` +
    `Increase the quantity to at least ${requiredQuantity} units.`
  );
}
