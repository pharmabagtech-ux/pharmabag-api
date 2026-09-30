# Catalogue-Only Seller Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seller can only list products that already exist in the PharmaBag catalogue, and cannot rename, re-categorise or self-publish a listing afterwards.

**Architecture:** All enforcement lives in the NestJS service layer — `ProductsService.create()` for the catalogue gate (which `POST /products`, `POST /products/bulk` and the CSV importer all funnel through) and `ProductsService.update()` for identity immutability and the activation rule, plus one guard in `AdminService.approveProduct()` so the existing orphan backlog cannot be promoted. DTO shapes are untouched. The seller portal makes catalogue search step one of Add Product so the UI cannot produce a request the API will reject.

**Tech Stack:** NestJS 10, Prisma 5 (Postgres), class-validator, Jest (ts-jest), Next.js 14 App Router, react-hook-form + zod, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-30-seller-catalogue-only-listings-design.md`

---

## Working environment

Two git worktrees, already created off the deployed heads. **Do not work in
`C:\Users\arkoc\OneDrive\Documents\Codebase\pharmabag-*`** — those trees sit on
other branches and carry unrelated uncommitted work.

| Repo | Worktree | Branch | Based on |
|---|---|---|---|
| API | `C:\tmp\pb-catalogue\api` | `feat/seller-catalogue-only` | `origin/main` |
| Web | `C:\tmp\pb-catalogue\web` | `feat/seller-catalogue-only` | `upstream/main` |

`node_modules` is already junctioned into both. There is no `.env` and no local
database, so nothing is verified by running the server — only `npx jest` and
`npx tsc --noEmit`.

**Already done on these branches (uncommitted, do not redo):**
- API: the catalogue lookup + rejection in `create()`, and
  `products.master-required.spec.ts`.
- API: the `masterProductId` description on `CreateProductDto`.
- Web: the whole catalogue-picker-first `ProductForm` rework.

Tasks 1-7 below finish the job. Task 1 closes a bypass in the existing work, so
do it first.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/modules/products/products.service.ts` | Modify | Catalogue gate on create; identity immutability and activation rule on update |
| `src/modules/products/products.master-required.spec.ts` | Modify | Pin the create-side rule, including that `isMigration` buys nothing |
| `src/modules/products/products.identity-immutable.spec.ts` | Create | Pin the update-side rules |
| `src/modules/products/products.listing-ownership.spec.ts` | Modify | Existing spec; one case needs a catalogue id now |
| `src/modules/products/dto/create-product.dto.ts` | Modify | Correct the `masterProductId` doc text |
| `src/modules/admin/admin.service.ts` | Modify | Refuse to approve a listing with no master |
| `src/modules/admin/admin.approve-requires-master.spec.ts` | Create | Pin the approval guard |
| `apps/seller/components/products/ProductForm.tsx` | Modify | Lock identity inputs while editing, not only when master-linked |

---

### Task 1: `isMigration` must not bypass the catalogue gate

The gate currently reads `if (!masterProductId && !normalized.isMigration)`.
`isMigration` is an optional client-supplied boolean on `CreateProductDto` and
`POST /products` is seller-facing, so any seller can send
`{"isMigration": true}` and walk past the check.

**Files:**
- Modify: `C:\tmp\pb-catalogue\api\src\modules\products\products.service.ts:188-196`
- Test: `C:\tmp\pb-catalogue\api\src\modules\products\products.master-required.spec.ts`

- [ ] **Step 1: Replace the existing migration-mode test with its inverse**

In `products.master-required.spec.ts`, find this test and delete it entirely:

```typescript
  it('still imports unlinked rows in migration mode', async () => {
    const { service, created } = makeService(null);

    await service.create('user-1', dto({ isMigration: true }));

    expect(created).toHaveLength(1);
    expect(created[0].data.masterProduct).toBeUndefined();
    // Unchanged from before: a backfilled row nobody has vetted stays dark.
    expect(created[0].data.approvalStatus).toBe(ProductApprovalStatus.PENDING);
    expect(created[0].data.isActive).toBe(false);
  });
```

Replace it with:

```typescript
  it('does not let isMigration buy a bypass', async () => {
    // `isMigration` is an optional boolean on CreateProductDto and
    // POST /products is seller-facing, so honouring it here would enforce the
    // catalogue rule only against sellers who did not think to send it.
    const { service, created } = makeService(null);

    await expect(
      service.create('user-1', dto({ isMigration: true })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(created).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/products.master-required.spec.ts -t "isMigration"
```

Expected: FAIL — the promise resolves instead of rejecting, so Jest reports
`Received function did not throw`.

- [ ] **Step 3: Make the gate unconditional**

In `products.service.ts`, replace lines 188-196:

```typescript
    // Migration mode backfills historical rows that predate the catalogue, so
    // it keeps the old unlinked behaviour.
    if (!masterProductId && !normalized.isMigration) {
      throw new BadRequestException(
        `"${normalized.name}" is not in the PharmaBag catalogue yet. ` +
          'Search for the product and pick it from the suggestions, or submit a ' +
          'product request and we will add it to the catalogue.',
      );
    }
```

with:

```typescript
    /**
     * `isMigration` deliberately does NOT excuse an unlinked listing.
     *
     * It is an optional boolean on CreateProductDto and POST /products is
     * seller-facing, so a gate that honoured it would hold only against sellers
     * who did not think to send `{"isMigration": true}`. It keeps its other
     * documented effects — relaxed image-URL validation, and the
     * externalId/slug upsert path above — it just cannot conjure a catalogue
     * entry. The one internal caller that sets it, seller-bulk-csv.service,
     * always passes masterProductId as well, so nothing legitimate regresses.
     */
    if (!masterProductId) {
      throw new BadRequestException(
        `"${normalized.name}" is not in the PharmaBag catalogue yet. ` +
          'Search for the product and pick it from the suggestions, or submit a ' +
          'product request and we will add it to the catalogue.',
      );
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/products.master-required.spec.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/pb-catalogue/api
git add src/modules/products/products.service.ts src/modules/products/products.master-required.spec.ts src/modules/products/dto/create-product.dto.ts
git commit -m "fix(products): sellers can only list catalogue products

A seller could type any product name into the Add Product form and submit.
create() looked for an exact name+manufacturer match against MasterProduct
and, finding none, created the listing anyway as PENDING/inactive: invisible
to buyers, so the seller saw success and then a product nobody could buy,
and the rows accumulated unreviewed.

The catalogue lookup now rejects instead, naming the product and pointing at
the product-request flow that admin already reviews. isMigration does not
excuse it - it is client-supplied on a seller-facing endpoint, so honouring
it would enforce the rule only against sellers who did not think to send it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Repair the one existing spec that relied on the bypass

`products.listing-ownership.spec.ts` mocks `masterProduct.findFirst` as
`async () => null`, and one of its cases calls `create()` with
`isMigration: true` expecting a row to be created. That case is about ownership,
not the catalogue, so give it a catalogue id — which is what the real CSV
importer sends anyway.

**Files:**
- Modify: `C:\tmp\pb-catalogue\api\src\modules\products\products.listing-ownership.spec.ts:141-154`

- [ ] **Step 1: Confirm the breakage is real and is only this one case**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/products.listing-ownership.spec.ts
```

Expected: FAIL — 1 of 5 tests fails, `creates a SEPARATE listing instead of
taking over another seller's row on a slug match (the bulk-CSV path)`, with
`"Sinarest Syrup 75 mL" is not in the PharmaBag catalogue yet`. The other four
pass: the externalId and same-seller-slug cases return early from the upsert
branches before reaching the catalogue gate.

- [ ] **Step 2: Give the case its catalogue id**

Replace lines 147-149:

```typescript
    // Exactly what seller-bulk-csv.service.ts sends: no slug, no externalId,
    // isMigration true. The slug is derived from the name and collides.
    await service.create('user-b', dto({ isMigration: true }));
```

with:

```typescript
    // Exactly what seller-bulk-csv.service.ts sends: no slug, no externalId,
    // isMigration true, and the id of the catalogue row it matched the CSV line
    // against. The slug is derived from the name and collides.
    await service.create('user-b', dto({ isMigration: true, masterProductId: 'master-1' }));
```

- [ ] **Step 3: Run the spec to verify it passes**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/products.listing-ownership.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/pb-catalogue/api
git add src/modules/products/products.listing-ownership.spec.ts
git commit -m "test(products): ownership spec sends the catalogue id the CSV importer sends

The bulk-CSV case created a listing with isMigration and no master, which the
catalogue rule now rejects. The case is about ownership, not the catalogue, so
it passes the masterProductId that seller-bulk-csv.service really sends.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Remove the now-dead unlinked branches in `create()`

Every created row is catalogue-linked, so `isFromMaster` is always true. Leaving
the ternaries in place implies a PENDING path that can no longer happen.

**Files:**
- Modify: `C:\tmp\pb-catalogue\api\src\modules\products\products.service.ts:198`, `:205-210`, `:244`, `:263-264`

- [ ] **Step 1: Assert the outcome the simplification must preserve**

Add this test to `products.master-required.spec.ts`, directly after the existing
`publishes a catalogue-linked listing immediately` test:

```typescript
  it('always links the listing to its master', async () => {
    const { service, created } = makeService({ id: MASTER });

    await service.create('user-1', dto());

    // No row reaches the database unlinked any more, so nothing downstream has
    // to cope with masterProductId === null on a freshly created listing.
    expect(created[0].data.masterProduct.connect.id).toBe(MASTER);
    expect(created[0].data.approvalStatus).toBe(ProductApprovalStatus.APPROVED);
    expect(created[0].data.isActive).toBe(true);
  });
```

- [ ] **Step 2: Run it and confirm it already passes**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/products.master-required.spec.ts -t "always links"
```

Expected: PASS. This is a characterisation test — it exists to catch a mistake in
the refactor that follows, so it must be green before the refactor starts.

- [ ] **Step 3: Delete the `isFromMaster` indirection**

Delete line 198 entirely:

```typescript
    const isFromMaster = !!masterProductId;
```

- [ ] **Step 4: Collapse the duplicate check**

Replace lines 205-210:

```typescript
    if (masterProductId) {
      duplicateCheckWhere.masterProductId = masterProductId;
    } else {
      duplicateCheckWhere.name = { equals: normalized.name, mode: 'insensitive' };
      duplicateCheckWhere.manufacturer = { equals: normalized.manufacturer, mode: 'insensitive' };
    }
```

with:

```typescript
    // One listing per seller per catalogue product. The old name+manufacturer
    // fallback here was for unlinked rows, which can no longer be created.
    duplicateCheckWhere.masterProductId = masterProductId;
```

- [ ] **Step 5: Make the create payload unconditional**

Replace line 244:

```typescript
      masterProduct: isFromMaster ? { connect: { id: masterProductId } } : undefined,
```

with:

```typescript
      masterProduct: { connect: { id: masterProductId } },
```

Then replace lines 263-264 — note the three-line comment above them goes too,
because it describes a choice that no longer exists:

```typescript
      // Linked to the catalogue means approved — the product itself was already
      // vetted when it entered the catalogue. Since the guard above, only
      // migration rows can still land here unlinked, and those stay PENDING.
      approvalStatus: isFromMaster ? ProductApprovalStatus.APPROVED : ProductApprovalStatus.PENDING,
      isActive: isFromMaster ? true : false,
```

with:

```typescript
      // The product was vetted when it entered the catalogue, and the guard
      // above means every row reaching here is linked to it — so there is
      // nothing left for an admin to approve about the listing itself.
      approvalStatus: ProductApprovalStatus.APPROVED,
      isActive: true,
```

- [ ] **Step 6: Confirm no `isFromMaster` references survive**

```bash
cd /c/tmp/pb-catalogue/api && grep -n "isFromMaster" src/modules/products/products.service.ts
```

Expected: no output.

- [ ] **Step 7: Run the products specs**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/
```

Expected: every spec passes except `products.sitemap.spec.ts`, which fails 5
tests on `main` as well. Compare against
`git stash && npx jest src/modules/products/products.sitemap.spec.ts; git stash pop`
if you need to confirm that is pre-existing.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/pb-catalogue/api
git add src/modules/products/products.service.ts src/modules/products/products.master-required.spec.ts
git commit -m "refactor(products): drop the unlinked-listing branches from create

Every created listing is now catalogue-linked, so the isFromMaster ternaries
described a PENDING/inactive path that can no longer be reached. Removed
rather than left as code that lies about what the system does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A listing's identity is immutable

`update()` passes `name`, `manufacturer`, `chemicalComposition`, `categoryId`
and `subCategoryId` straight into `prisma.product.update`. So: list a real
catalogue product (auto-approved, active, buyer-visible), then PATCH the name to
anything. This is the back door that makes Task 1 decorative on its own.

The check compares **values against the row's own current values**, not against
the linked master. The seller edit form rebuilds its whole payload on every save,
so an ordinary price edit resends all five identity fields unchanged — a
presence-based rejection would break every edit.

**Files:**
- Create: `C:\tmp\pb-catalogue\api\src\modules\products\products.identity-immutable.spec.ts`
- Modify: `C:\tmp\pb-catalogue\api\src\modules\products\products.service.ts:570-571` and a new private method near `findOwnProduct` at `:1445`

- [ ] **Step 1: Write the failing spec**

Create `src/modules/products/products.identity-immutable.spec.ts`:

```typescript
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProductApprovalStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import { UpdateProductDto } from './dto/update-product.dto';

/**
 * A seller could rename a listing into a product that is not in the catalogue.
 *
 * Listings are now required to be listings OF a catalogue product, but that was
 * only enforced on create(). update() passed name, manufacturer,
 * chemicalComposition, categoryId and subCategoryId straight through to
 * prisma.product.update, so the rule could be walked around in two requests:
 * list a real catalogue product — auto-approved, active, visible to buyers —
 * then PATCH the name to anything at all.
 *
 * The comparison is against THE ROW'S OWN current values, deliberately not
 * against its master's. The seller edit form rebuilds its whole payload on every
 * save, so an ordinary price edit resends all five identity fields unchanged;
 * rejecting on presence would break every edit, and only a value comparison can
 * tell a resubmit from a rename. Comparing against the master would also reject
 * innocent edits on historical rows whose category has drifted from it.
 *
 * The isActive case here is a separate, pre-existing hole found alongside:
 * isActive is on UpdateProductDto and flowed through the ...productData spread
 * untouched, so a seller on a PENDING listing could PATCH {"isActive": true} and
 * publish without review. Deactivating stays allowed — pausing your own listing
 * is legitimate.
 */

const CURRENT = {
  id: 'product-1',
  name: 'Sinarest Syrup 75 mL',
  manufacturer: 'Centaur',
  chemicalComposition: 'Paracetamol',
  categoryId: 'cat-ethical',
  subCategoryId: 'sub-syrup',
  masterProductId: 'master-1',
  approvalStatus: ProductApprovalStatus.APPROVED,
};

interface Harness {
  service: ProductsService;
  updated: any[];
}

const makeService = (overrides: Partial<typeof CURRENT> = {}): Harness => {
  const product = { ...CURRENT, ...overrides };
  const updated: any[] = [];

  const prisma: any = {
    sellerProfile: { findUnique: async () => ({ id: 'seller-1' }) },
    company: { upsert: async () => ({ id: 'company' }) },
    chemicalComposition: { upsert: async () => ({ id: 'cc' }) },
    masterProduct: { update: async () => ({}) },
    productImage: { deleteMany: async () => ({}), createMany: async () => ({}), findMany: async () => [] },
    productBatch: { findFirst: async () => ({ id: 'batch', stock: 5 }) },
    product: {
      findFirst: async () => product,
      update: async (args: any) => {
        updated.push(args);
        return {
          ...product,
          ...args.data,
          category: { name: 'Ethical' },
          subCategory: { name: 'Syrup' },
        };
      },
    },
  };

  const noop: any = {
    updateDefaultBatch: async () => ({}),
    createDefaultBatch: async () => ({}),
    upsert: () => undefined,
    initialise: () => undefined,
    trackEvent: async () => ({}),
    recordEvent: async () => ({}),
  };

  return { service: new ProductsService(prisma, noop, noop, noop), updated };
};

const dto = (over: Partial<UpdateProductDto> = {}): UpdateProductDto =>
  ({
    // What the seller portal resends on every save, unchanged.
    name: CURRENT.name,
    manufacturer: CURRENT.manufacturer,
    chemicalComposition: CURRENT.chemicalComposition,
    categoryId: CURRENT.categoryId,
    subCategoryId: CURRENT.subCategoryId,
    ...over,
  }) as UpdateProductDto;

describe('ProductsService.update — a listing keeps its catalogue identity', () => {
  it('allows an ordinary edit that resends every identity field unchanged', async () => {
    // The regression that matters: the seller form always sends these, so a
    // presence-based check would reject every price edit in the portal.
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', dto({ mrp: 120 }));

    expect(updated).toHaveLength(1);
    expect(updated[0].data.mrp).toBe(120);
  });

  it('ignores case and surrounding whitespace when deciding what changed', async () => {
    const { service, updated } = makeService();

    await service.update(
      'user-1',
      'product-1',
      dto({ name: '  sinarest syrup 75 ML  ', mrp: 120 }),
    );

    expect(updated).toHaveLength(1);
  });

  it('accepts a partial edit that sends no identity fields at all', async () => {
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', { stock: 40 } as UpdateProductDto);

    expect(updated).toHaveLength(1);
  });

  it('rejects a rename', async () => {
    const { service, updated } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ name: 'Pregnancy Test Kit' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updated).toHaveLength(0);
  });

  it('rejects a manufacturer change', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ manufacturer: 'Acme Diagnostics' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a composition change', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ chemicalComposition: 'Ibuprofen' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a re-categorisation', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ categoryId: 'cat-ayurvedic' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.update('user-1', 'product-1', dto({ subCategoryId: 'sub-tablet' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tells the seller what they can edit instead', async () => {
    const { service } = makeService();

    await expect(
      service.update('user-1', 'product-1', dto({ name: 'Something Else' })),
    ).rejects.toThrow(/price, stock, expiry or discount/s);
  });

  it('freezes legacy listings that have no master too', async () => {
    // These predate the rule and should never have existed; editing one into a
    // different product is exactly what must not happen.
    const { service } = makeService({ masterProductId: null as any });

    await expect(
      service.update('user-1', 'product-1', dto({ name: 'Something Else' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProductsService.update — a seller cannot publish an unapproved listing', () => {
  it('rejects isActive:true on a listing that is not approved', async () => {
    const { service, updated } = makeService({
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await expect(
      service.update('user-1', 'product-1', dto({ isActive: true })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(updated).toHaveLength(0);
  });

  it('rejects isActive:true on a rejected listing', async () => {
    const { service } = makeService({
      approvalStatus: ProductApprovalStatus.REJECTED,
    });

    await expect(
      service.update('user-1', 'product-1', dto({ isActive: true })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows isActive:true on an approved listing', async () => {
    const { service, updated } = makeService();

    await service.update('user-1', 'product-1', dto({ isActive: true }));

    expect(updated[0].data.isActive).toBe(true);
  });

  it('allows a seller to pause their own listing', async () => {
    const { service, updated } = makeService({
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await service.update('user-1', 'product-1', dto({ isActive: false }));

    expect(updated[0].data.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/products.identity-immutable.spec.ts
```

Expected: FAIL — 8 tests fail (the 5 rejection cases, the message case, the
legacy-listing case, and the two `isActive:true` cases) because nothing rejects
yet. The 4 permissive cases already pass.

- [ ] **Step 3: Add the two guards as private methods**

In `products.service.ts`, insert both methods immediately before
`private async findOwnProduct(` at line 1445:

```typescript
  /**
   * The identity of a listing belongs to the catalogue, not to the seller.
   *
   * update() used to pass name, manufacturer, chemicalComposition, categoryId
   * and subCategoryId straight through to prisma.product.update, so the
   * catalogue rule enforced in create() could be walked around in two requests:
   * list a real catalogue product — auto-approved, active, visible to buyers —
   * then PATCH the name to anything.
   *
   * Values are compared against THE ROW'S OWN current values, not the linked
   * master's, for two reasons. The seller edit form rebuilds its whole payload
   * on every save, so an ordinary price edit resends all five fields unchanged;
   * rejecting on presence would break every edit in the portal, and only a value
   * comparison can tell a resubmit from a rename. And some historical rows have
   * drifted from their master's category, so comparing against the master would
   * turn a data-quality problem into an outage for those sellers.
   *
   * Legacy listings with no master are frozen the same way, which is intended:
   * they should never have existed and must not be edited into something new.
   */
  private assertListingIdentityUnchanged(
    product: {
      name: string;
      manufacturer: string | null;
      chemicalComposition: string | null;
      categoryId: string;
      subCategoryId: string;
    },
    dto: UpdateProductDto,
  ) {
    const changed = (incoming: string | undefined, current: string | null) =>
      incoming !== undefined &&
      incoming.trim().toLowerCase() !== (current ?? '').trim().toLowerCase();

    const identityChanged =
      changed(dto.name, product.name) ||
      changed(dto.manufacturer, product.manufacturer) ||
      changed(dto.chemicalComposition, product.chemicalComposition) ||
      changed(dto.categoryId, product.categoryId) ||
      changed(dto.subCategoryId, product.subCategoryId);

    if (identityChanged) {
      throw new BadRequestException(
        "A listing's product details come from the PharmaBag catalogue and cannot be changed. " +
          'Edit your price, stock, expiry or discount instead — or submit a product ' +
          'request if the catalogue entry itself is wrong.',
      );
    }
  }

  /**
   * A seller must not publish a listing nobody approved.
   *
   * isActive is on UpdateProductDto and flowed through update()'s
   * ...productData spread untouched, so a seller sitting on a PENDING, inactive
   * listing could PATCH {"isActive": true} and go live with no admin review —
   * the approval gate was not a gate. Pre-existing, and independent of the
   * catalogue rule.
   *
   * Deactivating stays allowed: pausing your own listing is legitimate, and
   * there is no reason to make a seller ask.
   */
  private assertMayActivate(
    product: { approvalStatus: ProductApprovalStatus },
    dto: UpdateProductDto,
  ) {
    if (
      dto.isActive === true &&
      product.approvalStatus !== ProductApprovalStatus.APPROVED
    ) {
      throw new ForbiddenException(
        'This listing has not been approved yet, so it cannot be made active.',
      );
    }
  }
```

- [ ] **Step 4: Call them from `update()`**

Replace line 571:

```typescript
    const product = await this.findOwnProduct(userId, productId);
```

with:

```typescript
    const product = await this.findOwnProduct(userId, productId);

    this.assertListingIdentityUnchanged(product, dto);
    this.assertMayActivate(product, dto);
```

- [ ] **Step 5: Run the spec to verify it passes**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/products/products.identity-immutable.spec.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/pb-catalogue/api
git add src/modules/products/products.service.ts src/modules/products/products.identity-immutable.spec.ts
git commit -m "fix(products): a listing keeps its catalogue identity, and cannot self-publish

Two holes that made the catalogue rule bypassable.

update() passed name, manufacturer, chemicalComposition, categoryId and
subCategoryId straight to prisma.product.update, so a seller could list a real
catalogue product and then PATCH the name to anything - two requests to the
same result create() now refuses. Identity is compared against the row's own
values rather than its master's: the seller form resends all five fields on an
ordinary price edit, so only a value comparison can tell a resubmit from a
rename, and historical category drift would otherwise reject innocent edits.

Separately, isActive flowed through untouched, so a seller on a PENDING
listing could PATCH {\"isActive\": true} and publish with no review at all.
Activation now requires APPROVED; pausing your own listing stays allowed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Admin cannot approve a listing with no catalogue product

`approveProduct` sets `isActive: true`, but the storefront grid queries
`MasterProduct` — so approving an unlinked row makes it active without making it
buyable. That is how the PENDING backlog accumulated. Existing rows are left in
the database by design; this closes the route by which one could still reach
buyers.

**Files:**
- Create: `C:\tmp\pb-catalogue\api\src\modules\admin\admin.approve-requires-master.spec.ts`
- Modify: `C:\tmp\pb-catalogue\api\src\modules\admin\admin.service.ts:720-726`

- [ ] **Step 1: Write the failing spec**

Create `src/modules/admin/admin.approve-requires-master.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { ProductApprovalStatus } from '@prisma/client';
import { AdminService } from './admin.service';

/**
 * Approving a listing with no master product made it active but not buyable.
 *
 * Sellers used to be able to create listings for products that are not in the
 * catalogue; those rows landed as approvalStatus PENDING, isActive false and
 * nobody reviewed them. create() now refuses to make new ones, but the backlog
 * is deliberately left in the database rather than migrated — so the one thing
 * that must not happen is an admin approving one into visibility.
 *
 * It would not even work: approveProduct sets isActive true, but the storefront
 * grid queries MasterProduct and joins listings, so an unlinked row stays
 * invisible to buyers however it is flagged. The fix for such a product is to
 * add it to the catalogue and have the seller list it against that.
 */

const makeService = (product: any) => {
  const updated: any[] = [];

  const prisma: any = {
    product: {
      findUnique: async () => product,
      update: async (args: any) => {
        updated.push(args);
        return { id: 'product-1', name: 'X', isActive: true };
      },
    },
  };

  // AdminService(prisma, notificationsService, storage) — approveProduct touches
  // only prisma, so the other two are stand-ins.
  const noop: any = {};

  return { service: new AdminService(prisma, noop, noop), updated };
};

describe('AdminService.approveProduct — approval requires a catalogue product', () => {
  it('refuses a listing with no master product', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: null,
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await expect(service.approveProduct('product-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(updated).toHaveLength(0);
  });

  it('says what to do instead', async () => {
    const { service } = makeService({
      id: 'product-1',
      masterProductId: null,
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await expect(service.approveProduct('product-1')).rejects.toThrow(
      /catalogue/s,
    );
  });

  it('still approves a listing that is linked to the catalogue', async () => {
    const { service, updated } = makeService({
      id: 'product-1',
      masterProductId: 'master-1',
      approvalStatus: ProductApprovalStatus.PENDING,
    });

    await service.approveProduct('product-1');

    expect(updated).toHaveLength(1);
    expect(updated[0].data.approvalStatus).toBe(ProductApprovalStatus.APPROVED);
    expect(updated[0].data.isActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/admin/admin.approve-requires-master.spec.ts
```

Expected: FAIL — the first two tests fail because nothing rejects yet; the third
(`still approves a listing that is linked to the catalogue`) already passes.

- [ ] **Step 3: Add the guard**

In `admin.service.ts`, replace lines 723-726:

```typescript
    if (product.approvalStatus === ProductApprovalStatus.APPROVED) {
      throw new BadRequestException('Product is already approved');
    }
```

with:

```typescript
    if (product.approvalStatus === ProductApprovalStatus.APPROVED) {
      throw new BadRequestException('Product is already approved');
    }

    /**
     * Listings predating the catalogue rule have no master product, and the
     * storefront grid queries MasterProduct — so approving one sets isActive
     * without making it buyable, which is how the PENDING backlog grew. The
     * rows are left in place deliberately; this just stops one being promoted
     * into a visibility it cannot actually have. Rejection still works, so the
     * backlog stays cleanable.
     */
    if (!product.masterProductId) {
      throw new BadRequestException(
        'This listing is not linked to a catalogue product, so approving it would ' +
          'not make it visible to buyers. Add the product to the catalogue first, ' +
          'then ask the seller to list it against that entry.',
      );
    }
```

- [ ] **Step 4: Run the spec to verify it passes**

```bash
cd /c/tmp/pb-catalogue/api && npx jest src/modules/admin/admin.approve-requires-master.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/pb-catalogue/api
git add src/modules/admin/admin.service.ts src/modules/admin/admin.approve-requires-master.spec.ts
git commit -m "fix(admin): refuse to approve a listing with no catalogue product

approveProduct sets isActive true, but the storefront grid queries
MasterProduct - so approving an unlinked row made it active without making it
buyable. Sellers can no longer create such rows; the existing backlog is left
in place by design, and this closes the one route by which one could still be
promoted. Rejection still works so the backlog stays cleanable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Correct the `masterProductId` doc text

The description currently ends "(migration mode excepted)", which is no longer
true after Task 1.

**Files:**
- Modify: `C:\tmp\pb-catalogue\api\src\modules\products\dto\create-product.dto.ts:143-152`

- [ ] **Step 1: Replace the description**

Find:

```typescript
    description:
      'ID of the master product this listing is for. Required in practice: when omitted ' +
      'the service falls back to an exact name + manufacturer match against the catalogue, ' +
      'and rejects the request if that finds nothing (migration mode excepted).',
```

Replace with:

```typescript
    description:
      'ID of the master product this listing is for. Required in practice: when omitted ' +
      'the service falls back to an exact name + manufacturer match against the catalogue, ' +
      'and rejects the request if that finds nothing. Optional here only so that ' +
      'fallback stays usable — a listing always ends up linked to a catalogue product.',
```

- [ ] **Step 2: Typecheck**

```bash
cd /c/tmp/pb-catalogue/api && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit
```

Expected: no output. Deleting `tsconfig.tsbuildinfo` first is required — the
incremental build passes while a clean build fails, which is how a broken API
build reaches the server.

- [ ] **Step 3: Run the whole API suite**

```bash
cd /c/tmp/pb-catalogue/api && npx jest 2>&1 | tail -30
```

Expected: all suites pass except `products.sitemap.spec.ts` (5 failures,
pre-existing on `main`).

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/pb-catalogue/api
git add src/modules/products/dto/create-product.dto.ts
git commit -m "docs(products): masterProductId description no longer excepts migration mode

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Lock identity inputs on the edit screen

The picker rework disables the identity inputs via `disabled={!!linkedMasterId}`.
A legacy listing has `masterProductId: null`, so its edit screen still presents
editable name/manufacturer/composition fields — which the Task 4 guard now
rejects with a 400 after the seller has typed into them.

**Files:**
- Modify: `C:\tmp\pb-catalogue\web\apps\seller\components\products\ProductForm.tsx:494-498`

- [ ] **Step 1: Introduce one flag and use it on all four inputs**

Immediately after the `needsCatalogueChoice` declaration, add:

```typescript
  // Identity comes from the catalogue, so these are never the seller's to type:
  // locked once a master is picked, and locked on every edit — including legacy
  // listings with no master, whose fields would otherwise look editable and then
  // be rejected by the API.
  const identityLocked = !!linkedMasterId || isEditing;
```

Then in the Basic Information block, change all four inputs from
`disabled={!!linkedMasterId}` to `disabled={identityLocked}`:

```tsx
            <Input label="SKU (Optional)" error={errors.sku?.message} {...register("sku")} disabled={identityLocked} />
            <Input label="Product Name *" error={errors.product_name?.message} {...register("product_name")} disabled={identityLocked} />
            <Input label="Company / Manufacturer *" error={errors.company_name?.message} {...register("company_name")} disabled={identityLocked} />
```

and

```tsx
              <Textarea label="Chemical Combination" error={errors.chemical_combination?.message} {...register("chemical_combination")} disabled={identityLocked} />
```

- [ ] **Step 2: Confirm nothing still keys off the old expression**

```bash
cd /c/tmp/pb-catalogue/web && grep -n "disabled={!!linkedMasterId}" apps/seller/components/products/ProductForm.tsx
```

Expected: no output.

- [ ] **Step 3: Typecheck the seller app**

```bash
cd /c/tmp/pb-catalogue/web/apps/seller && npx tsc --noEmit
```

Expected: no output. If the command cannot resolve `@pharmabag/*` imports, the
workspace junctions are incomplete — re-junction `node_modules` for the repo root
and every `apps/*` and `packages/*` directory before retrying.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/pb-catalogue/web
git add apps/seller/components/products/ProductForm.tsx
git commit -m "feat(seller): a listing's product is chosen from the catalogue, not typed

Catalogue search becomes step one of Add Product instead of an optional
autocomplete: nothing else renders until a product is picked, the pick is shown
as a summary card with a Change button that clears the autofilled identity
fields, and sellers stocking something we do not carry are routed to
/products/requests. 'No catalogue match' waits for a settled response, because
keying it off an empty array flashed the message while the search was still
running.

Identity inputs are also locked on every edit, not only when a master is
linked - a legacy listing with no master would otherwise present editable
fields that the API now rejects.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification before claiming done

- [ ] `cd /c/tmp/pb-catalogue/api && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit` — no output
- [ ] `cd /c/tmp/pb-catalogue/api && npx jest 2>&1 | tail -30` — only `products.sitemap.spec.ts` fails (5 tests, pre-existing on `main`)
- [ ] `cd /c/tmp/pb-catalogue/web/apps/seller && npx tsc --noEmit` — no output
- [ ] `cd /c/tmp/pb-catalogue/api && git grep -n "isFromMaster" -- src` — no output
- [ ] `cd /c/tmp/pb-catalogue/api && git log --oneline origin/main..HEAD` — 6 commits (spec doc + Tasks 1-6)
- [ ] `cd /c/tmp/pb-catalogue/web && git log --oneline upstream/main..HEAD` — 1 commit
- [ ] Both user working trees untouched: `cd /c/Users/arkoc/OneDrive/Documents/Codebase/pharmabag-api && git rev-parse --abbrev-ref HEAD` still reports `feat/analytics-geo`, and the web tree still reports `fix/buyer-discount-badge-bold`
