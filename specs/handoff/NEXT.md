# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE. Phase 4: **M1 DONE, M2 DONE** (reviews `specs/reviews/M1-*.md`, `M2-*.md`).
- `npm run verify` green (236 tests; core coverage ~97% stmts / ~89% branches). Playwright E2E
  7/7 (`npm run e2e`). CI green on ubuntu (verify + audit + gitleaks + E2E) and windows (tests).
- M2 delivered: rooms (codes, delete impact), tags, devices CRUD with MAC rules and warnings,
  list filters/search/paging, bulk ops, CSV import (preview/commit, Windows-1252 fallback) and
  export, static panel serving, web pages `/dispositivos`, `/dispositivos/importar`, `/salas`,
  `/salas/:id`, E2E harness with CSP/console guard and axe.

## Next: M3 — WoL engine, scoped wake, verification (lead: Senior Fullstack)
Start at `M3-T01` in `specs/tasks.md`. Key rules:
- Scope resolution server-side (spec §4 SR-01..SR-12); property test AC-003-18.
- Sender binds per interface (plan §2.6); packet log per attempt; dry-run uses the recording sender.
- Tests never send real packets: use `FakePacketSender`; the real UDP sender gets a loopback
  contract test only (network guard allows 127.0.0.1).
- Audit entries inside the same transaction as the change (M2 architect rule).

## Working conventions
- Commit via verify-gated helper (prettier → `npm run verify` → commit → push). Never pipe
  verify into `head` without checking its exit code.
- Write files with the editor tool; avoid shell heredocs containing backticks (they break).
- `﻿` escapes written through the editor become literal BOMs: build the BOM with
  `String.fromCharCode(0xfeff)`.

## Files to read first
`CLAUDE.md`, `specs/tasks.md` (M3), `specs/spec.md` §4 + FR-003, `specs/plan.md` §2.6, §7.1.
