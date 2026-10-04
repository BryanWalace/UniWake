# UniWake — Tasks

Version: **1.0** · Date: 2026-10-04 · Owner: Senior Fullstack
History: v0.1 draft → reviewed in `specs/reviews/phase-3-*.md` → consolidated as v1.0.
Inputs: `spec.md` v1.1, `plan.md` v1.0, `constitution.md` v1.1.

## Rules
- Each task ≤ ~2 h; tests first or alongside; DoD per constitution §9.
- Status: `[ ]` todo · `[~]` in progress · `[x]` done. Commit scope = task ID (`feat(M3-T04): ...`).
- **AC IDs in test titles:** every test proving an AC includes the AC ID in its title
  (`it('AC-003-05 ...')`, Pester `It 'AC-007-01 ...'`). `npm run check:trace` enforces that every
  non-[manual] AC has a test (IMP-030).
- **Web tasks:** tests cover the main interaction **and** loading, empty and error states.
- **Milestone close:** `M<n>-D` Debug break-it pass (checklist below) → `M<n>-R` Code review
  (`specs/reviews/M<n>-review.md`) → CRITICAL/MAJOR findings become `M<n>-F<k>` tasks, fixed before
  the next milestone.
- **Deviation from the brief's milestone order:** a minimal auth core and audit append are in M1,
  because constitution §6.2 requires every route from M2 on to enforce auth (approved in
  `phase-3-architect.md`). M6 completes auth.

### Break-it checklist (every `M<n>-D`)
1. Full suite 3× in a row (flakiness).
2. Kill the hub mid-operation of the milestone's main flow; restart; check DB state.
3. Max-length and malformed inputs on every new endpoint.
4. Main flow with each fake port failing once (timeout, error, partial result).
5. Clock jumped ±1 h and across midnight.
6. Same action twice in parallel.
7. Logs: no secrets; operator-facing errors in pt-BR with a next step.

---

## M1 — Foundation
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [x] M1-T01 | Monorepo scaffold: root `package.json` (workspaces), `.nvmrc` 24.15.0, `engines`, `tsconfig.base.json` (strict + extra flags), `apps/server`, `apps/web`, `packages/shared`, `.editorconfig`. | ADR-004, ADR-024 | `npm run typecheck` passes | all workspaces compile |
| [x] M1-T02 | ESLint 10 flat config (typescript-eslint type-checked, import-x `no-restricted-paths` zones, restricted Node modules outside `adapters/`, `no-restricted-syntax` for `dangerouslySetInnerHTML`, react-hooks) + Prettier. | constitution §2.1, §4.1; ADR-024 | lint-rule test: violating fixtures fail via ESLint API | `npm run lint` 0 warnings |
| [x] M1-T03 | Vitest projects (server, shared, web), coverage thresholds on core globs, network-guard setup. | constitution §5; NFR-06 | guard: UDP/TCP to 192.0.2.1 throws, loopback allowed | thresholds enforced |
| [x] M1-T04 | `npm run verify` + `check:deps`. | plan §12; IMP-029 | check-deps unit test | verify runs all gates |
| [ ] M1-T05 | `ci.yml` (ubuntu: verify, `npm audit`, gitleaks pinned by SHA; windows: placeholder) + Dependabot. | constitution §9.1, §6.4; NFR-06 | CI green on push | — |
| [x] M1-T06 | `shared/errors.ts`: ErrorCode, HTTP status, pt-BR catalog. | ADR-006; plan §6.6 | every code has status + message | — |
| [x] M1-T07 | `shared/settings.ts` + `defaults.ts`: settings schema with UI metadata and `requiresRestart`. | NFR-03; spec §9 | defaults parse; metadata for every key | — |
| [x] M1-T08 | `shared/schemas`: rooms, tags, devices, MAC input, users; field limits. | spec §8; ADR-016 | limit boundary tests | — |
| [x] M1-T09 | `shared/mac.ts` (pure; shared so web forms validate identically; server imports it): parse/normalize/validate, multicast/zero/broadcast rejection, locally-administered flag. | FR-002.1 | AC-002-01, AC-002-03, AC-002-04 + property test | — |
| [x] M1-T10 | `application/ports.ts` + test fakes (FakeClock with timers, FakeSender, FakeProber, FakeInterfaces, FakeFs, FakeProcess, FakeReleaseSource) with fault injection. | constitution §2.2 | fake clock ordering; fault injection | — |
| [x] M1-T11 | `db/connection.ts` (pragmas, `transaction()`, unique-violation → AppError), `migrate.ts`, `001_initial.sql`. | plan §5; ADR-017 | migrations on `:memory:`, idempotent, pragmas, FK cascade, unique mapping | — |
| [x] M1-T12 | Config loader (defaults < file < env, Zod) + pino logger with rotation. | constitution §2.4; NFR-04 | precedence; invalid config message; rotation config | — |
| [x] M1-T13 | `http/app.ts`: Fastify + Zod provider, error handler, route-auth registry, host allowlist, security headers, CSRF origin check, `/api/health`. | constitution §6.1, §6.2; plan §6 | undeclared route throws; bad Host rejected; headers; error shape; CSRF | — |
| [x] M1-T14 | `main.ts`: two listeners, graceful shutdown, `EADDRINUSE` → exit 78. | plan §2.1, §9 | ephemeral loopback ports; shutdown closes DB | `node main` serves health |
| [x] M1-T15 | Route-table authz test harness for both listeners. | IMP-014 | enumerates routes; 401 without session | harness reusable |
| [x] M1-T16 | Auth core: argon2id (PHC), users + sessions repos, session plugin, setup (loopback + transactional), login/logout/me, role guard, idle/absolute expiry. | FR-006.1; ADR-018; plan §6.4 | AC-006-01, AC-006-02; expiry with fake clock; rehash | — |
| [x] M1-T17 | Audit service (append-only) + repo. | FR-006.5 | append + query | — |
| [x] M1-T18 | Web scaffold: Vite 8, React 19, Tailwind 4, Router, Query, layout shell pt-BR, banner slot, typed API client. | plan §6.5 | shell renders | `npm run dev` shows shell |
| [x] M1-T19 | Web: `/login`, `/primeiro-acesso`, auth guard, logout. | FR-006.1 | component tests | — |
| [x] M1-T20 | `check:trace`: spec ACs ↔ test titles ↔ tasks. | IMP-030 | script unit test | in `verify` |

### M1 close
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [x] M1-D | Debug break-it pass (checklist) → `apps/server/test/breakit-m1.test.ts`. | tasks §Break-it | 9 probes | findings filed |
| [x] M1-F1 | MAJOR: network guard does not block DNS (a real lookup left the machine). Patch `dns`/`dns.promises`/Resolver for non-loopback names. | constitution §5 | breakit DNS probe | guard blocks DNS |
| [x] M1-F2 | MAJOR: `Db` constructor leaks the SQLite handle when pragmas fail (corrupt file stays locked on Windows). | ADR-017 | breakit corrupt-DB probe | handle closed on failure |
| [x] M1-F3 | MINOR: corrupt/unreadable DB gives "file is not a database"; make it a startup error (exit 78) that points to backups. | constitution §8 | breakit corrupt-DB probe | actionable message |
| [x] M1-R | Code review → `specs/reviews/M1-review.md`. | §9 DoD | — | no open CRITICAL/MAJOR |
| [x] M1-F4 | MINOR R-M1-01: close DB/panel when `createHub` fails after opening them. | review | hub test | — |
| [x] M1-F5 | MINOR R-M1-02: flush and close the file logger on stop. | review | logger test | — |
| [x] M1-F6 | MINOR R-M1-04: reject `bootstrap.*` (config.json) keys in `SettingsService.update` until M6-T05. | review | settings test | — |
| [x] M1-F7 | MINOR R-M1-06: login button stays enabled (autofill); validate on submit. | review | web test | — |
| [x] M1-F8 | MINOR R-M1-07: `check:trace` matches titles wrapped onto the next line. | review | script test | — |

## M2 — Devices, Rooms, Tags
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [x] M2-T01 | Rooms repo/service/routes: CRUD, code generation, delete impact, devices → "Sem sala". | FR-008.1 | AC-008-01, AC-008-02, AC-008-03 | — |
| [x] M2-T02 | Tags repo/service/routes; delete impact. | FR-008.2 | AC-008-04 | — |
| [x] M2-T03 | Devices repo/service/routes CRUD; MAC duplicate; disabled; duplicate-name flag. | FR-002.1 | AC-002-01, AC-002-02, AC-002-03, AC-002-04, AC-002-05 [API] | — |
| [x] M2-T04 | Device list: filters, pagination, compact `all=1`; 500-device benchmark. | plan §5.1; NFR-01 | query < 50 ms at 500 | — |
| [x] M2-T05 | Bulk operations + audit. | FR-002.2 | AC-002-07 | — |
| [x] M2-T06 | `domain/csv.ts`: delimiter/BOM detection, header aliases, row validation, formula neutralization. | FR-002.3; ADR-016 | AC-002-09, AC-002-11 | — |
| [x] M2-T07 | CSV import preview/commit + export routes. | FR-002.3 | AC-002-08, AC-002-10 | — |
| [x] M2-T08 | Web: devices list (filters, search, bulk select + action bar). | FR-002.1, FR-002.2 | component tests | — |
| [x] M2-T09 | Web: device form dialog (MAC warning, duplicate-name warning). | FR-002.1 | component tests | — |
| [x] M2-T10 | Web: rooms & tags management (impact confirmations). | FR-008.1, FR-008.2 | component tests | — |
| [x] M2-T11 | Web: CSV import wizard + export. | FR-002.3 | component tests | — |
| [x] M2-T12 | Web: room page `/salas/:id`. | FR-008.3 | component tests | — |
| [x] M2-T13 | Playwright harness: built server + web, temp data dir, admin via setup API, API seeding helpers; **fails on CSP violations and console errors**. | constitution §5, §6.1 | harness smoke | in CI |
| [x] M2-T14 | E2E: duplicate name warning, room page deep link, axe on devices page. | FR-002.1, FR-008.3; NFR-07 | AC-002-06, AC-008-05 [E2E] | — |

### M2 close
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [x] M2-D | Debug break-it pass → `apps/server/test/breakit-m2.test.ts` (limits on every endpoint, CSV 2 MB/5000 rows, parallel creates/imports, kill -9 during imports, NFC/NFD names, HTML in names). | tasks §Break-it | 9 probes | findings filed |
| [x] M2-F1 | MAJOR: names differing only in Unicode normalization (NFC vs NFD, e.g. CSV from macOS) created duplicate rooms/tags. All text is NFC-normalized in the shared schemas and CSV lookups. | spec §8 | breakit NFC probe | — |
| [x] M2-F2 | MAJOR: audit entries were written after the change committed; a crash in between lost the trace (P4). Mutating service methods now run change + audit in one transaction. | constitution P4 | breakit atomic-audit test | — |
| [x] M2-R | Code review → `specs/reviews/M2-review.md`. | §9 DoD | — | no open CRITICAL/MAJOR |
| [x] M2-F3 | MINOR R-M2-01: framework errors (malformed URL) use the catalog shape. | ADR-006 | server test | — |
| [x] M2-F4 | MINOR R-M2-02: export filename uses the configured time zone. | FR-002.3 | server test | — |
| [x] M2-F5 | MINOR R-M2-03: debounced device search. | FR-002 | web test | — |
| [x] M2-F6 | MINOR R-M2-04: room page says when it shows part of the devices; `?sala=` filter link. | FR-008.3 | web test | — |
| [x] M2-F7 | MINOR R-M2-05: FK violations map to 422. | ADR-006 | server test | — |

## M3 — WoL engine, scoped wake, verification
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [x] M3-T01 | `domain/magic-packet.ts`. | FR-003.1 | AC-003-01 | — |
| [x] M3-T02 | `domain/destinations.ts` (per interface, room directed broadcast, dedupe). | FR-003.2 | AC-003-02, AC-003-03 | — |
| [x] M3-T03 | `adapters/network-interfaces` (os + `route print` parser, default selection). | FR-003.2; ADR-019 | fixtures: multi-NIC, VPN, APIPA, no gateway | — |
| [ ] M3-T04 | `domain/scope.ts` resolver (SR-01..SR-06, SR-10, SR-11). | spec §4 | AC-003-05, AC-003-06, AC-003-07, AC-003-18 (fast-check) | — |
| [ ] M3-T05 | `domain/stagger.ts` (per room, global cap). | FR-003.4 | AC-003-10, AC-003-19 | — |
| [ ] M3-T06 | `adapters/udp-packet-sender` (per-interface bind, broadcast, repeats, per-interface failure) + recording sender. | FR-003.2, FR-003.7; plan §7.1 | injected dgram factory; `EADDRNOTAVAIL`; **loopback contract**: real sender → 127.0.0.1 listener receives the exact payload | — |
| [ ] M3-T07 | `wake-service` preview/start: confirmation, active-job exclusion, keyed per-user limiter, audit. | FR-003.3, FR-003.8 | AC-003-08, AC-003-09, AC-003-14, AC-003-15 | — |
| [ ] M3-T08 | `job-runner`: lifecycle, stagger (fake clock), packet log, dry-run, no-interface handling. | FR-003.4, FR-003.5, FR-003.6, FR-003.7; NFR-02 | AC-003-04, AC-003-12, AC-003-13, AC-003-16; **faults**: send error on one interface, interface vanishes mid-job, DB busy | — |
| [ ] M3-T09 | Verification loop via Prober port; restart recovery. | FR-003.5; NFR-02 | AC-003-11, AC-003-17 | — |
| [ ] M3-T10 | Wake/jobs/packets routes. | FR-003.3, FR-003.6, FR-009 | 409/422/429 paths [API] | — |
| [ ] M3-T11 | Web: wake buttons → preview summary → confirmation dialog; advanced options (per-job stagger). | FR-003.3, FR-003.4 | component tests | — |
| [ ] M3-T12 | Web: job progress drawer, jobs history, job detail + packet log. | FR-009, FR-003.6 | component tests | — |

## M4 — Monitoring hub, realtime, history
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M4-T01 | `domain/status.ts` state machine (debounce, ever_online, desconhecido). | FR-004.1; ADR-014 | AC-004-01, AC-004-02, AC-004-03, AC-004-04, AC-004-05, AC-004-11, AC-004-12 | — |
| [ ] M4-T02 | `adapters/tcp-prober` (timeout, refused = alive). | FR-004.1 | loopback open/closed ports | — |
| [ ] M4-T03 | `probe-helper.ps1` + `ps-helper-icmp` adapter (JSON lines, deadlines, restart). | ADR-019 | fake process tests; Windows loopback contract test + 10 000-request soak | — |
| [ ] M4-T04 | `ping-exe-icmp` fallback + composite prober switch rule. | ADR-019 | localized output fixtures (pt-BR, en-US); switch after 3 restarts in 5 min | — |
| [ ] M4-T05 | `probe-queue` with priorities and concurrency. | FR-004.2 | AC-004-13 | — |
| [ ] M4-T06 | `monitor-service` sweep: DNS cache, IP drift, one-tx writes, events, SSE emits. | FR-004.2, FR-004.3; NFR-01 | AC-004-06, AC-004-07; **faults**: helper deadline, DNS timeout, DB busy | — |
| [ ] M4-T07 | Events bus + SSE route (heartbeat, session expiry, buffer cap). | FR-004.4; ADR-020 | AC-004-14 (server side) | — |
| [ ] M4-T08 | Dashboard API, `domain/uptime.ts`, nightly rollup, uptime API. | FR-004.5, FR-004.6 | AC-004-10, AC-004-16 | — |
| [ ] M4-T09 | Simulated prober + demo seed + `--demo` guard. | FR-015 | AC-015-01 | `npm run dev` lively |
| [ ] M4-T10 | Web: dashboard (counters, room cards, tag filter + wake, search `/`, status filter, notices area). | FR-004.5 | component tests | — |
| [ ] M4-T11 | Web: realtime hook (SSE → Query cache, reconnect refetch). | FR-004.4 | hook tests | — |
| [ ] M4-T12 | Web: device detail (history, uptime). | FR-004.6 | component tests | — |
| [ ] M4-T13 | E2E in demo mode: dashboard, realtime, search, axe; 500-device dashboard < 2 s. | FR-004.4, FR-004.5; NFR-01, NFR-07 | AC-004-08, AC-004-09, AC-004-15 [E2E] | — |
| [ ] M4-T14 | `Ctrl+K` quick-wake palette. | FR-004.7 | AC-004-17 [E2E] | — |
| [ ] M4-T15 | E2E: wake a room in demo mode, drawer progress to final counts. | FR-009 | AC-009-01 [E2E] | — |
| [ ] M4-T16 | Retention & cleanup jobs (history 180 d, packet log 30 d, audit 365 d, sessions, tokens, notices), chunked, never during a wake job. | spec §9; plan §5.1 | fake-clock retention tests | — |

## M5 — Scheduler
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M5-T01 | `domain/schedule.ts`: occurrences, weekdays, tz, DST rule, exceptions, next 5; midnight/month-end/leap cases. | FR-005.1, FR-005.2, FR-005.5; ADR-008 | AC-005-01, AC-005-02, AC-005-06 (DST matrix) | — |
| [ ] M5-T02 | Schedules repo/service/routes + targets + confirm at save + empty-target flag. | FR-005.1, FR-005.8 | AC-005-11 [API] | — |
| [ ] M5-T03 | Exceptions CRUD (global / per schedule). | FR-005.2 | API tests | — |
| [ ] M5-T04 | Scheduler tick: claim-then-execute, grace, atrasado/perdido, multiple missed, clock jumps. | FR-005.3, FR-005.4; NFR-02 | AC-005-03, AC-005-04, AC-005-05, AC-005-08; **faults**: clock ±1 h, DB busy on claim, restart mid-tick | — |
| [ ] M5-T05 | Pause/resume (reason, auto-resume), SSE. | FR-005.6 | AC-005-07, AC-005-09 | — |
| [ ] M5-T06 | Execution log API. | FR-005.7 | AC-005-10 | — |
| [ ] M5-T07 | Morning result notices + notices API + ack. | FR-013 | AC-013-01 | — |
| [ ] M5-T08 | Web: schedules list/form (target picker, weekdays, tz, stagger, next runs, "alvo vazio"). | FR-005.1, FR-005.8 | component tests | — |
| [ ] M5-T09 | Web: exceptions, pause dialog/banner, execution log, morning-result card. | FR-005.2, FR-005.6, FR-005.7, FR-013 | component tests | — |

## M6 — Auth completion, roles, audit, settings, health, backups
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M6-T01 | Password policy + per-account backoff + per-IP login limit + password change revokes sessions. | FR-006.3 | AC-006-04, AC-006-07 | — |
| [ ] M6-T02 | Users API (admin). | FR-006.2 | API tests | — |
| [ ] M6-T03 | Permission matrix in the route-table test (all routes). | FR-006.2 | AC-006-03 | — |
| [ ] M6-T04 | Audit API + CSV export. | FR-006.5 | AC-006-06 | — |
| [ ] M6-T05 | Settings API + audit diff; services apply changes at runtime; restart-required keys flagged; schema ↔ form test. | FR-016; NFR-03 | AC-016-01, AC-016-02 | — |
| [ ] M6-T06 | LAN exposure: HTTPS binding with PFX, cert-generator adapter, Secure cookies, allowlist. | FR-006.4; ADR-012, ADR-026 | AC-006-05, AC-006-08 | — |
| [ ] M6-T07 | Web: users, audit, settings (generated form), network preview. | FR-006.2, FR-006.5, FR-011, FR-016 | AC-011-01 | — |
| [ ] M6-T08 | Log viewer API + page. | FR-016; NFR-04 | API tests | — |
| [ ] M6-T09 | Health service/routes/page + `windows-host` read-only checks (power plan, pending reboot, active hours) + clock skew. | FR-012 | AC-012-01, AC-012-02, AC-012-03 | — |
| [ ] M6-T10 | Backups: daily/manual/pre-migration, retention, restore + web. | FR-014 | AC-014-01, AC-014-02 | — |
| [ ] M6-T11 | Web: global banners (dry-run/demo, pause, update failure) consistent on all pages. | constitution §8 | component tests | — |
| [ ] M6-T12 | E2E axe sweep: dashboard, room, devices, schedules, settings, login. | NFR-07 | axe [E2E] | — |

## M7 — prepare-target.ps1 and self-enrollment
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M7-T01 | Enrollment tokens service/routes (generate, hash, list, revoke, command with script hash, addresses). | FR-007.3 | AC-007-09, AC-007-13 | — |
| [ ] M7-T02 | Agent `POST /agent/enroll` (limits, checks, upsert/move, SMBIOS junk, notices); agent route table = 3 routes. | FR-007.2 | AC-007-05, AC-007-06, AC-007-07, AC-007-08, AC-007-12 | — |
| [ ] M7-T03 | `prepare-target.ps1`: params, elevation, adapter detection, `-WhatIf`, summary, transcript, BOM/CRLF. | FR-007.1; constitution §4.2 | AC-007-01, AC-007-11 [Pester] | — |
| [ ] M7-T04 | Script: NIC power management, Fast Startup, advanced properties, ICMP rule. | FR-007.1 | AC-007-02, AC-007-03, AC-007-04 [Pester] | — |
| [ ] M7-T05 | Script: enrollment POST, exit codes; one-liner hash check. | FR-007.1, FR-007.3 | AC-007-14 [Pester] | — |
| [ ] M7-T06 | PSScriptAnalyzer settings + Pester in the windows CI job. | IMP-018 | CI | — |
| [ ] M7-T07 | Web: "Preparar máquinas" page. | FR-007.3 | component tests | — |
| [ ] M7-T08 | Test-WoL flow service/routes/web. | FR-007.4 | AC-007-10 | — |
| [ ] M7-T09 | Diagnostics service/page + help pages. | FR-010, FR-007.5 | AC-010-01, AC-010-02, AC-007-15 | — |

## M8 — Service, installer, auto-update, release
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M8-T01 | Build script: esbuild bundles with version define, web build, staging layout. | ADR-022 | bundle smoke (`node server.mjs --version`) | — |
| [ ] M8-T02 | Node runtime fetch + SHASUMS256 verification script. | ADR-022 | checksum mismatch fails | — |
| [ ] M8-T03 | WinSW XML template + Inno Setup script (versions dir, firewall, shortcut, service, keep previous, data preserve, uninstall). | FR-001.1 | covered by M8-T09 smoke | — |
| [ ] M8-T04 | `windows-host` control: service stop/start/query, scheduled tasks, event log. | ADR-021, ADR-023 | fake process runner tests (argument arrays) | — |
| [ ] M8-T05 | `http-client` allowlist + `github-release-source` + update check service. | FR-001.2; NFR-05; ADR-025 | AC-001-04, AC-001-05, AC-001-06; allowlist test | — |
| [ ] M8-T06 | Download + verify + disk space + pre-update backup + plan file. | FR-001.3 | AC-001-07, AC-001-09, AC-001-14 | — |
| [ ] M8-T07 | `updater.mjs`: stop/install/start/health/rollback + watchdog. | FR-001.3; ADR-023 | AC-001-08, AC-001-13; **faults**: stop timeout, installer hang, health never OK, crash after stop | — |
| [ ] M8-T08 | Auto mode (window, guards), update routes, web update panel. | FR-001.3 | AC-001-10, AC-001-11 | — |
| [ ] M8-T09 | `release.yml` + Windows installer smoke + fake release server E2E. | FR-001.1, FR-001.4 | AC-001-01a, AC-001-02, AC-001-03, AC-001-12 [CI-Win] | — |
| [ ] M8-T10 | README pt-BR (install, first access, prepare targets, troubleshooting, cert trust, backups). | DoD | — | — |
| [ ] M8-T11 | E2E smoke on Edge (`msedge` channel) in the Windows job. | NFR-09 | [E2E] | — |

## M9 — v1.1 network discovery
| ID | Task | Refs | Tests | Done when |
|---|---|---|---|---|
| [ ] M9-T01 | Neighbor cache: `Get-NetNeighbor` JSON + `arp -a` parser (pt-BR/en-US fixtures). | FR-101 | AC-101-02 | — |
| [ ] M9-T02 | OUI vendor DB (bundled with releases; no runtime download, NFR-05) + lookup. | FR-101; NFR-05 | lookup tests | — |
| [ ] M9-T03 | Discovery service: CIDR sweep, hostname, already-registered, locally-administered flag. | FR-101 | AC-101-03 | — |
| [ ] M9-T04 | Discovery API + page + bulk add to room. | FR-101 | AC-101-01 | — |

## Phase 5 — Validate (lead: Debug)
| ID | Task | Refs | Evidence |
|---|---|---|---|
| [ ] V-T01 | Walk every AC; record pass/fail with test names / CI run links in `validation.md`. | all | `validation.md` |
| [ ] V-T02 | Walk every failure mode from `phase-0-debug.md` / `phase-1-debug.md` / `phase-2-debug.md`. | — | `validation.md` |
| [ ] V-T03 | Install → update → rollback with the local fake release server (Windows CI). | FR-001 | CI run |
| [ ] V-T04 | Security pass: route table, headers, CSP, enrollment abuse, CSV injection. | FR-006, ADR-016 | `validation.md` |
| [ ] V-T05 | Owner checklist for [manual] items (AC-001-01b, real WoL on hardware). | B-002 | checklist in `validation.md` |
| [ ] V-T06 | Footprint measurement (RAM/CPU idle). | NFR-08 | numbers in `validation.md` |
| [ ] V-T07 | Code Reviewer final audit → `specs/reviews/final-audit.md`. | — | go/no-go |
| [ ] V-T08 | Architect approval + release notes + tag `v1.0.0`. | FR-001.4 | Release |
