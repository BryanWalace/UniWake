# NEXT — handoff

Updated: 2026-10-06 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE. Phase 4: **M1–M9 DONE**, Phase 5 DONE (reviews in `specs/reviews/M1-*` … `M9-*`, `final-audit.md`).
- `npm run verify` green: ≈728 unit/integration tests (UTC by default, like CI), then `test:perf`,
  check:deps, check:trace (reads `e2e/*.spec.ts` and `scripts/tests/*.Tests.ps1` too). Playwright
  23 specs (`npm run e2e`, Chromium; `npm run e2e:edge` on Windows). `npm run test:ps`: PSScriptAnalyzer + 28 Pester tests (windows CI job
  runs it too). CI green.
- M7 delivered: enrollment tokens + hash-pinned one-liner (`/api/enrollment/*`), agent listener
  with exactly 3 routes (`/api/health`, `/agent/enroll` with Bearer token, `/agent/prepare-target.ps1`),
  `scripts/prepare-target.ps1` (NIC wake, Fast Startup, advanced NIC properties, own ICMP rule per
  ADR-028, enrollment, exit codes 0/1/2/3), /preparar page, "Testar WoL" flow (migration 003
  `test_wol_runs`), device diagnostics (`/api/devices/:id/diagnostics`), help pages `/ajuda/*`.

## Status: Phases 0–5 done; release candidate v1.0.0-rc.1
- M1–M9 done, Phase 5 validation done (`specs/validation.md`, `specs/validation-acs.md`,
`specs/reviews/final-audit.md`). CI green on all four jobs (incl. Windows installer and end-to-end
update with rollback).
- ADR-029: tag `v1.0.0-rc.1` published as a GitHub prerelease by `release.yml`. **Owner next:** run
the checklist in `specs/validation.md` V-T05 (real WoL per PC model, reboot with nobody logged in,
VLANs, LAN HTTPS), decide on code signing (B-001), then tag `v1.0.0` on the validated commit
(`git tag v1.0.0 && git push origin v1.0.0`).
- Agent next (if asked): roadmap items in `specs/improvements.md` marked roadmap; keep CI green.
- Known dev-only flake: a vitest worker on Windows occasionally exits with 0xC0000409 under the full
parallel run (seen in tcp-prober and hub tests); rerun; CI has never shown it.
Notes:
- Inno Setup, WinSW and the Node runtime are not installed locally: build/verify the installer in
  the windows CI job (install Inno Setup there, e.g. via choco, pinned version). Keep everything
  that can be unit-tested (plan file, updater state machine, http allowlist) runnable locally.
- Installed layout is plan §9: `versions\<ver>\` holds `server.mjs`, `updater.mjs`, `web\`,
  `scripts\prepare-target.ps1`, `helper\*.ps1`. `resolvePrepareScriptPath` and
  `resolveHelperPath` already look next to the bundle first.
- R-M7-05: the installer must open the agent port (47101) inbound, besides the panel's LAN port.
- R-M7-02: README (M8-T10) tells technicians to revoke a room's code when done.
- R-M6-04: README for developers: `npm run dev` does not restart after a restore (exit 75).
- Health already reports update status placeholders; notices support `update_failed` banners.

## Working conventions
- Commit via the verify-gated helper (scratchpad `commit-task.sh <TASK|-> <msg>`: prettier → mark
  task → `npm run verify` → staged gitleaks scan → commit → push → prints the last CI result;
  reverts the mark on failure). If the scratchpad is gone, recreate it from this description;
  gitleaks lives in `.tools/gitleaks/` (download v8.30.1 from GitHub releases if missing).
- Fake secrets in tests must be low-entropy (`token-de-teste-aaaaaaaa`): CI runs gitleaks.
- PowerShell files: UTF-8 BOM + CRLF; after editing them with sed/node, re-normalize. Pester tests
  call `Register-UwFakeSystem` (scripts/tests/FakeSystem.ps1) first; add every new system-touching
  wrapper to its list.
- Edit with the editor tool or node scripts in the scratchpad; in JS `String.replace` use a
  function replacer when the replacement contains `$` (PowerShell text!).
- Web fixtures use local-time instants; wall-clock assertions go in `apps/server/test/perf/`.
- API tests that move the clock by days log in per request (`h.login('operator-user')`).
- The GitHub API allows 60 unauthenticated requests/hour: poll CI sparingly.

## Files to read first
`CLAUDE.md`, `specs/tasks.md` (M8), `specs/spec.md` FR-001, `specs/plan.md` §8–§9,
`specs/decisions.md` ADR-009, ADR-015, ADR-021..ADR-025.
