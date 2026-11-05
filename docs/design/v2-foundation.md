# v2 foundation: data platform and card format

Status: **draft for review** (zvimoe, itvikl) · Branch: `new-design` · Covers phase 1 of [`overallplan`](../../overallplan) plus the storage groundwork phase 2 depends on.

## 1. Decisions in this document

| # | Decision | Why |
|---|---|---|
| D1 | **PostgreSQL** replaces Firestore | The domain is relational: workspaces → users → templates → creatives, shared assets and fonts, permissions, quotas, billing. Postgres keeps card documents as `jsonb` and adds `pgvector` for smart search, so one database covers the plan. |
| D2 | **AWS**: RDS Postgres, S3 + CloudFront, Next.js in a container on ECS Fargate, SQS + worker later | The AI assistant (Claude Agent SDK) starts a subprocess and server-side export needs native libraries and fonts. Both need a long-lived container, not serverless functions. |
| D3 | **Stay a Next.js monolith** (no NestJS) | Route handlers + a typed data layer give the same boundaries without a second service to deploy. |
| D4 | **Workspaces from day one** | Every row belongs to a workspace. A private customer gets a personal workspace, a business a company workspace. B2B is then a feature, not a migration. |
| D5 | **Card format v2**: three fixed layers, per-element locks, more element types | Removes z-index drift (a real bug: an imported card had its signature saved *under* the background image) and replaces the single `editable` flag with the plan's lock rules. |
| D6 | **Build the private side first** (v2 editor, font upload, PDF export, pay per download), business features after | The core every customer needs comes first, and the B2B governance is built on top of it. |

Out of scope here: billing, brand kits UI, the generator pipeline, smart search. The schema leaves room for them (§3.3).

## 2. Infrastructure

| Need | Production (AWS) | Local development |
|---|---|---|
| Database | RDS PostgreSQL 16 + `pgvector` | Postgres in Docker (`docker compose up db`) |
| Files (images, fonts, exports) | S3 bucket, private; served via CloudFront | Local folder `data/files/` behind the same interface |
| App | Container on ECS Fargate behind an ALB | `npm run dev` |
| Background jobs (batch render, ad sets) | SQS + worker container (phase 3) | Runs inline |
| Secrets | AWS Secrets Manager → env vars | `.env.local` |

Configuration (env): `DATABASE_URL`, `FILES_DRIVER=s3|local`, `S3_BUCKET`, `CDN_BASE_URL`, `ANTHROPIC_API_KEY`. Firebase settings are removed after the data migration (§6).

Code access: **Prisma** for the schema, migrations and typed queries. The Firestore-specific `db.ts` (read every collection, diff, batch write) is replaced by repository functions. Callers stop receiving the whole `Db` object.

## 3. Data model

### 3.1 Tables

Ids are UUIDs. `created_at` / `updated_at` on every table are omitted below.

```
workspaces      id, kind ('personal'|'company'), name, plan ('free'|'personal'|'business'), storage_quota_mb
users           id, email (unique, null for guests), name, password_hash, salt, platform_role ('admin'|'none')
memberships     workspace_id, user_id, role ('owner'|'manager'|'editor'|'viewer')        PK (workspace_id, user_id)
sessions        token_hash (PK), user_id, expires_at
topics          id, name, audience ('private'|'business'), cover_url, sort_order, hidden   -- home-page categories (today: CATEGORIES + carousel)
templates       id, workspace_id (null = platform catalogue), topic_id, name, status ('draft'|'published'),
                canvas jsonb (v2 doc), thumbnail_key, published_at
creatives       id, workspace_id, user_id, template_id, name, canvas jsonb (v2 doc), thumbnail_key
assets          id, workspace_id (null = platform), collection_id, kind ('image'|'svg'|'pattern'|'sticker'),
                file_key, width, height, metadata jsonb, embedding vector(…) (phase 5)
collections     id, workspace_id (null = platform), name, description               -- today's image "categories"
fonts           id, workspace_id (null = platform), family, weight, style, file_key, unicode_ranges
brand_kits      id, workspace_id, palette jsonb, typography jsonb                   -- table now, UI in phase 4
exports         id, creative_id, format ('png'|'pdf'), status, file_key             -- phase 3
```

### 3.2 Mapping from today

| Today (Firestore / `db.json`) | v2 |
|---|---|
| `Project` with `kind: 'template'` | `templates` (platform catalogue, `workspace_id` null) |
| `Project` with `kind: 'design'` | `creatives`, in the owner's personal workspace |
| `Project.topic` + `CATEGORIES` + `CarouselSlide` | `topics` (one row per category: audience, cover, order, hidden) |
| `Category` (image folder) | `collections`. Renamed: "category" now means only the home-page topic. |
| `ImageAsset` | `assets` (`kind: 'image'`) |
| `User.role: 'admin'` | `users.platform_role = 'admin'` |
| Guest cookie user | A `users` row without email + a personal workspace, created on first save |
| Upload `uploads/<file>` | S3 key `assets/<workspace>/<id>.<ext>` |

### 3.3 Access rules

- **Platform admin**: everything, including the platform catalogue (today's "admin mode").
- **Workspace member**: rows of their workspace, by role. `editor` edits creatives. `manager` also edits workspace templates and brand kits. `owner` also manages members and billing.
- **Everyone**: published catalogue templates, topics.

All checks live in one module (successor of `access.ts`). Routes never filter rows themselves.

## 4. Card format v2

### 4.1 Document

```ts
type CanvasDocV2 = {
  schema_version: 2;
  page: { width_mm: number; height_mm: number };
  layers: {
    background: BackgroundLayer;   // exactly one fill, optionally an image on top of it
    content: CanvasElement[];      // texts, shapes, dividers, content images
    overlay: CanvasElement[];      // stickers, frames, ribbons, user overlays
  };
};

type BackgroundLayer = {
  fill: Fill;                                  // always drawn
  image?: { asset_id: string; fit: 'cover' | 'contain'; colorOverride?: string };
  locks: Locks;                                // customer: swap image / change fill only if allowed
  field?: Field;
};
```

Order **within** a layer is the array order. There is no `z` field. A layer is always drawn above the one before it, so content can never end up under the background.

### 4.2 Elements

```ts
type Base = {
  id: string;
  x_mm: number; y_mm: number; rotation: number;
  locks: Locks;
  field?: Field;          // shown to the customer as a form field
};

type Locks = {
  content: boolean;       // allowContentEdit: change text / swap image
  transform: boolean;     // allowTransform: move, resize, rotate
  delete: boolean;        // allowDelete
  style: boolean;         // change colour (today customers may change text colour)
};

type Field = { label: string; variable?: string };   // variable: e.g. 'event_name', for batch fill and the generator

type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: { offset: number; color: string }[] }
  | { type: 'radial'; stops: { offset: number; color: string }[] }
  | { type: 'pattern'; asset_id: string; scale: number };

type CanvasElement =
  | Base & { type: 'text'; w_mm: number; text: string; align: 'right' | 'center' | 'left';
             font: { family: string; weight: number; size_pt: number; color: string;
                     line_height?: number; letter_spacing?: number };
             fit?: 'none' | 'shrink' }                 // shrink: reduce size until the text fits w_mm (and h_mm if set)
  | Base & { type: 'image'; w_mm: number; h_mm: number; asset_id: string;
             mask?: 'none' | 'circle' | 'rounded' | { svg_asset_id: string };   // photo frames
             swap_collection_id?: string }
  | Base & { type: 'shape'; shape: 'rect' | 'ellipse' | 'line'; w_mm: number; h_mm: number;
             fill: Fill; stroke?: { color: string; width_mm: number }; radius_mm?: number }
  | Base & { type: 'svg'; w_mm: number; h_mm: number; asset_id: string; recolor?: Record<string, string> }  // stickers, badges
  | Base & { type: 'group'; children: CanvasElement[] };                      // text presets, smart grouping
```

`font.family` refers to a row in `fonts`, so uploaded fonts work everywhere the built-in ones do.

### 4.3 Enforcement

`applyCustomerEdits` becomes `applyEdits(stored, incoming, actor)`: for every element of the stored template it takes from the incoming doc only what that element's `locks` allow for the actor, and ignores new elements unless the template allows additions on the overlay layer. Same rule as today (the server never trusts the client), generalised. The AI assistant's tools go through the same function, so they cannot do more than the user could.

Defaults: in a template, new elements are `{ content: true, transform: false, delete: false, style: true }` for customers (what `editable: true` means today). The background is `{ content: false, … }` unless the author allows swapping.

### 4.4 Editor

- One Konva `Layer` per card layer. Background isolated from pointer events unless it is swappable and selected from the panel.
- Selection, transformer and history operate within a layer. "Bring forward / send back" move within the layer only.
- The admin's element panel gets a lock inspector (the four checkboxes and the field label). It replaces the "editable" toggle.

## 5. Migration v1 → v2 (card documents)

A pure function `migrateV1(doc) → CanvasDocV2`, run on read until all stored documents are converted, then once over the database:

1. `page.background` → `layers.background.fill = { type: 'solid', color }`.
2. The lowest-`z` image that covers the whole page (±1 mm) → `layers.background.image`, its `swappable` / `swapCategoryId` / `colorOverride` / `label` mapped to `locks.content`, the collection id and `field`.
3. All other elements, sorted by `z` → `layers.content`. `rect` → `shape: 'rect'`, `fill: { type: 'solid' }`.
4. Text `editable: true` → `locks = { content: true, transform: true, delete: false, style: true }` (today customers may also drag editable texts) and `field = { label }`. `editable: false` → all locks false.
5. Image `swappable: true` → `locks.content: true`, `swap_collection_id = swapCategoryId`.

The broken wedding card is fixed by step 2–3: its signature becomes a content element above the background.

The ad importer (`examples/ad-import`) changes accordingly: the cleaned image goes to `layers.background.image`, rectangles and texts to `layers.content`.

## 6. Data migration

`scripts/migrate-to-postgres.ts`:

1. Read the source: Firestore (with credentials) or `data/db.json` (`--from local`).
2. Create one platform catalogue (`workspace_id` null) for all templates, and a personal workspace per user that owns designs.
3. Insert topics (merge `CATEGORIES` with carousel settings), collections, assets, templates, creatives (canvas converted by `migrateV1`), users, memberships. Sessions are not migrated (everyone signs in again).
4. Copy files from Cloud Storage / `data/uploads` to S3 under the new keys.
5. Verify counts and that every canvas passes `validateDocV2`. Idempotent (upsert by id), so it can run again before the switch.

## 7. Code changes

| Area | Change |
|---|---|
| `src/lib/db.ts`, `firebase.ts` | Replaced by `src/lib/data/*` (Prisma client, repositories per entity) and `src/lib/files.ts` (S3 / local) |
| 14 files using `readDb` / `updateDb` (API routes, `auth.ts`) | Call repositories instead of loading everything |
| `types.ts`, `canvas.ts` | v2 types, `validateDocV2`, `migrateV1`, `applyEdits` |
| `Editor.tsx` | Konva layers, lock inspector, new element types (fills, shapes, svg, masks, groups) |
| `agent/tools.ts` | v2 element model, edits through `applyEdits` |
| `access.ts` | Workspace + role rules (§3.3) |
| `examples/ad-import` | Output v2 |
| New | Font upload (admin and workspace), `docker-compose.yml` for Postgres, Prisma schema + migrations |

The home page, doors, carousel and category pages keep their UI. Only their data calls change.

## 8. Rollout

1. **Data platform**: Prisma schema, local Postgres, repositories, files interface, auth on Postgres. The app runs with v1 cards stored in `jsonb`.
2. **Migration script**, tested against a copy of the Firestore data and `data/db.json`.
3. **Card format v2**: types, validation, `migrateV1`, `applyEdits`, editor layers and lock inspector, agent tools, importer.
4. **Font upload** and the new element types.
5. **AWS environment**: RDS, S3/CloudFront, ECS service, CI deploy. Then run the migration and switch.

Each step is reviewable and merged into `new-design` separately. `main` stays deployable on Firebase until step 5.

## 9. Open questions

1. **itvikl**: agree to replacing Firestore with Postgres (D1)? Is anything in production on Firebase that has to keep working during the move?
2. **AWS account and region**: whose account, and `eu-central-1` (Frankfurt) or `il-central-1` (Tel Aviv)?
3. **Sign-in**: keep our own email/password (plus guests), or move to a hosted provider (Cognito, Clerk) once companies and invitations arrive?
4. **Editor ownership while v2 is built**: itvikl is changing `Editor.tsx` on `main`. Freeze editor changes on `main`, or merge `main` into `new-design` regularly?
5. **Customer additions**: may private customers add their own stickers and text (overlay layer), or only fill fields?
