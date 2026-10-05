# NEXT — handoff

Updated: 2026-10-05 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE. Phase 4: **M1–M6 DONE** (reviews in `specs/reviews/M1-*` … `M6-*`).
- `npm run verify` green: ≈560 unit/integration tests (UTC by default, like CI), then `test:perf`
  (sequential), check:deps, check:trace (reads `e2e/*.spec.ts` too). Playwright 18/18 incl. the
  axe sweep (`npm run e2e`, unseeded demo hub). CI green.
- M6 delivered: password policy, login backoff + per-IP limit, users API/page (LAST_ADMIN),
  permission matrix test, audit viewer + CSV, settings admin (DB keys + config.json bootstrap keys,
  `requiresRestart`), LAN HTTPS listener (`helper/` cert script, PanelCertificateStore), log viewer,
  health service/page (HostChecks/TimeCheck ports), backups + restore (swap at start, exit 75),
  GlobalBanners on every page.

## Next: M7 — prepare-target.ps1 and self-enrollment
Start at `M7-T01`. Notes:
- The agent listener (ADR-011, plan §6) is separate from the panel; check `hub.ts` for what M1
  set up (route table must end up with exactly 3 agent routes, M7-T02).
- Enrollment tokens: store only SHA-256 (like sessions in `auth-service.ts`); value shown once.
- `KeyedLimiter` (`application/rate-limit.ts`) gives the 10/min per-IP agent limit.
- Device moves (AC-007-07) raise a 24 h dashboard notice: reuse the notices service from M5.
- Pester/PSScriptAnalyzer run only in the windows CI job; locally `pwsh` is absent, Windows
  PowerShell 5.1 is present (check if Pester 3.x ships with it; tests may need Pester 5 via
  `Install-Module` in CI only). PowerShell files: UTF-8 BOM + CRLF (`scratchpad/fix-bom.cjs`).
- R-M6-04: document in the README (M8) that `npm run dev` does not restart after a restore.

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
`CLAUDE.md`, `specs/tasks.md` (M7), `specs/spec.md` FR-007, FR-010, `specs/plan.md` §6,
`specs/decisions.md` ADR-011.
