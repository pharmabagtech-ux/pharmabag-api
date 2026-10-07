import { BannerScope } from '@prisma/client';

export interface PlacementInput {
  scope: BannerScope | 'HOMEPAGE' | 'ALL_CATEGORIES' | 'CATEGORY';
  categoryId?: string | null;
}

export interface NormalisedPlacement {
  scope: BannerScope;
  categoryId: string | null;
}

/**
 * Collapses an incoming placement set to what should actually be stored.
 *
 *  - HOMEPAGE and ALL_CATEGORIES carry no category, so a categoryId sent
 *    alongside them is discarded rather than stored and silently ignored.
 *  - CATEGORY without a categoryId has no target at all and is dropped.
 *  - Exact duplicates are removed. The database will NOT do this for us:
 *    NULLs are distinct in a Postgres unique index, so two HOMEPAGE rows for
 *    the same banner satisfy @@unique([bannerId, scope, categoryId]).
 *
 * Order is preserved so the admin form's checkbox order survives a round trip.
 */
export function normalisePlacements(
  input: readonly PlacementInput[],
): NormalisedPlacement[] {
  const seen = new Set<string>();
  const out: NormalisedPlacement[] = [];

  for (const entry of input) {
    const scope = entry.scope as BannerScope;
    const categoryId = scope === 'CATEGORY' ? (entry.categoryId ?? null) : null;

    if (scope === 'CATEGORY' && !categoryId) continue;

    const key = `${scope}:${categoryId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ scope, categoryId });
  }

  return out;
}
