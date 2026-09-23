# Remaining Build — Task Breakdown

Mark `[x]` when merged to master. Each feature lists exact files touched so
work can be picked up by any LLM/dev mid-way — just paste this file + repo.

## 1. Site Scanner (architecture import + orphan detection) — DONE (basic scan pre-existed)
- [x] `apps/api/prisma/schema.prisma` — added `isOrphan`, `lastScannedAt` to `SitePage`
- [x] `apps/api/src/services/wordpress.ts` — `listWpPosts` paginates (was capped at 40) + fetches content; added `listWpPostTypes`
- [x] `apps/api/src/services/scanner.ts` (new) — full scan: categories+hierarchy, posts/pages/custom types (paginated), orphan detection via href-parsing across all page content
- [x] `apps/api/src/routes/wordpress.ts` — `POST /:siteId/scan` now calls `scanSite()`, returns `orphanCount`/`postTypesScanned`
- [x] `apps/admin/src/app/sites/page.tsx` — orphan count surfaced in scan toast
- Still synchronous (blocks request on large sites) — will move to job queue when #6 is built

## 2. Topic Planning & Clustering — DONE
- [x] `apps/api/prisma/schema.prisma` — added `TopicCluster`, `TopicIdea` models + `TopicStatus` enum, relations on `Site`
- [x] `apps/api/src/services/planner.ts` (new) — OpenAI call grounded in existing titles + business facts; lexical cannibalization check (word-overlap ratio ≥0.6)
- [x] `apps/api/src/routes/planning.ts` (new) — `POST /sites/:siteId/plan`, `GET /sites/:siteId/topics`, `PATCH /sites/topics/:id`
- [x] `apps/api/src/index.ts` — registered `planningRoutes` under `/sites` prefix
- [x] `apps/admin/src/app/planning/page.tsx` (new) — minimal UI: instruction box, topic list, approve/reject
- NOTE: run `npx prisma migrate dev --name topic_planning` before starting the API
- NOTE: cannibalization check is lexical only (word overlap), not semantic — upgrade path is embeddings in #3

## 3. Internal Linking Engine (relationship graph) — DONE
- [x] `apps/api/prisma/schema.prisma` — added `PageLink` model + `Site` relation
- [x] `apps/api/src/services/linking.ts` (new) — `rankLinkTargets()` (keyword/title overlap scoring, orphan boost), `recordAppliedLinks()` (parses `<a href>` from generated HTML into `PageLink` rows = the relationship graph)
- [x] `apps/api/src/routes/linking.ts` (new) — `GET /sites/:siteId/link-suggestions`
- [x] `apps/api/src/index.ts` — registered under `/sites`
- [x] `apps/api/src/services/generate.ts` — swapped naive "30 most-recent pages" for ranked `rankLinkTargets()`; records applied links after each generation
- NOTE: scoring is lexical, not embeddings — swap-in point is `rankLinkTargets()`, callers don't change

## 4. 3-Language Localization Workflow — DONE
- [x] `apps/api/src/services/localize.ts` (new) — `localizeContent()`, own OpenAI call per language: own keyword/title/meta/slug, not literal translation, facts preserved
- [x] `apps/api/src/routes/content.ts` — `POST /content/:id/localize { languages: ["pt","fr"] }`
- No schema change (self-relation via `parentContentId` + `language` enum already existed)
- NOT done: language tabs in `DocEditor.tsx` admin UI — API works, UI still shows only the single record you fetch

## 5. Rank Math Field Verification — DONE
- [x] `apps/api/prisma/schema.prisma` — added `rankMathVerified`, `rankMathMismatches` to `ContentItem`
- [x] `apps/api/src/services/wordpress.ts` — `verifyRankMathMeta()` reads post back with `context=edit` and diffs against expected
- [x] `apps/api/src/routes/content.ts` — `/:id/publish` now verifies after publish, stores result, returns `rankMath` in response
- [x] `wp-mu-plugin-rankmath-meta.php` (new, repo root) — **must be installed on the WP site** (`wp-content/mu-plugins/`) or verification will always fail: Rank Math doesn't expose its meta keys to REST by default

## 6. Persistent Job Queue — DONE
- [x] `apps/api/prisma/schema.prisma` — extended `Job` with `pct`, `label`, `result`
- [x] `apps/api/src/lib/jobs.ts` — rewritten DB-backed (Prisma `Job` table), same function names, now async
- [x] `apps/api/src/routes/content.ts` — call sites updated to `await`
- Still simple polling, not Redis/BullMQ — fine at current scale, survives restarts/multi-instance now which was the actual reliability gap

## 7. AI Cost Tracking Dashboard — DONE
- [x] `apps/api/src/routes/usage.ts` (new) — `GET /usage?siteId=&from=&to=`, aggregates by provider/operation/day
- [x] `apps/admin/src/app/usage/page.tsx` (new)
- [x] `apps/api/src/index.ts` — registered under `/usage`
- LIMITATION: siteId filter only works for usage rows tied to a `contentId` (generation, localization, optimization). Planning (`plan_topics`) usage isn't linked to a site yet — minor gap, note for later

## 8. Human Review/Approval + Version History + Content Optimization — DONE
- [x] `apps/api/prisma/schema.prisma` — added `ContentVersion` model, `ContentStatus` gained `REJECTED`/`NEEDS_REVISION`, `ContentItem.reviewNote`
- [x] `apps/api/src/routes/content.ts` — snapshot to `ContentVersion` on every PATCH edit; added `POST /:id/reject`, `POST /:id/request-changes` (approve already existed); `GET /:id/versions`
- [x] `apps/api/src/services/optimize.ts` (new) — pulls live WP page, proposes improvements via LLM, never overwrites directly (sets `NEEDS_REVISION`, snapshots prior state first)
- [x] `apps/api/src/services/wordpress.ts` — added `getWpPostByUrl()`
- [x] `apps/api/src/routes/content.ts` — `POST /:id/optimize`
- [x] `apps/admin/src/app/review/page.tsx` (new) — approve/reject/request-changes + version history viewer

---

**Suggested build order:** 1 → 6 → 2 → 3 → 4 → 7 → 8 → 5
(scanner and queue are foundational; 5 needs a WP-side plugin change so it's fine to do last/in parallel)
