import {
  calculateNetUnitPrice,
  calculatePTR,
  getBonusFraction,
} from './ptr.util';

/**
 * These figures are taken from the seller portal's own Pricing Preview, which
 * has always shown the correct numbers while the buyer side charged MRP.
 * They pin the API to the same arithmetic as packages/utils/src/pricing.ts.
 */
describe('PTR pricing', () => {
  it('derives PTR from MRP and the GST slab', () => {
    // MRP 800 at 12% GST -> 28.67% retail margin -> 570.64
    expect(calculatePTR(800, 12)).toBe(570.64);
    expect(calculatePTR(1000, 5)).toBe(761.9);
  });

  it('applies bonus then discount (the reported B-Colen case)', () => {
    // PTR 570.64 - bonus 2/22 (9.0909%) = 518.76 - 10% = 466.89
    expect(
      calculateNetUnitPrice(800, 12, 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS', {
        discountPercent: 10,
        buy: 20,
        get: 2,
        bonusProductName: '3-Nite Vag Capsule',
      }),
    ).toBe(466.89);
  });

  it('takes the bonus as get/(buy+get) of the price', () => {
    // buy 20 get 2 -> 2/22 -> 9.0909%
    expect(getBonusFraction(20, 2)).toBeCloseTo(0.090909, 6);
    expect(getBonusFraction(11, 1)).toBeCloseTo(0.083333, 6);
    // no usable bonus
    expect(getBonusFraction(20, 0)).toBe(0);
    expect(getBonusFraction(0, 2)).toBe(0);
    expect(getBonusFraction(undefined, undefined)).toBe(0);
  });

  it('order of bonus and discount does not change the result', () => {
    const ptr = 570.64;
    const bonusFirst = ptr * (1 - 2 / 22) * 0.9;
    const discountFirst = ptr * 0.9 * (1 - 2 / 22);
    expect(Math.round(bonusFirst * 100)).toBe(Math.round(discountFirst * 100));
  });

  it('charges PTR, not MRP, when there is no scheme at all', () => {
    expect(calculateNetUnitPrice(800, 12, null, null)).toBe(570.64);
  });

  it('reduces the price for bonus-only schemes', () => {
    // PTR 570.64 - 2/22 = 518.76. Free units are not added to the order;
    // the bonus reaches the buyer as this lower rate instead.
    expect(
      calculateNetUnitPrice(800, 12, 'SAME_PRODUCT_BONUS', { buy: 20, get: 2 }),
    ).toBe(518.76);
    expect(
      calculateNetUnitPrice(800, 12, 'DIFFERENT_PRODUCT_BONUS', {
        buy: 20,
        get: 2,
      }),
    ).toBe(518.76);
  });

  it('applies bonus and discount for PTR + same-product bonus', () => {
    // Aciloc: mrp 50.44, gst 5 -> ptr 38.43; - 1/12 bonus = 35.23; - 20% = 28.18
    expect(
      calculateNetUnitPrice(50.44, 5, 'PTR_PLUS_SAME_PRODUCT_BONUS', {
        buy: 11,
        get: 1,
        discountPercent: 20,
      }),
    ).toBe(28.18);
  });

  it('ignores a bonus with no get quantity', () => {
    expect(
      calculateNetUnitPrice(800, 12, 'PTR_DISCOUNT', { discountPercent: 10 }),
    ).toBe(513.58);
  });

  it('returns null rather than throwing on an unmapped GST slab', () => {
    // Must never be able to break checkout — caller falls back
    expect(calculateNetUnitPrice(800, 7, 'PTR_DISCOUNT', { discountPercent: 10 })).toBeNull();
    expect(calculatePTR(800, 7)).toBeNull();
  });

  it('returns null when mrp or gstPercent is missing', () => {
    expect(calculateNetUnitPrice(null, 12, 'PTR_DISCOUNT', {})).toBeNull();
    expect(calculateNetUnitPrice(800, null, 'PTR_DISCOUNT', {})).toBeNull();
    expect(calculateNetUnitPrice(0, 12, 'PTR_DISCOUNT', {})).toBeNull();
  });

  it('never returns more than MRP', () => {
    const net = calculateNetUnitPrice(800, 12, 'PTR_DISCOUNT', { discountPercent: 0 });
    expect(net).not.toBeNull();
    expect(net!).toBeLessThan(800);
  });
});
