/**
 * PTR pricing — ported from packages/utils/src/pricing.ts in pharmabag-web.
 *
 * PharmaBag is a B2B marketplace: a retailer pays PTR (price to retailer), not
 * the printed MRP. The seller portal has always calculated and displayed this,
 * but the API priced carts and listings straight off `mrp`, so buyers were
 * charged the full retail price and any scheme discount was ignored entirely.
 *
 * This returns the NET per-unit price BEFORE GST. GST is applied separately by
 * the order/cart layer from the listing's own gstPercent, so it must not be
 * folded in here or it would be charged twice.
 *
 * Keep the margin table in step with packages/utils/src/pricing.ts.
 */

/** GST percentage -> retail margin percentage. */
const GST_RETAIL_MARGIN_MAP: Record<number, number> = {
  0: 18.12,
  5: 23.81,
  12: 28.67,
  18: 32.2,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Retail margin for a GST slab, or null when the slab is unmapped.
 * Returns null rather than throwing: an unexpected GST value must not be able
 * to break checkout — the caller falls back to the existing price instead.
 */
export function getRetailMarginPercent(gstPercent: number): number | null {
  return GST_RETAIL_MARGIN_MAP[gstPercent] ?? null;
}

/** PTR = MRP - (MRP x retailMargin / 100) */
export function calculatePTR(mrp: number, gstPercent: number): number | null {
  const retailMargin = getRetailMarginPercent(gstPercent);
  if (retailMargin === null) return null;
  return round2(mrp - (mrp * retailMargin) / 100);
}

export type DiscountMeta = {
  discountPercent?: number;
  buy?: number;
  get?: number;
  bonusProductName?: string;
  specialPrice?: number;
} | null;

/**
 * Bonus as a proportion of the price, `get / (buy + get)`.
 *
 * Free goods are passed to the buyer as a lower unit price rather than as
 * extra units in the order: on "buy 20 get 2" the buyer receives 22 units'
 * worth of value for 20 units' worth of money, so the effective rate falls by
 * 2/22 = 9.0909%. Returns 0 when there is no usable bonus.
 */
export function getBonusFraction(
  buy?: number | null,
  get?: number | null,
): number {
  const b = buy ?? 0;
  const g = get ?? 0;
  if (b <= 0 || g <= 0) return 0;
  return g / (b + g);
}

/**
 * Net per-unit price a buyer pays, BEFORE GST.
 *
 * Follows the agreed formula: PTR - bonus - discount (+ tax added downstream).
 * Both reductions are proportional, so the order they are applied in does not
 * change the result.
 *
 * Free units are NOT added to the order — the bonus is passed on as this lower
 * unit price instead, and shown to the buyer for information only.
 *
 * Returns null when it cannot be computed (missing mrp/gst, or an unmapped GST
 * slab) so the caller can fall back to its existing behaviour.
 */
export function calculateNetUnitPrice(
  mrp: number | null | undefined,
  gstPercent: number | null | undefined,
  discountType?: string | null,
  discountMeta?: DiscountMeta,
): number | null {
  if (mrp == null || gstPercent == null || mrp <= 0) return null;

  const ptr = calculatePTR(mrp, gstPercent);
  if (ptr === null) return null;

  // No scheme at all: the buyer still pays PTR, not MRP.
  if (!discountType) return ptr;

  const meta = discountMeta ?? {};

  // A fixed price replaces the PTR outright - it is not a reduction of it.
  // The seller portal treats it the same way (finalPtr = specialPrice), and it
  // is GST-exclusive, so tax is added downstream exactly as for every other
  // type. Without this the buyer would be charged the plain PTR and the
  // seller's price would be silently ignored.
  if (discountType === 'SPECIAL_PRICE') {
    const special = meta.specialPrice;
    if (typeof special === 'number' && special > 0) return round2(special);
    return ptr;
  }

  const appliesDiscount =
    discountType === 'PTR_DISCOUNT' ||
    discountType === 'PTR_PLUS_SAME_PRODUCT_BONUS' ||
    discountType === 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS';

  const appliesBonus =
    discountType === 'SAME_PRODUCT_BONUS' ||
    discountType === 'DIFFERENT_PRODUCT_BONUS' ||
    discountType === 'PTR_PLUS_SAME_PRODUCT_BONUS' ||
    discountType === 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS';

  let net = ptr;

  if (appliesBonus) {
    net = net * (1 - getBonusFraction(meta.buy, meta.get));
  }

  if (appliesDiscount) {
    net = net * (1 - (meta.discountPercent ?? 0) / 100);
  }

  return round2(net);
}
