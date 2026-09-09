import { buildSearchCondition } from './search-condition.util';

/**
 * Reported: "when a space is given it won't show products".
 * "Telekast 10mg Tablet" returned 1 result, but the same string with a trailing
 * space returned none, because the raw query went into a single `contains`.
 */
const termsOf = (search: string): string[] => {
  const cond: any = buildSearchCondition(search);
  return (cond?.AND ?? []).map((c: any) => c.OR[0].name.contains);
};

describe('buildSearchCondition', () => {
  it('ignores a trailing space', () => {
    expect(termsOf('Telekast 10mg Tablet ')).toEqual([
      'Telekast',
      '10mg',
      'Tablet',
    ]);
  });

  it('ignores a leading space', () => {
    expect(termsOf(' Telekast 10mg Tablet')).toEqual([
      'Telekast',
      '10mg',
      'Tablet',
    ]);
  });

  it('collapses repeated spaces', () => {
    expect(termsOf('Telekast   10mg  Tablet')).toEqual([
      'Telekast',
      '10mg',
      'Tablet',
    ]);
  });

  it('matches words that are not adjacent in the product name', () => {
    // "Telekast Tablet" must find "Telekast 10mg Tablet"
    expect(termsOf('Telekast Tablet')).toEqual(['Telekast', 'Tablet']);
  });

  it('requires every word, so each becomes its own AND branch', () => {
    const cond: any = buildSearchCondition('telekast tablet');
    expect(cond.AND).toHaveLength(2);
    // each word may match any searchable field
    expect(cond.AND[0].OR.map((o: any) => Object.keys(o)[0])).toEqual([
      'name',
      'manufacturer',
      'chemicalComposition',
    ]);
  });

  it('searches case-insensitively', () => {
    const cond: any = buildSearchCondition('telekast');
    expect(cond.AND[0].OR[0].name.mode).toBe('insensitive');
  });

  it('drops one-character noise words that would match everything', () => {
    expect(termsOf('telekast a')).toEqual(['telekast']);
  });

  it('still searches a genuine one-character query', () => {
    expect(termsOf('B')).toEqual(['B']);
  });

  /**
   * Reported: searching "1 al 10 mg" never surfaced "1 AL 10mg Tablet".
   * A lone "1" is not noise the way a lone "a" is — it is the first half of
   * the brand name, and dropping it threw away the query's most selective
   * token. Single letters stay dropped; single digits are kept.
   */
  it('keeps a single-digit word', () => {
    expect(termsOf('1 AL 10 mg')).toEqual(['1', 'AL', '10', 'mg']);
  });

  it('still drops a single letter', () => {
    expect(termsOf('telekast a')).toEqual(['telekast']);
  });

  /**
   * The catalogue is inconsistent about the hyphen — the tablets are named
   * "1 AL 10mg Tablet" but the syrups "1-AL Syrup". Typing the brand as it is
   * printed on the pack must find both, so a hyphen separates words.
   */
  it('splits on a hyphen so the brand matches either spelling', () => {
    expect(termsOf('1-AL')).toEqual(['1', 'AL']);
  });

  it('splits on a slash and a comma too', () => {
    expect(termsOf('Galvus Met 50/1000mg')).toEqual([
      'Galvus',
      'Met',
      '50',
      '1000mg',
    ]);
  });

  it('returns null when there is nothing to search for', () => {
    expect(buildSearchCondition('')).toBeNull();
    expect(buildSearchCondition('   ')).toBeNull();
    expect(buildSearchCondition(undefined)).toBeNull();
    expect(buildSearchCondition(null)).toBeNull();
  });
});
