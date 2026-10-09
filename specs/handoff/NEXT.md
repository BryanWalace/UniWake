# NEXT — handoff

Updated: 2026-10-09 · Branch: **`dev`** (ADR-030: never touch `main`, never tag)

## Current state
- v1.0 + v1.1 built (M1–M9, Phase 5; release candidate `v1.0.0-rc.2` on `main`).
- **M10 done** (sync-ready data, roadmap §A): migration 004, `db/sync/*` (instance, Lamport clock,
  change log with tombstones, `verifyChangeLog`), settings `scope` + `machine_settings`,
  `ExecutionLease`, restore rotates the instance id. Migration verified on a copy of a database
  populated by v1.0 (see `specs/reviews/M10-review.md`).
- **v1.2 Modo equipe specified** (Phase 7): spec §6a FR-201..207, plan §14, ADR-035..040, tasks
  M11–M15 + Phase 8. Owner request of 2026-10-09: build v1.2 + README + GitHub community files, then
  STOP with a pt-BR two-PC test guide here. Do NOT start v1.3/v1.4.

## Next step
Implement M11 (team core) → M12 (sync engine) → M13 (team scheduling) → M14 (UI, installer, two-
instance tests) → M15 (docs/community) → Phase 8 validation → write the pt-BR guide → STOP.

## Working conventions
- Commit via the verify-gated helper (scratchpad `commit-task.sh <TASK|-> <msg-file>`: prettier →
  mark task → `npm run verify` → staged gitleaks scan → commit → push **origin dev** → prints the last
  CI result on dev; refuses to run on any branch but `dev`). Recreate it from this description if
  the scratchpad is gone; gitleaks lives in `.tools/gitleaks/`.
- In this environment, bash heredocs with quotes are unreliable: write scripts with the editor tool
  into the scratchpad and run them with node.
- Every API test harness runs `verifyChangeLog` on close; test fixtures that write replicated rows
  with raw SQL must `changeLog(db).touch(...)` them or call `baselineChangeLog(db)`.
- Fake secrets in tests must be low-entropy (`token-de-teste-aaaaaaaa`): CI runs gitleaks.
- PowerShell files: UTF-8 BOM + CRLF. Pester tests call `Register-UwFakeSystem` first.
- Known dev/CI flake: a vitest worker on Windows occasionally exits with 0xC0000409; rerun.
- The GitHub API allows 60 unauthenticated requests/hour: poll CI sparingly.
