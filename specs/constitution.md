# UniWake — Constitution

Version: **1.2** · Date: 2026-10-08 · Owner: Architect
History: v0.1 draft → reviewed in `specs/reviews/phase-0-*.md` → consolidated as v1.0 →
v1.1 amended by ADR-011 (§2.6), ADR-012 (§6.1), ADR-016 (§4.1, §6.7) in Phase 1.
v1.2 amended by ADR-030 (§9.1, §10) and ADR-031 (§2.3, §2.4) for the `dev` branch workflow and
the sync-ready data model.

This document holds the rules every role must follow for the life of the project. It is
binding: code, specs and reviews are judged against it. "MUST" is mandatory, "SHOULD" needs a
written reason to skip. Changes require an ADR that names the section changed (§11).

---

## 1. Product principles

| ID | Principle | What it means in practice |
|---|---|---|
| P1 | **Scoped by default** | A wake action affects exactly its target (device, selection, room, tag, all) and nothing else. Scope MUST be resolved and enforced on the server, never trusted from the client. |
| P2 | **Safe by default** | The panel and full API listen on loopback only. The LAN surface is minimal (enrollment + health) unless an admin enables LAN panel access. Large actions need confirmation. |
| P3 | **Works at 7:00 AM** | The scheduled morning wake MUST work after a reboot, a power cut or a network blip, with nobody logged in. Reliability beats features. |
| P4 | **Every action leaves a trace** | Who woke what, when, every packet sent (interface, destination, port), and which devices answered. Failures are explained in pt-BR with a suggested next step. |
| P5 | **Private** | No telemetry. The only outbound internet calls are the GitHub update check and its downloads. |
| P6 | **Boring technology** | Mature, well-documented tools. Every runtime dependency must be justified; fewer is better. |
| P7 | **Testable by construction** | Network, clock, filesystem, process and OS calls go through ports with fakes that support fault injection. |

## 2. Architecture rules

### 2.1 Shape
- One Windows Service process ("hub") hosting: HTTP API, realtime channel, web panel (static
  files), WoL engine, monitor, scheduler, update checker. One SQLite database file. The update
  **installer/rollback** runs in a separate updater process (ADR-009).
- Hexagonal (ports & adapters), inside `apps/server/src/`:
  - `domain/` — pure types and rules (MAC normalization, scope resolution, schedule
    evaluation, stagger planning). No I/O. Imports nothing from other layers.
  - `application/` — use cases orchestrating domain, repositories and ports.
  - `adapters/` — port implementations: UDP sender, prober, network interfaces, clock,
    filesystem, process runner, GitHub client, service control. The **only** place allowed to
    import `node:dgram`, `node:net`, `node:dns`, `node:child_process`.
  - `db/` — SQLite connection, migrations, repositories.
  - `http/` — Fastify routes, schemas, auth hooks; calls application use cases only.
  - `main.ts` — the only composition root that wires real adapters.
- Dependency direction (`http → application → domain`, `adapters/db → ports in application`)
  MUST be enforced by lint import rules.

### 2.2 Ports and fakes
- Ports exist where a fake is needed or more than one implementation exists. Minimum set:
  `Clock`, `PacketSender`, `Prober`, `NetworkInterfaces`, `FileSystem`, `ProcessRunner`,
  `ReleaseSource`, `Logger`.
- Every port has a real adapter and a fake. Fakes MUST support injected failures (timeouts,
  errors on the Nth call, partial results, interface removal, clock jumps).
- The database is **not** faked: repositories are concrete SQLite classes, tested against a
  fresh in-memory database with all migrations applied (ADR-003).

### 2.3 Data
- SQLite, WAL mode, `synchronous=FULL`, `foreign_keys=ON`, a busy timeout, single file under
  `%ProgramData%\UniWake\data\`. One writer connection.
- Schema changes only via versioned, forward-only migrations run at startup in a transaction.
  A DB backup is taken before the first migration of a new version. Migrations never delete
  user data without a prior copy.
- Automatic backups: daily + pre-migration + pre-update, with retention (IMP-010).
- Timestamps stored as UTC epoch milliseconds. Timezone conversion only in scheduler evaluation
  and UI display, using IANA zone names (ADR-008).
- MAC addresses stored normalized `AA:BB:CC:DD:EE:FF`; unique.
- **Sync-ready (ADR-031, ADR-033).** Every table is either a *replicated entity* or
  *machine-local*, and a new table MUST be classified in plan §5. Replicated rows carry a stable
  `uuid`, `rev`, `updated_at` and `updated_by_instance`; every write to them goes through a
  repository that updates the change log (`ChangeLog.touch` / `tombstone`) in the same
  transaction. References between replicated entities are exchanged as UUIDs, never local ids.
  Each installation has a persistent `instance_id`.

### 2.4 Configuration
- Bootstrap config (data dir, ports, bind addresses, log level) precedence:
  code defaults < `config.json` in the data dir < environment variables.
- Everything else is a setting stored in the DB, validated by a Zod schema, editable in the UI
  (NFR-03). Absent value = code default.
- Every setting declares `scope`: `shared` (team policy, replicated) or `machine` (this PC's
  interfaces, addresses, ports, paths, update and backup schedule), stored in `machine_settings`
  and never synced or exported (ADR-032).

### 2.5 Dry-run and demo
- Dry-run replaces `PacketSender` with a recording fake; a banner is visible on every page while
  it is active.
- Demo mode (IMP-001) adds seeded data and a simulated prober. Used by `npm run dev`, E2E tests and
  training. Demo mode implies dry-run.

### 2.6 Network rules
- Interfaces are read **at send time**, never cached from startup.
- The sender binds one socket per selected interface's local IPv4 and sends to both the limited
  broadcast and that interface's subnet-directed broadcast, on UDP 9 and 7.
- Every packet attempt is recorded in the packet log (P4).
- LAN surfaces (ADR-005, ADR-011): the **panel listener** (loopback by default) serves UI + full
  API; the **agent listener** (LAN) serves exactly: minimal health, enrollment, and the
  `prepare-target.ps1` download (whose SHA-256 is pinned in the command shown by the panel).

## 3. Repository layout and tooling
```
apps/server       Fastify hub (TypeScript)
apps/web          React + Vite + Tailwind panel (pt-BR)
packages/shared   Zod schemas, API types, error codes + pt-BR message catalog
scripts/          prepare-target.ps1 and dev scripts
installer/        Inno Setup script, service wrapper config, updater
specs/            SDD documents
.github/          CI and release workflows
```
- Node.js **24 LTS** + TypeScript, npm workspaces (ADR-002, ADR-004). The installer ships its
  own pinned Node runtime; the operator never installs Node.
- `npm run verify` runs lint, format check, typecheck, tests and coverage for the whole repo.
  CI runs exactly that command (plus the jobs in §9.1).
- `npm run dev` starts the hub in demo mode plus the Vite dev server.

## 4. Coding standards

### 4.1 TypeScript
- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
  No `any`; use `unknown` + validation, or a commented `eslint-disable-next-line` with a reason.
- ESLint (typescript-eslint recommended-type-checked) + Prettier. Zero warnings.
- Validate every external input with Zod: HTTP bodies/params/query, CSV rows, settings,
  enrollment payloads, GitHub API responses, config file.
- Errors: typed `AppError` with a stable `code`. Codes and their pt-BR messages live in
  `packages/shared` (ADR-006). API errors return `{ code, message, details? }`. Never leak
  stack traces to clients.
- Logging: pino, structured JSON, `module` + correlation id per request/job. Never log
  passwords, tokens, session ids or password hashes. Rotation by size and count (NFR-04).
- Every I/O has a timeout; defaults are defined in `plan.md`. No unbounded concurrency.
- English identifiers; pt-BR only in the message catalog and the web UI.
- A file over ~400 lines must be justified in review.
- No `TODO` without a task ID (`TODO(M3-T04): ...`).
- React: `dangerouslySetInnerHTML` is forbidden, enforced as a lint error (ADR-016; rule
  mechanism per ADR-024).

### 4.2 PowerShell (`scripts/*.ps1`)
- Compatible with Windows PowerShell **5.1** (no `??`, ternary, `ForEach-Object -Parallel`).
- Encoding UTF-8 **with BOM**, CRLF line endings.
- `Set-StrictMode -Version Latest`; `$ErrorActionPreference = 'Stop'`.
- Supports `-WhatIf`; idempotent (safe to re-run); writes a transcript log on the target.
- PSScriptAnalyzer clean; logic covered by Pester tests with mocked cmdlets.
- Panel-generated command lines use `powershell -NoProfile -ExecutionPolicy Bypass -File ...`.

## 5. Test policy
- Vitest for unit, integration and API tests (`fastify.inject`); Playwright (Chromium) for E2E
  against the hub in demo mode; Pester for PowerShell.
- **No real network in tests**, enforced two ways: (1) lint `no-restricted-imports` for network
  and process modules outside `adapters/`; (2) a Vitest global setup that makes
  `dgram` sends and `net` connects to any non-loopback address throw.
- Coverage on core modules — globs `apps/server/src/domain/**`, `apps/server/src/application/**`,
  `packages/shared/src/**` — MUST be ≥ 80% for lines, statements, functions and branches, enforced
  by the Vitest config in CI.
- Database tests use in-memory SQLite with real migrations.
- Every bug fix ships with a regression test that fails before the fix.
- Tests are deterministic: fake clock, no real `sleep`, no order dependence.
- **Scope tests are mandatory** for every wake path: e.g. "waking room A sends zero packets to
  devices of room B".
- **Route-table authz test** (IMP-014): enumerate every registered route; no session → 401 unless
  declared public; operator → 403 on admin routes.
- Fault-injection tests for every port used by scheduler, wake engine, monitor and updater.

## 6. Security rules

### 6.1 Network exposure
- Panel listener binds `127.0.0.1` by default; LAN panel access is an admin setting, audited,
  and served **over HTTPS only** with `Secure` cookies (ADR-012).
- Agent listener exposes only health (status only), enrollment and the script download (ADR-011).
- **Host header allowlist** on every request (loopback names + configured LAN names/IPs) to
  block DNS rebinding.
- Security headers: CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: same-origin`.

### 6.2 Authentication and sessions
- Every route declares `auth: 'public' | 'operator' | 'admin' | 'enrollment'`; a route without a
  declaration fails startup. Public routes: health, login, first-run setup.
- **First-run setup** only while no user exists **and** only from a loopback socket address; the
  "no users" check is repeated inside the creating transaction.
- Passwords: argon2id (preferred) or another OWASP-recommended memory-hard KDF chosen by ADR.
  Minimum length 10, reject a bundled list of common passwords, login backoff per account and IP.
- Server-side sessions; cookie `HttpOnly`, `SameSite=Strict`, `Path=/`; new id on login;
  idle timeout (default 12 h) and absolute timeout (default 7 d); logout and password change
  revoke sessions.
- CSRF: unsafe methods require an `Origin` (or `Referer`) matching the allowlist.
- Roles: `admin`, `operator`. Operators cannot change settings, users or updates.

### 6.3 Enrollment tokens
- ≥ 128 bits from a CSPRNG; stored as SHA-256 hash; constant-time comparison; bound to one room;
  expiry (short default); max uses; revocable; rate limited; every use audited.
- Enrollment can set only an allow-listed set of device fields.

### 6.4 Supply chain and secrets
- Lockfile committed; installs via `npm ci` only.
- `npm audit --omit=dev --audit-level=high` fails CI.
- Dependabot for npm and GitHub Actions. First-party `actions/*` pinned by major version;
  third-party actions pinned by commit SHA.
- Secret scanning in CI. No secrets in the repository.
- Native addons only with an ADR, and only with prebuilt win-x64 binaries for the shipped Node
  ABI (ADR-010).

### 6.5 Updates
- Download only over HTTPS from the configured repository's GitHub Releases; the release must be
  non-draft, non-prerelease, with a valid SemVer tag greater than the current version.
- Verify size and SHA-256 **before** executing anything. Checksums prove integrity, not
  authorship; Authenticode signing is added when a certificate exists (ADR-009, BLOCKERS B-001).

### 6.6 Audit
- Audit log for authentication, wake, schedule, settings, user, enrollment and update events.
- Append-only through the application (no update/delete routes); retention configurable.

### 6.7 Untrusted data (ADR-016)
- Data from targets (enrollment) and imported files is untrusted: every string has a max length
  in the shared schema, it is never rendered as HTML, and CSV exports neutralize cells starting
  with `=`, `+`, `-`, `@`, tab or CR.

## 7. Reliability rules
- **Scheduler:** tick-based (≤ 30 s), never one long timer. **Claim-then-execute:** insert
  `(schedule_id, planned_at_utc)` under a unique constraint before firing; a failed claim means
  it already ran. Missed runs execute only inside the grace window; otherwise recorded as
  "perdido". DST rules per ADR-008.
- Long operations (wake jobs, sweeps, updates) are jobs with state persisted in the DB and
  recovered or closed cleanly on restart.
- Graceful shutdown: stop accepting work, finish in-flight writes, close the DB.
- The service restarts automatically on crash (service recovery options).
- **Updates:** separate updater process; previous version kept side by side; health check after
  install; on failure restore previous binaries and the pre-update DB backup.

## 8. UX rules
- UI language pt-BR. Accessible: keyboard navigation, visible focus, WCAG AA contrast, labels on
  every control. Usable on a 768 px tablet.
- Every list has loading, empty and error states.
- Wake actions over the confirmation threshold, on more than one room, or on "Todos" need a
  confirmation that shows the exact device count and affected rooms.
- Every error shown to the operator says what happened and what to do next.
- Persistent banners for dry-run/demo mode, global pause and failed update.

## 9. Definition of Done (per task)
1. Acceptance criteria of the referenced FR/NFR met.
2. Tests written first or alongside; all green; coverage gate passes.
3. `npm run verify` green locally; CI green after push.
4. New error codes have pt-BR messages; user-visible changes reflected in README (pt-BR).
5. Spec/plan updated first if behavior or design changed.
6. No `TODO` without task ID; no lint warnings.
7. Task marked `[x]` in `specs/tasks.md`; committed with `Refs:` trailer; pushed.
8. At milestone end: `specs/reviews/M<n>-review.md` with no open CRITICAL/MAJOR.

### 9.1 CI quality gates
Every push to `dev` (and to `main`, which only receives owner-approved merges of `dev`): `npm ci` → lint + format check → typecheck → unit/integration tests with
coverage gate → E2E (Playwright, Chromium, demo mode) → PSScriptAnalyzer + Pester (Windows
runner) → `npm audit` → secret scan. Pushes never build or publish a release. On tag `v*`: the release workflow first checks
that the tagged commit is on `main`, then runs all of the above, builds the installer, computes the
SHA-256 and publishes the GitHub Release with generated notes.

## 10. Commit convention
- Conventional Commits: `type(scope): summary`, English, imperative, ≤ 72 chars.
- Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `ci`, `build`, `perf`.
- Scope: task ID during implementation (`feat(M3-T04): ...`), phase for specs
  (`docs(phase-1): ...`), milestone for reviews (`docs(M3): ...`).
- Body SHOULD include `Refs: FR-003, NFR-01` when applicable. Breaking changes use `!` and a
  `BREAKING CHANGE:` footer.
- Branches (ADR-030, supersedes ADR-007): all work is committed to `dev` and pushed to `origin dev`
  only, one commit per completed task. Agents MUST NOT commit to, merge into, rebase onto or push
  `main`, and MUST NOT open or merge a PR into `main`.
- Releases are SemVer tags `vMAJOR.MINOR.PATCH` on `main` only; release notes are generated from
  commits. Tags publish releases and trigger auto-update on real PCs, so agents MUST NOT create
  tags. `dev` is merged into `main` (and tagged) only when the owner explicitly asks, after all
  tests pass.

## 11. Governance
- ADRs in `specs/decisions.md`. Improvements in `specs/improvements.md` per brief §7; the
  Architect triages each one (accepted / rejected / deferred / roadmap) with a reason.
- Every phase: each role writes `specs/reviews/phase-<N>-<role>.md` before the lead consolidates.
- Blockers needing the owner go to `specs/handoff/BLOCKERS.md`; work continues around them.
- This constitution changes only via an ADR naming the section changed.
