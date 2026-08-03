import {
  MIN_ORDER_VALUE_INR,
  effectiveMinimumQuantity,
  lineValueWithGst,
  listingLotSize,
  meetsMinimumOrderValue,
  minimumQuantityForValue,
} from './minimum-order.util';

/**
 * The Rs 20,000 rule lived only in the browser. These pin the server-side
 * version to the same two decisions the storefront was fixed to follow:
 * the value is GST-INCLUSIVE and PER LINE, and the lot is `buy`, not
 * `buy + get`.
 */

describe('lineValueWithGst', () => {
  it('includes GST - the rule is written on the GST-inclusive figure', () => {
    // 100 units at Rs 100 net = Rs 10,000 goods + 12% = Rs 11,200
    expect(lineValueWithGst(100, 100, 12)).toBe(11200);
  });

  it('uses the listing GST slab it is given, not a fixed one', () => {
    expect(lineValueWithGst(100, 100, 5)).toBe(10500);
    expect(lineValueWithGst(100, 100, 18)).toBe(11800);
  });

  it('falls back to 12% only when the listing carries no slab', () => {
    expect(lineValueWithGst(100, 100, null)).toBe(11200);
    expect(lineValueWithGst(100, 100, undefined)).toBe(11200);
  });

  it('treats 0% GST as a real slab, not as missing', () => {
    // The dangerous confusion: `gst ?? 12` is right, `gst || 12` is not.
    expect(lineValueWithGst(100, 100, 0)).toBe(10000);
  });
});

describe('meetsMinimumOrderValue', () => {
  it('accepts a line exactly on Rs 20,000', () => {
    // 200 x 89.2857... is awkward on purpose; use a clean GST-inclusive hit
    expect(meetsMinimumOrderValue(200, 89.29, 12)).toBe(true);
    expect(lineValueWithGst(200, 89.29, 12)).toBeGreaterThanOrEqual(
      MIN_ORDER_VALUE_INR,
    );
  });

  it('rejects a line one unit short', () => {
    const price = 89.29;
    const min = minimumQuantityForValue(price, 12);
    expect(meetsMinimumOrderValue(min - 1, price, 12)).toBe(false);
  });

  it('does not reject on float dust just under the boundary', () => {
    // Contrived so quantity x price x tax lands microscopically below 20000.
    const price = 20000 / 1.12 / 137;
    expect(meetsMinimumOrderValue(137, price, 12)).toBe(true);
  });
});

describe('listingLotSize', () => {
  it('is `buy`, never `buy + get`', () => {
    // "buy 4 get 1" steps in 4s. A lot of 5 would bill the free unit.
    expect(listingLotSize('SAME_PRODUCT_BONUS', { buy: 4, get: 1 })).toBe(4);
  });

  it('applies to every bonus-bearing scheme type', () => {
    for (const type of [
      'SAME_PRODUCT_BONUS',
      'DIFFERENT_PRODUCT_BONUS',
      'PTR_PLUS_SAME_PRODUCT_BONUS',
      'PTR_PLUS_DIFFERENT_PRODUCT_BONUS',
    ]) {
      expect(listingLotSize(type, { buy: 20, get: 2 })).toBe(20);
    }
  });

  it('is 1 for schemes with no bonus', () => {
    expect(listingLotSize('PTR_DISCOUNT', { buy: 4, get: 1 })).toBe(1);
    expect(listingLotSize('SPECIAL_PRICE', null)).toBe(1);
    expect(listingLotSize(null, null)).toBe(1);
  });

  it('is 1 when the scheme is bonus-typed but the metadata is unusable', () => {
    expect(listingLotSize('SAME_PRODUCT_BONUS', { buy: 0, get: 1 })).toBe(1);
    expect(listingLotSize('SAME_PRODUCT_BONUS', null)).toBe(1);
  });
});

describe('minimumQuantityForValue', () => {
  it('returns a quantity that actually clears the floor', () => {
    const qty = minimumQuantityForValue(196.06, 12);
    expect(meetsMinimumOrderValue(qty, 196.06, 12)).toBe(true);
  });

  it('returns the SMALLEST such quantity - one less must fail', () => {
    const qty = minimumQuantityForValue(196.06, 12);
    expect(meetsMinimumOrderValue(qty - 1, 196.06, 12)).toBe(false);
  });

  it('rounds up to a whole lot', () => {
    // Lot of 20: the answer must be divisible by 20 and still clear the floor.
    const qty = minimumQuantityForValue(196.06, 12, 20);
    expect(qty % 20).toBe(0);
    expect(meetsMinimumOrderValue(qty, 196.06, 12)).toBe(true);
  });

  it('never returns a quantity below the lot itself', () => {
    // An expensive listing clears Rs 20,000 in 2 units but steps in 4s.
    const qty = minimumQuantityForValue(10000, 12, 4);
    expect(qty).toBe(4);
  });

  /**
   * The failure this function exists to prevent. Deriving the minimum by
   * division alone lands one lot out whenever the quotient falls a hair
   * either side of a whole number - the storefront shipped that bug and had
   * to be corrected separately. Sweeping the space is the only way to be sure
   * the two can never disagree again.
   */
  it('is self-consistent across the whole realistic price range', () => {
    const gstSlabs = [0, 5, 12, 18];
    const lots = [1, 4, 10, 20];
    let checked = 0;

    for (const gst of gstSlabs) {
      for (const lot of lots) {
        for (let paise = 50; paise <= 500000; paise += 137) {
          const price = paise / 100;
          const qty = minimumQuantityForValue(price, gst, lot);

          // clears the floor
          expect(meetsMinimumOrderValue(qty, price, gst)).toBe(true);
          // is a whole lot
          expect(qty % lot).toBe(0);
          // is minimal: one lot less must fall short (unless already one lot)
          if (qty > lot) {
            expect(meetsMinimumOrderValue(qty - lot, price, gst)).toBe(false);
          }
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(50000);
  });

  it('degrades safely on a price it cannot use', () => {
    expect(minimumQuantityForValue(0, 12)).toBe(1);
    expect(minimumQuantityForValue(-5, 12)).toBe(1);
    expect(minimumQuantityForValue(NaN, 12)).toBe(1);
  });
});

describe('effectiveMinimumQuantity', () => {
  it('takes the seller stored minimum when it is the higher of the two', () => {
    // Rs 20,000 needs ~102 units here; the seller demands 500.
    expect(effectiveMinimumQuantity(196.06, 12, 500)).toBe(500);
  });

  it('takes the platform floor when the stored minimum is stale and lower', () => {
    // This is the live condition: ~100 listings carry a stored minimum
    // written before the Rs 20,000 rule, well below what it now requires.
    const floor = minimumQuantityForValue(196.06, 12);
    expect(effectiveMinimumQuantity(196.06, 12, 10)).toBe(floor);
    expect(floor).toBeGreaterThan(10);
  });

  it('never returns less than 1 when no minimum is stored', () => {
    expect(effectiveMinimumQuantity(10000, 12, null)).toBeGreaterThanOrEqual(1);
    expect(effectiveMinimumQuantity(10000, 12, 0)).toBeGreaterThanOrEqual(1);
  });
});
