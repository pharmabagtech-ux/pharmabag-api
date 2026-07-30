import { Prisma } from '@prisma/client';

/** Fields a catalogue search looks at. */
const searchableFields = (term: string): Prisma.MasterProductWhereInput[] => [
  { name: { contains: term, mode: 'insensitive' } },
  { manufacturer: { contains: term, mode: 'insensitive' } },
  { chemicalComposition: { contains: term, mode: 'insensitive' } },
];

/**
 * Builds the catalogue search filter.
 *
 * The previous version passed the raw query straight into a single `contains`,
 * which meant the whole phrase had to appear verbatim. Any stray whitespace
 * broke it outright — "Telekast 10mg Tablet " with a trailing space matched
 * nothing — and so did any wording where the words are not adjacent, e.g.
 * "Telekast Tablet" against "Telekast 10mg Tablet".
 *
 * The query is now trimmed and its whitespace collapsed, then every word must
 * appear in at least one searchable field. A verbatim phrase still matches,
 * because a phrase satisfies the per-word requirement too.
 *
 * Words shorter than two characters are dropped: a stray "a" or "-" would match
 * most of the catalogue and drown the real results. If nothing survives that,
 * the cleaned string is used as-is so a genuine one-character search still works.
 *
 * Returns null when there is nothing to search for.
 */
export function buildSearchCondition(
  search?: string | null,
): Prisma.MasterProductWhereInput | null {
  const cleaned = (search ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;

  const words = cleaned.split(' ').filter((w) => w.length >= 2);
  const terms = words.length > 0 ? words : [cleaned];

  return { AND: terms.map((term) => ({ OR: searchableFields(term) })) };
}
