# Admin-managed promo banner strip

**Date:** 2026-10-04
**Repos:** `pharmabag-api` (branch `feat/promo-banners`), `pharmabag-web` (branch `feat/promo-banners`)

## Problem

There is no way to put a promotional message on the storefront without a code
change and a redeploy.

The homepage renders a fixed sequence — `Navbar`, `HeroSection`, `ProductCarousel`,
`TrustSection`, `Testimonials` — every element of it hard-coded. Category pages
render through `CollectionShell` and carry no promotional surface at all. The
only marketing lever an admin has today is `MarketingProduct`: a list of product
ids shown in the homepage and login carousels, with no artwork, no copy and no
call to action of its own.

So a campaign — a featured brand, a bulk-rate push, a festive offer — currently
costs a developer, a PR and a deploy, which means in practice it does not happen.

What is wanted is a **slim full-width banner strip directly under the header**,
on the homepage and on category pages, whose artwork, link, order and on/off
state are controlled entirely from the admin panel, rotating as a slideshow when
more than one banner is live.

## Scope decisions

Settled before implementation.

1. **A banner is an uploaded image plus a link**, not a set of structured text
   fields rendered by code. The admin uploads finished artwork and sets a
   click-through URL and alt text; the renderer does nothing but place it. This
   gives marketing total design freedom and keeps the component trivial. The
   cost is accepted knowingly: text baked into an image is not selectable, not
   translatable and not readable by crawlers, which is why `altText` is
   **required** rather than optional — it is the only textual representation the
   banner will ever have.

2. **Each banner is targeted at specific pages.** A banner can be placed on the
   homepage, on all category pages, and/or on named individual categories.
   Rejected: a pair of fixed slots (`HOMEPAGE` / `CATEGORY`) showing one
   identical set across every category page. The catalogue has exactly four
   categories with genuinely different buyers; an Ayurvedic promo on the Ethical
   page is waste, and retrofitting targeting later means migrating live rows.

3. **One global `position` per banner, not a position per placement.** A banner
   that appears on both the homepage and the Ethical page occupies the same
   relative slot in both slideshows. Per-placement ordering doubles the admin UI
   to solve a problem nobody has yet.

4. **A category banner also shows on that category's dosage-form sub-pages.**
   `/categories/ethical/tablet` is part of the Ethical collection, so it inherits
   Ethical's banners — the sub-page fetches using its **parent** category slug.
   Targeting a single dosage form is not supported.

   Two neighbouring pages are deliberately excluded. `/categories`, the index
   that lists the four categories, is not itself a category page and shows no
   strip. `/products`, the interactive catalogue, does not render through
   `CollectionShell` and is out of scope here.

5. **Manual `active` toggle only — no scheduling.** No "live from" / "live
   until" timestamps. Scheduling drags in IST-vs-UTC handling and a cache that
   must expire a banner without a request arriving, for a workflow that is today
   "switch it on, switch it off". It can be added later as two nullable columns
   without touching the renderer or the public endpoint shape.

6. **One global rotation interval**, stored in the existing `SiteSetting` table,
   not a column on the banner and not a value per placement. A banner can belong
   to several placements at once, so a per-placement interval has no single
   owner. One number, edited on the same admin screen.

7. **No analytics on banners in this change.** No impression or click counters.
   The first-party analytics module already records page views and can be
   extended later; adding a write path on a public cached read endpoint is a
   separate piece of work with its own caching consequences.

## Data model

One migration in `pharmabag-api`.

```prisma
model PromoBanner {
  id             String   @id @default(uuid())
  title          String   // internal label for the admin list; never rendered
  imageUrl       String   // desktop artwork
  mobileImageUrl String?  // optional; falls back to imageUrl
  altText        String   // required — see scope decision 1
  linkUrl        String?  // null => the banner is not clickable
  active         Boolean  @default(true)
  position       Int      @default(0)
  placements     PromoBannerPlacement[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([active, position])
  @@map("promo_banners")
}

model PromoBannerPlacement {
  id         String      @id @default(uuid())
  bannerId   String
  scope      BannerScope
  categoryId String?     // set if and only if scope = CATEGORY
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

`Category` gains the inverse relation field `bannerPlacements PromoBannerPlacement[]`.

**Why a placement table rather than a string array on the banner.** Targeting a
category needs a real foreign key. With `placements String[]` holding tokens like
`CATEGORY:<uuid>`, deleting a category leaves a dangling id that the read query
silently matches against nothing, and the admin UI shows a placement that no
longer exists. The FK cascade removes the targeting with the category.

**Why `categoryId` is nullable rather than two tables.** `HOMEPAGE` and
`ALL_CATEGORIES` have no category. The `@@unique([bannerId, scope, categoryId])`
constraint stops a banner being placed on the same target twice. Postgres treats
NULLs as distinct in unique constraints, so that constraint does *not* prevent
two `HOMEPAGE` rows for one banner — the service enforces that by deduplicating
the incoming placement set before writing, and a spec covers it.

### Settings

`SiteSetting` row with id `promo_banners`:

```json
{ "rotationSeconds": 5 }
```

Read by the public endpoint and returned alongside the banner list, so the
storefront makes one request rather than two. Clamped to 2–30 seconds on write;
an out-of-range or missing value reads back as 5.

## API

All in a new `src/modules/banners/` module, registered in `app.module.ts`.

### Public

| Endpoint | Returns |
|---|---|
| `GET /banners?scope=homepage` | active banners placed on `HOMEPAGE`, ordered by `position` |
| `GET /banners?scope=category&categorySlug=<slug>` | active banners placed on `ALL_CATEGORIES` **or** on that category, merged and ordered by `position` |

Response envelope matches the rest of the API —
`{ message, data: { banners: [...], rotationSeconds: 5 } }`.

Unauthenticated, because the storefront renders these for logged-out visitors.
An unknown `categorySlug` returns the `ALL_CATEGORIES` banners rather than 404:
the banner strip is decoration, and a slug typo must not take a category page
down.

`GET /banners?scope=category` with no slug is a 400 — that is a caller bug, not a
visitor-facing path.

### Admin

Guarded by `JwtAuthGuard` + `RolesGuard` + the existing `marketing` admin-access
area. No new permission character; `marketing` already exists
(`src/common/admin-access/admin-permissions.ts`, char `v`) and is what the admin
app files banners under.

| Endpoint | Purpose |
|---|---|
| `GET /admin/banners` | full list including inactive, with placements expanded |
| `POST /admin/banners` | create |
| `PATCH /admin/banners/:id` | update |
| `DELETE /admin/banners/:id` | delete (placements cascade) |
| `PATCH /admin/banners/reorder` | `{ ids: string[] }` → rewrites every `position` in one transaction |
| `GET /admin/banners/settings` · `PATCH /admin/banners/settings` | read/write `rotationSeconds` |

`reorder` takes the complete ordered id list and assigns positions by array
index inside a single `$transaction`. Sending deltas or a single moved id invites
duplicate positions when two admins drag at once; rewriting the whole list makes
the last writer coherent rather than interleaved. Ids not belonging to the
banner table are rejected before any write.

### Upload

`POST /storage/banner-image`, admin-only, cloned from the existing
`blog-image` handler — same `multerOptions`, same S3 bucket, returns a public
URL. Lives in `storage.controller.ts` / `storage.service.ts` beside its
siblings rather than in the banners module, because that is where every other
upload path in this codebase lives.

### DTO symmetry is a hard requirement

`src/main.ts` runs the global `ValidationPipe` with `whitelist: true` **and
`forbidNonWhitelisted: true`**, so any property not declared on the DTO is a 400
raised before the service runs. A field present on a create DTO but missing from
the matching update DTO therefore breaks every edit, and the error names a field
the admin never touched. That exact failure shipped on `masterProductId` on
2026-09-30 and took three days to find.

`CreateBannerDto` and `UpdateBannerDto` therefore carry **identical field sets**
from the first commit, differing only in which fields are optional. A spec drives
the real pipe against the exact payload the admin form sends, for both DTOs:

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}).transform(payload, { type: 'body', metatype: Dto })
```

Note that `enableImplicitConversion` **coerces** numbers to strings on
`@IsString()` fields rather than rejecting them, so a spec asserting "a number is
rejected" will fail for the wrong reason; assert on the coerced output instead.

## Storefront rendering

In `pharmabag-web`.

### The component

`apps/buyer/src/components/promo/PromoBannerStrip.tsx` — a client component
taking `{ banners, rotationSeconds }` as props. It owns rotation only; it never
fetches.

- Renders `null` when the list is empty. A page with no banners has no strip and
  no reserved space.
- A single banner renders statically with no timer, no dots and no arrows.
- Autoplay on `rotationSeconds`, pausing on pointer hover/focus and on
  `document.visibilitychange` so a backgrounded tab does not cycle through the
  whole set unseen.
- **No autoplay at all under `prefers-reduced-motion: reduce`** — the strip
  shows slide 1 and its controls, and only advances on user action.
- Dots always; arrows from the `sm` breakpoint up, hidden below it to keep the
  strip slim on phones, where horizontal swipe handles it.
- Keyboard: arrows are real buttons; dots are a tablist with left/right key
  support. The slide region carries `aria-roledescription="carousel"` and a live
  region announcing "slide N of M".
- `<Link>` wrapper only when `linkUrl` is set, with `aria-label` from `altText`.
- Fixed `aspect-ratio` wrapper so the strip reserves its height before images
  load and the hero below it does not jump. `priority` on the first slide only;
  the rest load lazily.
- Art direction uses **two `next/image` elements per slide** — the mobile one
  shown below the `sm` breakpoint, the desktop one above, toggled with Tailwind
  `hidden`/`block` classes. Not a raw `<picture>` element: `next/image` is what
  carries `priority`, the optimiser and the CLS-safe sizing this strip depends
  on, and it does not accept `<source>` children. A banner with no
  `mobileImageUrl` renders the desktop image at both breakpoints.

### Where it is fetched

`apps/buyer/src/lib/seo/banners.ts`, a `fetch` helper alongside the existing
`lib/seo/catalog.ts` helpers, with `next: { revalidate: 60 }`.

**Caching is a correctness requirement here, not an optimisation.** The API's
global `ThrottlerGuard` allows 100 requests per 60 seconds keyed on `req.ip`
(`app.module.ts`, with `trust proxy 1` set in `main.ts`). Every server-side fetch
from the Next.js server arrives from one address and therefore shares one
bucket. An uncached per-render banner fetch would spend that budget and start
429-ing unrelated catalogue reads. With a 60-second revalidate there are at most
a handful of banner requests per minute across the whole site.

Sixty seconds, rather than the one-day window `lib/seo/catalog.ts` uses for
catalogue reads, because an admin who toggles a banner off expects it gone
promptly — a day-long cache would make the admin screen look broken.

### Category pages

One insertion in `apps/buyer/src/components/seo/CollectionShell.tsx`, directly
below `<Navbar />`. That shell backs every facet page — category, dosage form,
brand, generic molecule, state and city — so a single edit covers all of them,
and the banners arrive as a prop from each page's own server-side fetch.

Only the category and dosage-form pages pass banners in this change. The brand,
generic, state and city pages pass nothing and render no strip, matching scope
decision 2; the prop is optional so that stays a one-line change per page if it
is wanted later.

### Homepage

`apps/buyer/src/app/page.tsx` is currently `'use client'` in its entirety, so it
cannot fetch on the server. It becomes a thin server component that fetches the
banners and renders the existing body, moved verbatim into
`apps/buyer/src/components/landing/HomeShell.tsx` with its `'use client'`
directive and its `open-login` window-event dispatch unchanged.

This refactor is in scope because the alternative is a client-side banner fetch
on the site's most important page: the strip would pop in after hydration, and
the one element whose job is to be seen first would be the last thing to appear.

## Admin panel

`apps/admin/app/marketing/banners/page.tsx`, reached from a tab on the existing
Marketing Management screen, which already manages `MarketingProduct` carousels
and is the obvious home.

- A list ordered by `position`, each row showing a thumbnail, the internal
  title, its placements as chips, an active toggle, and edit/delete.
- **Drag to reorder** the whole list, committing through `PATCH /admin/banners/reorder`
  on drop. Up/down buttons alongside the drag handle, because drag-and-drop is
  not keyboard-operable and this screen must be.
- Create/edit modal: desktop image, optional mobile image, alt text, link URL,
  placement checkboxes (Homepage · All category pages · each of the four
  categories, fetched live rather than hard-coded), active toggle.
- Artwork guidance shown in the form: **desktop 1920×180**, **mobile 800×240**.
  A mismatched aspect ratio produces a warning, never a block — the ratio is
  advice, and an admin who deliberately uploads something taller should be able
  to.
- `rotationSeconds` edited once at the top of the screen.
- Both images upload through `POST /storage/banner-image` and the form stores the
  returned URLs.

`apps/admin/lib/admin-areas.ts` needs a route rule for `/marketing/banners`
mapping to the `marketing` area. The API's `src/common/admin-access/` and this
file must agree: when they do not, the screen renders for an admin whose
permission string lacks the area and then every request behind it 403s.

## Testing

### api

Specs beside the code, one per concern, each with the header comment this repo
uses explaining what was broken or what is being guarded:

- `banners.service.spec.ts` — scope merge (`ALL_CATEGORIES` + category, no
  duplicates when a banner matches both), ordering by `position`, inactive rows
  excluded, unknown slug falls back to `ALL_CATEGORIES`, duplicate placements in
  the incoming set deduplicated.
- `banners.dto.spec.ts` — the real `ValidationPipe` against the admin form's
  exact payload, asserting create and update accept the identical field set.
- `banners.reorder.spec.ts` — positions rewritten by index, a foreign id
  rejected before any write, partial id lists rejected.
- `banners.settings.spec.ts` — `rotationSeconds` clamped to 2–30, missing or
  malformed settings read back as 5.

Verified with `npx jest` and a clean `npx tsc --noEmit`. There is no `.env` and
no local database, so the server is not run; the service specs mock Prisma, as
the existing service specs in this repo do.

`products.sitemap.spec.ts` fails with 5 tests on `main` and will fail here too.
That is pre-existing and not part of this change.

### web

The monorepo has no unit test framework — no jest, no vitest, zero spec files —
so verification is `pnpm tsc --noEmit` plus `pnpm build` across the affected
apps. All behavioural coverage for this feature lives in the api repo.

Manual verification against a running buyer app: zero banners (no strip, no
reserved space), one banner (static, no controls), three banners (rotation,
pause on hover, dots, swipe), reduced-motion on (no autoplay), a banner with no
`linkUrl` (not clickable), and a category-targeted banner appearing on its
dosage-form sub-page.

## Delivery

Both repos carry substantial uncommitted work on unrelated branches, so all work
happens in `git worktree` checkouts off the deployed heads — `origin/main` for
`pharmabag-api`, `upstream/main` for `pharmabag-web` — with `node_modules`
junctioned in rather than reinstalled. Note that `git worktree remove --force`
follows those junctions and deletes the real `node_modules`; remove the junctions
first.

PRs go to `pharmabagtech-ux` on both repos.

**The API must merge and deploy before the web app.** The storefront's banner
fetch returns 404 until `GET /banners` exists. The fetch helper treats any
non-200 as an empty list so the pages still render, but shipping web first means
a window where the feature is silently absent.

The admin screen and the storefront strip are independently useless and jointly
sufficient: there is no partial state worth shipping on its own.
