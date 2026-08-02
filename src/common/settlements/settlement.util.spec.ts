import {
  calculateSettlement,
  isSettleable,
  SELLER_COMMISSION_RATE,
  FALLBACK_GST_PERCENT,
} from './settlement.util';

/**
 * The three line values of order A305E057 from the report. The seller portal
 * showed ₹68,648.72 for it (goods only) while admin showed ₹76,179.00, so the
 * order's total GST is ₹7,530.28.
 *
 * The PER-LINE slabs are not known from the report — only the totals — so this
 * fixture carries the amounts and asserts the things that do not depend on the
 * split: the goods value and the commission. An earlier version of this test
 * guessed 5/12/12 and asserted a gross of ₹76,179.00; the guess produced
 * ₹75,158.58 and the assertion correctly failed. Do not re-add an assertion
 * that needs slabs we do not have.
 */
const A305E057_LINE_VALUES = [24685.56, 17000.0, 26963.16];
const A305E057_GOODS = 68648.72;
const A305E057_COMMISSION = 3432.44; // 5% of goods, independent of the slabs

describe('calculateSettlement', () => {
  it('pays the seller the GST, because they issue the invoice', () => {
    const s = calculateSettlement({ totalPrice: 1000, gstPercent: 12 });
    expect(s.goodsValue).toBe(1000);
    expect(s.gstAmount).toBe(120);
    expect(s.gross).toBe(1120);
    // the seller receives goods + tax, less commission on goods
    expect(s.amount).toBe(1120 - 50);
  });

  it('charges commission on the goods value ONLY, never on the tax', () => {
    const s = calculateSettlement({ totalPrice: 1000, gstPercent: 12 });
    expect(s.commission).toBe(1000 * SELLER_COMMISSION_RATE);
    // the naive mistake would be 5% of the gross 1120 = 56
    expect(s.commission).not.toBe(1120 * SELLER_COMMISSION_RATE);
  });

  it('recovers the commission syncSettlements was waiving on the reported order', () => {
    // Commission depends only on goods value, so it is checkable without the
    // per-line slabs.
    const lines = A305E057_LINE_VALUES.map((totalPrice) =>
      calculateSettlement({ totalPrice, gstPercent: 12 }),
    );

    const goods = +lines.reduce((s, l) => s + l.goodsValue, 0).toFixed(2);
    const commission = +lines.reduce((s, l) => s + l.commission, 0).toFixed(2);

    expect(goods).toBe(A305E057_GOODS);
    expect(commission).toBe(A305E057_COMMISSION);
    // syncSettlements wrote commission: 0 — this is what was given away
    expect(commission).toBeGreaterThan(0);
  });

  it('keeps gross and payable consistent whatever the slab is', () => {
    for (const gstPercent of [0, 5, 12, 18]) {
      const lines = A305E057_LINE_VALUES.map((totalPrice) =>
        calculateSettlement({ totalPrice, gstPercent }),
      );
      const goods = +lines.reduce((s, l) => s + l.goodsValue, 0).toFixed(2);
      const gst = +lines.reduce((s, l) => s + l.gstAmount, 0).toFixed(2);
      const gross = +lines.reduce((s, l) => s + l.gross, 0).toFixed(2);
      const commission = +lines.reduce((s, l) => s + l.commission, 0).toFixed(2);
      const payable = +lines.reduce((s, l) => s + l.amount, 0).toFixed(2);

      expect(gross).toBeCloseTo(goods + gst, 2);
      expect(payable).toBeCloseTo(gross - commission, 2);
      // the seller always nets more than the old GST-exclusive figure minus 5%
      expect(payable).toBeGreaterThan(goods - commission - 0.01);
    }
  });

  it('falls back to 12% when a product has no slab, matching checkout', () => {
    const s = calculateSettlement({ totalPrice: 1000, gstPercent: null });
    expect(s.gstPercent).toBe(FALLBACK_GST_PERCENT);
    expect(s.gstAmount).toBe(120);
  });

  it('handles a 0% slab without inventing tax', () => {
    const s = calculateSettlement({ totalPrice: 1000, gstPercent: 0 });
    expect(s.gstAmount).toBe(0);
    expect(s.gross).toBe(1000);
    expect(s.amount).toBe(950);
  });

  it('rounds to paise', () => {
    const s = calculateSettlement({ totalPrice: 24685.56, gstPercent: 5 });
    expect(s.gstAmount).toBe(1234.28);
    expect(s.commission).toBe(1234.28);
    expect(Number.isInteger(s.amount * 100)).toBe(true);
  });

  it('never returns NaN for a missing price', () => {
    const s = calculateSettlement({ totalPrice: undefined as any, gstPercent: 12 });
    expect(s.amount).toBe(0);
    expect(s.commission).toBe(0);
  });
});

describe('isSettleable', () => {
  it('requires the order to be delivered AND paid', () => {
    expect(isSettleable({ orderStatus: 'DELIVERED', paymentStatus: 'SUCCESS' })).toBe(true);
  });

  it('refuses a delivered order the buyer has not paid for', () => {
    // this is exactly what syncSettlements allowed
    expect(isSettleable({ orderStatus: 'DELIVERED', paymentStatus: 'PENDING' })).toBe(false);
  });

  it('refuses a paid order that has not been delivered', () => {
    expect(isSettleable({ orderStatus: 'SHIPPED', paymentStatus: 'SUCCESS' })).toBe(false);
  });
});
