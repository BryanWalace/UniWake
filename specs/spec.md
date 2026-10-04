# UniWake — Specification

Version: 0.1 (Architect draft, Phase 1) · Date: 2026-10-04
Sources: `.agents/01-project-brief.md`, `specs/constitution.md` v1.0, `specs/improvements.md`.

Acceptance criteria use **Given / When / Then** and IDs `AC-<FR>-<n>`. Every AC must map to at
least one automated test unless marked **[manual]** (hardware/OS steps that need the owner, B-002).

---

## 1. Purpose
UniWake lets the IT team of a college power on Windows PCs by room, tag or individually via
Wake-on-LAN, see which PCs are on, and run scheduled morning power-on reliably, with a full
record of what happened.

## 2. Personas
| ID | Persona | Context | Main need |
|---|---|---|---|
| PE-1 | **Morning operator** | IT staff, opens labs 06:45–07:30. Busy, often on a tablet walking between rooms. | "Which rooms are up? Wake Lab 3 now. What didn't come up?" |
| PE-2 | **Evening operator** | Other IT staff member, afternoon/evening shift. Prepares next day, handles exceptions (holidays, events). | Schedules, exceptions, pause, history of what happened in the morning. |
| PE-3 | **Admin** | One of the two IT staff, also responsible for the controller PC. | Users, settings, updates, network/interface config, backups. |
| PE-4 | **Technician at the target** | Same IT staff, physically at a PC to enable WoL in BIOS. | Run one command, see what was configured, have the PC appear in the right room. |

## 3. Glossary
- **Hub** — the UniWake Windows Service on the controller PC.
- **Target / device** — a PC registered in UniWake.
- **Room (Sala)** — group of devices; each device in exactly one room or in "Sem sala".
- **Tag** — free label, many-to-many with devices.
- **Wake job** — one execution of a wake action: resolved device set, packets, verification.
- **Sweep** — one monitoring pass over all enabled devices.
- **Probe** — one ICMP or TCP check against a device.
- **Enrollment token** — secret generated in the panel, bound to one room, used by
  `prepare-target.ps1` to register a PC.
- **Dry-run** — packets are recorded but not sent. **Demo mode** — dry-run + seeded data +
  simulated targets.

## 4. Scoping rules (normative)
These rules apply to every wake path (manual, schedule, API, test flows).

| ID | Rule |
|---|---|
| SR-01 | The device set of a wake is resolved **on the server**, from the database, at execution time. Clients send target descriptors (`{type, ids}`), never MAC lists. |
| SR-02 | **Room target**: enabled devices whose room is one of the selected rooms. "Sem sala" is selectable only explicitly. |
| SR-03 | **Tag target**: enabled devices that have **any** of the selected tags (union). |
| SR-04 | **Device / selection target**: exactly the listed device IDs. Unknown IDs → request rejected (422). Disabled devices are excluded and reported as `excluded: disabled`. |
| SR-05 | **All target**: all enabled devices. |
| SR-06 | Modifier **"só os desligados"** removes devices whose status is `online` at resolution time. |
| SR-07 | Magic packets are built **only** for MACs in the resolved set. Test form: for every target type, the multiset of MACs in sent packets equals the resolved set × repeats × destinations; no other MAC appears. |
| SR-08 | A magic packet is broadcast, so every NIC on the segment receives it, but only the NIC with the matching MAC wakes. "Zero packets to room B" means zero packets **containing a room-B MAC**. |
| SR-09 | Schedules resolve their target at fire time; devices added to a room later are included. |
| SR-10 | Large-action guard (server-side): if the resolved set exceeds the confirmation threshold, spans more than one room, or target is `all`, the request must carry `confirm.count` equal to the resolved count; otherwise 409 `CONFIRMATION_REQUIRED` with the count and affected rooms. Schedules are pre-confirmed when saved. |
| SR-11 | A device already in an **active** wake job is excluded from a new job and reported as `excluded: in_active_job` with the job id. If every device is excluded → 409 `WAKE_ALREADY_RUNNING`. |
| SR-12 | Stagger is applied per room using the room's settings (or global defaults). Rooms in one job run in parallel. |

## 5. Functional requirements — v1.0

### FR-001 Installer and auto-update
**FR-001.1 Installer.** `UniWake-Setup.exe`, Windows x64, requires admin elevation, supports
silent mode (`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`). Installs program files to
`%ProgramFiles%\UniWake`, data to `%ProgramData%\UniWake`. Registers the Windows Service
`UniWake` (automatic start, runs without a logged-in user, restart on failure). Creates
inbound firewall rules for the hub ports. Adds a Start Menu shortcut "UniWake" that opens the
panel. Upgrading over an existing install preserves database and config. Uninstall removes the
service, firewall rules and shortcut; data is kept unless the user ticks "remover dados".

- AC-001-01: Given a clean machine, When the installer runs silently, Then the service `UniWake`
  exists, is running, start type is Automatic, recovery is "restart", and `GET /api/health`
  on loopback returns 200 within 60 s. **[manual + CI smoke on Windows runner]**
- AC-001-02: Given an installed v1.0.0 with data, When v1.0.1 is installed over it, Then all
  rooms, devices, users and settings are unchanged and migrations ran once.
- AC-001-03: Given an install, When uninstalled silently, Then service, firewall rules and
  shortcut are gone and `%ProgramData%\UniWake\data` still exists.

**FR-001.2 Update check.** The hub checks
`GET https://api.github.com/repos/BryanWalace/UniWake/releases/latest` at start (after a delay)
and every N hours (default 6). It compares SemVer with the running version, ignoring drafts and
prereleases. The panel shows current version, latest version, release notes (changelog) and,
for admins, **Atualizar agora**.

- AC-001-04: Given running 1.0.0 and latest release v1.1.0, When the check runs, Then the panel
  shows "Nova versão 1.1.0 disponível" with the release notes.
- AC-001-05: Given latest is a prerelease, draft, non-SemVer tag, or ≤ current, Then no update is
  offered.
- AC-001-06: Given GitHub is unreachable or rate-limited, Then the check is retried at the next
  interval, the panel shows "Não foi possível verificar atualizações" with time of last success,
  and nothing else is affected.

**FR-001.3 Update install and rollback.** On "Atualizar agora" (or automatically, see setting
`update.mode`), the hub downloads the installer asset and the checksum asset, verifies size
and SHA-256, backs up the DB, and launches the updater process, which stops the service, runs
the installer silently, starts the service and polls health. On failure, it restores the previous
version and DB backup, restarts, and records the failure.

- AC-001-07: Given a checksum mismatch, Then the installer is not executed, the file is deleted,
  an audit entry `update.failed` with reason `CHECKSUM_MISMATCH` is written, and the panel shows
  the error.
- AC-001-08: Given the new version fails its health check within the timeout, Then the previous
  version is restored, the service runs the previous version, and the panel shows "Atualização
  revertida".
- AC-001-09: Given an interrupted download, Then the partial file is discarded and a retry is
  attempted with backoff (max 3).
- AC-001-10: Given an operator (not admin), Then "Atualizar agora" is not shown and the endpoint
  returns 403.

**FR-001.4 Release workflow.** On tag `v*`, GitHub Actions runs all quality gates, builds the
installer, writes `UniWake-Setup.exe.sha256`, and publishes a Release with generated notes.

- AC-001-11: Given a tag `v1.2.3`, When the workflow runs green, Then the Release has
  `UniWake-Setup.exe` and `UniWake-Setup.exe.sha256` whose hash matches the file.

### FR-002 Devices
**FR-002.1 CRUD.** Fields: name (required, unique), MAC (required, unique), IP (optional IPv4),
hostname (optional), room (optional → "Sem sala"), tags, notes, enabled (default true).
MAC accepted as `AA:BB:CC:DD:EE:FF`, `AA-BB-CC-DD-EE-FF`, `AABB.CCDD.EEFF`, `AABBCCDDEEFF`,
any case; stored normalized uppercase with colons.

- AC-002-01: Given input `aa-bb-cc-dd-ee-ff`, When saved, Then stored MAC is `AA:BB:CC:DD:EE:FF`.
- AC-002-02: Given a device with MAC X exists, When another device is saved with MAC X in any
  format, Then 409 `DEVICE_MAC_DUPLICATE` naming the existing device.
- AC-002-03: Given a MAC that is multicast (LSB of first octet set), all zeros or all FF, Then
  422 `MAC_INVALID`.
- AC-002-04: Given a locally administered MAC (second-LSB of first octet set), Then the save
  succeeds with warning flag `mac_locally_administered` shown in the UI. (IMP-012)
- AC-002-05: Given a disabled device, Then it is excluded from wake targets (SR-04) and from
  sweeps, and shown greyed with status `desconhecido`.

**FR-002.2 Bulk operations.** Select many devices → move to room, add/remove tags,
enable/disable, delete (with confirmation showing the count).
- AC-002-06: Given 12 selected devices in 3 rooms, When moved to "Lab 3", Then all 12 have room
  Lab 3 and one audit entry lists them.

**FR-002.3 CSV import/export.** Columns: `nome, mac, ip, hostname, sala, tags, observacoes,
ativo`; tags separated by `|`. Import shows a preview with per-row validation before committing;
missing rooms/tags can be created; existing MAC rows can be updated or skipped.
- AC-002-07: Given a CSV with 3 valid rows, 1 invalid MAC and 1 duplicate MAC, When previewed,
  Then the preview lists 3 OK, 1 error with line number and reason, 1 duplicate with the chosen
  action, and nothing is written until confirmed.
- AC-002-08: Given an export, When re-imported into an empty DB, Then devices, rooms and tags are
  identical (round trip).

### FR-003 Wake-on-LAN engine
**FR-003.1 Magic packet.** 6 × `0xFF` followed by 16 × MAC (102 bytes). UDP to ports 9 and 7
(configurable list). Each packet repeated `wake.repeat` times (default 3, 100 ms apart).
- AC-003-01: Given MAC `01:23:45:67:89:AB`, Then the payload is 102 bytes, bytes 0–5 are `FF`,
  and bytes 6–101 are 16 repetitions of the MAC.

**FR-003.2 Destinations and interfaces.** For each selected interface (setting; default: all
up, non-loopback IPv4 interfaces with a gateway or private address), the sender binds to the
interface's IPv4 and sends to `255.255.255.255` and the interface's subnet-directed broadcast.
If a device's room has a **directed broadcast address** configured (for routed subnets), it is
added. Destinations are de-duplicated.
- AC-003-02: Given interfaces `10.0.3.15/24` and `192.168.56.1/24` selected, When waking one
  device, Then packets are sent from each interface to `255.255.255.255` and to `10.0.3.255` /
  `192.168.56.255` respectively, on ports 9 and 7.
- AC-003-03: Given the device's room has directed broadcast `10.0.5.255`, Then it is added to the
  destinations.
- AC-003-04: Given no usable interface, Then the job fails with `NO_NETWORK_INTERFACE` and the
  pt-BR message tells the operator to check the network connection.

**FR-003.3 Targets.** device, selection, room(s), tag(s), all; modifier "só os desligados"
(SR-01..SR-11).
- AC-003-05 (scope): Given rooms A (3 devices) and B (2 devices), When room A is woken, Then
  packets contain exactly A's 3 MACs and zero B MACs.
- AC-003-06 (scope): Given tag "professor" on devices in rooms A and B, When the tag is woken,
  Then only tagged devices' MACs appear.
- AC-003-07: Given room A with 2 of 3 devices online, When "Ligar só os desligados", Then only
  the offline/unknown device is woken.
- AC-003-08: Given threshold 40 and a room of 45 devices, When woken without `confirm.count`,
  Then 409 `CONFIRMATION_REQUIRED` with `count=45` and the room list; with `confirm.count=45`
  the job starts; with `confirm.count=44` → 409 again.
- AC-003-09: Given device D in active job J1, When a new job targets D's room, Then D is
  excluded with reason `in_active_job` and J1's id.

**FR-003.4 Staggered wake.** Batch size and delay between batches; global defaults and per-room
override; per-job override for manual wakes and schedules.
- AC-003-10: Given room batch 5 and delay 10 s and 12 devices, Then packets are sent in batches
  of 5, 5, 2 at t = 0, 10, 20 s (fake clock).

**FR-003.5 Verification.** After sending, the job polls each device's status every
`wake.verifyInterval` (default 15 s) for `wake.verifyWindow` (default 5 min). Per-device result:
`acordou` (became online), `já estava ligado` (online at start), `não respondeu` (window
ended), `falha no envio` (all sends failed).
- AC-003-11: Given a device that comes online after 90 s, Then its result is `acordou` with
  wake time ≈ 90 s; job ends when all devices have a final result or the window ends.

**FR-003.6 Packet log.** Every send attempt is recorded: job, device, MAC, source interface IP,
destination, port, timestamp, outcome/error. Queryable per job and per device. (IMP-006)
- AC-003-12: Given a job, Then the packet log has one row per (device, destination, port,
  repeat) attempt with outcome.

**FR-003.7 Dry-run.** When `wake.dryRun` is on, packets are recorded with outcome `dry_run` and
not sent; a banner is visible.
- AC-003-13: Given dry-run, When a room is woken, Then no UDP socket sends occur and the log shows
  `dry_run` rows.

**FR-003.8 Rate limiting.** Wake endpoints: default 30 requests/min per user.
- AC-003-14: Given 31 wake requests in a minute by one user, Then the 31st gets 429
  `RATE_LIMITED`.

### FR-004 Monitoring hub
**FR-004.1 Status detection.** For each enabled device with an IP or hostname: ICMP echo, then TCP
connect to ports `[135, 445, 3389]` (configurable). Status: `online`, `offline`, `desconhecido`.
Latency, last seen, online since, IP, hostname recorded.
- AC-004-01: Given ICMP reply, Then `online` with latency.
- AC-004-02: Given ICMP timeout and TCP 445 connect success, Then `online`.
- AC-004-03: Given ICMP timeout and TCP 3389 connection refused, Then `online`.
- AC-004-04: Given all probes time out, Then `offline`.
- AC-004-05: Given no IP and an unresolvable hostname, Then `desconhecido`.

**FR-004.2 Sweeps.** Interval default 60 s; concurrency default 64; timeouts ICMP 1000 ms, TCP
800 ms. Verification probes from wake jobs take priority over sweep probes.
- AC-004-06 (NFR-01): Given 500 devices of which 50% time out, When a sweep runs with defaults on
  the fake prober with realistic latencies, Then it completes in < 30 s of simulated time.

**FR-004.3 IP drift.** Devices with a hostname are re-resolved (cache 5 min). If the resolved IP
differs, the IP is updated and an event `ip_changed` is recorded. (IMP-011)
- AC-004-07: Given device D with IP .20 and hostname that now resolves to .31, When a sweep runs,
  Then D's IP becomes .31 and an `ip_changed` event exists.

**FR-004.4 Live updates.** Status changes, counters and wake-job progress are pushed to the panel
in real time; the panel reconnects automatically.
- AC-004-08: Given an open panel, When a device changes status, Then the room card counter updates
  within 2 s without reload.

**FR-004.5 Dashboard.** Global counters (online/offline/desconhecido/total), room cards
(online/total, last action, buttons **Ligar sala**, **Ligar só os desligados**, **Ver
máquinas**), tag filter with **Ligar dispositivos com esta tag**, search by name/IP/MAC/hostname,
status filter.
- AC-004-09: Given 3 rooms, Then 3 room cards plus "Sem sala" (if non-empty) are shown with
  correct counters.

**FR-004.6 History.** Status changes (`status_events`), wake attempts, and daily uptime per device
and per room (% of the day online). Retention default 180 days.
- AC-004-10: Given events online 08:00 → offline 12:00 for a device, Then uptime for that day is
  4 h (16.7%).

### FR-005 Scheduler
**FR-005.1 Schedules.** Name, target (rooms/tags/devices/all + "só os desligados"), weekdays,
time `HH:mm`, timezone (default `America/Sao_Paulo`), stagger override, enabled. Next 5 runs
displayed.
- AC-005-01: Given Mon–Fri 06:50 America/Sao_Paulo, Then next runs list the next 5 weekdays at
  06:50 local, skipping exception dates.

**FR-005.2 Exceptions.** Global exception dates and ranges (holidays, vacations) with a
description; per-schedule exceptions. A skipped run is logged as `pulado (feriado)`.
- AC-005-02: Given exception 2026-11-20 "Consciência Negra", Then no run fires that day and the
  log shows `pulado (feriado)`.

**FR-005.3 Execution.** Tick ≤ 30 s; claim-then-execute; runs create a wake job.
- AC-005-03: Given two scheduler instances (or a restart) racing on the same due run, Then exactly
  one wake job is created.
- AC-005-04: Given the clock jumps back 10 min after a run, Then the run does not fire again.

**FR-005.4 Missed runs.** If the hub was down at the planned time and starts within the grace
window (default 15 min), the run executes late (logged as `atrasado`); otherwise logged
`perdido`.
- AC-005-05: Given planned 06:50 and hub start at 06:58, Then the run executes and is logged
  `atrasado (8 min)`. Given start at 07:20, Then `perdido`, no wake.

**FR-005.5 DST.** Non-existent local time runs at the first valid instant after; ambiguous time
runs once at the first occurrence (ADR-008).
- AC-005-06: Given America/New_York and 02:30 on the spring-forward day, Then the run fires at
  03:00 local. Given 01:30 on fall-back day, Then it fires once.

**FR-005.6 Global pause.** (IMP-020) Pause requires a reason; optional auto-resume date/time;
red banner on every page; runs during pause are logged `pulado (pausa)`.
- AC-005-07: Given pause with auto-resume Monday 00:00, Then Monday 06:50 run executes normally.

**FR-005.7 Execution log.** Per run: planned time, actual time, status (`executado`,
`atrasado`, `pulado (feriado)`, `pulado (pausa)`, `perdido`, `falhou`), link to the wake job.

### FR-006 Security and audit
**FR-006.1 First run.** When no user exists, the panel shows "Criar administrador" only to
loopback clients.
- AC-006-01: Given no users, When setup is requested from a non-loopback address, Then 403.
- AC-006-02: Given two concurrent setup requests, Then exactly one admin is created.

**FR-006.2 Users and roles.** Admin manages users (create, disable, reset password, role).
Permission matrix:

| Capability | Operator | Admin |
|---|---|---|
| View dashboard, devices, history, schedules, audit | ✔ | ✔ |
| Wake (any target) | ✔ | ✔ |
| Devices/rooms/tags CRUD, CSV import/export | ✔ | ✔ |
| Schedules CRUD, exceptions, pause/resume | ✔ | ✔ |
| Enrollment tokens, diagnostics, test WoL | ✔ | ✔ |
| Settings (network, monitoring, wake defaults, update, security) | ✘ | ✔ |
| Users | ✘ | ✔ |
| Install update, restore backup | ✘ | ✔ |

- AC-006-03: Every route enforces this matrix (route-table test).

**FR-006.3 Authentication.** Password rules and sessions per constitution §6.2.
- AC-006-04: Given 5 failed logins for a user within 15 min, Then further attempts are delayed
  with exponential backoff and audited.

**FR-006.4 LAN exposure.** Setting `panel.lanEnabled` (admin); when on, the panel listener also
binds the selected LAN address; the Host allowlist includes it.
- AC-006-05: Given LAN off, Then the panel listener is bound to 127.0.0.1 only.

**FR-006.5 Audit log.** Who, action, target, when, result, source IP. Viewer with filters and CSV
export.
- AC-006-06: Given a room wake by user U, Then an audit row has actor U, action `wake.start`,
  target `room:Lab 3`, device count, and later `wake.finish` with result counts.

### FR-007 Target preparation and self-enrollment
**FR-007.1 `prepare-target.ps1`.** Run as admin on the target (Windows PowerShell 5.1+).
Parameters: `-HubUrl`, `-RoomCode`, `-Token`, `-WhatIf`, `-SkipEnrollment`. Steps:
1. Detect the active wired physical adapter (Up, 802.3, not virtual/wireless; prefer the one
   with the default gateway).
2. Enable "Permitir que este dispositivo ative o computador" and "Somente permitir que um
   Magic Packet ative o computador".
3. Disable Fast Startup (`HiberbootEnabled = 0`).
4. Set advanced NIC properties when present: Wake on Magic Packet = on; Shutdown Wake-On-LAN /
   Wake from power off state = on; Energy Efficient Ethernet / Green Ethernet = off.
5. Print a pt-BR summary table (OK / FALHOU / NÃO SE APLICA / MANUAL) and the BIOS checklist.
6. Enroll (unless skipped).
- AC-007-01: Given mocked cmdlets with one wired and one Wi-Fi adapter, Then the wired adapter is
  chosen. [Pester]
- AC-007-02: Given `-WhatIf`, Then no setting is changed and the summary shows what would change.
  [Pester]
- AC-007-03: Given a property absent on the NIC, Then the step is `NÃO SE APLICA`, not a failure.
  [Pester]
- AC-007-04: Running twice produces the same end state and no errors (idempotent). [Pester]

**FR-007.2 Self-enrollment API.** `prepare-target.ps1` POSTs MAC, hostname, IP, manufacturer,
model, serial, OS to the agent listener with the token and room code.
- AC-007-05: Given a valid token for room Lab 3 and a new MAC, Then a device is created in Lab 3
  with name = hostname, and the response says `created`.
- AC-007-06: Given the MAC exists in Lab 3, Then the device is updated (`updated`); no duplicate.
- AC-007-07: Given the MAC exists in Lab 2, Then the device moves to Lab 3 (`moved`) and the
  audit says "movida de Lab 2 para Lab 3".
- AC-007-08: Given an expired / revoked / exhausted / unknown token or a room code that doesn't
  match the token's room, Then distinct errors `ENROLL_TOKEN_EXPIRED`, `..._REVOKED`,
  `..._EXHAUSTED`, `..._INVALID`, `ENROLL_ROOM_MISMATCH` with pt-BR messages.

**FR-007.3 "Preparar máquinas" page.** Pick a room → generate token (expiry default 8 h, max
uses default 100) → show the exact command and a copy button; list active tokens with use
count; revoke; BIOS checklist (generic + Dell/HP/Lenovo hints); download the script.
- AC-007-09: Given a generated token, Then the token value is shown once and only its hash is
  stored.

**FR-007.4 "Testar WoL desta máquina".** Guided flow for one device: wait until it is detected
`offline` → send → wait for `online` within the window → record the result in the device's
diagnostics.
- AC-007-10: Given the flow with a fake prober, Then results `sucesso` / `não acordou` are stored
  with timestamps.

**FR-007.5 Troubleshooting pages.** In-app pt-BR help: Fast Startup, BIOS/ErP, NIC power
settings, VLAN/broadcast. Linked from diagnostics and error messages.

### FR-008 Rooms and tags
**FR-008.1 Rooms.** Name (unique), block/building, floor, color, notes, stagger defaults
(batch size, delay), optional directed broadcast address, **room code** (short unique slug used
by enrollment, e.g. `LAB3`). Deleting a room with devices requires confirmation; devices move
to "Sem sala".
- AC-008-01: Given room Lab 3 with 4 devices, When deleted with confirmation, Then 4 devices are
  in "Sem sala".
**FR-008.2 Tags.** Name (unique), color. Many-to-many with devices.
**FR-008.3 Room page** `/salas/:id`: devices of that room, status, bulk actions, wake buttons.

### FR-009 Wake job progress (IMP-002)
A drawer opens after any wake: sent X/Y, woke Z, waiting W, countdown, list of non-responders
with links to diagnostics. Job pages are reachable later from history.
- AC-009-01: Given a running job, Then progress updates live and final counts match the job's
  per-device results.

### FR-010 Device diagnostics (IMP-005, IMP-009, IMP-012)
Per-device page: MAC flags, interfaces/destinations that would be used, subnet match between
device IP and controller interfaces, last successful wake, wake success rate (last 30 attempts),
"parou de acordar" flag (≥ 3 consecutive failures after ≥ 1 success), last test-WoL result,
prepare-target date (from enrollment), BIOS checklist.
- AC-010-01: Given 5 successful wakes then 3 `não respondeu`, Then the flag "parou de acordar"
  is shown.

### FR-011 Network settings preview (IMP-007)
Settings page lists interfaces with IP/prefix, selected or not, and the exact destinations that
will be used.
- AC-011-01: Given the fake interface list, Then the preview lists exactly the destinations of
  AC-003-02.

### FR-012 Health page (IMP-008, IMP-013)
Service uptime and version; DB size and last backup; scheduler last tick and next run; last sweep
duration vs 30 s target; update status; time-sync status; warning if the controller's power plan
allows sleep on AC.
- AC-012-01: Given a scheduler last tick older than 2 min, Then health shows "Agendador parado"
  in red and `GET /api/health` reports `degraded`.

### FR-013 Morning result (IMP-019)
After each scheduled run's verification window, a card "Resultado da manhã" shows per room the
devices that did not wake, pinned on the dashboard until an operator acknowledges it.
- AC-013-01: Given a scheduled run with 2 non-responders in Lab 1, Then the card lists them and
  disappears after "Ciente" (acknowledgement audited).

### FR-014 Backups (IMP-010)
Daily backup (default 03:00) + pre-migration + pre-update; retention default 14 daily; list and
restore (admin) from the panel; restore needs confirmation and restarts the service.
- AC-014-01: Given 15 daily backups, Then the oldest is deleted.

### FR-015 Demo mode (IMP-001)
`--demo` flag / setting: seeds 4 rooms and ~60 devices, enables dry-run, simulated prober wakes
devices after 20–120 s (≈ 10% never wake).

### FR-016 Settings and log viewer (NFR-03, NFR-04)
All settings editable in the UI (admin). Log viewer with level filter, text search, and download
of the current log file.

## 6. Functional requirements — v1.1
### FR-101 Network discovery (MAC scanner)
Choose interface/CIDR → ping/TCP sweep with limited concurrency → read the ARP/neighbor cache →
list IP, MAC, vendor (offline IEEE OUI DB, updatable), hostname (reverse DNS, NetBIOS), latency,
first/last seen, already registered?, flag locally administered MACs. Bulk add to a room. UI
states that discovery sees only the controller's own subnets.
- AC-101-01: Given a CIDR larger than /22, Then the UI warns and requires confirmation.
- AC-101-02: Given neighbor-cache output fixtures (pt-BR and en-US Windows), Then entries are
  parsed identically.
- AC-101-03: Given a discovered MAC already registered, Then it is marked "já cadastrado" and
  cannot be added twice.

## 7. Non-functional requirements
| ID | Requirement | Measure / test |
|---|---|---|
| NFR-01 | Scale | 500+ devices; full sweep < 30 s with defaults (AC-004-06); dashboard API for 500 devices < 300 ms; dashboard renders 500 devices without jank. |
| NFR-02 | Resilience | Survives reboot (auto-start), network loss (sends fail logged, scheduler keeps ticking), restart mid-job (job closed as `interrompido` and verification resumed or ended). |
| NFR-03 | Configurable | Every setting in the settings schema has a UI control (schema ↔ form test). |
| NFR-04 | Logs | pino JSON, rotation 10 MB × 10 files default, viewer in panel. |
| NFR-05 | Privacy | Outbound HTTP only to `api.github.com` and GitHub release download hosts; enforced by an allowlist in the HTTP client adapter (unit test). |
| NFR-06 | Quality | Core coverage ≥ 80% (constitution §5); CI green before any release. |
| NFR-07 | Accessibility | Playwright + axe: no serious/critical violations on main pages. |
| NFR-08 | Footprint | Idle hub < 300 MB RAM; < 2% CPU average between sweeps (manual measurement). |
| NFR-09 | Browsers | Current Edge and Chrome. |

## 8. Defaults
| Setting | Default |
|---|---|
| Panel port / bind | 47100 / 127.0.0.1 |
| Agent listener port / bind | 47101 / all IPv4 |
| Confirmation threshold | 40 devices |
| Wake repeat / ports | 3 / [9, 7] |
| Stagger batch / delay | 10 devices / 5 s |
| Verify interval / window | 15 s / 5 min |
| Sweep interval / concurrency | 60 s / 64 |
| ICMP / TCP timeout | 1000 ms / 800 ms |
| TCP probe ports | 135, 445, 3389 |
| Schedule grace window | 15 min |
| Update check interval / mode | 6 h / manual |
| Session idle / absolute | 12 h / 7 d |
| Enrollment token expiry / max uses | 8 h / 100 |
| History retention | 180 days |
| Backup time / retention | 03:00 / 14 |

## 9. Out of scope for v1.0
- Anything in v1.1 (FR-101) and the roadmap.
- IPv6 Wake-on-LAN, Wake-on-Wireless.
- Per-room permissions (all operators can wake every room).
- Multiple hubs / high availability.
- Mobile app (the panel is responsive to tablet size).

## 10. Roadmap (spec only)
- **RM-1 Relay agent per VLAN**: authenticated service on one PC per VLAN that broadcasts locally on
  hub request.
- **RM-2 Remote shutdown/restart; lightweight target agent** (CPU/RAM/disk/logged user).
- **RM-3 Notifications** (e-mail/Telegram) for failed scheduled wakes, fed by FR-013.
- **RM-4 Vendor BIOS tooling** (Dell Command | Configure, HP BCU, Lenovo WMI) to enable WoL remotely.

## 11. Traceability: improvements → requirements
| IMP | Requirement |
|---|---|
| IMP-001 | FR-015 |
| IMP-002 | FR-009 |
| IMP-005 | FR-010, FR-007.4 |
| IMP-006 | FR-003.6 |
| IMP-007 | FR-011 |
| IMP-008 | FR-012 |
| IMP-009 | FR-010 |
| IMP-010 | FR-014 |
| IMP-011 | FR-004.3 |
| IMP-012 | FR-002.1 (AC-002-03/04), FR-007.1 |
| IMP-013 | FR-012 |
| IMP-014/015/017/018 | constitution §5, §6, §4.2 |
| IMP-019 | FR-013 |
| IMP-020 | FR-005.6 |
