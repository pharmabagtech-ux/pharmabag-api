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
 * Net per-unit price a buyer pays, BEFORE GST.
 *
 * Bonus quantities (buy X get Y) deliberately do NOT change the price: free
 * units are shown to the buyer but never billed, and are not added to the
 * order. Only a PTR discount, or an explicit special price, moves the number.
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

  const meta = discountMeta ?? {};
  const discountPercent = meta.discountPercent ?? 0;

  switch (discountType) {
    case 'PTR_DISCOUNT':
    case 'PTR_PLUS_SAME_PRODUCT_BONUS':
    case 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS':
      return round2(ptr - (ptr * discountPercent) / 100);

    // Bonus-only schemes give free units; the unit price stays at PTR.
    case 'SAME_PRODUCT_BONUS':
    case 'DIFFERENT_PRODUCT_BONUS':
      return ptr;

    // No scheme at all: the buyer still pays PTR, not MRP.
    default:
      return ptr;
  }
}
