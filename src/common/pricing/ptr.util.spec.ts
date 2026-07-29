import { calculateNetUnitPrice, calculatePTR } from './ptr.util';

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

  it('applies a PTR discount (the reported B-Colen case)', () => {
    // Seller portal showed: PTR 570.64, Final PTR 513.58
    expect(
      calculateNetUnitPrice(800, 12, 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS', {
        discountPercent: 10,
        buy: 20,
        get: 2,
        bonusProductName: '3-Nite Vag Capsule',
      }),
    ).toBe(513.58);
  });

  it('charges PTR, not MRP, when there is no scheme at all', () => {
    expect(calculateNetUnitPrice(800, 12, null, null)).toBe(570.64);
  });

  it('leaves the unit price at PTR for bonus-only schemes', () => {
    // Free units are shown to the buyer but never billed, so price is unchanged
    expect(
      calculateNetUnitPrice(800, 12, 'SAME_PRODUCT_BONUS', { buy: 20, get: 2 }),
    ).toBe(570.64);
    expect(
      calculateNetUnitPrice(800, 12, 'DIFFERENT_PRODUCT_BONUS', {
        buy: 20,
        get: 2,
      }),
    ).toBe(570.64);
  });

  it('applies the discount for PTR + same-product bonus', () => {
    // Aciloc: mrp 50.44, gst 5, 20% off -> ptr 38.43 -> 30.74
    expect(
      calculateNetUnitPrice(50.44, 5, 'PTR_PLUS_SAME_PRODUCT_BONUS', {
        buy: 11,
        get: 1,
        discountPercent: 20,
      }),
    ).toBe(30.74);
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
