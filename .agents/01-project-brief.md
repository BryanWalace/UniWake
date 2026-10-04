# UniWake — Project Brief (shared context for all roles)

Read this file completely before acting. It is the source of truth for intent.
The `specs/` folder becomes the source of truth for decisions once created.

## 1. Product
**UniWake** powers on computers of a college (labs, offices, classrooms) via Wake-on-LAN,
monitors whether they are on, and schedules automatic power-on. The operator is the IT team
(2 people, different shifts). Environment: Windows 10/11 targets, Windows controller PC,
some targets possibly in VLANs different from the controller.

Repository: https://github.com/BryanWalace/UniWake (owner `BryanWalace`, repo `UniWake`).
UI language: **pt-BR**. Code, specs, commits: English.

## 2. Autonomy rules (apply to every role)
- Full autonomy. Never wait for human approval between steps or phases.
- Decide, record the decision as an ADR in `specs/decisions.md`, continue.
- Only stop for things physically impossible without the human (credentials, repo access,
  hardware). Write those in `specs/handoff/BLOCKERS.md` and continue with everything else.
- Every role is encouraged to propose improvements beyond this brief (see section 7).
- Never send real magic packets or scan real networks in automated tests. Use an injectable
  network layer with mocks, plus an app-level "dry-run" mode.

## 3. Core concept: Rooms and Tags (first-class)
The operator must be able to wake **one room only** without touching any other computer.

- **Room (Sala)**: name (e.g., "Lab 3"), block/building, floor, color, notes, default
  stagger settings (batch size, delay). Each device belongs to **exactly one room** (or
  "Sem sala").
- **Tag**: free labels, many-to-many (e.g., "professor", "projetor", "Win11", "manhã").
- Dashboard groups devices by room. Each room card shows `online/total`, last action, and
  buttons: **Ligar sala**, **Ligar só os desligados**, **Ver máquinas**.
- Tag filter + **Ligar dispositivos com esta tag**.
- Wake actions are strictly scoped to their target. Waking "Todos" or more than N devices
  (configurable) requires a confirmation dialog showing the exact count and rooms affected.
- Bulk move devices between rooms; drag-and-drop is a nice-to-have.
- Schedules can target: rooms, tags, specific devices, or all.

## 4. Scope v1.0 (MVP — implement fully)

**FR-001 Installer & auto-update**
- Windows x64 installer (`UniWake-Setup.exe`), admin elevation, silent mode supported.
  Installs a Windows Service (runs without logged-in user), firewall rule for panel port,
  Start Menu shortcut to the panel.
- Update check on start and every N hours via GitHub Releases API
  (`/repos/BryanWalace/UniWake/releases/latest`), semver compare, download installer,
  verify SHA-256 from a checksum asset, silent install, restart service, health check,
  rollback on failure. Database and config preserved.
- Panel: current version, latest version, changelog, button "Atualizar agora".
- GitHub Actions: on `v*` tag → build, test, checksum, publish Release.

**FR-002 Devices**
- CRUD: name, MAC (accept `AA:BB..`, `AA-BB..`, `AABB..`, normalize), IP, hostname, room,
  tags, notes, enabled. Duplicate MAC detection. CSV import/export (with room and tags).

**FR-003 Wake-on-LAN engine**
- Magic packet: 6×0xFF + 16×MAC. UDP ports 9 and 7. Send to 255.255.255.255 and to the
  subnet-directed broadcast of the device subnet / selected interface. Interface selectable.
- Targets: device, selection, room, tag, all.
- Staggered wake (batch size + delay), per room override.
- Post-wake verification: poll status for X minutes, record "acordou" / "não respondeu".

**FR-004 Monitoring hub**
- Status online/offline/unknown, latency, last seen, online since, IP, hostname.
- Detection: ICMP, then TCP probe on 135/445/3389 (configurable) because Windows Firewall
  blocks ICMP by default. Configurable interval and concurrency.
- Live updates (SSE or WebSocket), counters global and per room, filters, search.
- History of status changes and wake attempts; daily uptime per device and per room.

**FR-005 Scheduler**
- Schedules with target (rooms/tags/devices/all), weekdays, time, timezone
  (default America/Sao_Paulo), stagger options, enable/disable each, global pause.
- Exception dates (holidays, no classes), next-run display, execution log.
- Missed-run handling within a grace window; never double-fire.

**FR-006 Security & audit**
- Login (admin created on first run; argon2/bcrypt). Multiple users with roles
  (admin / operator) — operator cannot change settings or users.
- Panel bound to localhost by default; LAN exposure is an explicit setting.
- Audit log (who, what target, when, result). Rate limiting on wake endpoints.

**FR-007 Target preparation + self-enrollment**
- `prepare-target.ps1` run once on each target PC by the technician (who is already there
  to enable WoL in the BIOS):
  - Detects the active wired adapter; enables "Allow this device to wake the computer" and
    "Only allow a magic packet"; disables Fast Startup; sets advanced NIC properties
    (Wake on Magic Packet, disable energy-efficient features that break WoL) where present.
  - Reports what could not be automated (BIOS steps) with clear pt-BR instructions.
  - **Self-enrollment**: asks for (or receives via parameter) a room code and an enrollment
    token generated in the panel, then POSTs MAC, hostname, IP, manufacturer, model, serial
    and OS to the UniWake API, registering the device in that room automatically.
- Panel page "Preparar máquinas": generate enrollment token per room, show the exact
  command to run, BIOS checklist, and a "Testar WoL desta máquina" flow.
- In-app troubleshooting: Fast Startup, BIOS/ErP, VLAN/broadcast explanations.

## 5. Scope v1.1 — Network discovery (after v1.0 validated, modular)
**FR-101 MAC scanner**: choose interface/CIDR → ping/TCP sweep with limited concurrency →
read ARP cache (`Get-NetNeighbor` / `arp -a`) → for each: IP, MAC, vendor (offline IEEE OUI
DB, updatable), hostname (reverse DNS, NetBIOS), latency, first/last seen, already
registered?, flag locally administered/randomized MACs. Bulk add to a room. UI states that
discovery only sees the controller's own subnet.

## 6. Roadmap (spec only, do not implement)
- Relay agent per VLAN (authenticated; broadcasts locally on hub request).
- Remote shutdown/restart; lightweight target agent (CPU/RAM/disk/user).
- Notifications (e-mail/Telegram) for failed scheduled wakes.
- Vendor BIOS tooling integration (Dell Command | Configure, HP BCU, Lenovo WMI) to enable
  WoL in BIOS remotely.

## 7. Improvement protocol (all roles)
Any role may add entries to `specs/improvements.md`:
`IMP-xxx | proposed by | problem | proposal | impact | effort (S/M/L) | status`.
The Architect accepts when it increases reliability, safety or operator productivity and
does not break NFRs; accepted items get FR/NFR IDs in the spec before implementation.
Large items go to the roadmap instead of blocking v1.0.

## 8. Non-functional requirements
- NFR-01: 500+ devices; full status sweep under 30 s.
- NFR-02: survives reboots and network loss; scheduler resilient.
- NFR-03: everything configurable in the UI.
- NFR-04: structured logs with rotation; log viewer in panel.
- NFR-05: no telemetry; only external call is GitHub update check.
- NFR-06: test coverage ≥ 80% on core modules; CI green before any release.

## 9. Recommended stack (Architect may change with an ADR)
Node.js 22 LTS + TypeScript, Fastify, SQLite (better-sqlite3), Zod, pino; React + Vite +
Tailwind; Windows Service wrapper (WinSW or node-windows); Inno Setup installer; Vitest +
Playwright. Evaluate Go if a single self-updating binary is clearly more reliable.

## 10. Shared folders
```
specs/constitution.md   specs/spec.md       specs/plan.md     specs/tasks.md
specs/decisions.md      specs/improvements.md  specs/validation.md
specs/reviews/phase-<N>-<role>.md   specs/handoff/NEXT.md   specs/handoff/BLOCKERS.md
```
