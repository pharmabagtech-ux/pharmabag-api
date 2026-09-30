# Sellers may only list catalogue products

**Date:** 2026-09-30
**Repos:** `pharmabag-api` (branch `feat/seller-catalogue-only`), `pharmabag-web` (branch `feat/seller-catalogue-only`)

## Problem

A seller could invent a product that does not exist in the PharmaBag catalogue.

`POST /products` is `@Roles(Role.SELLER)` and `CreateProductDto.masterProductId` is
optional, so a seller could type any name, manufacturer and composition into the
seller portal's Add Product form and submit. `create()` looked for an exact
name + manufacturer match against `MasterProduct` and, finding none, created the
listing anyway as `approvalStatus: PENDING, isActive: false`.

That row is invisible to buyers — the storefront grid queries `MasterProduct` —
so the seller saw "Product added successfully" and then a product nobody could
buy. The rows accumulated with nobody reviewing them.

The rule to enforce: **a seller listing is a listing OF a catalogue product.**
The seller supplies the commercial terms (price, stock, MOQ, expiry, discount);
the catalogue supplies the identity. A seller who stocks something we do not
carry uses the existing product-request flow (`POST /products/requests`,
reviewed by admin), not the listing form.

The seller bulk-CSV importer already enforced this — it skips unmatched rows with
`product not in catalog` — so the manual form was the one path that let
uncatalogued products in.

## Scope decisions

Settled before implementation:

1. **Catalogue-only listings**, not a total block. Sellers keep the ability to
   create listings; they just cannot invent products. Rejected outright rather
   than queued as `PENDING` for admin approval — an approval queue nobody works
   is what produced the orphan rows in the first place.
2. **Enforcement lives in the service layer**, not in the DTOs. One guard in
   `ProductsService` covers `POST /products`, `POST /products/bulk` (which
   delegates to `create()`) and the CSV importer, and survives any future
   caller. DTO shapes stay unchanged so Swagger and existing clients are
   undisturbed; only the `masterProductId` description is corrected.
3. **Existing orphan rows are left in place.** No data migration. They stay
   invisible to buyers, and admin approval is blocked so they cannot be promoted
   into visibility after the fact. Admin can still reject them.

## Enforcement points

Five holes, all of which must close together — any one left open makes the rest
decorative.

### 1. Create must resolve to a catalogue product

`ProductsService.create()`. A listing resolves its master from an explicit
`masterProductId` (sent by the search picker) or, failing that, an exact
case-insensitive name + manufacturer match against a live `MasterProduct`. When
neither resolves, reject with a message that names the product and points at the
request flow.

Because every created row is now catalogue-linked, `approvalStatus: APPROVED` and
`isActive: true` are unconditional. The `PENDING` / inactive branch is dead for
new rows and is removed rather than left as misleading code.

### 2. `isMigration` must not bypass the gate

`CreateProductDto.isMigration` is an optional client-supplied boolean, and
`POST /products` is seller-facing. A gate written as
`if (!masterProductId && !isMigration)` is therefore bypassable by any seller
sending `{"isMigration": true}` — the rule would hold only for sellers who did
not think to try.

The catalogue gate applies **unconditionally**. `isMigration` keeps its other
documented effects (relaxed image-URL validation via `@ValidateIf`, and the
`externalId`/slug upsert path), but it no longer excuses an unlinked listing.
The one internal caller that sets it — `seller-bulk-csv.service.ts` — always
passes `masterProductId` as well, so this costs nothing there.

### 3. A listing's identity must be immutable

`ProductsService.update()` passed `name`, `manufacturer`,
`chemicalComposition`, `categoryId` and `subCategoryId` straight into
`prisma.product.update`. So: list a real catalogue product (auto-approved,
active, buyer-visible), then `PATCH` the name to anything. Blocking only `POST`
leaves the rule trivially bypassable through the back door.

Each identity field is compared, trimmed and case-insensitively, against **the
row's own current value** — deliberately not against the linked master's. Two
reasons:

- The seller edit form resends every identity field on an ordinary price edit
  (`ProductForm.tsx` builds `backendPayload` unconditionally), so a
  presence-based rejection would break every edit. The check must compare values
  and allow no-op resubmits.
- Comparing against the master would reject innocent edits wherever historical
  rows have drifted from their master's category, turning a data-quality issue
  into an outage for those sellers.

Legacy orphan listings (`masterProductId: null`) have no master to compare
against; comparing against their own values freezes their identity too, which is
the desired outcome.

### 4. A seller must not self-activate a listing

`isActive` is on `UpdateProductDto` and flowed through the `...productData`
spread untouched, so a seller sitting on a `PENDING` / `isActive: false` listing
could `PATCH {"isActive": true}` and go live with no admin approval. This is
pre-existing and independent of the catalogue rule — it is why the existing
approval gate was not a gate.

`isActive: false` stays allowed: pausing your own listing is a legitimate
capability (no UI today, but the vacation-mode work will want it).
`isActive: true` is rejected when `approvalStatus !== APPROVED`.

### 5. Admin must not approve an orphan

`AdminService.approveProduct()` sets `approvalStatus: APPROVED, isActive: true`.
It now refuses a listing with `masterProductId === null`, so the existing
`PENDING` backlog cannot be approved into buyer visibility. Rejection still
works, so the backlog stays cleanable.

## Seller portal

`apps/seller/components/products/ProductForm.tsx`.

Catalogue search becomes step one of Add Product rather than an optional
convenience. Until a master is chosen, the form renders only the search box and
a route to `/products/requests`; the commercial-terms fields mount after the
pick. The chosen product is shown as a confirmed summary card with a **Change**
button that returns to the picker and clears the autofilled identity fields, so
a half-swapped listing cannot be submitted carrying the previous product's name.

Details that matter:

- "No catalogue match" must key off a settled response, not an empty array —
  otherwise it flashes between the keystroke and the request starting, telling
  the seller their product does not exist while we are still looking.
- Identity inputs are disabled whenever the listing is catalogue-linked **or**
  is being edited. Editing must disable them even when `masterProductId` is
  null, because a legacy orphan would otherwise present editable fields that the
  new API guard rejects.
- The edit payload sends `masterProductId` from `linkedMasterId` (the listing's
  own master), not only from a fresh picker selection.

Editing never shows the picker: the listing already has its master, and legacy
listings must stay editable for price and stock.

The Add Product entry points (`products/page.tsx`, `dashboard/page.tsx`) are
unchanged; they now land on a picker.

## Testing

No `.env` and no local database, so verification is `npx jest` plus a clean
`npx tsc --noEmit` (delete `tsconfig.tsbuildinfo` first — the incremental build
passes while a clean build fails). Repo convention is one `*.spec.ts` beside the
code with a header comment explaining what was broken and why.

- `products.master-required.spec.ts` — off-catalogue create rejected, with the
  product named and the request flow mentioned; explicit `masterProductId`
  accepted; name + manufacturer fallback accepted; catalogue-linked rows
  published immediately; `isMigration` does **not** buy a bypass.
- `products.identity-immutable.spec.ts` — a no-op resubmit of every identity
  field passes (the regression that would break ordinary price edits); a real
  rename, manufacturer change, composition change and category change each
  rejected; orphan listings frozen the same way; `isActive: true` on a
  non-approved row rejected while `isActive: false` is allowed.
- `admin.approve-requires-master.spec.ts` — approving a `masterProductId: null`
  listing rejected; approving a linked listing still works.

`products.sitemap.spec.ts` fails with 5 tests on `main`; that is pre-existing.

## Out of scope

- No data migration over existing `PENDING` orphans.
- No change to `POST /products/requests` or the admin review screens for it.
- `/products/sync` is a "coming soon" placeholder with no creation path; untouched.
