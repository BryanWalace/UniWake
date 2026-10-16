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
- **Addendum (2026-10-09, final review):** with only two PCs nobody else could tell the removed PC.
  So a revoked member that proves itself with its own secret over an old-key session receives
  exactly `error: revoked` (no data, no key) and leaves the team with a "team_revoked" notice.

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
  `UniWake-Setup-<next>-dev.<run>.exe` (now `1.5.0-dev.N`, base in `DEV_VERSION_BASE`; bumped from 1.4.0 on 2026-10-16 — a hub on the published 1.4.0 must see the test build as newer) with its
  SHA-256 and uploads them as the Actions artifact **UniWake-Setup-dev** (14-day retention). It is
  not a release: no tag, no GitHub Release, nothing a hub's update check can see. A hub installed
  from it is a prerelease version: it never updates to another prerelease (AC-001-05) and updates
  automatically once a stable release newer than it is published (e.g. `v1.2.0`).
- **Consequences:** The owner downloads the installer from the run's page (GitHub login needed) and
  installs it on test PCs. Bump `DEV_VERSION_BASE` when work on the next version starts.

## ADR-042 — Remote shutdown by pull: Windows scheduled tasks, no installed program
- **Date:** 2026-10-11 · **Status:** Accepted (owner decision, 2026-10-11) · **Supersedes:**
  `.agents/07-roadmap-features.md` §C "UniWake Agent" Windows service with outbound WebSocket ·
  **Amends:** constitution §2.6; spec §11 RM-2 (→ §6b)
- **Context:** Lab PCs use local accounts (workgroup). Nothing downloaded may be installed on them:
  only PowerShell 5.1, Task Scheduler, `shutdown.exe`, `quser`, WMI/CIM and .NET Framework. The
  hub is on only part of the day (owner: wake 17:40, hub off 21:20, labs off 22:40).
- **Decision:** The preparation command (already SHA-256 pinned) downloads two PowerShell scripts from the hub
  (hashes checked against the signed enrollment answer, ADR-044) into
  `C:\ProgramData\UniWake\agent\` and registers three tasks: **"UniWake"** (SYSTEM, at startup +
  every 1 min, the minimum Task Scheduler repetition; `MultipleInstances=IgnoreNew`,
  `ExecutionTimeLimit=PT2H` so a warning with postpones fits in one run, runs on battery),
  **"UniWake Despertar"** (SYSTEM, one-time triggers, `WakeToRun`, ADR-045) and **"UniWake Aviso"**
  (Users, interactive, ADR-046). The tasks make **outbound HTTP calls** to the hub's agent listener
  (47101); no port is opened on lab PCs. The machine keeps the shutdown agenda of the next days and
  executes it alone; reports wait in a local queue until a hub answers.
- **Folder hardening:** `C:\ProgramData` lets Users create folders, so a user could pre-create
  `C:\ProgramData\UniWake` and plant a script that SYSTEM would run. The preparation sets owner =
  Administrators, disables inheritance and replaces the ACL (Administrators, SYSTEM full; Users read
  on the warning script only; ADR-046 for the IPC folders), and re-checks it on every run; the
  agent refuses to run (and reports it) if its folder's owner or ACL changed.
- **Alternatives rejected:** hub-side `shutdown /m \\PC` or WMI/WinRM (`Win32_OperatingSystem.
  Win32Shutdown`): need the same local administrator password on every PC,
  `LocalAccountTokenFilterPolicy=1` for remote admin with local accounts, and SMB 445/RPC/WinRM open
  inbound — a large attack surface, and the hub must be on at shutdown time. A Windows service
  (roadmap §C): it is an installed program (forbidden) and needs an installer per PC.
- **Consequences:** Works with the hub off. Up to ~1 min latency for manual orders. One
  `powershell.exe` start per minute per PC (≈ 0.3–0.8 s CPU, NFR-302). Machines prepared with v1.2
  keep waking; shutdown needs the new command once (FR-301.2). Freezing software can erase the tasks
  (ADR-047).

## ADR-043 — Agent channel: one check-in route, per-machine token, limits
- **Date:** 2026-10-11 · **Status:** Accepted · **Amends:** constitution §2.6, §5 (no real power
  changes in tests), §6.1, new §6.3a; plan §6.2 ("exactly three routes" → five)
- **Decision:**
  - Routes on the agent listener: `POST /agent/v1/checkin` (Bearer agent token) and
    `GET /agent/v1/scripts/:name` (`uniwake-agent.ps1`, `uniwake-aviso.ps1`; public bytes, integrity
    from the signed hashes, ADR-044), plus
    the existing health, enroll and prepare-script routes. `/agent/enroll` gains an optional
    `agent: {protocol: 1}` request field; with it, the answer adds `agentToken`, `hubKey`, the
    script hashes and the first agenda, and is signed over the script's nonce. Older scripts are unaffected.
  - **Check-in request:** `{protocol, nonce (16 random bytes), agentVersion, bootTime, clock,
    freeze {product, state, persistent}, power {sleepAfterMinutes, wakeTimers}, session {loggedOn,
    sessions}, reports[] (≤ 50, machine-made UUIDs), ackedOrders[]}` — **no user names** (owner,
    LGPD: the agent drops them while parsing `quser`). **Answer:** `{serverTime, orders[], agenda
    {version, window {from, to}, items[], nextWakes[]}, hubs[], scripts {name: {version, sha256}},
    ackReports[], newToken?}`, signed (ADR-044).
  - **Token:** 32 random bytes (base64url), only SHA-256 stored, compared in constant time. One
    active token per machine plus at most one pending (rotation: old valid until the new one is
    used). Rotation every 30 days, skipped while the machine reports "congelada" without a
    persistent area. Revocation per device ("Revogar desligamento remoto"); re-preparing issues a new
    token (enrollment is by MAC, upsert) and invalidates the old one.
  - **Storage on the PC:** a file readable by Administrators and SYSTEM only. DPAPI was considered
    and rejected: any local administrator can run code as SYSTEM and unprotect it, and a frozen
    machine would lose a DPAPI re-protection made after freezing.
  - **Limits:** 6 check-ins/min per token (1/min normal, 2/min while a warning is running, plus the
    pre-shutdown report), 60/min per source IP, body ≤ 64 KB, Zod-validated, reports deduplicated
    by UUID (insert-only); 401 without detail for missing/unknown/revoked tokens; failures logged
    without the token.
- **Threats accepted:** the token travels in clear HTTP on the LAN (same as the enrollment token
  today). A sniffed token lets an attacker read that machine's agenda, post false reports for it,
  or take over its rotation (the real machine then shows "perdido" — visible, fixed by
  re-preparing). It never lets anyone **order** a shutdown: orders only come from signed answers.
- **Consequences:** Hub load ≈ N/60 requests/s (500 PCs ≈ 8.3/s), agenda cached per device and
  invalidated by schedule/exception/device/settings changes.

## ADR-044 — Integrity of agent answers: hub signatures now, TLS stays roadmap (RM-5)
- **Date:** 2026-10-11 · **Status:** Accepted · **Decides:** RM-5 for v1.3 (TLS stays roadmap)
- **Context:** In v1.3 an answer from the hub can turn a lab off. Over plain HTTP, anyone able to
  spoof the hub on the LAN (ARP/DNS spoofing) could shut down every lab, or replay an old order.
  Confidentiality of agendas is of low value; authenticity and freshness are what matter.
- **Decision:**
  - Each hub has an **RSA-3072** signing key pair, generated on first start of v1.3, private key
    protected with DPAPI LocalMachine (ADR-037). The public key travels as JWK members `{n, e}`
    (base64url); key id = its RFC 7638 thumbprint (SHA-256 of `{"e":…,"kty":"RSA","n":…}`,
    base64url), easy to compute in PowerShell without ASN.1.
  - Every check-in answer is signed: `RSASSA-PKCS1-v1_5 / SHA-256` over
    `"uniwake-agent-v1\n" + nonce + "\n" + body bytes`, sent in `X-UniWake-Key` and
    `X-UniWake-Signature`. The agent reads the exact body bytes (`HttpWebRequest`, not the decoded
    string of `Invoke-WebRequest`), verifies with .NET Framework `RSA` (`RSACng` with
    `HashAlgorithmName.SHA256` / `RSASignaturePadding.Pkcs1`, .NET ≥ 4.6, present on supported
    Windows 10/11), checks the nonce it sent and rejects anything else (and reports it).
  - **Trust anchor:** the panel's copied command gains `-HubKeyId <id>`; the preparation accepts
    the `hubKey` from the enrollment answer only if its id matches. The command is copied by staff
    from the panel, like the script hash today.
  - **Team mode:** answers list the team hubs `{instanceId, urls, keyId, publicKey}` with the team
    key epoch; the agent trusts a key only if it came in a list signed by a key it already trusts
    and accepts lists only with epoch ≥ its current one. Revoking a member bumps the epoch (ADR-038)
    and drops its key.
  - **Scripts (preparation and self-update):** signed answers carry `{version, sha256}` per
    script; the preparation and the agent download them from `/agent/v1/scripts/`, check the hash
    and replace them atomically (write temp, verify, move). `prepare-target.ps1` stays one static
    file pinned by the copied command.
  - Signing key is in backups; restoring on another PC cannot decrypt the DPAPI blob, so machines
    must be prepared again — v1.4's portable export must carry the key (noted for v1.4).
- **Alternatives:** TLS on 47101 (RM-5): PowerShell 5.1 needs a certificate validation callback
  for a self-signed certificate (`ServicePointManager.ServerCertificateValidationCallback` with a
  script block is known to be fragile across threads) or a certificate imported into the machine
  store; it also needs certificate rotation. Signatures give the needed authenticity and freshness
  with built-in APIs. TLS remains RM-5 for confidentiality.
- **Spike (M16-T01), done 2026-10-11:** a Node RSA-3072 signature over a UTF-8 body verifies in
  Windows PowerShell 5.1 (Windows 11, .NET Framework 4.8) with `RSACng.ImportParameters` from
  `{n, e}` + `VerifyData(…, SHA256, Pkcs1)`; a changed body, another nonce, a malformed signature
  or key all give `false`; the RFC 7638 key id matches Node's. Fixture
  `packages/shared/fixtures/agent/signature.json` (throwaway key) is checked by Vitest and by
  Pester (`scripts/tests/agent-signature.Tests.ps1`, also on the CI Windows runner). Windows 10
  lab PCs ship .NET Framework 4.8 too (RSACng needs ≥ 4.6).
- **Residual risk:** a revoked team member that still has its private key could sign lists for
  machines that have not yet checked in with another hub (window ≤ one check-in while any good hub
  is on). Team members are staff PCs; accepted.

## ADR-045 — Local agenda: explicit window, clock offset, wake task, boot and sleep rules
- **Date:** 2026-10-11 · **Status:** Accepted (window and late-wake report per owner answers Q-3,
  Q-4, Q-9 of 2026-10-11)
- **Decision:**
  - **Items** carry the shutdown instant T in UTC (the hub resolves timezone/DST and holidays),
    warning, postpone policy and a deterministic occurrence UUID (v5 of schedule uuid + planned
    instant, ADR-031) so every team hub and every machine name the same occurrence. The message is
    the global setting, sent once per answer.
  - **Clock:** at each check-in the agent stores `offset = serverTime − local midpoint` and uses
    `local + offset`. Offsets > 2 min are reported ("relógio adiantado/atrasado X min").
  - **Window (Q-4):** the hub sends `window {from, to}` with to = generation time + 14 days
    (constant `AGENDA_DAYS = 14`) and from = generation time − 6 h (`AGENDA_LOOKBACK_MS`, M16-T05:
    a PC checking in during a warning, postpone or late wake must still see that item), and the concrete instants inside it, already without
    holidays, vacations, paused days and exclusions. The machine runs only listed items with T in
    the window; there is no other validity rule, and no rule is ever re-evaluated on the machine.
    After `to`, nothing runs until a hub sends a new window.
  - **Wake:** `WakeToRun` is a task setting, not a trigger setting, so the 1-minute task must
    **not** have it (it would wake the PC every minute). "UniWake Despertar" holds one-time
    triggers at T − warning − 1 min for the items, is rewritten when the agenda changes, and its
    action just runs the agent. It depends on the power plan option "Permitir temporizadores de
    ativação" (`powercfg` alias `RTCWAKE` under `SUB_SLEEP`, GUID
    `bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d`; 0 disable, 1 enable, 2 important only). The preparation
    sets AC = 1 on the active scheme when it is not 1 already (owner, Q-3; idempotent, shown in the
    summary): `powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1`, then
    `/SETACTIVE SCHEME_CURRENT`. It **only reads** the AC sleep timeout (alias `STANDBYIDLE`, never
    changed) and reports "Suspensão: após N min" / "nunca". `powercfg /QUERY` output is localized
    (pt-BR Windows prints Portuguese labels), so values are read by position of the hex indexes or
    from CIM `root\cimv2\power`. M18-T05: the hex values are read by position (last two = AC, DC);
    checked read-only on the developer's Windows 11 pt-BR, whose labels ("Índice de Configurações de
    Correntes Alternadas Atuais") differ from the English ones; other builds **não verificado**.
    The default value varies by plan and vendor (**não verificado**); value 2 likely blocks task
    wake timers (**não verificado**); behaviour on Modern Standby (S0) PCs **não verificado**. GPOs
    or firmware can still block wake timers → the late-wake rule.
  - **Rules at each run, in order:** (1) item already done/expired/cancelled → skip; (2) last boot
    (`Win32_OperatingSystem.LastBootUpTime`) after T → "máquina estava desligada", never run;
    (3) heartbeat gap > 3 min covering T (asleep/hibernated) → run only if now < next wake and
    now − T ≤ 60 min (Q-9), report "estava em suspensão"; otherwise report "pulado: acordou {n} min
    após o horário"; (4) now ≥ T − warning → start the warning
    flow (ADR-046). A heartbeat file (last run time) is written every run.
  - **Storage:** `agenda.json`, `state.json` (executed occurrence/order ids for 48 h, offset, hub
    list), `reports.jsonl` (≤ 500 lines, oldest dropped and counted) in the agent folder, or in the
    persistent path on frozen machines (ADR-047).
- **Consequences:** The same logic is specified once and tested twice: the hub's agenda generator
  (Vitest) and the agent's executor (Pester) share JSON contract fixtures under
  `packages/shared/fixtures/agent/`.

## ADR-046 — Warning with "Adiar": a task in the user's session and a file channel
- **Date:** 2026-10-11 · **Status:** Accepted
- **Context:** The native `shutdown /t` warning has no "Adiar". The SYSTEM task runs in session 0,
  which cannot show windows to the user. Only built-in Windows parts may be used.
- **Decision:**
  - Task **"UniWake Aviso"**: principal = group `BUILTIN\Users` (SID S-1-5-32-545), interactive,
    triggers: at logon (shows a warning already in progress) and on demand. The SYSTEM agent starts
    it with `Start-ScheduledTask` when a warning begins. Action: `powershell.exe -NoProfile
    -WindowStyle Hidden -ExecutionPolicy Bypass -File …\uniwake-aviso.ps1` (a brief console flash is
    accepted; `conhost.exe --headless` is undocumented, **não verificado**). The window is
    WinForms (.NET Framework): message, T, countdown, "Adiar 15 min" while allowed, always on top,
    no close-to-cancel.
  - That a group-principal task started on demand runs in each interactive member's session (also
    with fast user switching) is **não verificado** → spike M18-T01 on a test PC; fallback below.
    M18-T01 (2026-10-11): not run on the developer's PC — it needs a real scheduled task and an
    interactive session on a lab-like PC, a change the agent does not make on the owner's machine
    unasked. Moved to the owner's checklist (V3-T02, step "janela de aviso"). Until then the design
    does not depend on it: the agent waits 20 s for the window's heartbeat file and otherwise uses
    the native `shutdown /t` warning (reported "aviso nativo (sem adiar)"), so a failure costs only
    the "Adiar" button.
  - **Channel:** `C:\ProgramData\UniWake\ui\request\` (SYSTEM writes, Users read) holds
    `{requestId, T, postponesLeft, postponeMinutes, message}`; `ui\response\` (Users may create
    files, SYSTEM reads) receives `{requestId, action: "postpone"}`. SYSTEM **never writes or
    deletes in the Users-writable folder** (deleting through a user-planted junction/hard link is a
    classic privilege escalation), skips reparse points, reads ≤ 4 KB, accepts only the current
    requestId and enforces the count/length itself; the user-side script deletes its own files.
  - **Fallback:** the task does not start or the window does not appear (no heartbeat file from
    the UI within 20 s) → `shutdown /s /t <aviso> /c "<mensagem>"` (native warning, no postpone),
    reported "aviso nativo (sem adiar)". No user logged on (`quser`; fallback
    `Win32_ComputerSystem.UserName`) → shutdown with `/t 30`, no warning window.
  - **Forced close:** `/t > 0` implies `/f` (Microsoft Learn, `shutdown`): unsaved work is lost; the
    message says so.
- **Alternatives:** `msg.exe` / WTS messages (no button result); toast notifications from SYSTEM
  (need an AppUserModelID registration; actions need an app to receive them); named pipes (needs a
  long-running process in the user session anyway; files are simpler to test with mocks).

## ADR-047 — Freezing software: detection, persistent area, lost-agent heuristic
- **Date:** 2026-10-11 · **Status:** Accepted
- **Context:** Freezing products restore the system disk at restart, erasing tasks, scripts,
  tokens, agendas and reports created while frozen. The owner's institution does not use them;
  others do. Commands and exit codes must not be invented.
- **Detection table** (preparation + every check-in; every external call wrapped and mocked in tests):

  | Product | Presence | Frozen/thawed state | Verification |
  |---|---|---|---|
  | Deep Freeze (Faronics) | services/processes `DFServ` / `DfServEx`, `FrzState2k.exe` (typically under `…\Faronics\Deep Freeze\Install C-0\`) | `DFC.exe get /ISFROZEN`: exit 0 = thawed, 1 = frozen; `DFC.exe` found with `Get-Command` and the install folders | Third-party sources only (FileWave KB, BigFix forum, ProVal docs); DFC.exe location and whether `get /ISFROZEN` needs a password: **não verificado** |
  | Windows UWF | WMI class `UWF_Filter` in `root\standardcimv2\embedded` exists | `CurrentEnabled` (now) / `NextEnabled` (after restart) | Microsoft Learn (official). Only on Enterprise/Education/IoT editions |
  | Reboot Restore Rx (Horizon DataSys) | processes `shield.exe`, `shdserv.exe`, `shdtray.exe` (also `shdcmd.exe`, `shdsync.exe` listed) | none known without its own tools | Presence: third-party lists; state: **não verificado** → "detectado (estado não verificado)" |
  | Shadow Defender | tray `DefenderDaemon.exe`; service running `Service.exe` under a hex-number name | none known | Presence: third-party lists; state: **não verificado** |

  Any error or unknown output → "não verificado". Product names are reported, never paths with
  user data.
- **Preparation:** frozen → "Desligamento remoto: ATENÇÃO" with: "A máquina está congelada
  (<produto>). Descongele (Thawed / modo manutenção), execute o comando de novo e congele outra
  vez." Enrollment and the other steps run normally.
- **Persistent area:** `-PersistentPath <dir>` (e.g. a Deep Freeze ThawSpace `T:\UniWake`;
  ThawSpace drive letters are configured per site and cannot be detected reliably, so the path is a
  parameter, also settable in the panel's command generator). With UWF enabled, the preparation can
  add file exclusions for the agent's data folder (`uwfmgr.exe file add-exclusion <path>`, official;
  takes effect after restart — Microsoft Learn) when `-UwfExclude` is given. Exclusions for the
  Task Scheduler store and registry: **não verificado**, so the tasks themselves must be created
  while UWF is disabled.
- **Limitation (documented in help and README):** without a persistent area, the scheduled shutdown
  depends on the machine having talked to the hub **after its last restart** (the agenda is always
  fetched at start-up). Owner-like routines work: the hub wakes the labs, they check in, then shut
  down at night even with the hub off. Reports created while the hub was off are lost at restart;
  the hub infers "provavelmente desligou (sem relatório)" from the next boot time and the monitor.
  Token rotation is skipped on such machines (ADR-043). A self-updated agent reverts at restart and
  updates again — the hub accepts any agent with protocol 1.
- **Lost heuristic (owner, Q-5):** a machine with remote shutdown that has answered ping/TCP
  without interruption for 15 minutes (from its last offline→online transition in the monitor)
  and has not checked in since it came online → "Desligamento remoto perdido: provável
  congelamento ou tarefa removida" + help link; "Saúde do sistema" shows the count. Cleared by the
  next check-in.
- **Roadmap (RM-7):** using the products' own features (e.g. Deep Freeze scheduled
  shutdown/maintenance) — needs their consoles/licences; not in v1.3.

## ADR-048 — Shutdown in team mode: replicated orders and reports, no lease
- **Date:** 2026-10-11 · **Status:** Accepted · **Amends:** ADR-034/039 (scope)
- **Decision:**
  - Schedules with `action = 'shutdown'` replicate like other schedules; the scheduler (and the
    `TeamLease`) handles only `action = 'wake'`. A shutdown occurrence is executed **by each
    machine** from its own agenda, so there is nothing to elect: every hub computes the same agenda
    from replicated data; a machine may check in with any hub of its list.
  - New replicated entities: `power_order` (manual order per device: action, warning, policy,
    state, created by) and `power_report` (insert-only, UUID made by the machine, so the same report
    sent to two hubs is one entity). Order state changes are LWW; the agent ignores an order id it
    already executed (kept 48 h), so delivery by two hubs before sync is harmless.
  - `device_agent` replicated entity (1:1 with device): token hash(es), issued/rotated/revoked
    times, agent version, freeze state, last check-in written **at most every 30 min** (exact time, to limit change-log
    churn; rounding down made machines that talk to another hub look "perdido", M17-R). Each hub also keeps an exact local `agent_seen_at` for the "perdido" heuristic and
    the live job view.
  - Hub signing public keys travel in `team_members`; private keys never leave their PC.
  - **Mixed versions are not allowed to sync (Phase 9 finding, CRITICAL):** a v1.2 hub applying a
    schedule snapshot with `action: "shutdown"` would ignore the unknown field, store a **wake**
    schedule (waking the labs at shutdown time) and log its own version back to the team. So v1.3
    raises the team `PROTOCOL_VERSION` to 2: v1.2 and v1.3 PCs reject each other's hello and
    announcements; the v1.3 side shows the peer as "Versão diferente — atualize o UniWake neste
    PC" (it still parses the version field of old announcements to say so). Automatic updates in the
    nightly window normally bring every team PC to v1.3 the same night.
  - Snapshots of `schedule` (action, warning, postpone, excluded tags) and `device` (never
    scheduled shutdown) gain fields, so migration 006 resets their `rev` to 0 and the start-up
    baseline logs them again with the new shape (identical content on every PC → no conflict
    record).
- **Consequences:** Shutdown at 22:40 does not need any hub on. Reports reach every hub through
  sync. A brief agenda flip-flop between two hubs with unsynced data is harmless (newest version
  wins at the machine; both converge).

## ADR-049 — `.uniwake` file: gzip-compressed JSON of sync snapshots
- **Date:** 2026-10-12 · **Status:** Accepted (Architect assumption A-1, owner may override)
- **Context:** roadmap §D suggested a zip with versioned JSON and a manifest. A zip needs a library
  or a hand-written writer/reader; NFR-403 forbids new runtime dependencies.
- **Decision:**
  - A `.uniwake` file is `gzip(JSON)` (`node:zlib`). Document:
    `{ "uniwake": "export", "format": 1, "manifest": {...}, "data": {...}, "secrets": null | {...} }`.
  - `manifest`: app version, schema version (latest migration), created at, source PC name and
    instance id, sections, item counts per entity, `secrets: boolean`, `checksum` = SHA-256 of the
    canonical JSON of `data` (keys sorted).
  - `data`: per section, the same entity snapshots team sync uses (`ChangeEntry`: entity, UUID,
    rev, instance, payload) — one serializer for sync and export, references as UUIDs, no local
    ids, no machine-local columns.
  - Sections map to entities: Cadastro → room, tag, device; Agendamentos → schedule,
    schedule_exception, scheduler_pause; Configurações gerais → setting (shared scope only);
    Usuários → user (secret); Desligamento remoto → device_agent (secret) + hub key (secret);
    Histórico → schedule_run, power_job, power_order, power_report.
  - `format` is bumped when the document shape changes; readers convert older formats step by
    step and refuse newer ones. The schema version is informative (snapshots are versioned by
    `format`). Size limit 50 MB compressed and 200 MB uncompressed (zip-bomb guard), checked while
    inflating.
- **Consequences:** Windows cannot open the file directly (it is not a zip); that is acceptable
  for a backup format and avoids users editing it. Export cost is the sync snapshot cost.

## ADR-050 — Secrets in exports: argon2id + AES-256-GCM, only with a password
- **Date:** 2026-10-12 · **Status:** Accepted (assumption A-2)
- **Decision:**
  - Secret sections (Usuários: password hashes; Desligamento remoto: agent token hashes and the
    hub signing private key) are exported only with a password (≥ 10 characters). They go in
    `secrets = { kdf: { alg: "argon2id", m: 65536, t: 3, p: 1, salt }, iv, tag, ciphertext }`,
    ciphertext = AES-256-GCM of the JSON of those sections, **AAD = the manifest checksum**, so the
    secret part cannot be moved to another file. Key = argon2id(password, salt, 32 bytes) with
    stronger parameters than login (offline attack on a stolen file).
  - The hub private key is unwrapped from DPAPI only in memory to be encrypted, and re-wrapped
    with DPAPI on import. Password never stored, logged, audited or returned.
  - Wrong password and changed bytes give the same error (no oracle).
- **Consequences:** a file without password is safe to keep on a share (no hashes, no keys); with
  password it is as safe as the password.

## ADR-051 — Import: preview by rollback, merge or replace, standby, not in a team
- **Date:** 2026-10-12 · **Status:** Accepted (assumptions A-3, A-4)
- **Decision:**
  - **Preview** runs the import inside a transaction that is always rolled back and reports the
    applier's counts (created/updated/unchanged) and conflicts (duplicate names/MACs renamed or
    kept, orphans dropped), exactly what the real import will do.
  - **Mesclar** = the team-sync applier (`applyRemote`): match by UUID, newer `(rev, instance)`
    wins, no deletes. **Substituir** covers Cadastro, Agendamentos, Desligamento remoto and Histórico
    together (plus Usuários/Configurações gerais when present): rows whose UUID is not in the file
    are deleted, the change-log rows of those entities are dropped (so every item of the file wins;
    tombstones are unnecessary outside a team), then the applier updates matching rows **in place**
    (local ids, and so device status, events and test results, survive; deleting and re-inserting
    would cascade them away, M22 finding). Needs Cadastro and Agendamentos in the file.
  - Always one transaction (NFR-402), after a `pre-import` database backup; "Desfazer importação"
    restores that backup through the FR-014 restore (restart).
  - **Hub key:** imported only when this PC has no prepared machine of its own (no agent token);
    otherwise kept and the preview says the lab PCs prepared with the other PC need the command
    again.
  - **Team:** import refused while `team` state is joined (replace would erase the team's data
    everywhere; merge would inject foreign revisions). Export allowed.
  - **Standby** (`system_state` key `standby`): set by an import with Agendamentos or Desligamento
    remoto. The scheduler treats it like a pause (without touching the imported pause state), the
    agent check-in route answers 503 `AGENT_STANDBY` (the agent keeps its stored agenda and tries
    its next hub), the panel shows a banner; "Ativar este UniWake" (admin, typed confirmation,
    audited) clears it. Joining a team also clears it (Phase 11, D11-03).
- **Consequences:** moving to a new PC is: export with password → import (Substituir) on the new PC
  → check → turn off the old PC → activate. Two live copies never act at once by accident.

## ADR-052 — Automatic exports and command line
- **Date:** 2026-10-12 · **Status:** Accepted (assumption A-5)
- **Decision:**
  - Machine settings `export.autoEnabled` (false), `export.autoFolder`, `export.autoTime` (02:45,
    after the 02:30 backup and before the 03:00 update window), `export.autoKeep` (14). Files
    `UniWake-<PC>-<AAAA-MM-DD>.uniwake`, every non-secret section except Histórico; written to a
    temporary name then renamed; only files matching that pattern are rotated. Failures are logged
    and shown as a "Saúde do sistema" warning until the next success.
  - No stored password: automatic files never contain secrets.
  - CLI in `main.ts`: `--export <file> [--sections …] [--password-env VAR]` opens the database
    read-only alongside a running service; `--import <file> --mode merge|replace
    [--password-env VAR]` first probes `http://127.0.0.1:<panelPort>/api/health` and refuses (exit
    3) if a hub answers. The password comes from an environment variable so it never appears in
    the process list or shell history. Exit codes: 0, 2 usage, 3 refused, 4 wrong password or
    damaged file.
- **Consequences:** a nightly copy on a file server covers a dead PC (users and lab-PC preparation
  redone); a full migration still uses a password export.

## ADR-053 — Scheduled shutdown also pushed by the hub; one run id, one execution
- **Date:** 2026-10-15 · **Status:** Accepted · **Amends:** ADR-048 ("no lease", agenda only)
- **Context:** field v1.4.0: scheduled shutdowns never ran; the agent agenda was empty and, by
  design, nothing else delivered them and nothing was logged. Manual shutdown (orders) works.
- **Decision:**
  - The scheduler also handles `action = 'shutdown'`, through the same lease as wakes: at
    `T − warningMinutes − 1 min` (the start of the warning, minus one check-in period) the winning
    hub calls the **manual-shutdown service** with the schedule's policy, its target, its excluded
    tags and without machines flagged "Nunca desligar por agendamento". No second implementation.
  - The job's UUID is the occurrence UUID (v5 of schedule UUID + T, as the agenda item); orders
    are v5 of occurrence + device UUID, carry `occurrence`, and expire at T + 60 min (late-wake
    rule). A second hub or a restart inserting the same job is a no-op.
  - The agent treats the occurrence UUID as the run id: executing an order with `occurrence` marks
    it handled, and an agenda item already handled (or an order for a handled occurrence) is
    ignored. Reports carry both ids; `order` non-null means the push path ran it.
  - The occurrence is due for pushing from `T − warning − 1 min` until `T + 60 min` (a hub that
    starts late still pushes; agents that already ran it ignore it).
  - Every fire is a `schedule_runs` row (status `executado`, detail with counts), so it shows in
    the schedule history like a wake.
- **Consequences:** a scheduled shutdown needs either path to work; double execution is impossible
  by construction; old 1.3 agents get the new script by self-update at their next check-in.

## ADR-054 — Reconciliation of scheduled shutdowns
- **Date:** 2026-10-15 · **Status:** Accepted
- **Decision:** at `T + 10 min` the hub that pushed classifies each targeted machine from replicated
  reports/orders and its local sightings: desligou (report done, or order executed and monitor
  offline) + path; adiado — usuário ativo (report or order with postpones and still in the
  window); sem agente (not ready: needs preparation/revoked/lost); agenda desatualizada (the
  agenda version last served to it is not the current one and no order reached it); sem resposta
  (no check-in since before the warning); ainda ligado (online, none of the above). One retry
  order (v5 of occurrence + device + "retry") for "ainda ligado". The counts are written to the
  run's detail and logged; the per-machine view is computed on demand.

## ADR-055 — Online status from agent, ICMP, TCP and the neighbor table; IP follows the MAC
- **Date:** 2026-10-15 · **Status:** Accepted
- **Decision:**
  - Sweep signals: agent check-in ≤ 2 min (from `agent_seen`), ICMP, TCP ports, neighbor entry for
    the MAC in state Reachable (Stale entries outlive a shutdown, so they never count). Any positive
    → alive with `via` = agent|icmp|tcp|arp. `monitor.offlineAfter` consecutive all-negative sweeps
    → offline (unchanged rule).
  - Address per sweep: last check-in source IP (≤ 10 min) → neighbor IP for the MAC → DNS → stored
    IP; a different IP is stored with an `ip_changed` event naming its source.
  - ICMP helper: per-address try/catch, always echoes the request id; the hub drops empty
    addresses and resolves a batch at once when the helper reports an error (no deadline wait).
  - `device_state` gains `seen_via` and `ip_source` (migration 008, machine-local).

## ADR-056 — Diagnostics, duplicate notice and "Testar agendamento"
- **Date:** 2026-10-15 · **Status:** Accepted
- **Decision:**
  - `agent_seen` records the agenda version and item count last served (migration 008).
  - A per-device explanation endpoint evaluates each shutdown schedule with the agenda's own
    resolver and returns included/reason.
  - Enrollment creating a device whose hostname another device already has records a
    `possible_duplicate` notice.
  - "Testar agendamento": machine-local one-off items (`power_tests`: device, T, policy, uuid);
    the agenda builder adds them for that device and the scheduler pushes and reconciles them like
    schedule occurrences. Machine-local on purpose (a test from the hub the PC talks to).
    Implementation (M27-T02): the test's random UUID is the run id on both paths (agenda item
    occurrence and pushed job UUID). T is rounded up to the minute. The warning is the default
    one, capped at N − 1 min so the order can arrive before it starts. Postpone follows the
    settings. Holidays, the pause and exclusions do not apply (an explicit test), but a machine
    without a ready agent or marked "Nunca desligar por agendamento" is refused with a clear
    message. The reconciliation counts go to `power_reconciled`. The device page computes the
    result on demand with the same classifier, and the history names it "Testar agendamento
    (máquina)".
  - Info logs for fires, agenda changes, agenda served with a new version, pushes, reconciliations
    (only on change, so 500 PCs do not flood the log).

## ADR-057 — The installer trusts the service state, not the WinSW stop exit code
- **Date:** 2026-10-16 · **Status:** Accepted
- **Context:** CI run 38840416400 (installer smoke, upgrade 0.0.1 → 0.0.2) aborted with
  "O serviço UniWake não parou". The WinSW log showed the hub stopped cleanly on Ctrl+C in 22 ms,
  then WinSW 2.12 threw `Win32Exception: The handle is invalid` in `ProcessHelper.GetChildren`
  (it reads the start time of the process that just exited) and `stopwait` returned -1. The
  service had stopped; the installer still refused to upgrade. This is a race in WinSW, so it can
  happen on a real hub PC during a manual upgrade.
- **Decision:** when `stopwait` fails, `PrepareToInstall` waits up to 30 s for the service
  manager to report the service as `Stopped` (`Get-Service … WaitForStatus`) and only fails if it
  never does. WinSW 2.12 stays (ADR-021); the in-app updater does not run the installer and is
  not affected.
- **Consequences:** an upgrade no longer depends on a WinSW timing race. A service that really
  keeps running still blocks the upgrade with the same message after 30 s.
