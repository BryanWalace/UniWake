# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE (`constitution.md` v1.1, `spec.md` v1.1, `plan.md` v1.0, `tasks.md` v1.0).
- **Phase 4, M1 Foundation: DONE.** All M1 tasks `[x]`, break-it pass (`M1-D`) and review
  (`specs/reviews/M1-review.md`, `M1-architect.md`) closed; fixes M1-F1..F8 done.
- `npm run verify` green (151 tests; core coverage ~99% stmts / ~91% branches); CI green on
  ubuntu + windows.
- What exists: monorepo (shared/server/web), lint boundaries, network guard (dgram/net/http/DNS),
  SQLite + migrations (all tables), config + rotating logger, Fastify app (auth registry, Host
  allowlist, CSRF, headers, errors), hub with two listeners, argon2id auth + sessions + first-run
  setup, audit, settings service, web shell + login/setup, `check:deps`, `check:trace`.

## Next: M2 — Devices, Rooms, Tags (lead: Senior Fullstack)
Start at `M2-T01` in `specs/tasks.md`. Patterns to reuse:
- Repository interface in `application/<area>/`, SQLite implementation in `db/repositories/`.
- Wire services in `apps/server/src/services.ts`; routes in `apps/server/src/http/routes/` and
  register them in `http/panel.ts` (route-table authz test covers them automatically).
- API tests: `apps/server/test/helpers/api.ts` (`apiHarness`, `h.as('operator')`).
- Put AC IDs in test titles (`check:trace` enforces it for done tasks).
- Commit with the helper pattern: run `npm run verify`, only commit if it exits 0
  (never pipe verify into `head` without checking its exit code).

## Files to read first
`CLAUDE.md`, `specs/tasks.md` (M2), `specs/spec.md` FR-002/FR-008, `specs/plan.md` §5–§6.
