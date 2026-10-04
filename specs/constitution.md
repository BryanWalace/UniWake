# UniWake — Constitution

Version: 0.1 (draft by Architect, Phase 0) · Date: 2026-10-04

This document holds the rules every role must follow for the life of the project. It is
binding: code, specs and reviews are judged against it. Changes require an ADR (§11).

---

## 1. Product principles

| ID | Principle | What it means in practice |
|---|---|---|
| P1 | **Scoped by default** | A wake action affects exactly its target (device, selection, room, tag, all) and nothing else. Scope is resolved and enforced on the server, never trusted from the client. |
| P2 | **Safe by default** | Panel bound to `127.0.0.1`. Large actions need confirmation. Destructive operations are reversible or confirmed. |
| P3 | **Works at 7:00 AM** | The scheduled morning wake must work after a reboot, a power cut or a network blip, with nobody logged in. Reliability beats features. |
| P4 | **Every action leaves a trace** | Who woke what, when, how many packets, and which devices answered. Failures are explained in pt-BR with a suggested next step. |
| P5 | **Private** | No telemetry. The only outbound call is the GitHub update check (and its downloads). |
| P6 | **Boring technology** | Mature, well-documented tools. Every dependency must be justified; fewer is better. |
| P7 | **Testable by construction** | Network, clock, filesystem, process and OS calls go through ports with fake implementations. |

## 2. Architecture rules

### 2.1 Shape
- One Windows Service process ("hub") hosting: HTTP API, realtime channel, web panel (static
  files), WoL engine, monitor, scheduler, updater. One SQLite database file.
- Hexagonal (ports & adapters):
  - `domain/` — pure types and rules (MAC normalization, scope resolution, schedule
    evaluation, stagger planning). No I/O, no imports from other layers.
  - `application/` — use cases orchestrating domain + ports. Depends only on `domain` and port
    interfaces.
  - `adapters/` — implementations of ports: UDP sender, ICMP/TCP prober, SQLite repositories,
    system clock, filesystem, process runner, GitHub client, Windows service control.
  - `http/` — Fastify routes, schemas, auth hooks; calls application use cases only.
  - `main.ts` — the only composition root that wires real adapters.
- Dependency direction is enforced by lint rules (import boundaries), not by convention.

### 2.2 Ports that must exist (minimum)
`Clock`, `PacketSender`, `Prober`, `NetworkInterfaces`, `Repositories` (per aggregate),
`FileSystem`, `ProcessRunner`, `ReleaseSource`, `Logger`. Each has a real adapter and a fake.

### 2.3 Data
- SQLite in WAL mode, single file under `%ProgramData%\UniWake\`.
- Schema changes only through versioned, forward-only migrations, run at startup inside a
  transaction. A migration never deletes user data without a prior copy.
- Timestamps stored as UTC (epoch milliseconds). Timezone conversion only at the edges
  (scheduler evaluation and UI display) using IANA zone names.
- IDs: integer primary keys internally; MAC addresses stored normalized `AA:BB:CC:DD:EE:FF`.

### 2.4 Configuration
- Bootstrap config (data dir, port, bind address, log level) from a config file / env.
- Everything else is a setting stored in the DB, validated by a Zod schema, editable in the UI
  (NFR-03). Settings have defaults in code; absent value = default.

### 2.5 Dry-run
- A global dry-run mode replaces the `PacketSender` with a recording fake. It is visible in the
  UI at all times when active. Tests and demos use it.

## 3. Repository layout and tooling
```
apps/server      Fastify hub (TypeScript)
apps/web         React + Vite + Tailwind panel (pt-BR)
packages/shared  Zod schemas and types shared by server and web
scripts/         prepare-target.ps1 and dev scripts
installer/       Inno Setup script, service wrapper config
specs/           SDD documents
.github/         CI and release workflows
```
- Node.js LTS + TypeScript, npm workspaces. One `npm run verify` runs lint, typecheck, tests and
  coverage for the whole repo; CI runs exactly that command.

## 4. Coding standards
- TypeScript `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`. No `any`; when an
  external type forces it, use `unknown` + validation, or a commented `eslint-disable` line.
- ESLint (typescript-eslint, recommended-type-checked) + Prettier. Zero warnings in CI.
- Validate every external input with Zod: HTTP bodies/params/query, CSV rows, settings,
  enrollment payloads, GitHub API responses.
- Errors: domain errors are typed (`AppError` with a stable `code`). HTTP layer maps codes to
  status + pt-BR message. Never leak stack traces to clients.
- Logging: pino, structured JSON, one event per line, with `module` and correlation id. No
  passwords, tokens or session ids in logs.
- Every I/O has a timeout. No unbounded concurrency; use explicit limits.
- Names: English in code. UI strings in pt-BR live in the web app, not hard-coded in logic.
- Small modules; a file over ~400 lines is a smell to justify in review.

## 5. Test policy
- Framework: Vitest (unit, integration, API via `fastify.inject`), Playwright (E2E, against the
  hub in dry-run with fake network).
- **No real network in tests.** No test may send a UDP packet, ICMP echo or TCP connect to a
  non-loopback address.
- Coverage ≥ 80% lines and branches on core modules (`domain/`, `application/`), enforced in CI.
- Every bug fix ships with a regression test that fails before the fix.
- Tests are deterministic: fake clock, no real `sleep`, no ordering dependence.
- Scope tests are mandatory for every wake path: "waking room A sends zero packets to devices of
  room B".

## 6. Security rules
- Authentication required on every endpoint except: health, login, first-run setup (only while
  no admin exists) and enrollment (enrollment token required).
- Roles: `admin`, `operator`. Authorization checked server-side per route.
- Passwords hashed with argon2id (or bcrypt cost ≥ 12).
- Rate limiting on login, enrollment and wake endpoints.
- Panel listens on `127.0.0.1` unless LAN exposure is explicitly enabled by an admin.
- Enrollment tokens: random, scoped to one room, expiring.
- Updates: download over HTTPS from the configured repository only; verify SHA-256 against the
  published checksum **before** executing anything.
- Audit log for authentication, wake, settings, user and update events.
- No secrets in the repository.

## 7. Reliability rules
- The scheduler must never fire the same (schedule, planned time) twice.
- Graceful shutdown: stop accepting work, finish in-flight DB writes, close DB.
- The service restarts automatically on crash (service recovery options).
- Long operations (wake jobs, sweeps) are tracked as jobs with state persisted in the DB.

## 8. UX rules
- UI language pt-BR. Accessible: keyboard navigation, visible focus, WCAG AA contrast.
- Every list has loading, empty and error states.
- Actions over the configured threshold (or "Todos") require a confirmation that shows the exact
  device count and affected rooms.

## 9. Definition of Done (per task)
1. Acceptance criteria of the referenced FR/NFR met.
2. Tests written first or alongside; all green; coverage gate passes.
3. `npm run verify` green locally and in CI.
4. Docs updated (spec/plan if behavior changed, README pt-BR if user-visible).
5. Task marked `[x]` in `specs/tasks.md`; committed and pushed.

## 10. Commit convention
- Conventional Commits: `type(scope): summary` in English, imperative, ≤ 72 chars.
- Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `ci`, `build`, `perf`.
- Scope is the task ID during implementation (`feat(M3-T04): ...`) or the phase for specs
  (`docs(phase-1): ...`).
- Trunk-based: commits go to `main`. Releases are tags `vMAJOR.MINOR.PATCH` (SemVer).

## 11. Governance
- ADRs in `specs/decisions.md`: `ADR-NNN | date | status | context | decision | consequences`.
- Improvements in `specs/improvements.md` per brief §7; the Architect triages.
- This constitution changes only via an ADR that names the section changed.
