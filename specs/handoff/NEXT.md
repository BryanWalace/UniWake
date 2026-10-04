# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- Phases 0–3 DONE. Phase 4: **M1, M2, M3 DONE** (reviews in `specs/reviews/M1-*`, `M2-*`, `M3-*`).
- `npm run verify` green (~316 tests; core coverage ~95% stmts / ~87% branches). Playwright E2E 8/8
  (`npm run e2e`, hub forced to demo/dry-run). CI green on ubuntu and windows.
- M3 delivered: magic packet, interface selection + OS adapter (route print), scope resolver
  (property-tested), stagger planner, per-interface UDP sender + dry-run sender, WakeService
  (preview/start, confirmation guard, active-job exclusion, rate limit), JobRunner (send, packet
  log, verification, network retry, restart recovery, graceful stop), TCP prober (M4-T02 done
  early), DNS adapter, web wake dialog + live drawer + history/job pages.

## Next: M4 — Monitoring hub, realtime, history (lead: Senior Fullstack)
Start at `M4-T01` (M4-T02 already done). Notes:
- Composite prober: ICMP via persistent PowerShell helper (ADR-019) + existing `TcpProber`.
- Sweeps must use the same Prober port; verification probes take priority (AC-004-13).
- `EventsBus` exists (`application/events-bus.ts`); SSE route should subscribe to it; the web job
  drawer currently polls every 2 s — switch it to SSE (M4-T11).
- Demo mode (M4-T09) must also provide simulated network interfaces (R-M3-03).
- Retention jobs (M4-T16) must purge `packet_log` (30 d).

## Working conventions
- Commit via verify-gated helper (prettier → `npm run verify` → commit → push). Never pipe
  verify into `head` without checking its exit code.
- Write files with the editor tool; avoid shell heredocs containing backticks (they break).
- `﻿` escapes written through the editor become literal BOMs: build the BOM with
  `String.fromCharCode(0xfeff)`.

## Files to read first
`CLAUDE.md`, `specs/tasks.md` (M3), `specs/spec.md` §4 + FR-003, `specs/plan.md` §2.6, §7.1.
