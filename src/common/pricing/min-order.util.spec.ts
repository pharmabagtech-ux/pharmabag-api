import {
  MIN_ORDER_VALUE,
  lineOrderValue,
  minQuantityForOrderValue,
  checkMinimumOrderValue,
} from './min-order.util';

describe('minimum order value', () => {
  describe('lineOrderValue', () => {
    it('adds GST, because the rule is GST-inclusive', () => {
      // AB Flo Tablet: net 187.52 at 5%, the storefront minimum of 102
      expect(lineOrderValue(187.52, 102, 5)).toBe(20083);
    });

    it('rounds subtotal and GST separately, the way the bag does', () => {
      // Budecort 0.5mg Respule: net 12.42 at 5%
      expect(lineOrderValue(12.42, 1533, 5)).toBe(19992); // what was reported
      expect(lineOrderValue(12.42, 1536, 5)).toBe(20031); // one lot more
    });

    it('handles a zero GST slab', () => {
      expect(lineOrderValue(100, 200, 0)).toBe(20000);
    });
  });

  describe('minQuantityForOrderValue', () => {
    it('clears the floor for a product with no scheme', () => {
      const qty = minQuantityForOrderValue(187.52, 5, null);
      expect(qty).toBe(102);
      expect(lineOrderValue(187.52, qty, 5)).toBeGreaterThanOrEqual(MIN_ORDER_VALUE);
    });

    it('rounds up to a whole scheme lot, and the lot is buy not buy+get', () => {
      // Budecort: 3 + 1. 1534 clears the floor but is not a multiple of 3.
      const qty = minQuantityForOrderValue(12.42, 5, { buy: 3, get: 1 });
      expect(qty).toBe(1536);
      expect(qty % 3).toBe(0);
    });

    it('does not round when the scheme has no free units', () => {
      // buy is defaulted all over the pricing code even without a bonus, so
      // keying off buy alone would round a plain discount listing.
      expect(minQuantityForOrderValue(187.52, 5, { buy: 9, get: 0 })).toBe(102);
    });

    it('returns 0 rather than dividing by zero on a missing price', () => {
      expect(minQuantityForOrderValue(0, 5, null)).toBe(0);
    });
  });

  describe('checkMinimumOrderValue', () => {
    it('passes a line that clears the floor', () => {
      expect(checkMinimumOrderValue(187.52, 102, 5, null)).toBeNull();
    });

    it('rejects the reported short line and names the quantity needed', () => {
      const msg = checkMinimumOrderValue(12.42, 1533, 5, { buy: 3, get: 1 });
      expect(msg).toContain('19,992');
      expect(msg).toContain('20,000');
      expect(msg).toContain('1536');
    });

    it('rejects without suggesting a quantity when it cannot better the ask', () => {
      // stock-limited nonsense input: price so low no sane quantity helps
      const msg = checkMinimumOrderValue(0, 10, 5, null);
      expect(msg).not.toBeNull();
      expect(msg).not.toContain('Order at least');
    });

    it('honours a caller-supplied floor', () => {
      expect(checkMinimumOrderValue(100, 50, 0, null, 5000)).toBeNull();
      expect(checkMinimumOrderValue(100, 49, 0, null, 5000)).toContain('4,900');
    });
  });

  describe('the figures already signed off with the client', () => {
    // Each of these is a live listing or a worked example the client approved.
    // The server must not reject a quantity the buyer app offers.
    const cases: Array<[string, number, number, { buy?: number; get?: number } | null, number]> = [
      ['worked example, no scheme', 64.2, 12, null, 279],
      ['O2 Syrup 60mL, 4+1', 44.3, 5, { buy: 4, get: 1 }, 432],
      ['buy 7 get 5', 262.14, 12, { buy: 7, get: 5 }, 70],
      ['AB Flo Tablet', 187.52, 5, null, 102],
      ['AB Flo SR 200mg', 189.3, 5, null, 101],
      ['Budecort 0.5mg Respule, 3+1', 12.42, 5, { buy: 3, get: 1 }, 1536],
    ];

    it.each(cases)('accepts %s at %p/%p -> qty %p', (_label, unitPrice, gst, meta, qty) => {
      expect(checkMinimumOrderValue(unitPrice, qty as number, gst, meta as any)).toBeNull();
      expect(minQuantityForOrderValue(unitPrice, gst, meta as any)).toBeLessThanOrEqual(qty as number);
    });
  });
});
