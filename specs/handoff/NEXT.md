# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE. Phase 4: **M1–M5 DONE** (reviews in `specs/reviews/M1-*` … `M5-*`).
- `npm run verify` green: ≈495 unit/integration tests (run in UTC by default, like CI), then
  `test:perf` (wall-clock budgets, sequential, uninstrumented), check:deps, check:trace (reads
  `e2e/*.spec.ts` too). Playwright 15/15 (`npm run e2e`, unseeded demo hub). CI green.
- M5 delivered: `domain/schedule.ts` (occurrences, DST, exceptions, run decisions); schedules +
  exceptions + execution log + pause APIs; `Scheduler` (15 s tick, claim-then-execute, last-tick
  mark, crash recovery); morning-result notices + ack; demo seed with schedules; web schedules
  page/form/target picker, holidays, pause banner/dialog, execution log in /historico, morning
  card on the dashboard.

## Next: M6 — Auth completion, roles, audit, settings, health, backups
Start at `M6-T01`. Notes:
- `AuthService` already has login backoff pieces (`recordLoginFailure`, `LOGIN_THROTTLED`); check
  what M1 delivered before adding FR-006.3 rules.
- Route-auth registry exists (`http/route-auth.ts`, `test/route-authz.test.ts`); M6-T03 turns it
  into the full permission matrix (settings/users/logs/backups = admin).
- Settings: `SettingsService.update(patch, actorId)` exists; M6-T05 adds the API, audit diff and
  runtime application (monitor interval, retention, scheduler zone…). R-M5-02: the schedule form
  should then default to `scheduler.timezone`.
- Banners: `DemoBanner` and `PauseBanner` live in `RequireAuth`'s Layout; M6-T11 adds dry-run and
  update-failure banners there.
- Backups: `openDatabase(path, backupsDir)` and the `backups` table exist (M1); `node:sqlite`
  backup API or `VACUUM INTO` for online copies.

## Working conventions
- Commit via the verify-gated helper (scratchpad `commit-task.sh <TASK|-> <msg>`: prettier → mark
  task → `npm run verify` → commit → push → prints the last CI result; reverts the mark on
  failure). Check that CI line after every push and investigate any failure immediately.
- Edit with the editor tool or node scripts written to the scratchpad; never put backticks or
  `${…}` inside bash-quoted node snippets (bash expands them). When a scripted edit fails midway,
  re-read the file: prettier may have reformatted it.
- Web fixtures use local-time instants (`new Date(y, m, d, h, mi)`), never `Date.UTC` for values
  shown as wall-clock text. Wall-clock assertions go in `apps/server/test/perf/*.perf.test.ts`.
- Sessions idle out after 12 h and expire after 7 d: API tests that move the clock by days log
  in per request (`h.login('operator-user')`).

## Files to read first
`CLAUDE.md`, `specs/tasks.md` (M6), `specs/spec.md` FR-006, FR-011, FR-012, FR-014, FR-016,
`specs/plan.md` §6, `specs/decisions.md` ADR-012, ADR-026, ADR-027.
