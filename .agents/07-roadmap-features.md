# UniWake — Roadmap features and decisions affecting the design from day one

Read this together with `01-project-brief.md`. Versions are implemented in this order,
each one fully through the SDD loop (spec → plan → tasks → implement → validate), all on
branch `dev`:

| Version | Content |
|---|---|
| v1.0 | MVP from the brief (FR-001…FR-007) |
| v1.1 | Network discovery (FR-101) |
| v1.2 | Team mode — LAN sync between instances (section B) |
| v1.3 | UniWake Agent + remote/scheduled shutdown (section C) |
| v1.4 | Backup, restore and migration (section D) |

**Stop point:** after v1.0 is validated on `dev`, STOP, write in `specs/handoff/NEXT.md`
how I can test it on real PCs (pt-BR, step by step) and wait. When I say "continue",
proceed through v1.1 → v1.4 autonomously and stop again at the end with a final report.

## A. Design decisions that apply from v1.0 (do not postpone)
- **Deployment model:** there is NO 24/7 server. Each IT staff member (2 people,
  different shifts) runs UniWake on their own PC, which is not always on. Design the data
  layer for sync from the start: every syncable entity has a stable UUID, `updated_at`,
  `updated_by_instance`, soft-delete (tombstone), and every write goes through a
  repository that appends to a local change log.
- Each installation has a persistent `instance_id`.
- Machine-specific settings (network interface, port, bind address, paths) live in a
  separate table that is never synced or exported.
- Scheduler must be designed so a future lease/leader mechanism can decide whether this
  instance executes a run.
- The panel can still be exposed on the LAN (multi-user, roles) for occasional browser use.

## B. v1.2 — Team mode (LAN sync)
Pairing:
- "Parear com outro PC" shows a 6-digit code, valid 5 min, single use, attempt limit.
- The code authenticates a key exchange via a PAKE (SPAKE2/CPace) or equivalent proven
  scheme; the code never travels over the network.
- Result: shared team key stored encrypted on each PC (Windows DPAPI). Panel lists peers,
  renames, revokes (revocation rotates the key for remaining peers).

Sync:
- Discovery by periodic UDP announcement (team id hash + latest version, no data) plus
  manual peer address (hostname/IP) for other subnets.
- Transport: TCP, mutual authentication and encryption derived from the team key
  (TLS-PSK or Noise). Peer asks "changes since N"; applied in one DB transaction;
  idempotent.
- Conflicts: deterministic last-writer-wins (logical clock, instance id); losing values
  shown in a "conflitos resolvidos" log.
- Tombstones; change-log compaction after all peers acknowledged.
- Installer adds a Windows Firewall inbound rule for the sync port (private/domain only).
- Panel: sync status (peers online/offline, last sync, pending changes), "Sincronizar agora".
- Schedules: online peers elect one executor per run (lease); alone → execute. Execution
  records synced. On startup, offer (not auto-run) wakes missed in the last X minutes.
- README pt-BR: setup for 2 PCs; BIOS "Power On by RTC" tip for unattended mornings.

## C. v1.3 — UniWake Agent and shutdown
- Architect writes an ADR comparing native remote shutdown (WMI/RPC/WinRM with stored
  credentials), local Task Scheduler/GPO, and a lightweight agent. Preferred: agent.
- Agent: Windows service on each target, installed and enrolled by `prepare-target.ps1`,
  outbound authenticated WebSocket to whichever paired team instance is online (team
  key / per-device token, revocable), no inbound ports on targets, auto-updates with
  the app, reports logged-in user and idle time.
- Commands: shutdown, restart, cancel pending shutdown, show message. Targets: device,
  room, tag, all, with the same scoping guarantees and confirmations as wake.
- Scheduler action types: wake / shutdown / restart.
- pt-BR on-screen warning with countdown; skip/postpone if a user was active in the last
  X minutes (per schedule); soft vs forced; tags excluded from automatic shutdown
  (e.g., "servidor", "professor"); warn if an instance's own PC is a shutdown target.
- Optional fallback for devices without agent: native shutdown if credentials configured,
  clearly marked in the UI.
- Debug: agent offline, user active, Windows Update in progress, token revoked.

## D. v1.4 — Backup, restore and migration
- Page "Backup e restauração" (admin). Export one `.uniwake` file (zip: versioned JSON +
  manifest with app/schema version, date, checksum), selectable sections.
- Secrets only with an export password → AES-256-GCM, key via scrypt/argon2; without
  password, secrets omitted and UI explains what must be redone.
- Machine-specific settings never exported.
- Import with preview (create/update/skip/conflicts), merge or replace, automatic backup
  before import with one-click undo, schema migrations for older files, reject newer.
- Scheduled automatic backups (daily, keep N, configurable folder/network share).
- CLI: `--export <file>` / `--import <file>`.
- Imported copy starts in standby (no schedules, no agent connections) until activated.
