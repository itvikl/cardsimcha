# Parked: Vitol's feature/business-ads work, waiting to be ported

These files came into `new-design` with the two merges of `feature/business-ads` (5f2126a, 22eac97).
They are written against the Firestore data layer and the v1 card format, so they don't compile on
`new-design` (447 type errors) and kept `next build` from passing. They live here, outside the build
(`tsconfig.json` excludes `legacy/`), as the source to port from. Paths mirror the repo:
`legacy/business-ads/src/lib/looks.ts` goes back to `src/lib/looks.ts` once it works on v2 and Postgres.

Two kinds of file:

- **Vitol's new files** (most of them): moved here as they were.
- **Files both sides changed**, where the merge combined the two versions into something that
  didn't compile: `src/app/categories/page.tsx`, `src/app/category/[topic]/page.tsx`,
  `src/lib/agent/run.ts`, `src/lib/elements.ts`. `src/` has new-design's own version back (from
  ec305e3); the combined version is kept here.

What is out of the running app until it's ported: the business door pages (brand kit, catalog,
messages, billing, business categories), the server-side download routes (export, GIF, video, ZIP) and resizing, private card
looks (backgrounds and wordings), guest entry without sign-up, design import, Shabbat times, and the
seed scripts (`npm run seed:*`).

The editor tools (snapping, rulers, layers, arc text, effects, …) are ported from Vitol's branch
itself, where they run: `git show origin/feature/business-ads:src/components/Editor.tsx`.

Decisions for the port (2026-11-15, Zvi and Vitol): see the decisions board on page 3 of the mockup canvas.
