# NEXT — handoff

Updated: 2026-10-04 · Mode: single-agent orchestrator (`.agents/06-orchestrator.md`)

## Current state
- **Phase 0 (Constitution): DONE.** `specs/constitution.md` now v1.1 (amended in Phase 1 by
  ADR-011, 012, 016).
- **Phase 1 (Specify): DONE.** `specs/spec.md` v1.0 consolidated from the draft and
  `specs/reviews/phase-1-{architect,fullstack,debug,reviewer}.md`. FR-001..FR-016 (+ FR-101 for
  v1.1), NFR-01..09, scoping rules SR-01..SR-12, defaults, limits, roadmap RM-1..RM-6.
- ADR-001..016 in `specs/decisions.md`. IMP-001..025 in `specs/improvements.md`.
- Blockers B-001..003 unchanged (`specs/handoff/BLOCKERS.md`).
- No code yet.

## Next: Phase 2 — Plan (lead: Architect)
Write `specs/plan.md` draft covering (per `.agents/02-architect.md`):
1. Architecture diagram (Mermaid): hub process (panel listener, agent listener, API, SSE, wake
   engine, prober queue, scheduler, update checker), updater process, service wrapper, DB, browser,
   targets, GitHub.
2. Modules and boundaries (folder-level, mapped to constitution §2.1).
3. Data model: rooms, devices, tags, device_tags, schedules, schedule_targets, schedule_runs,
   schedule_exceptions, wake_jobs, wake_job_devices, packet_log, status_events, daily_uptime,
   users, sessions, audit_log, settings, enrollment_tokens, backups metadata, notices/acks.
4. API contract (REST + SSE), error code list, route auth table per listener.
5. Service lifecycle, update/rollback flow (sequence diagram), installer layout, packaging.
6. Decisions to make with ADRs: SQLite driver (`node:sqlite` vs better-sqlite3), password hashing
   (`crypto.argon2` vs alternatives), ICMP approach (ping.exe vs FFI), SSE, service wrapper
   (WinSW), TLS cert generation for LAN panel, bundling (esbuild), UI stack (React/Vite/Tailwind,
   TanStack Query, router), test tooling.
7. Timeout defaults (constitution §4.1), risk register (VLAN/broadcast, Fast Startup, ICMP
   blocked, service permissions, AV flagging, clock drift, DST + new ones).
Then Fullstack/Debug/Reviewer write `specs/reviews/phase-2-<role>.md`, Architect consolidates,
commit `docs(phase-2): ...`, push, update this file.

**Tip:** run quick spikes to verify Plan decisions on this machine (Node 24.15): `node:sqlite`
stability warnings, `crypto.argon2` API, `ping.exe` throughput, `os.networkInterfaces()` output.

## Then
Phase 3 Tasks (Fullstack) → Phase 4 Implement M1..M9 → Phase 5 Validate.

## Files to read first
`CLAUDE.md`, `specs/constitution.md`, `specs/spec.md`, `specs/decisions.md`,
`specs/reviews/phase-1-architect.md`.
