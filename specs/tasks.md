# UniWake — Tasks

Version: 0.1 (Senior Fullstack draft, Phase 3) · Date: 2026-10-04
Inputs: `spec.md` v1.1, `plan.md` v1.0, `constitution.md` v1.1.

Rules: each task ≤ ~2 h, tests first or alongside, DoD per constitution §9. Status: `[ ]` todo,
`[x]` done, `[~]` in progress. Commit scope = task ID (`feat(M3-T04): ...`).
Every milestone ends with **Debug break-it pass** (`M<n>-D`) and **Code review** (`M<n>-R`,
`specs/reviews/M<n>-review.md`); CRITICAL/MAJOR findings become `M<n>-F<k>` tasks fixed before the
next milestone.

**Deviation from the brief's milestone order:** a minimal auth core (first-run setup, login,
sessions, roles) and audit append move into M1, because constitution §6.2 requires every route
from M2 on to declare and enforce auth. M6 completes auth (policy, users UI, LAN HTTPS, settings,
audit viewer).

---

## M1 — Foundation
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M1-T01 | Monorepo scaffold: root `package.json` (workspaces), `.nvmrc` 24.15.0, `engines`, `tsconfig.base.json` (strict + extra flags), `apps/server`, `apps/web`, `packages/shared` skeletons, `.editorconfig`. | §3, ADR-004, ADR-024 | `npm run typecheck` passes | all workspaces build empty |
| [ ] M1-T02 | ESLint 10 flat config (typescript-eslint type-checked, import-x `no-restricted-paths` zones, restricted Node modules outside `adapters/`, `no-restricted-syntax` for `dangerouslySetInnerHTML`, react-hooks) + Prettier. | constitution §2.1/§4.1, ADR-024 | lint-rule test: fixture files that violate each rule fail ESLint API | `npm run lint` 0 warnings |
| [ ] M1-T03 | Vitest projects (server, shared, web), coverage thresholds on core globs, network-guard setup. | constitution §5 | guard test: UDP/TCP to 192.0.2.1 throws, 127.0.0.1 allowed | thresholds enforced |
| [ ] M1-T04 | `npm run verify` and `check:deps` (compares runtime deps with plan §4.1). | plan §12, IMP-029 | check-deps unit test | verify runs all gates |
| [ ] M1-T05 | `ci.yml` (ubuntu: verify, audit, secret scan; windows: placeholder job) + Dependabot. | constitution §9.1, §6.4 | CI green on push | badge green |
| [ ] M1-T06 | `shared/errors.ts`: ErrorCode, HTTP status, pt-BR catalog. | ADR-006, plan §6.6 | every code has status + message | — |
| [ ] M1-T07 | `shared/settings.ts` + `defaults.ts`: settings schema with UI metadata. | NFR-03, spec §9 | defaults parse; every key has metadata | — |
| [ ] M1-T08 | `shared/schemas`: rooms, tags, devices, MAC input, users, field limits. | spec §8 | limit boundary tests | — |
| [ ] M1-T09 | `domain/mac.ts`: parse/normalize/validate, multicast/zero/broadcast rejection, locally-administered flag. | FR-002.1 | AC-002-01, 03, 04 + property test | — |
| [ ] M1-T10 | `application/ports.ts` + test fakes (FakeClock with timers, FakeSender, FakeProber, FakeInterfaces, FakeFs, FakeProcess, FakeReleaseSource) with fault injection. | constitution §2.2 | fake clock timer ordering; fault injection | — |
| [ ] M1-T11 | `db/connection.ts` (pragmas, `transaction()`, unique-violation → AppError), `migrate.ts`, `001_initial.sql` (all tables, plan §5). | plan §5, ADR-017 | migrations on `:memory:`, idempotent, pragmas, FK cascade, unique mapping | — |
| [ ] M1-T12 | Config loader (defaults < file < env, Zod) + pino logger with rotation. | constitution §2.4, NFR-04 | precedence; invalid config message | — |
| [ ] M1-T13 | `http/app.ts`: Fastify + Zod provider, error handler, route-auth registry (undeclared → startup error), host allowlist, security headers, CSRF origin check, `/api/health`. | constitution §6.1/6.2, plan §6 | undeclared route throws; bad Host rejected; headers present; error shape; CSRF | — |
| [ ] M1-T14 | `main.ts`: two listeners, graceful shutdown, `EADDRINUSE` → exit 78. | plan §2.1, §9 | listeners on ephemeral loopback ports; shutdown closes DB | `node main` serves health |
| [ ] M1-T15 | Route-table authz test harness for both listeners. | IMP-014 | enumerates all routes; 401 without session | harness reusable |
| [ ] M1-T16 | Auth core: argon2id hashing (PHC), users + sessions repos, session plugin, setup (loopback + transactional), login/logout/me, role guard, idle/absolute expiry. | FR-006.1, ADR-018, plan §6.4 | AC-006-01, 02; expiry with fake clock; hash verify/rehash | — |
| [ ] M1-T17 | Audit service (append-only) + repo. | FR-006.5 | append + query | — |
| [ ] M1-T18 | Web scaffold: Vite 8, React 19, Tailwind 4, Router, Query, layout shell pt-BR, banners slot, typed API client. | plan §6.5 | shell renders (Testing Library) | `npm run dev` shows shell |
| [ ] M1-T19 | Web: `/login`, `/primeiro-acesso`, auth guard, logout. | FR-006.1 | component tests | — |

## M2 — Devices, Rooms, Tags
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M2-T01 | Rooms repo/service/routes: CRUD, code generation, delete impact, devices → "Sem sala". | FR-008.1 | AC-008-01, 02, 03 | — |
| [ ] M2-T02 | Tags repo/service/routes; delete impact. | FR-008.2 | AC-008-04 | — |
| [ ] M2-T03 | Devices repo/service/routes CRUD; MAC duplicate; disabled; duplicate-name warning flag. | FR-002.1 | AC-002-01..05 [API] | — |
| [ ] M2-T04 | Device list: filters, pagination, compact `all=1`; 500-device benchmark. | plan §5.1, NFR-01 | query < 50 ms at 500 | — |
| [ ] M2-T05 | Bulk operations + audit. | FR-002.2 | AC-002-07 | — |
| [ ] M2-T06 | `domain/csv.ts`: delimiter/BOM detection, header aliases, row validation, formula neutralization. | FR-002.3, ADR-016 | AC-002-09, 11 | — |
| [ ] M2-T07 | CSV import preview/commit + export routes. | FR-002.3 | AC-002-08, 10 | — |
| [ ] M2-T08 | Web: devices list (filters, search, bulk select + action bar). | FR-002 | component tests | — |
| [ ] M2-T09 | Web: device form dialog (MAC warning, duplicate-name warning). | FR-002.1 | component tests | — |
| [ ] M2-T10 | Web: rooms & tags management (impact confirmations). | FR-008 | component tests | — |
| [ ] M2-T11 | Web: CSV import wizard + export. | FR-002.3 | component tests | — |
| [ ] M2-T12 | Web: room page `/salas/:id`. | FR-008.3 | component tests | — |

## M3 — WoL engine, scoped wake, verification
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M3-T01 | `domain/magic-packet.ts`. | FR-003.1 | AC-003-01 | — |
| [ ] M3-T02 | `domain/destinations.ts` (per interface, directed broadcast per room, dedupe). | FR-003.2 | AC-003-02, 03 | — |
| [ ] M3-T03 | `adapters/network-interfaces` (os + `route print` parser, default selection rule). | FR-003.2, ADR-019 | route-print fixtures (multi-NIC, VPN, APIPA) | — |
| [ ] M3-T04 | `domain/scope.ts` resolver (SR-01..06, 10, 11). | §4 SR | AC-003-05, 06, 07, 18 (fast-check) | — |
| [ ] M3-T05 | `domain/stagger.ts` (per room, global cap). | FR-003.4 | AC-003-10, 19 | — |
| [ ] M3-T06 | `adapters/udp-packet-sender` (per-interface bind, broadcast, repeats, per-interface failure) + recording sender. | FR-003.2/7, plan §7.1 | injected dgram factory; EADDRNOTAVAIL path | — |
| [ ] M3-T07 | `wake-service` preview/start: confirmation, active-job exclusion, keyed per-user limiter, audit. | FR-003.3/8 | AC-003-08, 09, 14, 15 | — |
| [ ] M3-T08 | `job-runner`: lifecycle, stagger with fake clock, packet log, dry-run, no-interface handling. | FR-003.4–7 | AC-003-04, 12, 13, 16 | — |
| [ ] M3-T09 | Verification loop via Prober port; restart recovery. | FR-003.5 | AC-003-11, 17 | — |
| [ ] M3-T10 | Wake/jobs/packets routes. | FR-003, FR-009 | 409/429 paths [API] | — |
| [ ] M3-T11 | Web: wake buttons → preview summary → confirmation dialog. | FR-003.3 | component tests | — |
| [ ] M3-T12 | Web: job progress drawer, jobs history, job detail + packet log. | FR-009, FR-003.6 | component tests | — |

## M4 — Monitoring hub, realtime, history
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M4-T01 | `domain/status.ts` state machine (debounce, ever_online, desconhecido). | FR-004.1, ADR-014 | AC-004-01..05, 11, 12 | — |
| [ ] M4-T02 | `adapters/tcp-prober` (timeout, refused = alive). | FR-004.1 | loopback open/closed ports | — |
| [ ] M4-T03 | `probe-helper.ps1` + `ps-helper-icmp` adapter (JSON lines, deadlines, restart). | ADR-019 | fake process tests; Windows loopback contract test | — |
| [ ] M4-T04 | `ping-exe-icmp` fallback + composite prober switch rule. | ADR-019 | localized output fixtures; switch after 3 restarts | — |
| [ ] M4-T05 | `probe-queue` with priorities and concurrency. | FR-004.2 | AC-004-13 | — |
| [ ] M4-T06 | `monitor-service` sweep: DNS cache, IP drift, one-tx writes, events, SSE emits. | FR-004.2/3 | AC-004-06, 07 | — |
| [ ] M4-T07 | Events bus + SSE route (heartbeat, session expiry, buffer cap). | FR-004.4, ADR-020 | AC-004-14 (server side) | — |
| [ ] M4-T08 | Dashboard API, `domain/uptime.ts`, nightly rollup, uptime API. | FR-004.5/6 | AC-004-10, 16 | — |
| [ ] M4-T09 | Simulated prober + demo seed + `--demo` guard. | FR-015 | AC-015-01 | `npm run dev` lively |
| [ ] M4-T10 | Web: dashboard (counters, room cards, tag filter + wake, search `/`, status filter, notices area). | FR-004.5 | component tests | — |
| [ ] M4-T11 | Web: realtime hook (SSE → Query cache, reconnect refetch). | FR-004.4 | hook tests | — |
| [ ] M4-T12 | Web: device detail (history, uptime). | FR-004.6 | component tests | — |
| [ ] M4-T13 | Playwright harness (demo mode, temp data dir) + E2E: dashboard, realtime, search, axe on dashboard. | NFR-01/07 | AC-004-08, 09, 15 [E2E] | — |
| [ ] M4-T14 | `Ctrl+K` quick-wake palette. | FR-004.7 | AC-004-17 [E2E] | — |

## M5 — Scheduler
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M5-T01 | `domain/schedule.ts`: occurrences, weekdays, tz, DST rule, exceptions, next 5. | FR-005.1/2/5, ADR-008 | AC-005-01, 02, 06 (DST matrix) | — |
| [ ] M5-T02 | Schedules repo/service/routes + targets + confirm at save + empty-target flag. | FR-005.1/8 | AC-005-11 [API] | — |
| [ ] M5-T03 | Exceptions CRUD (global / per schedule). | FR-005.2 | API tests | — |
| [ ] M5-T04 | Scheduler tick: claim-then-execute, grace, atrasado/perdido, multiple missed, clock jumps. | FR-005.3/4 | AC-005-03, 04, 05, 08 | — |
| [ ] M5-T05 | Pause/resume (reason, auto-resume), SSE. | FR-005.6 | AC-005-07, 09 | — |
| [ ] M5-T06 | Execution log API. | FR-005.7 | AC-005-10 | — |
| [ ] M5-T07 | Morning result notices + notices API + ack. | FR-013 | AC-013-01 | — |
| [ ] M5-T08 | Web: schedules list/form (target picker, weekdays, tz, stagger, next runs, "alvo vazio"). | FR-005 | component tests | — |
| [ ] M5-T09 | Web: exceptions, pause dialog/banner, execution log, morning-result card. | FR-005, FR-013 | component tests | — |

## M6 — Auth completion, roles, audit, settings, health, backups
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M6-T01 | Password policy + per-account backoff + per-IP login limit + password change revokes sessions. | FR-006.3 | AC-006-04, 07 | — |
| [ ] M6-T02 | Users API (admin). | FR-006.2 | API tests | — |
| [ ] M6-T03 | Permission matrix in the route-table test (all routes). | FR-006.2 | AC-006-03 | — |
| [ ] M6-T04 | Audit API + CSV export. | FR-006.5 | AC-006-06 | — |
| [ ] M6-T05 | Settings API + audit diff; schema ↔ form metadata test. | FR-016 | AC-016-01, 02 | — |
| [ ] M6-T06 | LAN exposure: HTTPS binding with PFX, cert-generator adapter, Secure cookies, allowlist. | FR-006.4, ADR-012/026 | AC-006-05, 08 | — |
| [ ] M6-T07 | Web: users, audit, settings (generated form), network preview. | FR-006, FR-011, FR-016 | AC-011-01 | — |
| [ ] M6-T08 | Log viewer API + page. | FR-016 | API tests | — |
| [ ] M6-T09 | Health service/routes/page + windows-host checks (power plan, pending reboot, active hours, clock skew). | FR-012 | AC-012-01, 02, 03 | — |
| [ ] M6-T10 | Backups: daily/manual/pre-migration, retention, restore + web. | FR-014 | AC-014-01, 02 | — |

## M7 — prepare-target.ps1 and self-enrollment
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M7-T01 | Enrollment tokens service/routes (generate, hash, list, revoke, command with script hash, addresses). | FR-007.3 | AC-007-09, 13 | — |
| [ ] M7-T02 | Agent `POST /agent/enroll` (limits, checks, upsert/move, SMBIOS junk, notices); agent route table = 3 routes. | FR-007.2 | AC-007-05..08, 12 | — |
| [ ] M7-T03 | `prepare-target.ps1`: params, elevation, adapter detection, `-WhatIf`, summary, transcript, BOM/CRLF. | FR-007.1, §4.2 | AC-007-01, 11 [Pester] | — |
| [ ] M7-T04 | Script: NIC power management, Fast Startup, advanced properties, ICMP rule. | FR-007.1 | AC-007-02, 03, 04 [Pester] | — |
| [ ] M7-T05 | Script: enrollment POST, exit codes; one-liner hash check. | FR-007.1/3 | AC-007-14 [Pester] | — |
| [ ] M7-T06 | PSScriptAnalyzer settings + Pester in the windows CI job. | IMP-018 | CI | — |
| [ ] M7-T07 | Web: "Preparar máquinas" page. | FR-007.3 | component tests | — |
| [ ] M7-T08 | Test-WoL flow service/routes/web. | FR-007.4 | AC-007-10 | — |
| [ ] M7-T09 | Diagnostics service/page + help pages. | FR-010, FR-007.5 | AC-010-01, 02, AC-007-15 | — |

## M8 — Service, installer, auto-update, release
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M8-T01 | Build script: esbuild bundles with version define, web build, staging layout. | ADR-022 | bundle smoke (`node server.mjs --version`) | — |
| [ ] M8-T02 | Node runtime fetch + SHASUMS256 verification script. | ADR-022 | checksum mismatch fails | — |
| [ ] M8-T03 | WinSW XML template + Inno Setup script (versions dir, firewall, shortcut, service, keep previous, data preserve, uninstall). | FR-001.1 | — (CI smoke in T09) | — |
| [ ] M8-T04 | `windows-host` adapter: service control, scheduled tasks, event log, power plan, pending reboot, active hours. | ADR-021/023 | fake process runner tests | — |
| [ ] M8-T05 | `http-client` allowlist + `github-release-source` + update check service. | FR-001.2, NFR-05, ADR-025 | AC-001-04, 05, 06; allowlist test | — |
| [ ] M8-T06 | Download + verify + disk space + pre-update backup + plan file. | FR-001.3 | AC-001-07, 09, 14 | — |
| [ ] M8-T07 | `updater.mjs`: stop/install/start/health/rollback + watchdog. | FR-001.3, ADR-023 | AC-001-08, 13 (fakes) | — |
| [ ] M8-T08 | Auto mode (window, guards), update routes, web update panel. | FR-001.3 | AC-001-10, 11 | — |
| [ ] M8-T09 | `release.yml` + Windows installer smoke + fake release server E2E. | FR-001.4 | AC-001-01a, 02, 03, 12 [CI-Win] | — |
| [ ] M8-T10 | README pt-BR. | DoD | — | — |

## M9 — v1.1 network discovery
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M9-T01 | Neighbor cache: `Get-NetNeighbor` JSON + `arp -a` parser (pt-BR/en-US fixtures). | FR-101 | AC-101-02 | — |
| [ ] M9-T02 | OUI vendor DB (bundled with releases) + lookup. | FR-101 | lookup tests | — |
| [ ] M9-T03 | Discovery service: CIDR sweep, hostname, already-registered, locally-administered flag. | FR-101 | AC-101-03 | — |
| [ ] M9-T04 | Discovery API + page + bulk add to room. | FR-101 | AC-101-01 | — |
