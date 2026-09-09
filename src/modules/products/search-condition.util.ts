import { Prisma } from '@prisma/client';

/** Fields a catalogue search looks at. */
const searchableFields = (term: string): Prisma.MasterProductWhereInput[] => [
  { name: { contains: term, mode: 'insensitive' } },
  { manufacturer: { contains: term, mode: 'insensitive' } },
  { chemicalComposition: { contains: term, mode: 'insensitive' } },
];

/**
 * Words are separated by whitespace and by the punctuation brand names use.
 *
 * The catalogue is inconsistent about the hyphen — the same brand is
 * "1 AL 10mg Tablet" as a tablet but "1-AL Syrup" as a syrup. Treating the
 * hyphen as a separator means typing the brand either way finds the whole
 * range instead of half of it.
 */
const SEPARATORS = /[\s\-/,]+/;

interface Tokens {
  /** The query with its whitespace trimmed and collapsed. */
  cleaned: string;
  /** The words every match must contain. */
  words: string[];
}

/**
 * Splits a query into the words a match must contain.
 *
 * Single-character words are dropped, because a stray "a" or "-" matches most
 * of the catalogue and drowns the real results — EXCEPT digits. A lone "1" is
 * not noise the way a lone "a" is: it is the first half of "1 AL 10mg Tablet",
 * and dropping it discarded the most selective token in the query. If nothing
 * survives, the cleaned string is used as-is so a genuine one-character search
 * still works.
 */
function tokenize(search?: string | null): Tokens {
  const cleaned = (search ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { cleaned: '', words: [] };

  const parts = cleaned.split(SEPARATORS).filter(Boolean);
  const kept = parts.filter((w) => w.length >= 2 || /\d/.test(w));

  return { cleaned, words: kept.length > 0 ? kept : [cleaned] };
}

/**
 * Builds the catalogue search filter — which products may appear at all.
 *
 * The previous version passed the raw query straight into a single `contains`,
 * which meant the whole phrase had to appear verbatim. Any stray whitespace
 * broke it outright — "Telekast 10mg Tablet " with a trailing space matched
 * nothing — and so did any wording where the words are not adjacent, e.g.
 * "Telekast Tablet" against "Telekast 10mg Tablet".
 *
 * The query is now trimmed and split into words, and every word must appear in
 * at least one searchable field. A verbatim phrase still matches, because a
 * phrase satisfies the per-word requirement too.
 *
 * This decides ELIGIBILITY only. It deliberately says nothing about order —
 * see `buildSearchRelevanceTiers` for that.
 *
 * Returns null when there is nothing to search for.
 */
export function buildSearchCondition(
  search?: string | null,
): Prisma.MasterProductWhereInput | null {
  const { cleaned, words } = tokenize(search);
  if (!cleaned) return null;

  return { AND: words.map((term) => ({ OR: searchableFields(term) })) };
}

/**
 * Builds the relevance tiers a search is ordered by, best first.
 *
 * Reported: searching "1 al 10 mg" never surfaced "1 AL 10mg Tablet". The
 * product was not missing — it was result 358 of 2,966, because the search was
 * a filter with nothing ranking it. "Nortipan M Tablet" scored exactly as high
 * on its composition ("Pregabalin ... 10mg") as the product actually named in
 * the query, and searching the exact full name put the exact match fourth.
 *
 * The tiers are:
 *   1. the name IS the query
 *   2. the name STARTS WITH the query
 *   3. every word appears in the NAME
 *   4. everything else eligible (a manufacturer or composition match)
 *
 * They are mutually exclusive by construction — each excludes the ones above
 * it — so their counts sum to the unranked total and paging cannot repeat or
 * skip a row. Returns null when there is nothing to search for, in which case
 * a browse keeps its single, unranked ordering.
 */
export function buildSearchRelevanceTiers(
  search?: string | null,
): Prisma.MasterProductWhereInput[] | null {
  const { cleaned, words } = tokenize(search);
  if (!cleaned) return null;

  const insensitive = 'insensitive' as const;
  const isExactName = { name: { equals: cleaned, mode: insensitive } };
  const startsWithQuery = { name: { startsWith: cleaned, mode: insensitive } };
  const everyWordInName = words.map((term) => ({
    name: { contains: term, mode: insensitive },
  }));

  return [
    isExactName,
    { ...startsWithQuery, NOT: isExactName },
    { AND: everyWordInName, NOT: startsWithQuery },
    { NOT: { AND: everyWordInName } },
  ];
}
