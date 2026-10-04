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
