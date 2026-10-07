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
- **Date:** 2026-10-04 · **Status:** Accepted
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
