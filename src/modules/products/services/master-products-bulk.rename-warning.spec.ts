import { MasterProductsBulkService } from './master-products-bulk.service';

/**
 * When the sheet changes a name against a SKU, that rename is pushed down onto
 * every seller listing on that SKU — the SKU is the anchor for the product's
 * identity.
 *
 * The mechanism cannot tell a spelling correction from "this SKU is now a
 * different drug", and the second silently relabels a seller's physical stock.
 * That is what happened to 1,576 master products on 2026-07-28. This heuristic
 * does not block the rename; it decides which ones are reported for review.
 */
const svc = new MasterProductsBulkService({} as any);
const sameProduct = (a: string, b: string): boolean =>
  (svc as any).looksLikeSameProduct(a, b);

describe('rename warning heuristic', () => {
  it('treats spelling and format corrections as the same product', () => {
    expect(sameProduct('Brutaflam Plus Tablets', 'Brutaflam Plus Tablet')).toBe(true);
    expect(sameProduct('AB Flo SR Tablet 1*', 'AB Flo SR 200mg Tablet')).toBe(true);
    expect(sameProduct('Acenac P Tablet', 'Acenac-P Tablet')).toBe(true);
    expect(sameProduct('Zincovit  Syrup', 'Zincovit Syrup 200 mL')).toBe(true);
  });

  it('does not treat a shared dosage form as evidence of the same product', () => {
    // "Tablet" appears in most product names and carries no identity
    expect(sameProduct('AB Flo SR Tablet', 'Irex Tablet')).toBe(false);
    expect(sameProduct('Something Syrup', 'Another Syrup')).toBe(false);
  });

  it('reports a change to the brand word itself', () => {
    // A altered brand spelling is worth a human look, even if benign
    expect(sameProduct('Esgipyrin Tablet', 'Esgiprin Tablet')).toBe(false);
  });

  it('flags a rename into a completely different drug', () => {
    // the 2026-07-28 corruption, as it would appear here
    expect(sameProduct('Acenac P Tablet', 'Gutwash 4000 Syrup')).toBe(false);
    expect(sameProduct('Budamate 400 Transcaps', 'Olkem 20 H Tablet')).toBe(false);
    expect(sameProduct('AB Flo SR Tablet', 'Irex Tablet')).toBe(false);
    expect(sameProduct('Brutaflam Plus Tablets', 'Revidox LB Capsule')).toBe(false);
  });

  it('does not rely on single characters or punctuation', () => {
    // one-letter tokens are ignored, so these share nothing meaningful
    expect(sameProduct('A B', 'C D')).toBe(false);
    expect(sameProduct('---', 'Acenac P Tablet')).toBe(false);
  });

  it('handles empty input without claiming a match', () => {
    expect(sameProduct('', 'Acenac P Tablet')).toBe(false);
    expect(sameProduct('Acenac P Tablet', '')).toBe(false);
  });
});
