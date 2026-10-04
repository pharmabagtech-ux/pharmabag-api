import { normalisePlacements } from './placements.util';

/**
 * `@@unique([bannerId, scope, categoryId])` looks like it prevents duplicate
 * placements. It does not: Postgres treats NULL as distinct in a unique index,
 * so two HOMEPAGE rows for one banner — categoryId NULL in both — are accepted
 * by the database without complaint. Deduplication therefore has to happen
 * here, before the write, or an admin who ticks a box twice in two saves ends
 * up with a banner the read query returns once but the admin screen lists
 * twice.
 */
describe('normalisePlacements', () => {
  it('drops an exact duplicate HOMEPAGE placement', () => {
    expect(
      normalisePlacements([{ scope: 'HOMEPAGE' }, { scope: 'HOMEPAGE' }]),
    ).toEqual([{ scope: 'HOMEPAGE', categoryId: null }]);
  });

  it('drops a duplicate CATEGORY placement for the same category', () => {
    expect(
      normalisePlacements([
        { scope: 'CATEGORY', categoryId: 'cat-1' },
        { scope: 'CATEGORY', categoryId: 'cat-1' },
      ]),
    ).toEqual([{ scope: 'CATEGORY', categoryId: 'cat-1' }]);
  });

  it('keeps two CATEGORY placements for different categories', () => {
    expect(
      normalisePlacements([
        { scope: 'CATEGORY', categoryId: 'cat-1' },
        { scope: 'CATEGORY', categoryId: 'cat-2' },
      ]),
    ).toHaveLength(2);
  });

  it('forces categoryId to null on HOMEPAGE and ALL_CATEGORIES', () => {
    expect(
      normalisePlacements([
        { scope: 'HOMEPAGE', categoryId: 'cat-1' },
        { scope: 'ALL_CATEGORIES', categoryId: 'cat-2' },
      ]),
    ).toEqual([
      { scope: 'HOMEPAGE', categoryId: null },
      { scope: 'ALL_CATEGORIES', categoryId: null },
    ]);
  });

  it('drops a CATEGORY placement with no categoryId rather than storing a null target', () => {
    expect(normalisePlacements([{ scope: 'CATEGORY' }])).toEqual([]);
    expect(normalisePlacements([{ scope: 'CATEGORY', categoryId: null }])).toEqual([]);
  });

  it('keeps ALL_CATEGORIES alongside a specific CATEGORY', () => {
    // Not a contradiction: the read query ORs them and Prisma returns the
    // banner once. Collapsing them here would lose the admin's intent the
    // moment they untick ALL_CATEGORIES.
    expect(
      normalisePlacements([
        { scope: 'ALL_CATEGORIES' },
        { scope: 'CATEGORY', categoryId: 'cat-1' },
      ]),
    ).toHaveLength(2);
  });

  it('preserves input order, so the admin form round-trips unchanged', () => {
    expect(
      normalisePlacements([
        { scope: 'CATEGORY', categoryId: 'cat-2' },
        { scope: 'HOMEPAGE' },
        { scope: 'CATEGORY', categoryId: 'cat-1' },
      ]),
    ).toEqual([
      { scope: 'CATEGORY', categoryId: 'cat-2' },
      { scope: 'HOMEPAGE', categoryId: null },
      { scope: 'CATEGORY', categoryId: 'cat-1' },
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalisePlacements([])).toEqual([]);
  });
});
