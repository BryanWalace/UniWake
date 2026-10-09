# UniWake — Architecture Decision Records

Format: `ADR-NNN | date | status | context | decision | consequences`.
Status: Proposed · Accepted · Superseded by ADR-xxx.

---

## ADR-001 — Reconstruct the orchestrator; single-agent automatic mode
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** `00-LEIA-ME.md` references `.agents/06-orchestrator.md`, which was not in the
  repository. The owner asked for fully autonomous operation with the four roles played by one
  agent.
- **Decision:** Rebuild `06-orchestrator.md` from `00-LEIA-ME.md` and the kickoff instructions
  (Mode A). Mark it as reconstructed.
- **Consequences:** The process is documented in-repo; the owner can replace the file with their
  original at any time. A future replacement takes precedence and gets a new ADR.

## ADR-002 — Runtime: Node.js 24 LTS + TypeScript (Go rejected)
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** The brief recommends Node 22 LTS and asks to evaluate Go for a single
  self-updating binary. As of 2026-10-04, Node 24 is the current LTS line (supported to
  April 2028); Node 22 is in maintenance and reaches end of life in April 2027, likely within the
  product's first year. The dev machine has Node 24.15. Go is not installed.
- **Decision:** Node.js 24 LTS + TypeScript for server and tooling. The installer bundles a
  pinned `node.exe`. Go is rejected: the panel is React/TypeScript either way, so Go would mean
  two languages and no shared schemas; the "single binary" benefit is largely recovered by
  bundling the server into one JS file + a pinned runtime, and the self-update difficulty (a
  running service replacing itself) is the same in both languages.
- **Consequences:** Shared Zod types between server and web. The update package is larger
  (~35 MB with runtime) than a Go binary; acceptable. Moving to the next LTS needs a new ADR.

## ADR-003 — Hexagonal architecture with lint-enforced boundaries; real SQLite in tests
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Network, clock and OS behavior must be testable without real hardware. Faking
  repositories would duplicate SQL semantics (unique MAC, cascades) and drift.
- **Decision:** Layers `domain / application / adapters / db / http` with import rules enforced
  by ESLint. Ports only at real I/O boundaries. Repositories are concrete SQLite classes tested
  against in-memory databases with real migrations.
- **Consequences:** Fast, faithful DB tests; fewer interfaces; lint fails on boundary violations.

## ADR-004 — Monorepo with npm workspaces
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Server, web and shared schemas must evolve together. pnpm is not installed; npm
  ships with Node.
- **Decision:** npm workspaces: `apps/server`, `apps/web`, `packages/shared`.
- **Consequences:** One lockfile, one `npm ci`, one `npm run verify`.

## ADR-005 — Two listeners: loopback panel and LAN agent surface
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Brief requires the panel bound to localhost by default (FR-006) *and* targets that
  POST to the hub during self-enrollment (FR-007). A single loopback listener makes enrollment
  impossible; enabling LAN for everything to make enrollment work exposes the whole panel.
- **Decision:** The hub runs two HTTP listeners. **Panel listener**: UI + full API, default
  `127.0.0.1`, LAN only if an admin enables it. **Agent listener**: LAN-bound, routes limited to
  enrollment and health, with its own Windows Firewall rule created by the installer. Exact
  ports and whether the agent listener can be disabled are set in Plan.
- **Consequences:** Two firewall rules; the route-table test runs per listener; minimal
  attack surface on the LAN by default.

## ADR-006 — Shared error-code catalog with pt-BR messages
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** pt-BR messages are needed by the web UI and by `prepare-target.ps1`, which only
  sees API responses.
- **Decision:** `packages/shared` defines `ErrorCode` and a pt-BR message catalog. API errors
  return `{ code, message, details? }` with `message` in pt-BR.
- **Consequences:** One source of truth; a test checks every code has a message.

## ADR-007 — Trunk-based development, Conventional Commits, SemVer tags
- **Date:** 2026-10-04 · **Status:** Superseded by ADR-030
- **Context:** A single autonomous agent works on the repo; the owner wants a push after each
  task.
- **Decision:** Commit directly to `main` after `npm run verify` passes locally; CI validates
  every push. Releases are tags `v*`.
- **Consequences:** Fast flow. A red CI on `main` must be fixed before the next task starts.

## ADR-008 — Time handling: UTC storage, IANA zones, tick-based scheduler, DST rules
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Schedules are local wall-clock times ("Seg–Sex 06:50", America/Sao_Paulo by
  default). Clocks drift and jump; zones may observe DST.
- **Decision:** Store UTC epoch ms. Convert with IANA zone names at evaluation/display only. The
  scheduler ticks at least every 30 s and compares against "next due". A non-existent local time
  (spring forward) runs at the first valid instant after it; an ambiguous one (fall back) runs once,
  at the first occurrence. Double-fire is prevented by the claim-then-execute unique key, not by
  timer logic.
- **Consequences:** Clock jumps and service restarts cannot cause double fire. The DST behavior
  is unit-tested with zones that observe DST (e.g. America/New_York, Europe/Lisbon).

## ADR-009 — Update safety model
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Self-update is the riskiest feature. A running service cannot replace its own
  files. A SHA-256 published in the same release proves integrity, not authorship.
- **Decision:** The hub checks GitHub Releases (non-draft, non-prerelease, valid SemVer greater
  than current), downloads to a temp file, verifies size + SHA-256, takes a DB backup, then launches
  a **separate updater process** that stops the service, runs the installer silently, starts the
  service and polls the health endpoint. On failure it restores the previous version directory and
  the DB backup and restarts. Authenticode signing and signature verification are added when a
  certificate is available (BLOCKERS B-001).
- **Consequences:** Rollback is possible without the hub being alive. Until signing exists,
  security of updates depends on the GitHub account's security; this is documented for the owner.

## ADR-010 — Native addon policy
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Native addons (e.g. `better-sqlite3`, `argon2`) must match the bundled Node ABI and
  add install/update failure points. Node 24.15 ships `node:sqlite` and `crypto.argon2` built in
  (verified on the dev machine).
- **Decision:** A native addon requires its own ADR and prebuilt win-x64 binaries for the shipped
  ABI. Plan phase evaluates the built-in modules first.
- **Consequences:** Potentially zero native addons, so the server bundle is runtime + one JS file.

## ADR-011 — Agent listener serves the prepare script; hash-pinned one-liner
- **Date:** 2026-10-04 · **Status:** Accepted · **Amends:** ADR-005, constitution §2.6
- **Context:** The technician needs the script on each target PC; the panel is loopback-only.
  Downloading over plain HTTP and running elevated is a MITM risk on a shared college LAN
  (phase-1 R1-02).
- **Decision:** Agent listener routes are exactly: `GET /api/health` (minimal), `POST /agent/enroll`,
  `GET /agent/prepare-target.ps1`. The panel (reached over loopback, a trusted channel) shows a
  one-line command embedding the script's SHA-256; the command verifies the downloaded file with
  `Get-FileHash` and aborts on mismatch before executing.
- **Consequences:** No USB sticks needed. Tampering in transit is detected. The route-table test
  asserts the agent listener exposes nothing else.

## ADR-012 — LAN panel access is HTTPS-only
- **Date:** 2026-10-04 · **Status:** Accepted · **Amends:** constitution §6.1
- **Context:** Students share the college LAN. Plain HTTP would expose admin passwords and session
  cookies (phase-1 R1-01).
- **Decision:** When `panel.lanEnabled` is on, the LAN binding serves TLS only, using a
  self-signed certificate generated by the hub (or an admin-uploaded PFX); cookies issued there are
  `Secure`. Loopback stays HTTP. Certificate generation mechanism is chosen in Plan.
- **Consequences:** Browsers show a certificate warning for the self-signed cert until IT trusts it
  (documented in README). Slightly more code in the panel listener.

## ADR-013 — Accepted risk: enrollment over plain HTTP on the LAN
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** A sniffed enrollment token lets an attacker create devices in, or move devices into,
  one room for the token's lifetime (phase-1 R1-03). TLS with thumbprint pinning in PowerShell 5.1
  adds significant complexity to the technician's command.
- **Decision:** Accept for v1.0 with mitigations: 128-bit tokens, room-scoped, 8 h default expiry,
  max uses, revocation, per-IP rate limit, field allowlist, audit of every use, and a dashboard
  notice of devices moved by enrollment in the last 24 h. TLS on the agent listener is roadmap RM-5.
- **Consequences:** Worst case is wrong room membership, visible and reversible; no code execution
  or credential exposure.

## ADR-014 — Device status semantics
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** A PC that filters ICMP and all probe ports cannot be distinguished from a PC that is
  off: both time out. A stale status after restart misleads the operator.
- **Decision:** Positive signals are ICMP reply, TCP connect, **and TCP connection refused**.
  `offline` only after `monitor.offlineAfter` (default 2) consecutive failed sweeps; `online` is
  immediate. `desconhecido` = disabled, no address, or not probed since hub start. Flag
  "nunca respondeu" for devices never seen online. `prepare-target.ps1` enables the ICMPv4 echo
  rule to remove the ambiguity at the source.
- **Consequences:** Fewer false offlines and no flapping; up to one extra sweep (~60 s) before an
  offline transition is shown.

## ADR-015 — Automatic updates by default, inside a maintenance window
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** The brief asks for auto-update with silent install. An update during the morning
  schedule would be the worst possible timing.
- **Decision:** `update.mode` default `auto`, window 03:00–05:00 local; the updater does not start
  while a wake job is active or if a schedule is due within 60 min. Admins can always install
  manually; `manual` mode turns auto-install off.
- **Consequences:** Hubs stay current without operator effort. Until code signing exists (B-001),
  auto-update trusts the GitHub account's security, as documented in ADR-009.

## ADR-016 — Handling untrusted target-supplied data
- **Date:** 2026-10-04 · **Status:** Accepted · **Amends:** constitution §4.1, adds §6.7
- **Context:** Hostnames, serials and notes can come from target PCs via enrollment and from CSV
  files; they are rendered in the panel and exported to Excel (phase-1 R1-04..06).
- **Decision:** Every string field has a max length in the shared Zod schemas; `react/no-danger` is
  a lint error; CSV exports neutralize formula-leading characters; enrollment bodies ≤ 8 KB.
- **Consequences:** Closes stored-XSS and CSV-injection paths with cheap, testable rules.

## ADR-017 — SQLite driver: built-in `node:sqlite`
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** ADR-010 asks to avoid native addons. Spike (plan §1): `node:sqlite` in Node 24.15
  supports WAL, `synchronous=FULL`, transactions, `backup()`, with no experimental warning.
- **Decision:** Use `node:sqlite` behind `db/connection.ts`. Synchronous access rules in plan §5.1.
- **Consequences:** No native addon to match ABIs. If the API changes, only the wrapper changes;
  fallback option is better-sqlite3 (would need its own ADR per ADR-010).

## ADR-018 — Password hashing: built-in argon2id
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Constitution §6.2 prefers argon2id. Node 24.15 ships `crypto.argon2`.
- **Decision:** argon2id, memory 19 456 KiB, 2 passes, parallelism 1, 16-byte salt, 32-byte tag,
  stored as a PHC string (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`), verified with
  `timingSafeEqual`. Parameters upgradable on login (rehash when params differ).
- **Consequences:** ~45 ms per hash on the dev machine; no native addon.

## ADR-019 — Probing: persistent PowerShell ICMP helper, `ping.exe` fallback, TCP, `route print`
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Raw ICMP sockets need admin and native code; `ping.exe` output is localized;
  `Get-NetIPConfiguration` is ~4 s. Spike: a persistent helper using .NET `Ping.SendPingAsync`
  did 250 pings in ~0.5 s with locale-independent status.
- **Decision:** `probe-helper.ps1` (JSON lines over stdin/stdout) is the primary ICMP prober,
  supervised with deadlines; after 3 restarts in 5 min the composite prober switches to
  `ping.exe` (exit code + `TTL=`), shown on the health page. TCP probes via `node:net`
  (`ECONNREFUSED` = alive). Default gateways from `route.exe print -4`, matched per interface IP.
- **Consequences:** Fast and locale-safe; depends on PowerShell being allowed for SYSTEM, with a
  working fallback when it isn't.

## ADR-020 — Realtime channel: Server-Sent Events
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Updates flow server → client only; the panel uses cookie sessions.
- **Decision:** SSE at `GET /api/events`; heartbeat 20 s; `session.expired` event; client refetches
  on reconnect.
- **Consequences:** No WebSocket library; native browser reconnect; works through the same auth.

## ADR-021 — Windows Service wrapper: WinSW 2.12, LocalSystem
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Node is not an SCM-aware service binary. WinSW 2.12 is the stable release (v3 is
  prerelease). The service must run installers, manage firewall rules, the certificate store and
  scheduled tasks.
- **Decision:** WinSW 2.12 x64 renamed `UniWakeService.exe`, account LocalSystem, recovery restart
  10/30/60 s. Hardening: process execution rules (plan §9.1), ACL'd data dir, update source
  constant (ADR-025), minimal LAN surface.
- **Consequences:** Highest privilege, mitigated by narrowing every input path that can reach a
  process or file operation.

## ADR-022 — Packaging: esbuild bundle + pinned Node runtime + versioned dirs + Inno Setup
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** Zero native addons (ADR-017/018) means the server is pure JS.
- **Decision:** esbuild bundles `server.mjs` and `updater.mjs`; the installer ships the official
  pinned `node.exe` (checksum-verified in CI), the Vite build, scripts and the helper into
  `versions\<ver>\`, and rewrites `UniWakeService.xml` to that dir. The previous version dir is
  kept for rollback.
- **Consequences:** Rollback = repoint XML (+ optional DB restore). Installer ≈ 35–40 MB.

## ADR-023 — Updater launched by Task Scheduler, with a watchdog task
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** WinSW kills the wrapped process tree on stop, so an updater spawned by the hub would
  die when it stops the service (phase-2 D2-01). An updater crash could leave the service stopped.
- **Decision:** The hub registers and runs one-shot scheduled tasks as SYSTEM: `UniWake-Updater`
  (runs `updater.mjs` with a plan file) and `UniWake-Watchdog` (15 min later; restarts the previous
  version if the service is not running). The updater restores the DB only if the schema version
  advanced. Task command lines contain only fixed paths and the validated plan path.
- **Consequences:** Updates survive the service stop and updater crashes; extra code in
  `windows-host` adapter, covered by fakes and the Windows CI end-to-end test.

## ADR-024 — Toolchain pins
- **Date:** 2026-10-04 · **Status:** Accepted · **Amends:** constitution §4.1 (no-danger rule wording)
- **Context:** As of 2026-10-04: TypeScript 7 exists but typescript-eslint supports `<6.1`;
  eslint-plugin-react does not support ESLint 10; `@types/node` latest is 26 while we ship Node 24.
- **Decision:** TypeScript 6.0.x; ESLint 10 + typescript-eslint 8 + eslint-plugin-import-x +
  eslint-plugin-react-hooks; the no-`dangerouslySetInnerHTML` rule is enforced with
  `no-restricted-syntax`; `@types/node` 24; Vite 8; Vitest 5; React 19; React Router 8 (library
  mode); TanStack Query 5; Tailwind 4; Zod 4; Fastify 5.
- **Consequences:** Type-aware linting works; upgrade to TS 7 when typescript-eslint supports it.

## ADR-025 — Update source is a build-time constant
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** A configurable update repository would let anyone with admin or DB write access
  redirect updates and execute code as SYSTEM (phase-2 R2-01).
- **Decision:** Repository owner/name and API host are compiled into production builds. Only test
  builds can override them (fake release server).
- **Consequences:** Forks must rebuild to change the source; no runtime path to redirect updates.

## ADR-026 — LAN panel certificate via PowerShell
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** ADR-012 needs a certificate without adding a dependency; Node cannot create X.509
  certificates natively.
- **Decision:** When LAN access is enabled, the hub runs `New-SelfSignedCertificate`
  (`-KeyExportPolicy Exportable`, SAN = LAN name/IP, 5-year validity) and `Export-PfxCertificate`
  with a random password stored in `%ProgramData%\UniWake\certs\pfx.key`, then removes the cert
  from the store. Admins can upload their own PFX instead.
- **Consequences:** Self-signed warning in browsers until IT trusts the cert (README explains).

## ADR-027 — Uptime semantics and live-update session handling
- **Date:** 2026-10-04 · **Status:** Accepted
- **Context:** FR-004.6 defines uptime as "% of the local day online" but leaves open what happens
  while the hub is down, how today is shown, and which data wins after retention trims events.
  ADR-020 SSE heartbeats could also keep a session alive forever.
- **Decision:**
  - Local days use `scheduler.timezone` (Intl-based, DST-aware; 23/25 h days count their real length).
  - At hub start each known status is reset to `desconhecido` with the event dated at the device's
    `last_probe_at`, so downtime or a crash never counts as uptime.
  - Today's ratio is over the elapsed part of the day; days before the device existed are `null`.
  - `daily_uptime` (nightly at 00:10 local, catch-up on start, bounded by `retention.historyDays`)
    is authoritative for finished days; missing days are computed from events on demand.
  - Room uptime = average of its *current* devices' known days (AC-004-16).
  - SSE heartbeats validate the session without touching `last_seen_at`: an open dashboard alone
    does not defeat the idle timeout.
  - Amended in M4-R (R-M4-01): requests the panel sends after 60 s without user input (polling,
    live-update refetches) carry `X-UniWake-Idle: 1` and do not touch the session either.
  - Amended in M4-R (R-M4-02): a tab hidden for 30 s closes its stream (HTTP/1.1 allows ~6
    connections per host) and reconnects with a refetch when shown.
- **Consequences:** Moving a device between rooms changes historical room averages (acceptable;
  the device's own history is unchanged). A wall-display dashboard is logged out after
  `security.sessionIdleHours` without interaction.

## ADR-028 — Dedicated ICMP rule instead of the built-in echo rule
- **Date:** 2026-10-05 · **Status:** Accepted · **Amends:** FR-007.1 step 5, IMP-021
- **Context:** The built-in "Compartilhamento de Arquivo e Impressora (Solicitação de Eco -
  ICMPv4-In)" rule differs between Windows builds and languages: on many it is one rule for the
  Private *and Public* profiles, so enabling it also answers pings on public networks (a laptop in
  a café). Its name and grouping also depend on the build.
- **Decision:** prepare-target.ps1 creates (or repairs) its own inbound rule `UniWake-ICMPv4-In`
  ("UniWake - Ping (ICMPv4)"): ICMPv4 type 8, Allow, profiles Domain and Private only. Built-in
  rules are left untouched. `-NoFirewallChange` skips the step.
- **Consequences:** Same end state on every build, idempotent by rule name, nothing opened on
  Public. IT can find and remove the rule by its name. Group Policy that blocks local rules still
  wins; the monitor's TCP probe (incl. refused) covers that case.

## ADR-029 — Release candidate before hardware validation
- **Date:** 2026-10-06 · **Status:** Accepted · **Amends:** tasks V-T08
- **Context:** Every automated criterion passes, including install, update and rollback on Windows
  CI, but real Wake-on-LAN on the college's PCs (B-002) and the reboot-with-nobody-logged-in check
  (AC-001-01b) need the owner's hands. A final `v1.0.0` published before anyone woke a real PC would
  claim more than was verified.
- **Decision:** Phase 5 ends with tag `v1.0.0-rc.1`. The release workflow publishes it as a
  GitHub prerelease (installer + SHA-256), which also exercises AC-001-12. Hubs never auto-update
  to prereleases (AC-001-05). The owner runs the checklist in `validation.md` (V-T05) and then tags
  `v1.0.0` on the same commit (or a fix), which publishes the final release.
- **Consequences:** The owner can install the release candidate from GitHub right away; the final
  release reflects real hardware results.
- **Addendum (same day):** the `v1.0.0-rc.1` tag ran every gate and built the installer, but the
  publish step failed before creating the release: PowerShell turned the one-element argument array
  into a string, so `gh` received `--prerelease--notes-file …` as one argument. Fixed in
  `release.yml`; the tag was left in place (nothing was published from it) and the first published
  candidate is `v1.0.0-rc.2`.

## ADR-030 — Work on `dev`; `main` and tags belong to the owner
- **Date:** 2026-10-08 · **Status:** Accepted · **Supersedes:** ADR-007 · **Amends:** constitution
  §9.1, §10; plan §12
- **Context:** Release tags publish installers that hubs on real PCs install automatically
  (ADR-015). With trunk-based work on `main`, one bad push plus one tag reaches the college's PCs.
  The owner now wants every change isolated on a branch until they decide to ship it.
- **Decision:** All work is committed to `dev` (created from `main` at `7297341`) and pushed to
  `origin dev` only, one commit per completed task. Agents never commit to, merge into, rebase onto
  or push `main`, never open or merge PRs into `main` and never create `v*` tags. Only when the
  owner says "pode subir a dev para a main" is `dev` merged into `main` (after all tests pass), and
  a tag is created only if the owner asks. `ci.yml` runs on pushes to `dev` and `main` and on PRs:
  lint, format, typecheck, unit/integration/E2E/PowerShell tests and the installer/update smoke
  tests. None of its jobs publish anything; the installer it builds is a throwaway test build.
  `release.yml` still triggers on `v*` tags but first fails unless the tagged commit is reachable
  from `origin/main`, so a tag pushed on `dev` by mistake publishes nothing.
- **Consequences:** `main` always holds owner-approved code, and auto-update only ever installs what
  the owner merged and tagged. The handoff (`NEXT.md`) tells the owner when `dev` is ready to merge.
  The README download links keep pointing to the last published release until the owner tags a new
  one.

## ADR-031 — Sync-ready data layer: UUIDs, Lamport revisions, one change-log row per entity
- **Date:** 2026-10-08 · **Status:** Accepted · **Amends:** constitution §2.3; spec NFR-10; plan §5
- **Context:** `.agents/07-roadmap-features.md` §A: there is no 24/7 server. Each of the two IT
  staff runs UniWake on their own PC, and v1.2 syncs them over the LAN. The design must be ready
  for that from v1.0: stable UUIDs, `updated_at`, `updated_by_instance`, tombstones, and every write
  appending to a local change log through a repository. v1.0 was built with local integer keys and
  hard deletes; ~730 tests and every API route use those integer ids.
- **Decision:**
  1. **Two kinds of tables.** *Replicated entities* (the team's shared data) and *machine-local*
     tables (observations and state of this PC). Replicated: `room`, `tag`, `device` (incl. its tag
     set), `schedule` (incl. its targets), `schedule_exception`, `schedule_run`, `user`, `setting`
     (shared scope only, ADR-032) and the scheduler pause (`scheduler_pause`, singleton `global`).
     Everything else is machine-local and never synced or exported: `instance`, `machine_settings`,
     `system_state` (except the pause), `sessions`, `device_state`, `device_events`, `daily_uptime`,
     `wake_jobs`, `wake_job_devices`, `packet_log`, `test_wol_runs`, `enrollment_tokens`, `notices`,
     `backups`, `audit_log`, and the users' lock-out counters.
  2. **Identity.** The integer `id` stays as a *local* surrogate key (FKs, URLs, API). Each
     replicated row also gets `uuid` (unique), its global identity, assigned once and never changed;
     references between entities travel as UUIDs. Settings use their key as identity (two PCs
     changing `wake.repeat` change the same thing); the pause uses `global`; a schedule run uses a
     name-based UUID (v5) of `schedule uuid + planned instant`, so the same occurrence has the same
     identity on every PC and two records of it merge instead of duplicating.
  3. **Versions.** Each replicated row carries `rev` (a Lamport clock value), `updated_at` and
     `updated_by_instance`. The clock lives in the `instance` row and is incremented on every
     replicated write; v1.2 merges it with remote revisions on receipt. Conflicts will be resolved by
     `(rev, instance_id)`: deterministic last-writer-wins.
  4. **Change log = latest state per entity.** `change_log(seq AUTOINCREMENT, entity, entity_id,
     op, rev, instance_id, at, payload)` with one row per entity: a write deletes the entity's
     previous row and appends a new one with a full JSON snapshot (references as UUIDs; local ids,
     lock-out counters and machine data excluded). Because snapshots are full state, superseded
     rows carry no information, so this *is* the compaction; a peer asking "changes since N" gets
     the latest version of everything that changed after N.
  5. **Tombstones.** A delete replaces the entity's log row with `op = 'delete'` (no payload). The
     live tables keep hard deletes, so no read query, unique constraint or FK cascade changes, and
     a deleted name can be reused. Dependents removed by a cascade are tombstoned too (a schedule's
     exceptions and runs); devices whose room or tags change because of a delete are re-logged.
     Tombstones are pruned only in v1.2, after every peer acknowledged them. Retention pruning of
     old schedule runs drops their log rows without tombstones (each PC applies its own retention).
  6. **Enforcement.** Repositories call `ChangeLog.touch(entity, id)` after a write and
     `ChangeLog.tombstone(entity, id)` before a delete, inside the write's transaction. `touch`
     assigns the UUID when missing, bumps the clock and writes the snapshot. A checker
     (`verifyChangeLog`) proves for any database that every replicated row has a log row with the
     same `rev` and the same snapshot, and that no tombstone has a live row; every API test harness
     runs it on close, so a write path that skips the log fails the suite.
  7. **Migration.** Migration 004 adds the columns and tables; at start-up a baseline logs every
     existing row that has no revision yet, so a v1.0 database upgraded later syncs completely.
  8. **Schedule targets keep the target's UUID** (`schedule_targets.ref_uuid`), and deleting a
     room, tag or device clears the local `ref_id` of targets that pointed to it. This also fixes a
     latent v1.0 bug: SQLite may reuse the highest rowid, so a schedule whose room was deleted could
     silently target a room created afterwards with the same id.
- **Alternatives rejected:** UUID primary keys everywhere (rewrites every FK, route, client type and
  most tests for no functional gain: peers never see local ids); `deleted_at` soft-delete columns
  (every read query, uniqueness rule and cascade would have to change; a tombstone in the log is
  what sync needs); SQLite triggers writing the log (cannot build snapshots with UUID references
  and aggregate children cleanly; the repository rule plus the checker is explicit and tested);
  an append-only log of every change (grows with every IP change and pause forever while carrying
  no extra information for state-based last-writer-wins).
- **Consequences:** v1.0 behaves exactly as before for the operator; writes cost one extra snapshot
  query. v1.2 only adds transport, apply (with the same repositories, keeping remote `rev` and
  instance) and tombstone pruning. Unique names (two PCs creating "Lab 1" independently) are a v1.2
  conflict rule, not a schema change.

## ADR-032 — Machine-specific settings in their own table
- **Date:** 2026-10-08 · **Status:** Accepted · **Amends:** constitution §2.4; plan §5
- **Context:** Roadmap §A: network interface, port, bind address and paths are properties of one
  PC and must never be synced or exported.
- **Decision:** Every setting declares `scope: 'shared' | 'machine'` in the shared registry (a
  required field, so a new key cannot be added unclassified). Machine-scope keys live in the new
  `machine_settings` table, which no change log, sync or export ever reads; migration 004 moves
  existing values there. Machine scope: `wake.interfaces`, `wake.dryRun`, `panel.lanEnabled`,
  `panel.lanAddress`, `enrollment.hubAddress`, `update.*` (each PC updates itself, in its own
  window), `backup.*` (each PC backs up its own disk) and the `bootstrap.*` keys (already in
  `config.json`). Everything else (wake policy, monitoring, scheduler, security, retention) is
  shared team policy. The settings page marks machine-scope settings "Somente neste PC".
- **Consequences:** The settings API and form are unchanged; only storage differs. v1.4's export
  and v1.2's sync can treat `settings` as team data without filtering.

## ADR-033 — Persistent instance identity
- **Date:** 2026-10-08 · **Status:** Accepted · **Amends:** plan §5, §9; spec FR-012, FR-014
- **Context:** Each installation needs a stable `instance_id` (roadmap §A) to attribute writes,
  order conflicts and, in v1.2, track what each peer has seen.
- **Decision:** A single-row `instance` table holds `instance_id` (random UUID, created on first
  start), `created_at` and the Lamport clock. It is machine-local. Restoring a backup file (FR-014)
  gives the installation a **new** `instance_id` and keeps the clock at least at the highest
  revision in the restored data: the restored change log restarts from older sequence numbers, and
  peers that tracked the old identity must not mistake it for the same history. The health page
  shows the identifier (first 8 characters) to make support and v1.2 pairing easier to follow.
- **Consequences:** A database copied to another PC by hand would share the identity; v1.4's
  import never copies `instance`, and the copy gets its own identity.

## ADR-034 — Scheduler asks an execution lease before handling an occurrence
- **Date:** 2026-10-08 · **Status:** Accepted · **Amends:** plan §7.2
- **Context:** Roadmap §A/§B: with several instances online, one executor is elected per run
  (lease); alone, an instance executes. v1.0 has one instance, but the scheduler must not need a
  redesign for v1.2.
- **Decision:** The scheduler depends on an `ExecutionLease` port: `shouldHandle({ schedule uuid,
  planned instant, now })` → boolean, asked before an occurrence is claimed, whether it would be
  executed or only logged (`perdido`, `pulado`). v1.0 wires `SoloLease` (always true). v1.2's lease
  keeps its state up to date in the background (peer announcements) so the call stays synchronous
  and the tick stays simple. The claim-then-execute row stays the local guard; the run's
  deterministic UUID (ADR-031) makes two instances' records of one occurrence the same entity, and
  each run records `claimed_by_instance`.
- **Consequences:** An instance that declines leaves no record; the executor's run arrives by sync.
  Offering missed wakes at start-up (roadmap §B) builds on the same port in v1.2.

## ADR-035 — Team mode: peer-to-peer pull sync, replicated membership, one port
- **Date:** 2026-10-09 · **Status:** Accepted · **Amends:** spec FR-201..205; plan §14
- **Context:** Roadmap §B. No PC is always on; two staff, different shifts; sometimes a third PC.
  The data layer is already sync-ready (ADR-031).
- **Decision:**
  - **Peer-to-peer, pull only.** Each PC pulls "changes since N" from every online peer and keeps a
    cursor per peer; a "poke" asks a peer to pull now. Because a PC's change log also holds what it
    received (with the original revision and instance), changes gossip through any PC that is on.
  - **Membership is a replicated entity** (`team_member`: instance id as UUID, name, verifier of the
    member secret, joined/revoked times), so every PC can check every other PC and a rename or
    revocation spreads like any change. Keys are not replicated (ADR-038).
  - **Who keeps data.** The PC that shows the code keeps its data; the joining PC replaces its
    replicated data with the team's (after a backup and a typed confirmation). Merging two
    independently built inventories at pairing time would turn every room name and MAC into a
    conflict; the UI says which PC to pair from.
  - **One port, 47102.** UDP for announcements; TCP for both pairing and sync, told apart by the first
    byte (TLS records start with 0x16, pairing JSON with `{`). One firewall rule.
- **Consequences:** No coordinator to install or keep on. A PC that was off catches up from whichever
  PC is on. Cost: each PC opens one inbound port on Domain/Private networks.

## ADR-036 — Pairing with SPAKE2 over the RFC 3526 group, no new dependency
- **Date:** 2026-10-09 · **Status:** Accepted · **Amends:** plan §4, §14
- **Context:** Roadmap §B requires a PAKE (SPAKE2/CPace) or an equivalent proven scheme so the
  6-digit code authenticates the key exchange without travelling. `node:crypto` has no elliptic-curve
  point arithmetic; the audited JS curve libraries would be a new runtime dependency (P6).
- **Decision:** SPAKE2 as specified by RFC 9382 (transcript, key schedule, key confirmation with
  HMAC), instantiated in the prime-order subgroup of the RFC 3526 2048-bit MODP group (safe prime,
  generator 4) with `BigInt` exponentiation. `M` and `N` are hashed into the group (squares of
  SHA-512-expanded integers: nobody knows their discrete logs). Received elements are validated
  (range and subgroup membership). `w` = hash of the code and the session's nonces, reduced mod q.
  Pairing traffic is JSON over TCP; after confirmation the inviter's payload is encrypted with
  AES-256-GCM under a key derived from the SPAKE2 output.
- **Alternatives:** CPace or SPAKE2 on ristretto255 via a curve library (smaller messages, new
  dependency); SRP-6a (augmented, needs a stored verifier: no benefit for a one-time code).
- **Consequences:** ~260-byte messages and tens of milliseconds of CPU per pairing; an attacker on the
  wire gets no offline guess; an online guesser has 5 tries in 10⁶. Known-answer tests pin the group
  constants; property tests check both sides agree on the right code and disagree on any other.

## ADR-037 — Team secrets protected with DPAPI (LocalMachine)
- **Date:** 2026-10-09 · **Status:** Accepted · **Amends:** plan §9, §14
- **Context:** The team key must be stored encrypted on each PC (roadmap §B). The service runs as
  LocalSystem.
- **Decision:** A `SecretProtector` port. The Windows adapter calls
  `ProtectedData.Protect/Unprotect` (scope LocalMachine, fixed entropy) through PowerShell with the
  bytes on stdin, never on the command line. Blobs live in the machine-local `team` table; the
  plaintext exists only in memory. Tests and non-Windows development use a fake protector that marks
  its output, so a test can prove nothing plain reaches the database.
- **Consequences:** A copied database (or backup) cannot be used to join the team on another PC: the
  blobs only open on the PC that made them. Restoring a backup on the same PC keeps team mode working
  (the restored identity is new, ADR-033, and re-announced as the same member name).

## ADR-038 — Sync transport: TLS 1.3 PSK per key epoch, member secrets, re-keying
- **Date:** 2026-10-09 · **Status:** Accepted · **Amends:** plan §14
- **Context:** Mutual authentication and encryption derived from the team key (roadmap §B); revoking
  a PC rotates the key for the others, including PCs that are off at the time.
- **Decision:** `node:tls` with TLS 1.3 PSK (spiked on Node 24.15 / OpenSSL 3.5; (EC)DHE key
  exchange, so recorded traffic stays secret even if the key leaks later). PSK = HKDF(team key,
  "uniwake sync psk"), identity `uniwake/1/<instance id>/<epoch>`. Each PC keeps the current and the
  previous epoch's key. After the handshake both sides send `hello` with their member secret; the
  other side checks it against the member's replicated verifier and refuses revoked or unknown
  members. A connection on the previous epoch may only carry the new key: when one side has a
  newer epoch, it hands the key to the other (which proved it is a non-revoked member) and closes.
  Revocation = mark the member revoked (replicated) + new random key at epoch + 1, pushed to every
  online member; concurrent rotations converge on the higher (epoch, key hash).
- **Consequences:** A revoked PC still holding the old key cannot pass the member check, cannot
  open a current-epoch session and never receives the new key. A member that was off longer than
  two rotations must pair again (shown in pt-BR).

## ADR-039 — Team execution lease: deterministic election with fallback
- **Date:** 2026-10-09 · **Status:** Accepted · **Amends:** ADR-034; plan §7.2, §14
- **Context:** Online peers elect one executor per run; alone → execute (roadmap §B). The lease port
  (ADR-034) is synchronous.
- **Decision:** `TeamLease.shouldHandle` elects, for each occurrence, the smallest instance id among
  this PC and the non-revoked members seen (announcement or sync) in the last 60 s. The scheduler
  keeps declined occurrences in memory and asks again on each tick: when the run record arrives by
  sync the claim fails (same schedule and planned time) and the occurrence is dropped; 90 s after
  the planned time without a record, the lease answers yes for the next candidate (fallback, logged
  `atrasado`). The deterministic run UUID makes any double record one entity. In team mode, start-up
  does not replay missed runs: after the first sync round, a run inside the grace window with no
  record becomes a notice "Agendamento não executado" with "Ligar agora".
- **Alternatives:** Message-based leases with grants and expiry (more traffic and failure modes for
  two or three PCs); executing everywhere and deduplicating packets (wakes twice, logs twice).
- **Consequences:** No extra messages. A split view (A sees B, B does not see A) can at worst run a
  schedule twice, never zero times. The fallback costs 90 s only when the elected PC is on but stuck.

## ADR-040 — Conflict rules: last writer wins, deterministic duplicate merges
- **Date:** 2026-10-09 · **Status:** Accepted · **Amends:** spec FR-203; plan §14
- **Context:** Deterministic last-writer-wins with a "conflitos resolvidos" log (roadmap §B). Two
  PCs editing apart can also create duplicates the schema forbids (MAC, room name/code, tag name,
  username).
- **Decision:** Versions compare by (rev, instance id). An incoming version that loses is ignored;
  one that wins replaces the row and its log entry, keeping the remote revision. A conflict is
  recorded when the overwritten (or ignored) version differs and the sender had not acknowledged
  it (its cursor into our log is older than that version's sequence): the edits were concurrent.
  Unique-key clashes between different UUIDs are resolved by UUID order on every PC: same MAC → the
  larger UUID is deleted (tombstone); same room/tag name or room code → the larger UUID is renamed
  with " (2)"/"-2" (next free suffix); same username → "-2". A rename made while applying is a new
  local write, so it propagates; every PC computes the same result.
- **Consequences:** Convergence without coordination. Renamed rooms and merged devices are visible
  in "Conflitos resolvidos" so staff can fix names by hand.

## ADR-041 — Dev test installer as a CI artifact
- **Date:** 2026-10-09 · **Status:** Accepted · **Amends:** ADR-030; plan §12
- **Context:** The owner must test Modo equipe on two real PCs before anything reaches `main`, but
  only `v*` tags on `main` publish installers (ADR-030) and agents never tag. The CI installer job
  only builds throwaway 0.0.x installers for its smoke tests.
- **Decision:** On pushes to `dev`, the Windows installer job also builds
  `UniWake-Setup-<next>-dev.<run>.exe` (now `1.2.0-dev.N`, base in `DEV_VERSION_BASE`) with its
  SHA-256 and uploads them as the Actions artifact **UniWake-Setup-dev** (14-day retention). It is
  not a release: no tag, no GitHub Release, nothing a hub's update check can see. A hub installed
  from it is a prerelease version: it never updates to another prerelease (AC-001-05) and updates
  automatically once a stable release newer than it is published (e.g. `v1.2.0`).
- **Consequences:** The owner downloads the installer from the run's page (GitHub login needed) and
  installs it on test PCs. Bump `DEV_VERSION_BASE` when work on the next version starts.
