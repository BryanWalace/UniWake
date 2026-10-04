# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE. Phase 4: **M1, M2, M3, M4 DONE** (reviews in `specs/reviews/M1-*` … `M4-*`).
- `npm run verify` green: ≈431 unit/integration tests, then `test:perf` (wall-clock budgets,
  sequential, uninstrumented), check:deps, check:trace (now also reads `e2e/*.spec.ts`).
  Playwright 15/15 (`npm run e2e`, unseeded demo hub, simulated boots 1–3 s). CI green.
- M4 delivered: status state machine; TCP + PowerShell ICMP helper (ready handshake) + `ping.exe`
  fallback; `ProbeQueue`; `MonitorService` (sweeps, DNS cache/drift, verification counts as a
  probe, fast abortable stop); SSE `/api/events`; dashboard/uptime/history APIs + nightly rollup;
  retention jobs; simulated LAN + demo seed; web dashboard, device page, realtime provider (idle
  header, hidden-tab release), Ctrl+K palette; E2E for AC-004-08/09/15/17, AC-009-01, NFR-01.

## Next: M5 — Scheduler (lead: Senior Fullstack)
Start at `M5-T01` (`domain/schedule.ts`). Notes:
- Reuse `domain/tz.ts` (`dayStart`, `addDays`, `localDay`, `nextLocalTime`) for occurrences; add
  the DST rule from ADR-008 (non-existent local times run at the first valid instant; repeated
  ones once) and test the matrix (AC-005-06).
- Wake jobs for schedules: `wake.start(req, actor, { source: 'schedule', scheduleRunId,
  preConfirmed, networkRetryUntil })` already exists; `JobRunner` has `onFinished` for the morning
  result (FR-013).
- `notices` table + dashboard notices area exist; `NOTICE_TEXT` in `DashboardPage.tsx` needs the
  new notice types. SSE already forwards `notice` and `scheduler` events (invalidate dashboard).
- M5-T07 must extend the demo seed (`application/demo/demo-seed.ts`) with 2 schedules and a past
  morning-result notice.
- Scheduler tick must use the injectable `Clock`; the hub stop order is runner → retention →
  dashboard → monitor → listeners; add the scheduler first.

## Working conventions
- Commit via the verify-gated helper (scratchpad `commit-task.sh <TASK|-> <msg>`: prettier → mark
  task → `npm run verify` → commit → push → prints the last CI result; reverts the mark on
  failure). Check that CI line after every push and investigate any failure immediately.
- Edit with the editor tool or node scripts written to the scratchpad; never put backticks or
  `${…}` inside bash-quoted node snippets (bash expands them). Build BOMs with
  `String.fromCharCode(0xfeff)`.
- Web tests: `findBy*` waits up to 5 s (setup.ts). Wall-clock assertions go in
  `apps/server/test/perf/*.perf.test.ts`, never in the parallel suite.

## Files to read first
`CLAUDE.md`, `specs/tasks.md` (M5), `specs/spec.md` FR-005 + FR-013, `specs/plan.md` §5–6,
`specs/decisions.md` ADR-008, ADR-027.
