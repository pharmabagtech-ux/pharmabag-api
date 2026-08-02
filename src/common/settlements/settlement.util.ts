/**
 * What a seller is owed for one order item.
 *
 * This exists because the arithmetic was copied into five places
 * (orders.service, three spots in admin.service, payments.service) and one of
 * those copies drifted: `syncSettlements` wrote `commission = 0` and a
 * GST-exclusive amount, so every settlement created through the admin
 * "Paid" button silently waived the platform's 5%. On a single reported order
 * that was ₹3,432.44. Five copies of a money formula is the bug; one function
 * is the fix.
 *
 * The model, confirmed with the business:
 *
 *   The SUPPLYING WHOLESALER issues the GST invoice, so the tax is theirs to
 *   collect and remit — the platform must not hold it. The seller therefore
 *   receives the goods value PLUS GST, less commission.
 *
 *   Commission is charged on the GOODS VALUE ONLY, never on the tax. Taking a
 *   cut of GST would be taking a cut of money that belongs to the exchequer.
 *
 * So, per item:
 *
 *   goodsValue = totalPrice                        (GST-exclusive, as stored)
 *   gstAmount  = goodsValue x gstPercent / 100
 *   gross      = goodsValue + gstAmount            (what the buyer paid)
 *   commission = goodsValue x 5%
 *   amount     = gross - commission                (what the seller receives)
 */

/** Platform commission, charged on goods value only. */
export const SELLER_COMMISSION_RATE = 0.05;

/**
 * Used when a product carries no slab. Matches the fallback in
 * `OrdersService.checkout`, so a seller is never credited tax the buyer was
 * not charged, nor vice versa.
 */
export const FALLBACK_GST_PERCENT = 12;

export interface SettlementInput {
  /** OrderItem.totalPrice — quantity x unitPrice, GST-EXCLUSIVE. */
  totalPrice: number;
  /** Product.gstPercent. Null/undefined falls back to FALLBACK_GST_PERCENT. */
  gstPercent?: number | null;
}

export interface SettlementBreakdown {
  /** GST-exclusive value of the goods. The commission basis. */
  goodsValue: number;
  gstPercent: number;
  gstAmount: number;
  /** goodsValue + gstAmount — the figure the buyer paid for this line. */
  gross: number;
  /** SELLER_COMMISSION_RATE of goodsValue. Never charged on tax. */
  commission: number;
  /** gross - commission — what the seller is actually paid. */
  amount: number;
}

/** Rounds to paise. Money is never left at full float precision. */
function toPaise(value: number): number {
  return +value.toFixed(2);
}

export function calculateSettlement(input: SettlementInput): SettlementBreakdown {
  const goodsValue = Number(input.totalPrice) || 0;
  const gstPercent =
    typeof input.gstPercent === 'number' && Number.isFinite(input.gstPercent)
      ? input.gstPercent
      : FALLBACK_GST_PERCENT;

  const gstAmount = toPaise(goodsValue * (gstPercent / 100));
  const gross = toPaise(goodsValue + gstAmount);
  const commission = toPaise(goodsValue * SELLER_COMMISSION_RATE);
  const amount = toPaise(gross - commission);

  return { goodsValue: toPaise(goodsValue), gstPercent, gstAmount, gross, commission, amount };
}

/**
 * Whether an order is eligible to be settled at all.
 *
 * Both conditions matter and `syncSettlements` enforced only the first, which
 * is how sellers were paid out for orders the buyer had not paid for — money
 * out before money in. Every creation path now goes through this.
 */
export function isSettleable(order: {
  orderStatus: string;
  paymentStatus: string;
}): boolean {
  return order.orderStatus === 'DELIVERED' && order.paymentStatus === 'SUCCESS';
}
