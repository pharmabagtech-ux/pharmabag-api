# Promo Banner Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-managed slim banner strip under the header on the PharmaBag homepage and category pages, rotating as a slideshow, with artwork, link, placement, order and on/off state controlled entirely from the admin panel.

**Architecture:** A new `PromoBanner` table with a `PromoBannerPlacement` join table targets banners at the homepage, all category pages, or named categories. A new NestJS `banners` module serves one cached public read endpoint and admin CRUD guarded by the existing `marketing` permission area. The buyer storefront fetches server-side through a 60-second-revalidated helper and renders a single client component that owns rotation only. Full design rationale: `docs/superpowers/specs/2026-10-04-promo-banners-design.md`.

**Tech Stack:** NestJS 10 + Prisma + Postgres (api); Next.js 14 App Router + React Query + Tailwind, pnpm monorepo (web); S3 via `@aws-sdk/client-s3` for uploads; Jest for api specs.

---

## Before you start

**Two worktrees are already created. Work only in these — the user's real checkouts carry uncommitted work and must not be touched.**

| Repo | Worktree | Branch | Based on |
|---|---|---|---|
| `pharmabag-api` | `C:\tmp\pb-banners-api` | `feat/promo-banners` | `origin/main` |
| `pharmabag-web` | `C:\tmp\pb-banners-web` | `feat/promo-banners` | `upstream/main` |

**`node_modules` must be junctioned in, not installed:**

```powershell
New-Item -ItemType Junction -Path C:\tmp\pb-banners-api\node_modules -Target C:\Users\arkoc\OneDrive\Documents\Codebase\pharmabag-api\node_modules
New-Item -ItemType Junction -Path C:\tmp\pb-banners-web\node_modules -Target C:\Users\arkoc\OneDrive\Documents\Codebase\pharmabag-web\node_modules
foreach ($d in @('apps\admin','apps\buyer','apps\seller','apps\blog','packages\api-client','packages\ui','packages\utils','packages\types')) {
  $src = "C:\Users\arkoc\OneDrive\Documents\Codebase\pharmabag-web\$d\node_modules"
  if (Test-Path $src) { New-Item -ItemType Junction -Path "C:\tmp\pb-banners-web\$d\node_modules" -Target $src }
}
```

**When you are finished, delete the junctions BEFORE removing the worktree.** `git worktree remove --force` follows a junction and deletes the real `node_modules` behind it, which costs an `npm ci` *and* a `prisma generate` to recover.

**There is no `.env` and no local database.** Do not run `prisma migrate dev` — it will try to connect and fail. Migrations are hand-written SQL files (see the existing `prisma/migrations/*` timestamps, all hand-authored). `npx prisma generate` works offline and is what gives you the TypeScript types.

**`products.sitemap.spec.ts` fails with 5 tests on `main`.** It will fail here too. That is pre-existing; do not try to fix it and do not report it as a regression.

---

# PART A — `pharmabag-api` (must merge and deploy FIRST)

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261004120000_add_promo_banners/migration.sql`

- [ ] **Step 1: Add the models to `prisma/schema.prisma`**

Append after the `MarketingProduct` model and its `MarketingSlot` enum (around line 718):

```prisma
/// A promotional image strip rendered under the storefront header. The image
/// IS the content — there are no text fields to render — which is why altText
/// is required rather than optional: it is the only textual representation
/// this banner will ever have.
model PromoBanner {
  id             String   @id @default(uuid())
  title          String
  imageUrl       String
  mobileImageUrl String?
  altText        String
  linkUrl        String?
  active         Boolean  @default(true)
  position       Int      @default(0)
  placements     PromoBannerPlacement[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([active, position])
  @@map("promo_banners")
}

/// Where one banner is shown. A real FK to Category rather than a string token
/// on the banner, so deleting a category removes its targeting instead of
/// leaving a dangling id that silently matches nothing.
model PromoBannerPlacement {
  id         String      @id @default(uuid())
  bannerId   String
  scope      BannerScope
  categoryId String?
  banner     PromoBanner @relation(fields: [bannerId], references: [id], onDelete: Cascade)
  category   Category?   @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([bannerId, scope, categoryId])
  @@index([scope, categoryId])
  @@map("promo_banner_placements")
}

enum BannerScope {
  HOMEPAGE
  ALL_CATEGORIES
  CATEGORY
}
```

- [ ] **Step 2: Add the inverse relation to `Category`**

In `prisma/schema.prisma`, inside `model Category` (around line 135), add one field beside the existing `subCategories`:

```prisma
  bannerPlacements PromoBannerPlacement[]
```

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/20261004120000_add_promo_banners/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "BannerScope" AS ENUM ('HOMEPAGE', 'ALL_CATEGORIES', 'CATEGORY');

-- CreateTable
CREATE TABLE "promo_banners" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "mobileImageUrl" TEXT,
    "altText" TEXT NOT NULL,
    "linkUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_banner_placements" (
    "id" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "scope" "BannerScope" NOT NULL,
    "categoryId" TEXT,

    CONSTRAINT "promo_banner_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_banners_active_position_idx" ON "promo_banners"("active", "position");

-- CreateIndex
CREATE INDEX "promo_banner_placements_scope_categoryId_idx" ON "promo_banner_placements"("scope", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_banner_placements_bannerId_scope_categoryId_key" ON "promo_banner_placements"("bannerId", "scope", "categoryId");

-- AddForeignKey
ALTER TABLE "promo_banner_placements" ADD CONSTRAINT "promo_banner_placements_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "promo_banners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_banner_placements" ADD CONSTRAINT "promo_banner_placements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Generate the client and verify it compiles**

Run: `cd /c/tmp/pb-banners-api && npx prisma generate && npx tsc --noEmit`
Expected: `Generated Prisma Client` then tsc exits 0 with no output.

- [ ] **Step 5: Verify the SQL matches the schema**

Run: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DB" --exit-code`

If no shadow database is available (expected on this machine — there is no local Postgres), skip this step and instead re-read the SQL against the schema by eye, checking: three enum values, every column name and nullability, both indexes, the unique constraint column order, and both `ON DELETE CASCADE` clauses. Note in the commit message that the diff could not be run.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261004120000_add_promo_banners
git commit -m "feat(banners): promo_banners and promo_banner_placements tables"
```

---

### Task 2: Placement normalisation (pure, TDD)

The write path must deduplicate an incoming placement set. `@@unique([bannerId, scope, categoryId])` does **not** do this for you: Postgres treats NULLs as distinct in a unique index, so two `HOMEPAGE` rows for one banner (both with `categoryId = NULL`) are accepted by the database. This function is the only thing standing between the admin form and duplicate placements.

**Files:**
- Create: `src/modules/banners/placements.util.ts`
- Create: `src/modules/banners/placements.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/banners/placements.util.spec.ts`:

```ts
import { normalisePlacements } from './placements.util';

/**
 * `@@unique([bannerId, scope, categoryId])` looks like it prevents duplicate
 * placements. It does not: Postgres treats NULL as distinct in a unique index,
 * so two HOMEPAGE rows for one banner (categoryId NULL in both) are accepted.
 * Deduplication therefore has to happen here, before the write.
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
  });

  it('keeps ALL_CATEGORIES alongside a specific CATEGORY', () => {
    // ALL_CATEGORIES plus a named category is not a contradiction; the read
    // query ORs them and Prisma returns the banner once. Collapsing them here
    // would lose the admin's intent if they later untick ALL_CATEGORIES.
    expect(
      normalisePlacements([
        { scope: 'ALL_CATEGORIES' },
        { scope: 'CATEGORY', categoryId: 'cat-1' },
      ]),
    ).toHaveLength(2);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalisePlacements([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/modules/banners/placements.util.spec.ts`
Expected: FAIL — `Cannot find module './placements.util'`.

- [ ] **Step 3: Implement**

Create `src/modules/banners/placements.util.ts`:

```ts
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
 *  - HOMEPAGE and ALL_CATEGORIES carry no category, so any categoryId sent
 *    alongside them is discarded rather than stored and silently ignored.
 *  - CATEGORY without a categoryId has no target and is dropped.
 *  - Exact duplicates are removed. The database will not do this: NULLs are
 *    distinct in a Postgres unique index.
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/modules/banners/placements.util.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/banners/placements.util.ts src/modules/banners/placements.util.spec.ts
git commit -m "feat(banners): normalise and deduplicate a banner's placement set"
```

---

### Task 3: Rotation settings (pure clamp, TDD)

**Files:**
- Create: `src/modules/banners/rotation.util.ts`
- Create: `src/modules/banners/rotation.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/banners/rotation.util.spec.ts`:

```ts
import { clampRotationSeconds, DEFAULT_ROTATION_SECONDS } from './rotation.util';

/**
 * This value reaches the storefront and becomes a setInterval delay. A zero or
 * negative number would spin the slideshow as fast as React can re-render; a
 * huge one would park it on slide 1 forever and look like the rotation is
 * broken. Both ends are clamped rather than rejected, because this is read
 * from a free-form JSON settings row that nothing else validates.
 */
describe('clampRotationSeconds', () => {
  it('passes a sensible value through', () => {
    expect(clampRotationSeconds(5)).toBe(5);
    expect(clampRotationSeconds(12)).toBe(12);
  });

  it('clamps to the 2-second floor', () => {
    expect(clampRotationSeconds(0)).toBe(2);
    expect(clampRotationSeconds(-10)).toBe(2);
    expect(clampRotationSeconds(1)).toBe(2);
  });

  it('clamps to the 30-second ceiling', () => {
    expect(clampRotationSeconds(31)).toBe(30);
    expect(clampRotationSeconds(100000)).toBe(30);
  });

  it('rounds a fractional value', () => {
    expect(clampRotationSeconds(5.6)).toBe(6);
  });

  it('falls back to the default for anything that is not a usable number', () => {
    expect(clampRotationSeconds(undefined)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(null)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds('abc')).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(NaN)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(Infinity)).toBe(DEFAULT_ROTATION_SECONDS);
  });

  it('accepts a numeric string, because JSON settings rows are hand-edited', () => {
    expect(clampRotationSeconds('8')).toBe(8);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/modules/banners/rotation.util.spec.ts`
Expected: FAIL — `Cannot find module './rotation.util'`.

- [ ] **Step 3: Implement**

Create `src/modules/banners/rotation.util.ts`:

```ts
export const DEFAULT_ROTATION_SECONDS = 5;
export const MIN_ROTATION_SECONDS = 2;
export const MAX_ROTATION_SECONDS = 30;

/** The SiteSetting row id holding banner configuration. */
export const BANNER_SETTINGS_ROW_ID = 'promo_banners';

/**
 * Turns whatever is in the settings JSON into a delay the storefront can use.
 * Never throws and never returns something unusable: this value is read on a
 * public, cached endpoint that must not 500 because a row was hand-edited.
 */
export function clampRotationSeconds(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ROTATION_SECONDS;
  }

  const rounded = Math.round(value);
  if (rounded < MIN_ROTATION_SECONDS) return MIN_ROTATION_SECONDS;
  if (rounded > MAX_ROTATION_SECONDS) return MAX_ROTATION_SECONDS;
  return rounded;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/modules/banners/rotation.util.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/banners/rotation.util.ts src/modules/banners/rotation.util.spec.ts
git commit -m "feat(banners): clamp the rotation interval read from site settings"
```

---

### Task 4: DTOs with enforced create/update symmetry (TDD)

**This is the task that prevents the bug that cost three days on 2026-09-30.** `src/main.ts` runs the global `ValidationPipe` with `whitelist: true` **and `forbidNonWhitelisted: true`**. A field accepted on create but absent from the update DTO makes every edit 400 with a message naming a field the admin never touched.

**Files:**
- Create: `src/modules/banners/dto/create-banner.dto.ts`
- Create: `src/modules/banners/dto/update-banner.dto.ts`
- Create: `src/modules/banners/dto/reorder-banners.dto.ts`
- Create: `src/modules/banners/dto/update-banner-settings.dto.ts`
- Create: `src/modules/banners/dto/banner-dtos.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/banners/dto/banner-dtos.spec.ts`:

```ts
import { ValidationPipe } from '@nestjs/common';
import { CreateBannerDto } from './create-banner.dto';
import { UpdateBannerDto } from './update-banner.dto';
import { ReorderBannersDto } from './reorder-banners.dto';

/**
 * The admin banner form builds ONE payload and sends all of it on both create
 * and update — the seller ProductForm does the same thing, and that is how a
 * field present on CreateProductDto but missing from UpdateProductDto made
 * every seller edit 400 for three days in September 2026.
 *
 * The global pipe runs with forbidNonWhitelisted: true, so an undeclared
 * property is rejected before the service is ever reached. These tests drive
 * the REAL pipe with the REAL payload so that failure cannot recur silently.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const FULL_PAYLOAD = {
  title: 'Veltam 0.4mg featured',
  imageUrl: 'https://pharmabag03.s3.ap-south-1.amazonaws.com/banners/a.jpg',
  mobileImageUrl: 'https://pharmabag03.s3.ap-south-1.amazonaws.com/banners/a-m.jpg',
  altText: 'Veltam 0.4mg Tablet — better urological care',
  linkUrl: '/products/veltam-0-4mg-tablet',
  active: true,
  placements: [
    { scope: 'HOMEPAGE' },
    { scope: 'CATEGORY', categoryId: '3f1b2c44-0000-4000-8000-000000000001' },
  ],
};

const transform = (dto: unknown, metatype: new () => object) =>
  pipe.transform(dto, { type: 'body', metatype });

describe('banner DTOs accept the same field set', () => {
  it('CreateBannerDto accepts the full admin payload', async () => {
    await expect(transform(FULL_PAYLOAD, CreateBannerDto)).resolves.toMatchObject({
      title: 'Veltam 0.4mg featured',
      altText: 'Veltam 0.4mg Tablet — better urological care',
    });
  });

  it('UpdateBannerDto accepts the IDENTICAL payload — the form resends everything', async () => {
    await expect(transform(FULL_PAYLOAD, UpdateBannerDto)).resolves.toMatchObject({
      title: 'Veltam 0.4mg featured',
    });
  });

  it('both DTOs declare exactly the same properties', async () => {
    const created = (await transform(FULL_PAYLOAD, CreateBannerDto)) as object;
    const updated = (await transform(FULL_PAYLOAD, UpdateBannerDto)) as object;
    expect(Object.keys(updated).sort()).toEqual(Object.keys(created).sort());
  });

  it('rejects a property neither DTO declares, rather than dropping it', async () => {
    await expect(
      transform({ ...FULL_PAYLOAD, extraFields: { x: 1 } }, CreateBannerDto),
    ).rejects.toThrow(/extraFields should not exist/);
  });

  it('requires altText — the image carries all the text there is', async () => {
    const { altText, ...withoutAlt } = FULL_PAYLOAD;
    await expect(transform(withoutAlt, CreateBannerDto)).rejects.toThrow(/altText/);
  });

  it('allows UpdateBannerDto to send only the field being changed', async () => {
    await expect(transform({ active: false }, UpdateBannerDto)).resolves.toEqual({
      active: false,
    });
  });

  it('rejects an unknown placement scope', async () => {
    await expect(
      transform(
        { ...FULL_PAYLOAD, placements: [{ scope: 'FOOTER' }] },
        CreateBannerDto,
      ),
    ).rejects.toThrow(/scope/);
  });

  it('ReorderBannersDto requires a non-empty array of ids', async () => {
    await expect(
      transform({ ids: ['3f1b2c44-0000-4000-8000-000000000001'] }, ReorderBannersDto),
    ).resolves.toMatchObject({ ids: expect.any(Array) });
    await expect(transform({ ids: [] }, ReorderBannersDto)).rejects.toThrow(/ids/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/modules/banners/dto/banner-dtos.spec.ts`
Expected: FAIL — `Cannot find module './create-banner.dto'`.

- [ ] **Step 3: Implement the DTOs**

Create `src/modules/banners/dto/create-banner.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BannerPlacementDto {
  @ApiProperty({ enum: ['HOMEPAGE', 'ALL_CATEGORIES', 'CATEGORY'] })
  @IsEnum(['HOMEPAGE', 'ALL_CATEGORIES', 'CATEGORY'])
  scope!: 'HOMEPAGE' | 'ALL_CATEGORIES' | 'CATEGORY';

  @ApiPropertyOptional({ description: 'Required when scope is CATEGORY, ignored otherwise' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CreateBannerDto {
  @ApiProperty({ description: 'Internal label shown in the admin list only; never rendered' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ description: 'Desktop artwork URL, from POST /storage/banner-image' })
  @IsString()
  @MaxLength(2048)
  imageUrl!: string;

  @ApiPropertyOptional({ description: 'Optional mobile crop; falls back to imageUrl' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mobileImageUrl?: string;

  @ApiProperty({
    description:
      'Required. The banner text is baked into the image, so this is the only textual representation that exists.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  altText!: string;

  @ApiPropertyOptional({ description: 'Click-through target; omit to make the banner non-clickable' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  linkUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: [BannerPlacementDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BannerPlacementDto)
  placements?: BannerPlacementDto[];
}
```

Create `src/modules/banners/dto/update-banner.dto.ts`:

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateBannerDto } from './create-banner.dto';

/**
 * Every field of CreateBannerDto, all optional.
 *
 * Derived with PartialType rather than retyped BY DESIGN: the admin form sends
 * its whole payload on every save, and the global pipe runs with
 * forbidNonWhitelisted, so a field added to the create DTO and forgotten here
 * would 400 every edit with a message naming a field the admin never touched.
 * Deriving makes that class of bug structurally impossible. Do not replace
 * this with a hand-written class.
 */
export class UpdateBannerDto extends PartialType(CreateBannerDto) {}
```

Create `src/modules/banners/dto/reorder-banners.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderBannersDto {
  @ApiProperty({
    type: [String],
    description:
      'The COMPLETE ordered list of banner ids. Positions are assigned by array index. Sending a partial list is rejected.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];
}
```

Create `src/modules/banners/dto/update-banner-settings.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_ROTATION_SECONDS, MIN_ROTATION_SECONDS } from '../rotation.util';

export class UpdateBannerSettingsDto {
  @ApiProperty({ minimum: MIN_ROTATION_SECONDS, maximum: MAX_ROTATION_SECONDS, example: 5 })
  @IsInt()
  @Min(MIN_ROTATION_SECONDS)
  @Max(MAX_ROTATION_SECONDS)
  rotationSeconds!: number;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/modules/banners/dto/banner-dtos.spec.ts`
Expected: PASS, 8 tests.

If the "both DTOs declare exactly the same properties" test fails, the cause is almost certainly that `PartialType` was replaced with a hand-written class. Restore the derivation — do not adjust the test to match.

- [ ] **Step 5: Commit**

```bash
git add src/modules/banners/dto
git commit -m "feat(banners): DTOs, with update derived from create so edits cannot 400"
```

---

### Task 5: The service

**Files:**
- Create: `src/modules/banners/banners.service.ts`
- Create: `src/modules/banners/banners.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/banners/banners.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { BannersService } from './banners.service';

/**
 * The read path decides what a visitor sees. Three things it must get right:
 * inactive banners never ship, a category page shows ALL_CATEGORIES banners
 * merged with its own, and an unknown slug degrades to the shared set rather
 * than throwing — the strip is decoration and must never take a category page
 * down.
 */
function makePrisma() {
  return {
    promoBanner: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    promoBannerPlacement: { deleteMany: jest.fn(), createMany: jest.fn() },
    // assertCategoriesExist reaches for this on every write path. Without it
    // the create/update tests fail with "Cannot read properties of undefined"
    // rather than with whatever they were actually asserting.
    category: { count: jest.fn().mockResolvedValue(0) },
    siteSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(makePrisma()) : arg,
    ),
  };
}

describe('BannersService.findPublic', () => {
  it('asks only for active banners, ordered by position', async () => {
    const prisma = makePrisma();
    const service = new BannersService(prisma as never);

    await service.findPublic({ scope: 'homepage' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.active).toBe(true);
    expect(args.orderBy).toEqual([{ position: 'asc' }, { createdAt: 'asc' }]);
  });

  it('matches HOMEPAGE placements for the homepage', async () => {
    const prisma = makePrisma();
    const service = new BannersService(prisma as never);

    await service.findPublic({ scope: 'homepage' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.placements.some.scope).toBe('HOMEPAGE');
  });

  it('merges ALL_CATEGORIES with the named category', async () => {
    const prisma = makePrisma();
    const service = new BannersService(prisma as never);

    await service.findPublic({ scope: 'category', categorySlug: 'ethical' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.placements.some.OR).toEqual([
      { scope: 'ALL_CATEGORIES' },
      { scope: 'CATEGORY', category: { slug: 'ethical' } },
    ]);
  });

  it('lowercases the slug, because a category URL is not case sensitive', async () => {
    const prisma = makePrisma();
    const service = new BannersService(prisma as never);

    await service.findPublic({ scope: 'category', categorySlug: 'Ethical' });

    const args = prisma.promoBanner.findMany.mock.calls[0][0];
    expect(args.where.placements.some.OR[1]).toEqual({
      scope: 'CATEGORY',
      category: { slug: 'ethical' },
    });
  });

  it('rejects scope=category with no slug — that is a caller bug, not a visitor path', async () => {
    const service = new BannersService(makePrisma() as never);
    await expect(service.findPublic({ scope: 'category' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the rotation interval alongside the banners, so the storefront makes one call', async () => {
    const prisma = makePrisma();
    const service = new BannersService(prisma as never);

    const result = await service.findPublic({ scope: 'homepage' });

    expect(result).toEqual({ banners: [], rotationSeconds: 5 });
  });

  it('clamps a hand-edited rotation value out of the settings row', async () => {
    const prisma = makePrisma();
    prisma.siteSetting.findUnique.mockResolvedValue({ data: { rotationSeconds: 900 } });
    const service = new BannersService(prisma as never);

    const result = await service.findPublic({ scope: 'homepage' });

    expect(result.rotationSeconds).toBe(30);
  });
});

describe('BannersService.reorder', () => {
  it('rejects an id that is not a banner, before writing anything', async () => {
    const prisma = makePrisma();
    prisma.promoBanner.count.mockResolvedValue(1); // only 1 of the 2 ids exists
    const service = new BannersService(prisma as never);

    await expect(service.reorder(['id-a', 'id-b'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a partial list — positions must be rewritten wholesale', async () => {
    const prisma = makePrisma();
    prisma.promoBanner.count
      .mockResolvedValueOnce(1) // the ids sent all exist
      .mockResolvedValueOnce(5); // but there are 5 banners in total
    const service = new BannersService(prisma as never);

    await expect(service.reorder(['id-a'])).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/modules/banners/banners.service.spec.ts`
Expected: FAIL — `Cannot find module './banners.service'`.

- [ ] **Step 3: Implement**

Create `src/modules/banners/banners.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { normalisePlacements } from './placements.util';
import {
  BANNER_SETTINGS_ROW_ID,
  clampRotationSeconds,
  DEFAULT_ROTATION_SECONDS,
} from './rotation.util';

export interface PublicBannerQuery {
  scope: 'homepage' | 'category';
  categorySlug?: string;
}

/** What the storefront renders. Deliberately narrower than the admin shape. */
const PUBLIC_SELECT = {
  id: true,
  imageUrl: true,
  mobileImageUrl: true,
  altText: true,
  linkUrl: true,
} satisfies Prisma.PromoBannerSelect;

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublic(query: PublicBannerQuery) {
    const some =
      query.scope === 'homepage'
        ? { scope: 'HOMEPAGE' as const }
        : this.categoryFilter(query.categorySlug);

    const [banners, rotationSeconds] = await Promise.all([
      this.prisma.promoBanner.findMany({
        where: { active: true, placements: { some } },
        select: PUBLIC_SELECT,
        // createdAt breaks ties so two banners sharing a position do not swap
        // order between requests, which would look like a flickering bug.
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.getRotationSeconds(),
    ]);

    return { banners, rotationSeconds };
  }

  /**
   * A category page shows the banners aimed at every category PLUS the ones
   * aimed at this one. Prisma's `some` with an OR returns each banner once, so
   * a banner holding both placements does not appear twice.
   */
  private categoryFilter(categorySlug?: string) {
    const slug = categorySlug?.trim().toLowerCase();
    if (!slug) {
      throw new BadRequestException(
        'categorySlug is required when scope is "category"',
      );
    }
    return {
      OR: [
        { scope: 'ALL_CATEGORIES' as const },
        { scope: 'CATEGORY' as const, category: { slug } },
      ],
    };
  }

  async getRotationSeconds(): Promise<number> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { id: BANNER_SETTINGS_ROW_ID },
    });
    const data = (row?.data as Record<string, unknown> | undefined) ?? {};
    return clampRotationSeconds(data.rotationSeconds ?? DEFAULT_ROTATION_SECONDS);
  }

  async setRotationSeconds(seconds: number): Promise<number> {
    const value = clampRotationSeconds(seconds);
    await this.prisma.siteSetting.upsert({
      where: { id: BANNER_SETTINGS_ROW_ID },
      create: { id: BANNER_SETTINGS_ROW_ID, data: { rotationSeconds: value } },
      update: { data: { rotationSeconds: value } },
    });
    return value;
  }

  /** Admin list: everything, inactive included, placements expanded. */
  async findAllForAdmin() {
    return this.prisma.promoBanner.findMany({
      include: {
        placements: {
          include: { category: { select: { id: true, name: true, slug: true } } },
        },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreateBannerDto) {
    const placements = normalisePlacements(dto.placements ?? []);
    await this.assertCategoriesExist(placements);

    // New banners go to the end of the list rather than the front, so adding
    // one never silently demotes whatever the admin put first.
    const last = await this.prisma.promoBanner.findFirst({
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.promoBanner.create({
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl,
        mobileImageUrl: dto.mobileImageUrl ?? null,
        altText: dto.altText,
        linkUrl: dto.linkUrl ?? null,
        active: dto.active ?? true,
        position: (last?.position ?? -1) + 1,
        placements: { create: placements },
      },
      include: { placements: true },
    });
  }

  async update(id: string, dto: UpdateBannerDto) {
    await this.assertExists(id);

    const placements =
      dto.placements === undefined ? null : normalisePlacements(dto.placements);
    if (placements) await this.assertCategoriesExist(placements);

    return this.prisma.$transaction(async (tx) => {
      // `position` is absent from the DTO on purpose: order is owned by the
      // reorder endpoint. Accepting it here would let two concurrent saves
      // fight over the same slot.
      await tx.promoBanner.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
          ...(dto.mobileImageUrl !== undefined && {
            mobileImageUrl: dto.mobileImageUrl || null,
          }),
          ...(dto.altText !== undefined && { altText: dto.altText }),
          ...(dto.linkUrl !== undefined && { linkUrl: dto.linkUrl || null }),
          ...(dto.active !== undefined && { active: dto.active }),
        },
      });

      if (placements) {
        await tx.promoBannerPlacement.deleteMany({ where: { bannerId: id } });
        if (placements.length) {
          await tx.promoBannerPlacement.createMany({
            data: placements.map((p) => ({ ...p, bannerId: id })),
          });
        }
      }

      return tx.promoBanner.findUnique({
        where: { id },
        include: { placements: true },
      });
    });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.promoBanner.delete({ where: { id } });
    return { id };
  }

  /**
   * Rewrites every position from the supplied order.
   *
   * The whole list is required rather than a delta. Two admins dragging at the
   * same time with deltas produce interleaved positions that match neither
   * intent; rewriting wholesale makes the last writer simply win.
   */
  async reorder(ids: string[]) {
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new BadRequestException('The id list contains duplicates');
    }

    const found = await this.prisma.promoBanner.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new BadRequestException('The id list contains an unknown banner');
    }

    const total = await this.prisma.promoBanner.count();
    if (total !== ids.length) {
      throw new BadRequestException(
        `Reorder expects every banner: received ${ids.length} of ${total}`,
      );
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.promoBanner.update({ where: { id }, data: { position: index } }),
      ),
    );

    return { reordered: ids.length };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.promoBanner.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Banner not found');
  }

  /**
   * A placement pointing at a category that does not exist would store
   * cleanly and then show the banner nowhere, which reads as "the admin panel
   * saved but the site ignored it".
   */
  private async assertCategoriesExist(
    placements: { scope: string; categoryId: string | null }[],
  ) {
    const ids = placements
      .filter((p) => p.scope === 'CATEGORY' && p.categoryId)
      .map((p) => p.categoryId as string);
    if (!ids.length) return;

    const found = await this.prisma.category.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) {
      throw new BadRequestException('A placement names a category that does not exist');
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/modules/banners/banners.service.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/banners/banners.service.ts src/modules/banners/banners.service.spec.ts
git commit -m "feat(banners): read, write and reorder service"
```

---

### Task 6: Controllers and module

**Files:**
- Create: `src/modules/banners/banners.controller.ts`
- Create: `src/modules/banners/banners.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write the public and admin controllers**

Create `src/modules/banners/banners.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { UpdateBannerSettingsDto } from './dto/update-banner-settings.dto';

/**
 * Public read. Unauthenticated because the storefront renders this for
 * logged-out visitors, and cached at the edge for the same reason the
 * site-settings public route is: the storefront fetches it server-side from a
 * single IP, and the global 100req/60s throttler keys on IP.
 */
@ApiTags('Banners')
@Controller('banners')
export class BannersPublicController {
  constructor(private readonly service: BannersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Active promo banners for a storefront placement' })
  @ApiQuery({ name: 'scope', enum: ['homepage', 'category'] })
  @ApiQuery({ name: 'categorySlug', required: false })
  @ApiResponse({ status: 200, description: 'Banners and the rotation interval' })
  async find(
    @Query('scope') scope: 'homepage' | 'category',
    @Query('categorySlug') categorySlug?: string,
  ) {
    const data = await this.service.findPublic({
      scope: scope === 'category' ? 'category' : 'homepage',
      categorySlug,
    });
    return { message: 'Banners retrieved successfully', data };
  }
}

@ApiTags('Admin / Banners')
@ApiBearerAuth('JWT-auth')
@Controller('admin/banners')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class BannersAdminController {
  constructor(private readonly service: BannersService) {}

  // Declared BEFORE the ':id' routes. Nest matches in declaration order, so
  // with these below, PATCH /admin/banners/reorder would bind id = "reorder".
  @Get('settings')
  @ApiOperation({ summary: 'Read banner rotation settings' })
  async getSettings() {
    const rotationSeconds = await this.service.getRotationSeconds();
    return { message: 'Banner settings retrieved successfully', data: { rotationSeconds } };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update banner rotation settings' })
  async updateSettings(@Body() dto: UpdateBannerSettingsDto) {
    const rotationSeconds = await this.service.setRotationSeconds(dto.rotationSeconds);
    return { message: 'Banner settings updated successfully', data: { rotationSeconds } };
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Rewrite banner order from a complete id list' })
  async reorder(@Body() dto: ReorderBannersDto) {
    const data = await this.service.reorder(dto.ids);
    return { message: 'Banners reordered successfully', data };
  }

  @Get()
  @ApiOperation({ summary: 'List all banners, inactive included' })
  async findAll() {
    const data = await this.service.findAllForAdmin();
    return { message: 'Banners retrieved successfully', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a banner' })
  async create(@Body() dto: CreateBannerDto) {
    const data = await this.service.create(dto);
    return { message: 'Banner created successfully', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a banner' })
  async update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    const data = await this.service.update(id, dto);
    return { message: 'Banner updated successfully', data };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a banner' })
  async remove(@Param('id') id: string) {
    const data = await this.service.remove(id);
    return { message: 'Banner deleted successfully', data };
  }
}
```

- [ ] **Step 2: Write the module**

Create `src/modules/banners/banners.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { BannersService } from './banners.service';
import { BannersAdminController, BannersPublicController } from './banners.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [BannersPublicController, BannersAdminController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
```

If `DatabaseModule` is global in this codebase (check `src/database/database.module.ts` for `@Global()`), drop the `imports` line — match whatever `src/modules/site-settings/site-settings.module.ts` does.

- [ ] **Step 3: Register it**

In `src/app.module.ts`, add `BannersModule` to the `imports` array immediately after `PageSeoModule`, and add the import statement beside the other module imports:

```ts
import { BannersModule } from './modules/banners/banners.module';
```

- [ ] **Step 4: Verify it compiles and all specs still pass**

Run: `npx tsc --noEmit && npx jest src/modules/banners`
Expected: tsc exits 0; jest passes 24 tests across 4 suites.

- [ ] **Step 5: Commit**

```bash
git add src/modules/banners/banners.controller.ts src/modules/banners/banners.module.ts src/app.module.ts
git commit -m "feat(banners): public read endpoint and admin CRUD controllers"
```

---

### Task 7: Admin area routing rules

**Without this task, every scoped (non-super) admin gets a 403 on the new screen.** `src/common/admin-access/admin-areas.ts` says it plainly: *"An unmatched route is DENIED for scoped admins."* `/admin/banners` and `/storage/banner-image` match no existing rule.

**Files:**
- Modify: `src/common/admin-access/admin-areas.ts`
- Modify: `src/common/admin-access/admin-permissions.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/common/admin-access/admin-permissions.spec.ts`:

```ts
import { areaForRoute } from './admin-areas';

/**
 * An admin-only route matching no rule is denied for every scoped admin. These
 * two were added with the promo banner feature; without rules the Banners
 * screen renders from the mirrored web-side map and then 403s on every request
 * behind it — the exact failure mode the header of admin-areas.ts warns about.
 */
describe('promo banner routes belong to the marketing area', () => {
  it('maps the admin banner CRUD routes', () => {
    expect(areaForRoute('GET', '/admin/banners')).toBe('marketing');
    expect(areaForRoute('POST', '/admin/banners')).toBe('marketing');
    expect(areaForRoute('PATCH', '/admin/banners/reorder')).toBe('marketing');
    expect(areaForRoute('PATCH', '/admin/banners/settings')).toBe('marketing');
    expect(areaForRoute('DELETE', '/admin/banners/abc-123')).toBe('marketing');
  });

  it('maps the banner image upload to marketing, not to products', () => {
    expect(areaForRoute('POST', '/storage/banner-image')).toBe('marketing');
  });

  it('still maps through the global api prefix', () => {
    expect(areaForRoute('GET', '/api/admin/banners')).toBe('marketing');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/common/admin-access/admin-permissions.spec.ts -t "promo banner"`
Expected: FAIL — `expect(received).toBe('marketing')` with `received: null`.

- [ ] **Step 3: Add the rules**

In `src/common/admin-access/admin-areas.ts`, add to the Uploads block beside the other `/storage/*` rules:

```ts
  rule(/^\/storage\/banner-image$/, 'marketing'),
```

and in the Content block, directly beneath the existing `/admin/marketing` rule:

```ts
  rule(/^\/admin\/banners/, 'marketing'),
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/common/admin-access/admin-permissions.spec.ts`
Expected: PASS, including the three new tests.

- [ ] **Step 5: Commit**

```bash
git add src/common/admin-access/admin-areas.ts src/common/admin-access/admin-permissions.spec.ts
git commit -m "feat(banners): route the banner endpoints to the marketing area"
```

---

### Task 8: Banner image upload

**Files:**
- Modify: `src/modules/storage/storage.service.ts`
- Modify: `src/modules/storage/storage.controller.ts`

- [ ] **Step 1: Add the service method**

In `src/modules/storage/storage.service.ts`, directly after `uploadBlogImage` (around line 172), add:

```ts
  /**
   * Promo banner artwork. Public URL, like blog images — the storefront
   * renders these for logged-out visitors, so a signed URL would expire
   * mid-page.
   */
  async uploadBannerImage(file: Express.Multer.File): Promise<string> {
    const key = await this.upload(file, 'banner-images');
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
```

Read the real `uploadBlogImage` first and mirror it exactly — if it calls a validation helper on the line before `this.upload`, call that too.

- [ ] **Step 2: Add the controller route**

In `src/modules/storage/storage.controller.ts`, directly after the `blog-image` handler, add:

```ts
  @Post('banner-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload promo banner artwork (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileUploadBody)
  @ApiResponse({ status: 201, description: 'Image uploaded, URL returned' })
  async uploadBannerImage(@UploadedFile() file: Express.Multer.File) {
    const url = await this.storageService.uploadBannerImage(file);
    return { message: 'Banner image uploaded', data: { url } };
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/storage
git commit -m "feat(banners): admin upload endpoint for banner artwork"
```

---

### Task 9: Full API verification

- [ ] **Step 1: Clean build — not an incremental one**

Run: `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`
Expected: exits 0.

The `rm` is not optional. `npx tsc` is incremental here and will happily pass against a stale `tsconfig.tsbuildinfo` while the server's clean build fails.

- [ ] **Step 2: Full test suite**

Run: `npx jest`
Expected: all suites pass **except** `products.sitemap.spec.ts`, which fails 5 tests on `main` and is pre-existing. If anything else fails, it is yours — fix it.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/promo-banners
gh pr create --repo pharmabagtech-ux/pharmabag-api \
  --title "feat(banners): admin-managed promo banner strip" \
  --body "See docs/superpowers/specs/2026-10-04-promo-banners-design.md. Adds promo_banners + promo_banner_placements, a public cached GET /banners, admin CRUD and reorder under the existing marketing permission area, and POST /storage/banner-image. Must deploy BEFORE pharmabag-web#<n>."
```

Push to `origin` (which is `pharmabagtech-ux`), **not** `fork` — the active `gh` account has no push on `Server-eraofmarketing`.

---

# PART B — `pharmabag-web` (merge AFTER the API is deployed)

All paths below are relative to `C:\tmp\pb-banners-web`.

### Task 10: Admin API client and hooks

**Files:**
- Modify: `apps/admin/api/admin.api.ts`
- Modify: `apps/admin/hooks/useAdmin.ts`

- [ ] **Step 1: Add the API functions**

Read the existing `getMarketingProducts` / `addMarketingProduct` in `apps/admin/api/admin.api.ts` first and match its client, error handling and return-unwrapping style exactly. Then add beside them:

```ts
// ─── Promo banners ────────────────────────────────────
export interface AdminBannerPlacement {
  id: string;
  scope: "HOMEPAGE" | "ALL_CATEGORIES" | "CATEGORY";
  categoryId: string | null;
  category?: { id: string; name: string; slug: string } | null;
}

export interface AdminBanner {
  id: string;
  title: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  altText: string;
  linkUrl: string | null;
  active: boolean;
  position: number;
  placements: AdminBannerPlacement[];
}

export interface BannerPayload {
  title: string;
  imageUrl: string;
  mobileImageUrl?: string;
  altText: string;
  linkUrl?: string;
  active: boolean;
  placements: { scope: AdminBannerPlacement["scope"]; categoryId?: string }[];
}

export const getBanners = async (): Promise<AdminBanner[]> =>
  (await api.get("/admin/banners")).data.data;

export const createBanner = async (payload: BannerPayload): Promise<AdminBanner> =>
  (await api.post("/admin/banners", payload)).data.data;

export const updateBanner = async ({ id, ...payload }: BannerPayload & { id: string }) =>
  (await api.patch(`/admin/banners/${id}`, payload)).data.data;

export const deleteBanner = async (id: string) =>
  (await api.delete(`/admin/banners/${id}`)).data.data;

export const reorderBanners = async (ids: string[]) =>
  (await api.patch("/admin/banners/reorder", { ids })).data.data;

export const getBannerSettings = async (): Promise<{ rotationSeconds: number }> =>
  (await api.get("/admin/banners/settings")).data.data;

export const updateBannerSettings = async (rotationSeconds: number) =>
  (await api.patch("/admin/banners/settings", { rotationSeconds })).data.data;

export const uploadBannerImage = async (file: File): Promise<string> => {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/storage/banner-image", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.data.url;
};
```

Replace `api` with whatever the file's existing axios instance is actually called.

- [ ] **Step 2: Add the hooks**

In `apps/admin/hooks/useAdmin.ts`, add the new names to the import block from `@/api/admin.api`, then append after the existing Marketing section (around line 492):

```ts
// ─── Promo banners ────────────────────────────────────
export function useBanners() {
  return useQuery({ queryKey: ["admin", "banners"], queryFn: getBanners, staleTime: 30_000, retry: 1 });
}

export function useBannerSettings() {
  return useQuery({ queryKey: ["admin", "banners", "settings"], queryFn: getBannerSettings, staleTime: 60_000, retry: 1 });
}

function useBannerMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "banners"] }),
  });
}

export const useCreateBanner = () => useBannerMutation(createBanner);
export const useUpdateBanner = () => useBannerMutation(updateBanner);
export const useDeleteBanner = () => useBannerMutation(deleteBanner);
export const useReorderBanners = () => useBannerMutation(reorderBanners);
export const useUpdateBannerSettings = () => useBannerMutation(updateBannerSettings);
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/api/admin.api.ts apps/admin/hooks/useAdmin.ts
git commit -m "feat(admin): API client and hooks for promo banners"
```

---

### Task 11: Admin route permission mapping

**Files:**
- Modify: `apps/admin/lib/admin-areas.ts`

- [ ] **Step 1: Check whether a rule is already needed**

Read the `ROUTE_AREAS` array. If it already contains `{ prefix: '/marketing', area: 'marketing' }` **and** the matcher is a `startsWith` prefix test, `/marketing/banners` is already covered and this task is a no-op — verify by reading the function that consumes `ROUTE_AREAS` (search for `ROUTE_AREAS` in `apps/admin`).

- [ ] **Step 2: If the matcher is an exact match, add the route**

```ts
  { prefix: '/marketing/banners', area: 'marketing' },
```

Place it **above** `{ prefix: '/marketing', area: 'marketing' }` if the array is first-match-wins.

- [ ] **Step 3: Commit (skip if step 1 showed it was already covered)**

```bash
git add apps/admin/lib/admin-areas.ts
git commit -m "feat(admin): map /marketing/banners to the marketing area"
```

---

### Task 12: Admin banners screen

**Files:**
- Create: `apps/admin/app/marketing/banners/page.tsx`
- Create: `apps/admin/components/marketing/BannerFormModal.tsx`
- Modify: `apps/admin/app/marketing/page.tsx`

- [ ] **Step 1: Build the form modal**

Create `apps/admin/components/marketing/BannerFormModal.tsx`. Requirements, all of which must be present:

- Fields: `title`, desktop image upload, optional mobile image upload, `altText`, `linkUrl`, `active` toggle, and placement checkboxes.
- Placement checkboxes are **Homepage**, **All category pages**, and one per category **fetched live** from the categories endpoint — never hard-coded. The catalogue has four today; a fifth must appear here without a code change.
- Both uploads call `uploadBannerImage` and store the returned URL in form state. Show the thumbnail once uploaded.
- Artwork hints rendered next to each upload: **desktop 1920×180**, **mobile 800×240**.
- On file select, read the image's natural dimensions and if the aspect ratio differs from the target by more than 15%, show a **warning** — never block the save. The ratio is advice.
- `altText` is required; the save button stays disabled until it and `title` and `imageUrl` are set.
- The submit handler builds **one** payload object used for both create and update. This mirrors the seller ProductForm, and it is safe here only because `UpdateBannerDto` is derived from `CreateBannerDto` with `PartialType` (API Task 4).

- [ ] **Step 2: Build the list page**

Create `apps/admin/app/marketing/banners/page.tsx`:

- `AdminLayout` wrapper, heading "Banner Management", matching the existing `apps/admin/app/marketing/page.tsx` visual language (glass-card, same table classes, `framer-motion` row entrance).
- A rotation-interval number input at the top bound to `useBannerSettings` / `useUpdateBannerSettings`, with the 2–30 range stated in the field hint.
- Rows ordered by `position`, each showing: drag handle, thumbnail, title, placement chips, active toggle, edit, delete.
- **Drag to reorder**, committing the complete id list through `useReorderBanners` on drop.
- **Up/down arrow buttons beside the drag handle.** Drag-and-drop is not keyboard operable, and this screen must be. This is not optional polish.
- Optimistic local reordering so the list does not jump while the request is in flight; re-sync from the query result on success, roll back on error with a `toast.error`.
- Empty state: "No banners yet — add one to show a promo strip on the homepage or category pages."

- [ ] **Step 3: Link it from the Marketing screen**

In `apps/admin/app/marketing/page.tsx`, add a link or tab to `/marketing/banners` next to the existing slot buttons, labelled "Banners".

- [ ] **Step 4: Verify it compiles**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/marketing apps/admin/components/marketing
git commit -m "feat(admin): banner management screen with drag ordering"
```

---

### Task 13: Buyer fetch helper

**Files:**
- Create: `apps/buyer/src/lib/seo/banners.ts`

- [ ] **Step 1: Write the helper**

Create `apps/buyer/src/lib/seo/banners.ts`:

```ts
/**
 * Server-side promo banner reads.
 *
 * Sixty seconds, not the one-day window `catalog.ts` uses for taxonomy: an
 * admin who switches a banner off expects it gone promptly, and a day-long
 * cache would make the admin screen look broken.
 *
 * Caching here is a correctness requirement, not an optimisation. The API's
 * global throttler allows 100 requests per 60 seconds keyed on req.ip, and
 * every server-side fetch arrives from the single Next.js server address — an
 * uncached per-render read would spend that budget and start 429-ing unrelated
 * catalogue reads.
 */
const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://api.pharmabag.in/api'
).replace(/\/+$/, '');

const REVALIDATE_BANNERS = 60;
const DEFAULT_ROTATION_SECONDS = 5;

export interface PromoBanner {
  id: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  altText: string;
  linkUrl: string | null;
}

export interface PromoBannerPayload {
  banners: PromoBanner[];
  rotationSeconds: number;
}

const EMPTY: PromoBannerPayload = { banners: [], rotationSeconds: DEFAULT_ROTATION_SECONDS };

/**
 * Never throws. A banner strip is decoration: a page that renders without one
 * is fine, a category page that 500s because the banner endpoint blipped is
 * not. This is also what makes it safe to merge the storefront before the API
 * is deployed — a 404 reads as "no banners".
 */
export async function fetchBanners(
  scope: 'homepage' | 'category',
  categorySlug?: string,
): Promise<PromoBannerPayload> {
  const query =
    scope === 'category'
      ? `?scope=category&categorySlug=${encodeURIComponent(categorySlug ?? '')}`
      : '?scope=homepage';

  if (scope === 'category' && !categorySlug) return EMPTY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${API_BASE}/banners${query}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      next: { revalidate: REVALIDATE_BANNERS },
    });
    if (!res.ok) return EMPTY;
    const body = await res.json();
    const data = body?.data;
    if (!data || !Array.isArray(data.banners)) return EMPTY;
    return {
      banners: data.banners as PromoBanner[],
      rotationSeconds:
        typeof data.rotationSeconds === 'number'
          ? data.rotationSeconds
          : DEFAULT_ROTATION_SECONDS,
    };
  } catch {
    return EMPTY;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/buyer && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/buyer/src/lib/seo/banners.ts
git commit -m "feat(buyer): cached server-side promo banner fetch"
```

---

### Task 14: The banner strip component

**Files:**
- Create: `apps/buyer/src/components/promo/PromoBannerStrip.tsx`

- [ ] **Step 1: Build it**

Create `apps/buyer/src/components/promo/PromoBannerStrip.tsx` as a `'use client'` component taking `{ banners, rotationSeconds }`. Every item below is a requirement, not a suggestion:

- Returns `null` for an empty list. No strip, no reserved space, no empty box.
- A **single** banner renders statically: no timer, no dots, no arrows.
- Autoplay advances every `rotationSeconds` seconds, and **pauses** on pointer enter, on focus within, and on `document.visibilitychange` when the tab is hidden. A backgrounded tab must not cycle the whole set unseen.
- **`prefers-reduced-motion: reduce` disables autoplay entirely** — slide 1 plus working controls, advancing only on user action. Read it with `window.matchMedia` and subscribe to changes.
- Dots at all widths; previous/next arrows from `sm` up, hidden below.
- Touch swipe (track `touchstart`/`touchend` X, threshold ~40px).
- Each slide renders **two `next/image` elements** — mobile `block sm:hidden`, desktop `hidden sm:block` — not a `<picture>`: `next/image` is what carries `priority` and the optimiser, and it does not accept `<source>` children. When `mobileImageUrl` is null, render the desktop image at both breakpoints.
- `priority` on the first slide only; the rest lazy.
- A wrapper with a fixed `aspect-ratio` (desktop ≈ `1920/180`, mobile ≈ `800/240`) so the strip reserves height before images load and the hero below does not jump.
- A slide with `linkUrl` is wrapped in `next/link` with `aria-label={altText}`; without one it is a plain image.
- Accessibility: container `aria-roledescription="carousel"`, each slide `aria-roledescription="slide"` with `aria-label="N of M"`, dots as real `<button>`s in a `role="tablist"` with left/right arrow key handling, and a visually-hidden `aria-live="polite"` region announcing the current slide.
- Clean up the interval and both event listeners on unmount.

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/buyer && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/buyer/src/components/promo/PromoBannerStrip.tsx
git commit -m "feat(buyer): promo banner slideshow component"
```

---

### Task 15: Wire it into the category pages

**Files:**
- Modify: `apps/buyer/src/components/seo/CollectionShell.tsx`
- Modify: `apps/buyer/src/app/categories/[categorySlug]/page.tsx`
- Modify: `apps/buyer/src/app/categories/[categorySlug]/[formSlug]/page.tsx`

- [ ] **Step 1: Accept the banners on the shell**

In `CollectionShellProps`, add:

```ts
  /**
   * Promo strip rendered directly under the navbar. Optional: the facet pages
   * that do not opt in (brand, generic, state, city) pass nothing and render
   * no strip.
   */
  banners?: PromoBannerPayload;
```

and render it immediately after `<Navbar />`:

```tsx
{banners?.banners.length ? (
  <PromoBannerStrip banners={banners.banners} rotationSeconds={banners.rotationSeconds} />
) : null}
```

- [ ] **Step 2: Fetch on the category page**

In `apps/buyer/src/app/categories/[categorySlug]/page.tsx`, add `fetchBanners` to the existing parallel data fetch (it already awaits several things — put it in the same `Promise.all` rather than adding a serial await), then pass `banners={banners}` to `<CollectionShell>`:

```ts
const banners = await fetchBanners('category', params.categorySlug);
```

- [ ] **Step 3: Fetch on the dosage-form page using the PARENT slug**

In `apps/buyer/src/app/categories/[categorySlug]/[formSlug]/page.tsx`:

```ts
// The parent category's slug, not formSlug: a dosage-form page is part of its
// category's collection and inherits that category's banners. Targeting a
// single dosage form is not supported.
const banners = await fetchBanners('category', params.categorySlug);
```

and pass it to `<CollectionShell>`.

- [ ] **Step 4: Verify it compiles**

Run: `cd apps/buyer && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/buyer/src/components/seo/CollectionShell.tsx apps/buyer/src/app/categories
git commit -m "feat(buyer): promo strip on category and dosage-form pages"
```

---

### Task 16: Wire it into the homepage

`apps/buyer/src/app/page.tsx` is `'use client'` in its entirety, so it cannot fetch server-side. Splitting it is what buys the homepage a server-rendered banner instead of one that pops in after hydration.

**Files:**
- Create: `apps/buyer/src/components/landing/HomeShell.tsx`
- Modify: `apps/buyer/src/app/page.tsx`

- [ ] **Step 1: Move the current body into a client shell**

Create `apps/buyer/src/components/landing/HomeShell.tsx` holding the **current contents of `page.tsx` verbatim** — the `'use client'` directive, the `handleLoginClick` dispatch, every import and the whole JSX tree — renamed to `HomeShell`, with one new prop `banners: PromoBannerPayload`, and `<PromoBannerStrip>` rendered immediately after `<Navbar>`:

```tsx
'use client';
// ...existing imports unchanged...
import PromoBannerStrip from '@/components/promo/PromoBannerStrip';
import type { PromoBannerPayload } from '@/lib/seo/banners';

export default function HomeShell({ banners }: { banners: PromoBannerPayload }) {
  const handleLoginClick = () => {
    window.dispatchEvent(new CustomEvent('open-login'));
  };

  return (
    <main className="w-full bg-gradient-to-br from-[#8deaffe] via-[#e0ffc7e6] to-[#f4ffede6] min-h-screen relative">
      <Navbar showUserActions={true} onLoginClick={handleLoginClick} />
      {banners.banners.length ? (
        <PromoBannerStrip banners={banners.banners} rotationSeconds={banners.rotationSeconds} />
      ) : null}
      {/* ...the rest of the existing tree, unchanged... */}
    </main>
  );
}
```

Do not restyle anything while moving it. If the diff shows a class change you did not intend, revert it.

- [ ] **Step 2: Turn the page into a server component**

Replace `apps/buyer/src/app/page.tsx` entirely with:

```tsx
import HomeShell from '@/components/landing/HomeShell';
import { fetchBanners } from '@/lib/seo/banners';

/**
 * A server component purely so the promo strip is in the HTML rather than
 * appearing a beat after hydration. Everything interactive lives in HomeShell,
 * which is the previous contents of this file moved across unchanged.
 */
export default async function HomePage() {
  const banners = await fetchBanners('homepage');
  return <HomeShell banners={banners} />;
}
```

- [ ] **Step 3: Verify it compiles and builds**

Run: `cd apps/buyer && npx tsc --noEmit && pnpm build`
Expected: both exit 0. The build must not warn about a client hook in a server component — if it does, something that needs `'use client'` was left behind in `page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/buyer/src/app/page.tsx apps/buyer/src/components/landing/HomeShell.tsx
git commit -m "feat(buyer): server-rendered promo strip on the homepage"
```

---

### Task 17: Web verification and PR

- [ ] **Step 1: Typecheck and build every affected app**

Run from the repo root:

```bash
pnpm --filter ./apps/buyer exec tsc --noEmit
pnpm --filter ./apps/admin exec tsc --noEmit
pnpm --filter ./apps/buyer build
pnpm --filter ./apps/admin build
```

Expected: all four exit 0. There is no unit test framework anywhere in this monorepo — no jest, no vitest, zero spec files — so this plus the manual pass below is the whole of web-side verification.

- [ ] **Step 2: Manual verification against a running buyer app**

Run `pnpm --filter ./apps/buyer dev` and confirm each of these. Record the result of every line in the PR body:

- Zero banners: no strip, no reserved gap, hero sits where it does on `main`.
- One banner: static, no dots, no arrows, no timer.
- Three banners: rotates on the configured interval; pauses on hover; dots jump; swipe works on a narrow viewport.
- DevTools → Rendering → `prefers-reduced-motion: reduce`: no autoplay, controls still work.
- A banner with no `linkUrl`: not clickable, no pointer cursor.
- A category-targeted banner appears on `/categories/ethical` **and** on `/categories/ethical/tablet`.
- An `ALL_CATEGORIES` banner appears on every category page but **not** on `/categories` or `/products`.
- Admin: create, edit, toggle active, drag-reorder, arrow-key reorder, delete, change the rotation interval — and confirm the storefront reflects each within 60 seconds.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/promo-banners
gh pr create --repo pharmabagtech-ux/pharmabag-web \
  --title "feat(banners): admin-managed promo banner strip" \
  --body "Pairs with pharmabag-api#<n>, WHICH MUST DEPLOY FIRST — the banner fetch returns an empty list until GET /banners exists.

Adds the promo banner strip under the header on the homepage and on category and dosage-form pages, fed by a 60s-revalidated server-side fetch. The homepage becomes a thin server component (HomeShell holds the previous client body verbatim) so the strip is in the HTML rather than appearing after hydration. Admin screen at /marketing/banners: upload, target, toggle, drag or arrow-key reorder, rotation interval.

Verified: tsc --noEmit and next build clean for apps/buyer and apps/admin. This monorepo has no unit test framework, so behavioural coverage lives in the api PR. Manual pass results:
<paste the Step 2 checklist with a result against every line>"
```

Push to `origin` here — in the **web** repo `origin` is `pharmabagtech-ux`. (It is the opposite way round from the api repo, where the canonical remote is also `origin` but `upstream` is a third fork. Check `git remote -v` before pushing if in any doubt.)

- [ ] **Step 4: Clean up the worktrees**

Delete the `node_modules` junctions **first**, then remove the worktrees. `git worktree remove --force` follows a junction and deletes the real `node_modules` behind it.

```powershell
Get-ChildItem -Path C:\tmp\pb-banners-web,C:\tmp\pb-banners-api -Recurse -Filter node_modules -Directory -Force |
  Where-Object { $_.LinkType -eq 'Junction' } | ForEach-Object { cmd /c rmdir $_.FullName }
```

Then `git worktree remove C:\tmp\pb-banners-api` and `git worktree remove C:\tmp\pb-banners-web`.

---

## Deployment order

1. Merge and deploy **`pharmabag-api`**. Run `npx prisma migrate deploy` on the box.
2. Verify `GET /api/banners?scope=homepage` returns `{ banners: [], rotationSeconds: 5 }`.
3. Merge and deploy **`pharmabag-web`**.
4. Create the first banner in the admin panel and confirm it appears within 60 seconds.

Shipping web first is not dangerous — `fetchBanners` turns any non-200 into an empty list — but the feature is silently absent until the API lands, which looks like a broken release.
