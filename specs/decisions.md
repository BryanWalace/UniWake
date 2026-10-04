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
