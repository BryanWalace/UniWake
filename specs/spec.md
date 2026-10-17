# UniWake — Specification

Version: **1.7** · Date: 2026-10-17 · Owner: Architect
History: v0.1 draft → reviewed in `specs/reviews/phase-1-*.md` → consolidated as v1.0 → v1.1
(Phase 2: AC-001-13/14, FR-004.7) → v1.2 (Phase 6, `specs/reviews/phase-6-*.md`: FR-017 sync-ready
data from `.agents/07-roadmap-features.md` §A, AC-005-12, FR-012/FR-014 additions) → v1.3 (Phase 7,
`specs/reviews/phase-7-*.md`: §6a v1.2 Modo equipe, FR-201..207) → v1.4 (Phase 9,
`specs/reviews/phase-9-*.md`: §6b v1.3 Desligar, FR-301..311, replaces RM-2) → v1.5 (Phase 11,
`specs/reviews/phase-11-*.md`: §6c v1.4 Backup e migração, FR-401..407) → v1.6 (Phase 13, field fixes: §6d FR-501..504) → v1.7 (Phase 15: §6e product v1.6, FR-601..605).
Sources: `.agents/01-project-brief.md`, `.agents/07-roadmap-features.md`, `specs/constitution.md`, `specs/improvements.md`,
`specs/decisions.md`.

Acceptance criteria use **Given / When / Then** with IDs `AC-<FR>-<n>`. Every AC maps to at
least one automated test unless marked **[manual]** (needs real hardware/OS, see BLOCKERS B-002).
Tags in brackets name the test kind when it is not a Vitest unit/integration test:
**[API]** `fastify.inject`, **[E2E]** Playwright, **[Pester]**, **[CI-Win]** Windows runner smoke.

---

## 1. Purpose
UniWake lets the IT team of a college power on Windows PCs by room, tag or individually via
Wake-on-LAN, see which PCs are on, and run scheduled morning power-on reliably, with a full
record of what happened.

## 2. Personas
| ID | Persona | Context | Main need |
|---|---|---|---|
| PE-1 | **Morning operator** | IT staff, opens labs 06:45–07:30. Busy, often on a tablet walking between rooms. | "Which rooms are up? Wake Lab 3 now. What didn't come up?" |
| PE-2 | **Evening operator** | Other IT staff member, afternoon/evening shift. Prepares next day, handles exceptions. | Schedules, holidays, pause, what happened this morning. |
| PE-3 | **Admin** | One of the two IT staff, responsible for the controller PC. | Users, settings, updates, network config, backups. |
| PE-4 | **Technician at the target** | IT staff physically at a PC to enable WoL in BIOS. | Run one command, see what was configured, PC appears in the right room. |

## 3. Glossary
- **Hub** — the UniWake Windows Service on the controller PC.
- **Panel listener** — HTTP(S) endpoint serving UI + full API; loopback by default.
- **Agent listener** — LAN endpoint serving only health, enrollment and the prepare script (ADR-011).
- **Target / device** — a PC registered in UniWake. Identity = MAC.
- **Room (Sala)** — group of devices; each device in exactly one room or in "Sem sala".
- **Tag** — free label, many-to-many with devices.
- **Wake job** — one execution of a wake action: resolved device set, packets, verification.
- **Sweep** — one monitoring pass over all enabled devices. **Probe** — one ICMP or TCP check.
- **Enrollment token** — secret generated in the panel, bound to one room.
- **Dry-run** — packets recorded, not sent. **Demo mode** — dry-run + seed data + simulated targets.

## 4. Scoping rules (normative)
Apply to every wake path (manual, schedule, API, test-WoL).

| ID | Rule |
|---|---|
| SR-01 | The device set of a wake is resolved **on the server**, from the database, at execution time. Clients send target descriptors (`{type, ids, onlyOffline}`), never MAC lists. Preview and execution use the same resolver. |
| SR-02 | **Room target**: enabled devices whose room is one of the selected rooms. "Sem sala" is selectable only explicitly. |
| SR-03 | **Tag target**: enabled devices that have **any** of the selected tags (union). |
| SR-04 | **Device / selection target**: exactly the listed device IDs. Unknown IDs → 422 `DEVICE_NOT_FOUND`. Disabled devices are excluded and reported as `excluded: disabled`. |
| SR-05 | **All target**: all enabled devices. |
| SR-06 | Modifier **"só os desligados"** removes devices whose status is `online` at resolution time. |
| SR-07 | Magic packets are built **only** for MACs in the resolved set. Test form: for every target type, the set of MACs in sent packets equals the resolved set; no other MAC appears. |
| SR-08 | A magic packet is broadcast; every NIC on the segment receives it, only the matching MAC wakes. "Zero packets to room B" means zero packets **containing a room-B MAC**. |
| SR-09 | Schedules resolve their target at fire time; devices added to a room later are included. |
| SR-10 | Large-action guard (server-side): if the resolved set exceeds `wake.confirmThreshold`, spans more than one room ("Sem sala" counts as a room), or the target is `all`, the request must carry `confirm.count` equal to the resolved count; otherwise 409 `CONFIRMATION_REQUIRED` with count and affected rooms. Schedules are confirmed when saved. |
| SR-11 | A device already in an **active** wake job is excluded from a new job and reported as `excluded: in_active_job` with the job id. If every device is excluded → 409 `WAKE_ALREADY_RUNNING` with the job id(s). |
| SR-12 | Stagger is applied per room (room settings or global defaults); rooms run in parallel, capped globally by `wake.maxDevicesPerStep`. |

## 5. Functional requirements — v1.0

### FR-001 Installer and auto-update
**FR-001.1 Installer.** `UniWake-Setup.exe`, Windows x64, admin elevation, silent mode
(`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`). Program files in `%ProgramFiles%\UniWake`, data in
`%ProgramData%\UniWake`. Registers Windows Service `UniWake` (automatic start, no logged-in user
needed, restart on failure). Creates inbound firewall rules for the agent listener port and the
panel port (Domain/Private profiles). Start Menu shortcut "UniWake" opens the panel. Upgrade keeps
DB and config. Uninstall removes service, firewall rules and shortcut; data kept unless the user
ticks "Remover dados" (silent uninstall keeps data).
- AC-001-01a [CI-Win]: Given a clean Windows runner, When the installer runs silently, Then service
  `UniWake` exists, is Running, start type Automatic, recovery = restart, and loopback
  `GET /api/health` returns 200 within 60 s.
- AC-001-01b [manual]: Given an installed hub, When the controller reboots with nobody logged in,
  Then the service is running and the next scheduled run fires.
- AC-001-02 [CI-Win]: Given v(N) installed with data, When v(N+1) is installed over it, Then rooms,
  devices, users and settings are unchanged and each migration ran once.
- AC-001-03 [CI-Win]: Given an install, When uninstalled silently, Then service, firewall rules and
  shortcut are gone and `%ProgramData%\UniWake\data` still exists.

**FR-001.2 Update check.** At start (after 2 min) and every `update.checkIntervalHours`
(default 6), the hub calls `GET https://api.github.com/repos/BryanWalace/UniWake/releases/latest`,
ignoring drafts, prereleases and non-SemVer tags, and compares with the running version. The
panel shows current version, latest version, release notes and, for admins, **Atualizar agora**.
- AC-001-04: Given running 1.0.0 and latest v1.1.0, When the check runs, Then the panel shows
  "Nova versão 1.1.0 disponível" and the release notes.
- AC-001-05: Given latest is prerelease, draft, non-SemVer, or ≤ current, Then no update is offered.
- AC-001-06: Given GitHub unreachable or rate-limited, Then the panel shows "Não foi possível
  verificar atualizações" with the last success time; the next check happens at the next interval.

**FR-001.3 Update install and rollback (ADR-009, ADR-015).** Modes: `auto` (default) or
`manual`. In `auto`, installation starts only inside the maintenance window (default
03:00–05:00 local) **and** only if no wake job is active and no schedule is due within 60 min;
otherwise it waits for the next window. **Atualizar agora** (admin) installs immediately, subject to
the same active-job/schedule guard unless the admin confirms an override. Steps: download installer
+ checksum asset to a temp file → verify size and SHA-256 → DB backup → launch updater process →
stop service → silent install → start service → poll health (timeout 120 s) → success, or rollback
(restore previous program dir and DB backup, restart) and record failure.
- AC-001-07: Given a checksum mismatch, Then the installer is not executed, the temp file is
  deleted, audit `update.failed` reason `CHECKSUM_MISMATCH` is written, the panel shows the error.
- AC-001-08: Given the new version fails health within 120 s, Then the previous version and DB
  backup are restored, the service runs the previous version, the panel shows
  "Atualização revertida" with the reason. (Updater logic tested with fakes; [CI-Win] end to end
  against a local fake release server.)
- AC-001-09: Given an interrupted download, Then the partial file is discarded and retried with
  backoff (max 3 attempts per check).
- AC-001-10: Given an operator, Then "Atualizar agora" is hidden and the endpoint returns 403.
- AC-001-11: Given `auto` mode, a pending update, time 03:10, and a schedule due at 04:00, Then the
  install is postponed; given no schedule before 05:00 and no active job, Then it starts.
- AC-001-13: Given the updater stops the service and then crashes, When the watchdog task runs
  15 min later, Then the service runs the previous version and the next start records
  "Atualização interrompida — versão anterior restaurada". (IMP-027, ADR-023)
- AC-001-14: Given free space below 3 × installer size + DB size, Then no download starts and the
  panel shows `UPDATE_DISK_SPACE`.

**FR-001.4 Release workflow.** On tag `v*`, GitHub Actions runs all quality gates, builds the
installer, writes `UniWake-Setup.exe.sha256`, and publishes a Release with generated notes.
- AC-001-12 [CI]: Given tag `v1.2.3`, When the workflow is green, Then the Release has
  `UniWake-Setup.exe` and `UniWake-Setup.exe.sha256` matching the file, and the embedded app version
  is 1.2.3.

### FR-002 Devices
**FR-002.1 CRUD.** Fields: name (required, **not unique**; the UI warns on duplicates), MAC
(required, unique), IP (optional IPv4), hostname (optional), room (optional → "Sem sala"), tags,
notes, enabled (default true). MAC accepted as `AA:BB:CC:DD:EE:FF`, `AA-BB-CC-DD-EE-FF`,
`AABB.CCDD.EEFF`, `AABBCCDDEEFF`, any case, surrounding spaces trimmed; stored uppercase with colons.
- AC-002-01: Given `aa-bb-cc-dd-ee-ff`, When saved, Then stored MAC is `AA:BB:CC:DD:EE:FF`.
- AC-002-02: Given a device with MAC X, When another device is saved with MAC X in any format,
  Then 409 `DEVICE_MAC_DUPLICATE` naming the existing device.
- AC-002-03: Given a multicast MAC (bit 0 of first octet set), all zeros or all FF, Then 422
  `MAC_INVALID`.
- AC-002-04: Given a locally administered MAC (bit 1 of first octet set), Then the save succeeds and
  the device carries flag `mac_locally_administered`, shown as a warning. (IMP-012)
- AC-002-05: Given a disabled device, Then it is excluded from wake targets and sweeps and shown
  greyed with status `desconhecido`.
- AC-002-06: Given a second device named "PC-01", Then the save succeeds and the UI shows
  "Já existe outro dispositivo com este nome". [E2E]

**FR-002.2 Bulk operations.** Select many devices → move to room, add/remove tags,
enable/disable, delete (confirmation shows the count).
- AC-002-07: Given 12 selected devices in 3 rooms, When moved to "Lab 3", Then all 12 are in Lab 3
  and one audit entry lists them.

**FR-002.3 CSV import/export.** Columns `nome, mac, ip, hostname, sala, tags, observacoes, ativo`
(headers accepted with or without accents, any case); tags separated by `|`. Import auto-detects
`,` or `;`, accepts UTF-8 with or without BOM, and shows a per-row preview before committing;
missing rooms/tags can be created; rows with an existing MAC are updated or skipped (operator
choice). Export uses `;`, UTF-8 with BOM, and neutralizes formula injection (cells starting with
`=`, `+`, `-`, `@`, tab or CR are prefixed with `'`).
- AC-002-08: Given a CSV with 3 valid rows, 1 invalid MAC and 1 duplicate MAC, When previewed, Then
  the preview shows 3 OK, 1 error with line number and reason, 1 duplicate with the chosen action,
  and nothing is written until confirmed.
- AC-002-09: Given a `;`-separated file with BOM and header `Observações`, Then it imports the same
  as a `,`-separated file without BOM.
- AC-002-10: Given an export, When re-imported into an empty DB, Then devices, rooms and tags are
  identical (round trip, ignoring the injection prefix rule which only affects risky cells).
- AC-002-11: Given a device named `=HYPERLINK("x")`, When exported, Then the cell is
  `'=HYPERLINK("x")`.

### FR-003 Wake-on-LAN engine
**FR-003.1 Magic packet.** 6 × `0xFF` + 16 × MAC (102 bytes), UDP to `wake.ports` (default 9 and
7), each repeated `wake.repeat` times (default 3, 100 ms apart).
- AC-003-01: Given MAC `01:23:45:67:89:AB`, Then the payload is 102 bytes, bytes 0–5 are `FF`,
  bytes 6–101 are 16 repetitions of the MAC.

**FR-003.2 Interfaces and destinations.** Interfaces are read at send time. Default selection:
up, non-loopback IPv4 interfaces **with a default gateway**, excluding APIPA (169.254/16); other
interfaces can be selected in settings. For each selected interface the sender binds to its IPv4
and sends to `255.255.255.255` and to the interface's subnet-directed broadcast. If the device's
room has a **directed broadcast address** configured (routed subnet), it is added. Destinations
are de-duplicated.
- AC-003-02: Given selected interfaces `10.0.3.15/24` and `10.0.4.20/23`, When waking one device,
  Then packets go from 10.0.3.15 to `255.255.255.255` and `10.0.3.255`, and from 10.0.4.20 to
  `255.255.255.255` and `10.0.5.255`, each on ports 9 and 7.
- AC-003-03: Given the device's room has directed broadcast `10.0.7.255`, Then it is added.
- AC-003-04: Given a manual wake and no usable interface, Then the job fails with
  `NO_NETWORK_INTERFACE` and a pt-BR message asking to check the controller's network.
- AC-003-16: Given a **scheduled** job and no usable interface, Then the engine retries every 30 s
  until the schedule's grace window ends; if an interface appears, packets are sent; otherwise the
  run is `falhou (sem rede)`.

**FR-003.3 Targets and preview.** Targets: device, selection, room(s), tag(s), all; modifier
"só os desligados" (SR-01..SR-12). `POST /api/wake/preview` returns
`{count, rooms[], excluded[], needsConfirmation}` for any target; the UI shows the summary
before every wake and the confirmation dialog when `needsConfirmation`. (IMP-024)
- AC-003-05 (scope): Given rooms A (3 devices) and B (2), When A is woken, Then packets contain
  exactly A's 3 MACs and zero B MACs.
- AC-003-06 (scope): Given tag "professor" on devices in A and B, When the tag is woken, Then only
  tagged devices' MACs appear.
- AC-003-07: Given room A with 2 of 3 devices online, When "Ligar só os desligados", Then only the
  third device is woken.
- AC-003-08: Given threshold 40 and a 45-device room, When woken without `confirm.count`, Then 409
  `CONFIRMATION_REQUIRED` with `count=45` and the room; with `confirm.count=45` the job starts;
  with `44` → 409.
- AC-003-09: Given device D in active job J1, When a new job targets D's room, Then D is excluded
  with reason `in_active_job` and J1's id.
- AC-003-15: Given any target, Then preview and execution resolve the same set when data is
  unchanged; when data changed in between, execution returns 409 with the new count (if
  confirmation was required).
- AC-003-18 (scope, all paths): property-based test over random rooms/tags/devices: for every
  target descriptor, sent MACs ⊆ resolved set and resolved set matches SR-02..SR-06.

**FR-003.4 Staggered wake.** Batch size and delay between batches; global defaults, per-room
override, per-job override (manual and schedules). Global cap `wake.maxDevicesPerStep`
(default 30) across rooms per step.
- AC-003-10: Given room batch 5, delay 10 s and 12 devices, Then batches of 5, 5, 2 start at
  t = 0, 10, 20 s (fake clock).
- AC-003-19: Given 4 rooms × 20 devices, batch 10 each, cap 30, Then no step starts more than 30
  devices.

**FR-003.5 Job lifecycle and verification.** States: `pendente → enviando → verificando →
concluído | interrompido | falhou`. After sending, the job probes its devices directly on the
priority queue every `wake.verifyInterval` (default 15 s) for `wake.verifyWindow` (default 5 min).
Per-device result: `acordou`, `já estava ligado`, `não respondeu`, `falha no envio`, `sem IP para verificar`
(no IP and no resolvable hostname; added in M3), and excluded devices are reported by the
preview/start response (`excluded`).
- AC-003-11: Given a device that comes online after 90 s, Then its result is `acordou` with wake
  time ≈ 90 s; the job ends when every device has a final result or the window ends.
- AC-003-17: Given the hub restarts during `verificando` with 3 min of window left, Then
  verification resumes for the remaining time; given the window already ended, Then the job closes
  as `interrompido` and unresolved devices are `não respondeu`.

**FR-003.6 Packet log (IMP-006).** One row per send attempt: job, device, MAC, source interface
IP, destination, port, repeat index, timestamp, outcome/error. Queryable per job and per device.
Retention default 30 days.
- AC-003-12: Given a job, Then the packet log has one row per (device, source, destination, port,
  repeat) with outcome.

**FR-003.7 Dry-run.** With `wake.dryRun` on, packets are logged with outcome `dry_run` and not
sent; a banner is visible on every page.
- AC-003-13: Given dry-run, When a room is woken, Then the real sender is never called and the log
  shows `dry_run` rows.

**FR-003.8 Rate limiting.** Wake endpoints: default 30 requests/min per user.
- AC-003-14 [API]: Given 31 wake requests in a minute by one user, Then the 31st gets 429
  `RATE_LIMITED`.

### FR-004 Monitoring hub
**FR-004.1 Status detection (ADR-014).** For each enabled device with an IP or resolvable
hostname: ICMP echo; if no reply, TCP connect to `monitor.tcpPorts` (default 135, 445, 3389) in
parallel. Any reply — ICMP echo reply, TCP connect, **or TCP connection refused** — means
`online`. Statuses:
- `online` — positive probe in the latest sweep or verification.
- `offline` — no positive probe in `monitor.offlineAfter` consecutive sweeps (default 2).
- `desconhecido` — device disabled; no IP and hostname unresolvable; or not probed since hub start.
Each device stores latency, last seen, online since, IP, hostname, and flag **"nunca respondeu"**
(never seen online since registration).
- AC-004-01: Given ICMP reply, Then `online` with latency.
- AC-004-02: Given ICMP timeout and TCP 445 connect success, Then `online`.
- AC-004-03: Given ICMP timeout and TCP 3389 refused, Then `online`.
- AC-004-04: Given an online device and all probes timing out in 1 sweep, Then still `online`;
  after the 2nd consecutive failed sweep, Then `offline` with a status event.
- AC-004-05: Given no IP and unresolvable hostname, Then `desconhecido`.
- AC-004-11: Given hub start, Then every device is `desconhecido` until probed (no stale `online`).
- AC-004-12: Given a device never seen online, Then flag "nunca respondeu" is shown with the hint
  about firewalls and a link to diagnostics.

**FR-004.2 Sweeps.** Interval default 60 s; concurrency default 64; timeouts ICMP 1000 ms, TCP
800 ms; verification probes have priority over sweep probes.
- AC-004-06 (NFR-01): Given 500 devices, 50% timing out, When a sweep runs with defaults on the
  fake prober with realistic latencies, Then it completes in < 30 s of simulated time.
- AC-004-13: Given a sweep in progress and a wake job verifying, Then verification probes are not
  queued behind sweep probes.

**FR-004.3 IP drift (IMP-011).** Devices with a hostname are re-resolved (cache 5 min). If the
resolved IP differs, the IP is updated and event `ip_changed` recorded.
- AC-004-07: Given D with IP .20 whose hostname now resolves to .31, When a sweep runs, Then D's IP
  is .31 and an `ip_changed` event exists.

**FR-004.4 Live updates.** Status changes, counters and job progress are pushed to the panel
(realtime channel per plan); the panel reconnects automatically and re-syncs.
- AC-004-08 [E2E]: Given an open panel in demo mode, When a device changes status, Then the room
  card counter updates within 2 s of the server event, without reload.
- AC-004-14: Given the realtime connection drops and returns, Then the client refetches state and
  shows current counters.

**FR-004.5 Dashboard.** Global counters (online/offline/desconhecido/total); room cards ordered by
block → floor → name, "Sem sala" last if non-empty. Card: color strip, name, `online/total`, last
action ("Ligada às 06:50 por agendamento — 28/30 acordaram"), buttons **Ligar sala**, **Ligar só
os desligados**, **Ver máquinas**. Tag filter with **Ligar dispositivos com esta tag**; search by
name/IP/MAC/hostname (`/` focuses it); status filter. Notices: morning result (FR-013), devices
moved by enrollment in the last 24 h (ADR-013), dry-run/demo, pause, update failure.
- AC-004-09 [E2E]: Given 3 rooms and 2 devices without room, Then 3 room cards + "Sem sala" with
  correct counters.
- AC-004-15 [E2E]: Given search "10.0.3.2", Then only matching devices are listed.

**FR-004.6 History.** Status changes, wake attempts, daily uptime per device (% of the local day
online) and per room (average of its devices). Retention default 180 days.
- AC-004-10: Given online 08:00 → offline 12:00 on one day, Then that day's uptime is 4 h (16.7%).
- AC-004-16: Given a room with devices at 50% and 100%, Then room uptime is 75%.

**FR-004.7 Quick-wake palette (IMP-026, low priority).** `Ctrl+K` opens a searchable picker of
rooms, tags and devices; Enter runs the normal preview → (confirmation) → wake flow.
- AC-004-17 [E2E]: Given `Ctrl+K`, typing "lab 3" and Enter, Then the preview for Lab 3 is shown;
  confirmation rules are identical to the room card button.

### FR-005 Scheduler
**FR-005.1 Schedules.** Name, target (rooms/tags/devices/all + "só os desligados"), weekdays,
time `HH:mm`, timezone (default `America/Sao_Paulo`), stagger override, enabled. Saving a schedule
whose target needs confirmation (SR-10) shows the confirmation once. The next 5 runs are shown.
- AC-005-01: Given Mon–Fri 06:50 America/Sao_Paulo, Then the next runs are the next 5 weekdays at
  06:50 local, skipping exception dates.

**FR-005.2 Exceptions.** Global exception dates and date ranges with a description, and
per-schedule exceptions. Skipped runs are logged `pulado (feriado)`.
- AC-005-02: Given exception 2026-11-20 "Consciência Negra", Then nothing fires that day and the
  log shows `pulado (feriado)`.

**FR-005.3 Execution.** Tick ≤ 30 s; claim-then-execute (ADR-008); each run creates a wake job.
- AC-005-03: Given two schedulers (or a restart) racing for the same due run, Then exactly one job
  is created.
- AC-005-04: Given the clock jumps back 10 min after a run, Then it does not fire again.

**FR-005.4 Missed runs.** If the hub was down at the planned time and starts within the grace
window (default 15 min), the run executes late (`atrasado`); otherwise `perdido`. When several
occurrences were missed, only the most recent within the window may run.
- AC-005-05: Given planned 06:50 and hub start 06:58, Then the run executes as `atrasado (8 min)`.
  Given start 07:20, Then `perdido`, no wake.
- AC-005-08: Given the hub down from Friday 18:00 to Monday 06:55 with a Mon–Fri 06:50 schedule
  and a Sat 08:00 schedule, Then Monday 06:50 runs `atrasado`, Saturday's is `perdido`.

**FR-005.5 DST (ADR-008).** Non-existent local time runs at the first valid instant after it;
ambiguous time runs once, at the first occurrence.
- AC-005-06: Given America/New_York and 02:30 on the spring-forward day, Then it fires at 03:00
  local. Given 01:30 on the fall-back day, Then it fires once.

**FR-005.6 Global pause (IMP-020).** Requires a reason; optional auto-resume date/time; red banner
on every page while paused; runs during pause are logged `pulado (pausa)`.
- AC-005-07: Given pause with auto-resume Monday 00:00, Then Monday 06:50 runs normally and the
  banner is gone.
- AC-005-09: Given a pause without reason, Then 422 `PAUSE_REASON_REQUIRED`.

**FR-005.7 Execution log.** Per run: planned time, actual time, status (`executado`, `atrasado`,
`pulado (feriado)`, `pulado (pausa)`, `perdido`, `falhou`), link to the wake job.
- AC-005-10: Given each status scenario above, Then a log row with that status and (when a job
  exists) its job id is recorded.

**FR-005.8 Empty targets.** A schedule whose target currently resolves to zero devices shows
"alvo vazio" in the list; a run with an empty target is logged `falhou (alvo vazio)` and appears
in the morning result.
- AC-005-11: Given a schedule on room R and R is deleted, Then the schedule shows "alvo vazio"
  and the next run logs `falhou (alvo vazio)`.
- AC-005-12: Given a schedule on room R, R deleted and a new room created afterwards (SQLite may
  reuse R's local id), Then the schedule still shows "alvo vazio" and never wakes the new room.

### FR-006 Security and audit
**FR-006.1 First run.** While no user exists, the panel shows "Criar administrador" only to
loopback clients.
- AC-006-01 [API]: Given no users, When setup comes from a non-loopback address, Then 403.
- AC-006-02: Given two concurrent setup requests, Then exactly one admin exists.

**FR-006.2 Users and roles.** Admin manages users (create, disable, reset password, change role).

| Capability | Operator | Admin |
|---|---|---|
| Dashboard, devices, rooms, tags, history, schedules, jobs, audit (view) | ✔ | ✔ |
| Health page details | ✔ | ✔ |
| Wake (any target), test-WoL | ✔ | ✔ |
| Devices/rooms/tags CRUD, CSV import/export | ✔ | ✔ |
| Schedules CRUD, exceptions, pause/resume | ✔ | ✔ |
| Enrollment tokens, diagnostics | ✔ | ✔ |
| Acknowledge morning result | ✔ | ✔ |
| Settings (network, monitoring, wake defaults, update, security, LAN exposure) | ✘ | ✔ |
| Users | ✘ | ✔ |
| Log viewer | ✘ | ✔ |
| Install update, backups list/restore | ✘ | ✔ |

- AC-006-03 [API]: Route-table test: every route enforces this matrix; no session → 401 unless
  public.

**FR-006.3 Authentication.** Per constitution §6.2: minimum length 10, common-password list,
sessions with idle/absolute timeouts, revocation on logout/password change. Login rate limits:
per account exponential backoff after 5 failures in 15 min; per IP 20 attempts/min.
- AC-006-04 [API]: Given 5 failed logins for one user in 15 min, Then the next attempt is delayed
  and audited; given 21 attempts/min from one IP, Then 429.
- AC-006-07: Given a password change, Then all other sessions of that user are revoked.

**FR-006.4 LAN exposure (ADR-012).** Setting `panel.lanEnabled` (admin). When on, the panel is
also served on the chosen LAN address **over HTTPS only**, using an automatically generated
self-signed certificate or an admin-uploaded PFX; cookies get `Secure` there. The Host allowlist
includes the LAN name/IP. Loopback remains HTTP.
- AC-006-05: Given LAN off, Then the panel listener binds 127.0.0.1 only.
- AC-006-08: Given LAN on, Then the LAN binding serves TLS, plain HTTP on that address is refused
  or redirected, and session cookies there carry `Secure`.

**FR-006.5 Audit log.** Actor, action, target, when, result, source IP. Viewer with filters and CSV
export (with formula neutralization). Append-only. Retention default 365 days.
- AC-006-06: Given a room wake by user U, Then an audit row has actor U, action `wake.start`,
  target `room:Lab 3`, device count, and later `wake.finish` with result counts.

### FR-007 Target preparation and self-enrollment
**FR-007.1 `prepare-target.ps1`.** Windows PowerShell 5.1+, run elevated. Parameters: `-HubUrl`,
`-RoomCode`, `-Token`, `-WhatIf`, `-SkipEnrollment`, `-NoFirewallChange`. Steps:
0. Check elevation; if not admin, print "Abra o PowerShell como Administrador e execute
   novamente" and exit 3.
1. Detect the active wired physical adapter (Up, 802.3, not virtual/wireless; prefer the one with
   the default gateway). Report other wired adapters.
2. Enable "Permitir que este dispositivo ative o computador" and "Somente permitir que um Magic
   Packet ative o computador".
3. Disable Fast Startup (`HiberbootEnabled = 0`).
4. Advanced NIC properties when present: Wake on Magic Packet on; Shutdown Wake-On-LAN / Wake from
   power-off state on; Energy Efficient Ethernet / Green Ethernet off.
5. Unless `-NoFirewallChange`, allow inbound ICMPv4 echo for the Domain and Private profiles
   with a dedicated `UniWake-ICMPv4-In` rule (IMP-021, ADR-028).
6. Print a pt-BR summary (OK / FALHOU / NÃO SE APLICA / MANUAL) and the BIOS checklist; write a
   transcript to `%ProgramData%\UniWake-Prepare\`.
7. Enroll (unless `-SkipEnrollment`).
Exit codes: 0 all OK, 1 partial (some step failed), 2 enrollment failed, 3 not elevated.
- AC-007-01 [Pester]: Given one wired and one Wi-Fi adapter, Then the wired one is chosen.
- AC-007-02 [Pester]: Given `-WhatIf`, Then no setter is called and the summary lists planned changes.
- AC-007-03 [Pester]: Given a property absent on the NIC, Then the step is `NÃO SE APLICA`.
- AC-007-04 [Pester]: Given a second run, Then the end state is the same and no errors occur.
- AC-007-11 [Pester]: Given a non-elevated session, Then exit code 3 and the pt-BR message.

**FR-007.2 Self-enrollment API.** Agent listener `POST /agent/enroll` with token and room code;
body: MAC, otherMacs[], hostname, IP, manufacturer, model, serial, OS, prepare results (≤ 8 KB).
Junk SMBIOS values ("To be filled by O.E.M.", "Default string", "System Serial Number", empty) are
stored as null. Rate limit 10 requests/min per source IP. Enrollment may set only: name (on
create), MAC, IP, hostname, hardware fields, OS, room, prepare date/results.
- AC-007-05 [API]: Given a valid token for Lab 3 and a new MAC, Then a device is created in Lab 3
  with name = hostname; response `created`.
- AC-007-06 [API]: Given the MAC exists in Lab 3, Then it is updated (`updated`), no duplicate,
  name unchanged.
- AC-007-07 [API]: Given the MAC exists in Lab 2, Then the device moves to Lab 3 (`moved`), the
  audit says "movida de Lab 2 para Lab 3", and the dashboard notice lists it for 24 h.
- AC-007-08 [API]: Given an expired / revoked / exhausted / unknown token or a room code not
  matching the token, Then `ENROLL_TOKEN_EXPIRED` / `_REVOKED` / `_EXHAUSTED` / `_INVALID` /
  `ENROLL_ROOM_MISMATCH` with pt-BR messages.
- AC-007-12: Given serial "To be filled by O.E.M.", Then serial is stored as null.

**FR-007.3 "Preparar máquinas" page (IMP-025, ADR-011).** Pick a room → generate token (expiry
default 8 h, max uses default 100) → choose the hub address targets will use (default: interface
with the default gateway; remembered) → the page shows a one-line command, with a copy button,
that downloads the script from the agent listener, **verifies its SHA-256 against the hash
embedded in the command**, and runs it with `-HubUrl -RoomCode -Token`. Also: list of active
tokens with use counts, revoke, BIOS checklist (generic + Dell/HP/Lenovo hints), and a plain
download of the script for offline use.
- AC-007-09: Given a generated token, Then its value is shown once and only its hash is stored.
- AC-007-13: Given the served script, Then the hash in the generated command equals the SHA-256 of
  the bytes served by `GET /agent/prepare-target.ps1`.
- AC-007-14 [Pester]: Given the one-liner and a tampered download, Then it aborts before
  executing with "Arquivo alterado — não execute".

**FR-007.4 "Testar WoL desta máquina".** Guided flow for one device: wait until `offline`, then
30 s more (NIC arming), send, wait for `online` within the verify window, record the result in the
device's diagnostics.
- AC-007-10: Given the flow with fake prober/clock, Then `sucesso` / `não acordou` is stored with
  timestamps, and sending happens ≥ 30 s after offline was detected.

**FR-007.5 Troubleshooting pages.** pt-BR help pages: Fast Startup, BIOS/ErP, NIC power settings,
firewall/ICMP, VLAN/broadcast. Linked from diagnostics and from error messages by error code.
- AC-007-15 [E2E]: Given each help page, Then it renders; given error `NO_NETWORK_INTERFACE` or a
  device flagged "parou de acordar", Then the UI links to the relevant page.

### FR-008 Rooms and tags
**FR-008.1 Rooms.** Name (unique), block/building, floor, color, notes, stagger (batch, delay),
optional directed broadcast address, **room code** (unique, `[A-Z0-9-]{2,16}`, generated from the
name, editable). Deleting a room with devices or referenced by schedules requires confirmation
listing the devices count and affected schedules; devices move to "Sem sala".
- AC-008-01: Given Lab 3 with 4 devices, When deleted with confirmation, Then 4 devices are in
  "Sem sala".
- AC-008-02: Given name "Lab 3", Then the suggested code is `LAB3`; given it exists, `LAB3-2`.
- AC-008-03: Given Lab 3 referenced by schedule S, When deletion is requested, Then the
  confirmation lists S.

**FR-008.2 Tags.** Name (unique, ≤ 32), color. Many-to-many. Deleting a tag referenced by
schedules lists them first.
- AC-008-04: Given tag T on 5 devices, When deleted, Then those devices lose T and the tag is gone.

**FR-008.3 Room page** `/salas/:id`: room devices with status, bulk actions, wake buttons,
bookmarkable.
- AC-008-05 [E2E]: Given `/salas/<id>` opened directly, Then the room's devices and buttons render.

### FR-009 Wake job progress (IMP-002)
A drawer opens after any wake: sent X/Y, woke Z, waiting W, countdown, non-responders with links to
diagnostics. Jobs are listed in history with the same detail page.
- AC-009-01 [E2E]: Given a running job in demo mode, Then progress updates live and final counts
  equal the job's per-device results.

### FR-010 Device diagnostics (IMP-005, IMP-009, IMP-012)
Per device: MAC flags, other MACs reported by enrollment, interfaces/destinations that would be
used, subnet match between device IP and controller interfaces, last successful wake, success rate
over the last 30 attempts, **"parou de acordar"** (≥ 3 consecutive `não respondeu` after ≥ 1
`acordou`), "nunca respondeu", last test-WoL result, prepare-target date/results, BIOS checklist.
- AC-010-01: Given 5 `acordou` then 3 `não respondeu`, Then "parou de acordar" is set; one
  `acordou` clears it.
- AC-010-02: Given device IP 10.0.9.5 and controller interfaces 10.0.3.0/24 only, Then
  diagnostics shows "Dispositivo em outra sub-rede" with the VLAN help link.

### FR-011 Network settings preview (IMP-007)
Settings lists interfaces (name, IPv4/prefix, gateway, selected) and the exact destinations that
will be used.
- AC-011-01: Given the fake interface list of AC-003-02, Then the preview lists exactly those
  destinations.

### FR-012 Health (IMP-008, IMP-013, IMP-022)
Public `GET /api/health` returns only `{status: "ok" | "degraded" | "down"}`. Authenticated health
page: uptime, version, DB size, last backup, scheduler last tick and next run, last sweep duration
vs 30 s, update status, clock skew (from the GitHub `Date` header; warn > 2 min), warnings for
power plan allowing sleep on AC, pending Windows reboot, Windows Update active hours not covering
05:00–08:00, with pt-BR instructions, and the installation identifier (FR-017.2, first 8
characters).
- AC-012-01: Given the scheduler's last tick older than 2 min, Then the page shows "Agendador
  parado" in red and public health is `degraded`.
- AC-012-02 [API]: Given no session, Then `/api/health` body has only `status`.
- AC-012-03: Given a GitHub `Date` 5 min ahead of the local clock, Then a clock warning is shown.

### FR-013 Morning result (IMP-019)
After each scheduled run's verification window, a "Resultado da manhã" card shows per room the
devices that did not wake (and `falhou` or `perdido` runs: nothing woke), pinned on the dashboard
until acknowledged. One card per local day; runs are added as their verification ends.
- AC-013-01: Given a scheduled run with 2 non-responders in Lab 1, Then the card lists them and
  disappears after "Ciente" (acknowledgement audited).

### FR-014 Backups (IMP-010)
Daily backup (default 02:30) + pre-migration + pre-update; retention default 14 daily. Admin
lists and restores from the panel; restore takes a backup of the current DB first, requires typing
the backup date to confirm, is audited, and restarts the service. A restored database gets a new
installation identifier (ADR-033, AC-017-08). Backup files are copies of this PC's database and
include its machine-specific settings; the portable export that leaves them out is v1.4.
- AC-014-01: Given 15 daily backups, Then the oldest is deleted.
- AC-014-02 [API]: Given a restore request, Then a pre-restore backup exists before the swap and an
  audit entry is written; an operator gets 403.

### FR-015 Demo mode (IMP-001)
`--demo` flag (and `npm run dev`): seeds 4 rooms, ~60 devices, tags, 2 schedules, a past morning
result and 7 days of history; forces dry-run; the simulated prober brings woken devices online after
20–120 s (≈ 10% never wake). A "Modo demonstração" banner is shown.
- AC-015-01: Given demo start on an empty data dir, Then the seed exists and the real packet sender
  is never constructed.

### FR-016 Settings and log viewer (NFR-03, NFR-04)
All settings are editable in the UI (admin), grouped by area, validated with the shared schema.
Log viewer (admin): level filter, text search, last 5 MB of the current file, download.
- AC-016-01: Given the settings schema, Then every key has a form control (schema ↔ form test).
- AC-016-02 [API]: Given an operator, Then settings writes and the log endpoints return 403.

### FR-017 Sync-ready data (team-mode foundation; roadmap §A, ADR-031..034)
There is no 24/7 server: each IT staff member runs UniWake on their own PC, and v1.2 syncs those
installations over the LAN. v1.0 already stores data so that sync needs no schema redesign. Nothing
here is visible to the operator except the installation identifier on the health page and the
"Somente neste PC" mark on machine-specific settings.

**FR-017.1 Replicated vs machine-local data.** Rooms, tags, devices (with their tags), schedules
(with their targets), schedule exceptions, schedule runs, users, shared settings and the scheduler
pause are *replicated entities*. Every other table (observations, jobs, packets, sessions, audit,
notices, backups, enrollment codes, machine settings, the instance identity) is *machine-local* and
is never synced or exported.

**FR-017.2 Identity and versions.** Each installation has a persistent `instance_id` (UUID). Each
replicated entity has a stable UUID (settings: their key; schedule runs: derived from schedule and
planned instant), `rev` (Lamport clock), `updated_at` and `updated_by_instance`.

**FR-017.3 Change log and tombstones.** Every write to a replicated entity goes through a
repository that, in the same transaction, replaces that entity's change-log row with its new full
snapshot (references as UUIDs). A delete leaves a tombstone row. Retention pruning of old runs does
not create tombstones.

**FR-017.4 Machine-specific settings** (`wake.interfaces`, `wake.dryRun`, `panel.*`,
`enrollment.hubAddress`, `update.*`, `backup.*`, `bootstrap.*`) are stored apart from shared
settings, never logged, synced or exported, and marked "Somente neste PC" in the settings page.

**FR-017.5 Execution lease.** Before handling a due occurrence the scheduler asks an execution
lease; v1.0 always executes (single instance). Each run records which instance claimed it.

- AC-017-01: Given a fresh data folder, When the hub starts twice, Then the same `instance_id` (a
  UUID) is used both times, and the health page shows its first 8 characters.
- AC-017-02 [API]: Given rooms, tags, devices, schedules, exceptions, users, settings and the pause
  created and edited through the API, Then every replicated row has a UUID, `rev` and
  `updated_by_instance`, and the change log holds exactly one row per entity whose `rev` and
  snapshot match the row (references as UUIDs).
- AC-017-03 [API]: Given a room with devices, a tag on devices and a schedule with exceptions and
  runs, When each is deleted, Then each leaves a tombstone, the affected devices are re-logged
  without that room/tag, and the schedule's exceptions and runs are tombstoned.
- AC-017-04: Given a schema-3 (v1.0) database with data and machine-specific settings, When it is
  migrated and the hub starts, Then every replicated row gets a UUID, a revision and a log row, and
  the machine-specific values move to `machine_settings` unchanged.
- AC-017-05 [API]: Given a machine-specific setting is changed, Then it is stored in
  `machine_settings` and no change-log row is written; a shared setting is logged.
- AC-017-06: Given a lease that declines, When a run is due, Then no run is claimed and no wake job
  starts; with the solo lease the run executes and records `claimed_by_instance`.
- AC-017-07: Given the same schedule UUID and planned instant, Then the run UUID is identical on
  any installation (name-based UUID), and it differs for another instant.
- AC-017-08: Given a backup is restored, When the hub starts, Then the installation has a new
  `instance_id` and its clock is at least the highest revision in the restored data.
- AC-017-09: Given machine-specific and shared settings, Then the settings page marks exactly the
  machine-specific ones "Somente neste PC", and every setting declares its scope.

## 6. Functional requirements — v1.1
### FR-101 Network discovery (MAC scanner)
Choose interface/CIDR → ping/TCP sweep with limited concurrency → read the neighbor cache
(`Get-NetNeighbor` as JSON, `arp -a` fallback) → list IP, MAC, vendor (offline IEEE OUI DB,
updatable), hostname (reverse DNS, NetBIOS), latency, first/last seen, already registered?, flag
locally administered MACs. Bulk add to a room. UI states that discovery sees only the controller's
own subnets.
- AC-101-01: Given a CIDR larger than /22, Then the UI warns and requires confirmation.
- AC-101-02: Given `arp -a` fixtures from pt-BR and en-US Windows, Then entries parse identically.
- AC-101-03: Given a discovered MAC already registered, Then it is marked "já cadastrado" and
  cannot be added twice.

## 6a. Functional requirements — v1.2 "Modo equipe" (roadmap §B)
Two (or a few) IT staff each run UniWake on their own PC, which is not always on. Team mode keeps
their installations in sync over the LAN with no server: whatever one registers, edits or deletes
reaches the others, and a scheduled wake runs on exactly one of the PCs that are on. Built on
FR-017. Ports: TCP and UDP **47102** (`bootstrap.syncPort`, machine scope, `config.json`).

### FR-201 Pairing
**FR-201.1 Code.** On the page "Modo equipe" (admin), "Parear com outro PC" shows a 6-digit code,
the PC's addresses and a 5-minute countdown. The code is single use, at most one is open at a time,
and after 5 wrong attempts it is cancelled. While a code is open, the PC announces "pareamento
aberto" (name only) on the LAN.

**FR-201.2 Joining.** On the other PC, "Entrar em uma equipe" lists PCs with an open pairing on the
LAN and accepts a typed address (hostname or IP, for other subnets), then the code. The PC that
**shows** the code keeps its data; the PC that **types** it adopts the team's data: if it has rooms,
devices, tags, schedules or users, it shows how many, takes an automatic backup and requires typing
`SUBSTITUIR`. Its users and sessions are replaced by the team's (the operator logs in again with the
team's accounts). A PC already in a team cannot join another one without leaving first.

**FR-201.3 Key exchange (ADR-036).** The code authenticates a SPAKE2 exchange (RFC 9382 structure,
RFC 3526 2048-bit group); the code itself never travels. Both sides confirm the derived key before
anything else is sent; a wrong code derives no key and counts as an attempt. The inviter then sends,
encrypted with the confirmed key, the team id, the current team key and epoch, and a new per-member
secret for the joiner.

**FR-201.4 Storage.** The team key (current and previous epoch) and this PC's member secret are
stored encrypted with Windows DPAPI (LocalMachine scope, ADR-037); never in plain text in the
database, logs, API responses, backups or exports.

**FR-201.5 Members.** The page lists the team's PCs (name, address, online/offline, last sync,
pending changes). Admins can rename any PC (team-wide), set a fixed address for a PC in another
subnet, revoke a PC and leave the team. Revoking rotates the team key (new epoch) and pushes it to
the remaining online PCs; a PC that was off receives it on its next contact, after proving it is a
non-revoked member. A revoked PC can no longer sync, and when it learns of its revocation it leaves
the team (its data stays local).

- AC-201-01: Given "Parear com outro PC", Then a 6-digit code valid for 5 minutes is shown; it
  cannot be used twice, a second code cancels the first, and after 5 wrong attempts it is cancelled.
- AC-201-02: Given a wrong code, Then pairing fails with a pt-BR message, no key is stored on either
  PC, the attempt is counted, and the code's digits appear in no message on the wire.
- AC-201-03: Given the right code, Then both PCs hold the same team id and key, and each lists the
  other as a member.
- AC-201-04: Given a paired PC, Then the team key and member secret exist only as DPAPI-protected
  blobs (no plain copy in the database or logs).
- AC-201-05: Given three PCs and one revoked, Then the key epoch increases, the remaining PCs (also
  one that was off during the revocation) keep syncing, and the revoked PC can no longer pull.
- AC-201-06: Given a joining PC that has data, Then without the typed confirmation nothing changes;
  with it, a backup exists and the PC ends with exactly the team's data.

### FR-202 Synchronization
**FR-202.1 Discovery.** Every 15 s each PC broadcasts a UDP announcement on its subnets with only:
protocol version, a hash of the team id (never the id or key), its instance id, sync port, latest
change sequence, and — while pairing is open — its display name. PCs in other subnets are reached by
the fixed address set on the members page.

**FR-202.2 Transport (ADR-038).** TCP with TLS 1.3 PSK: the PSK is derived from the team key of an
epoch (HKDF), the PSK identity names instance and epoch; both sides then prove membership with
their member secret. Wrong key, unknown or revoked member → connection closed, nothing exchanged.

**FR-202.3 Pull.** A PC asks a peer for "changes since N" (its cursor into that peer's log) and
applies the answer in one database transaction, in dependency order; applying twice changes nothing.
The request's cursor acknowledges what it already has. Received revisions advance the local Lamport
clock. Each PC pulls from every online peer every 30 s and asks peers to pull from it 2 s after a
local change ("Sincronizar agora" does both at once).

**FR-202.4 What travels.** Only replicated entities (FR-017.1) and team members. Machine settings,
history, jobs, packets, sessions, audit, notices, backups and keys never travel.

**FR-202.5 Tombstones.** A delete travels as a tombstone; a tombstone is pruned only when every
non-revoked member has acknowledged it and it is older than 30 days.

**FR-202.6 Status.** The members page shows, per PC: online/offline, last successful sync, last
error in pt-BR, and pending changes (local changes the PC has not acknowledged yet).

- AC-202-01: Given rooms, devices, tags and schedules created on A and others on B, When they sync,
  Then both PCs hold the same entities with identical snapshots.
- AC-202-02: Given the same batch applied twice, Then the second application changes nothing; given
  a failure in the middle of a batch, Then nothing of it is applied.
- AC-202-03: Given a discovery announcement, Then it carries only the listed fields and the team
  id hash, never data, the team id or a key.
- AC-202-04: Given a client with a wrong key or a revoked member secret, Then it is disconnected
  without receiving any change.
- AC-202-05: Given a device deleted on A, Then it disappears on B; the tombstone is pruned only after
  every member acknowledged it.
- AC-202-06: Given a machine setting and a shared setting changed on A, Then only the shared one
  reaches B.
- AC-202-07: Given B off, Then A shows B offline with its pending changes; "Sincronizar agora" with
  B on brings pending to zero.

### FR-203 Conflicts
**FR-203.1 Last writer wins.** Two versions of an entity are ordered by (revision, instance id); the
higher wins on every PC. When the peer had not seen the version it overwrote (concurrent edits), the
PC records the entity, both values and the winner in "Conflitos resolvidos".

**FR-203.2 Duplicates.** The same MAC registered on two PCs is one machine: the version with the
smaller UUID is kept and the other is deleted. Two rooms or tags with the same name (or rooms with
the same code) are both kept and the one with the larger UUID is renamed ("Lab 1 (2)", code
"LAB1-2"); two users with the same username: the larger UUID becomes "nome-2". Each case is recorded
in "Conflitos resolvidos". Every PC reaches the same result.

- AC-203-01: Given the same room renamed differently on A and B while apart, When they sync, Then
  both show the same name and "Conflitos resolvidos" lists the discarded one.
- AC-203-02: Given the same MAC registered on A and B while apart, Then after sync one device remains
  on both PCs, and the merge is listed.
- AC-203-03: Given a room "Lab 1" created on both, Then after sync both PCs have "Lab 1" and
  "Lab 1 (2)", the same way round.

### FR-204 Scheduling in a team
**FR-204.1 One executor (ADR-039).** For each due run, the PCs that are on elect one: the PC with the
smallest instance id among this PC and the members seen in the last 60 s. The others wait; if no run
record has arrived 90 s after the planned time, the next one executes it (late, `atrasado`). Alone, a
PC executes. The run record (same identity on every PC) syncs; the schedule log shows which PC ran
it.

**FR-204.2 Missed runs at start-up.** In team mode, runs missed while this PC was off are not
executed automatically at start-up (another PC may have run them): after the first sync round (or
60 s), runs still without a record that fall inside the grace window become a notice
"Agendamento não executado" with "Ligar agora".

- AC-204-01: Given two PCs on and a due run, Then exactly one wake job exists across both and both
  show the same run record naming the executor.
- AC-204-02: Given the elected PC off, Then the other runs the schedule on time.
- AC-204-03: Given the elected PC on but not executing, Then the other executes within 90 s, once.
- AC-204-04: Given a team PC that starts 5 minutes after a missed run, Then no wake starts by itself
  and a notice offers "Ligar agora".

### FR-205 Firewall
The installer adds the inbound rule "UniWake - Modo equipe" for TCP and UDP 47102, Domain and
Private profiles only, and removes it on uninstall.
- AC-205-01 [CI-Win]: Given an installation, Then the rule exists for both protocols with only the
  Domain and Private profiles; after uninstall it is gone.

### FR-206 Help pages
"Ajuda › Modo equipe" explains pairing, what is synced, the firewall port, PCs in other subnets and
the BIOS "Power On by RTC" tip for unattended mornings.
- AC-206-01: Given the help menu, Then "Modo equipe" opens that page.

### FR-207 Report a problem / suggest a feature
The "Ajuda" menu has "Relatar problema" and "Sugerir função", which open GitHub's new-issue page with
the matching issue form and the app version pre-filled (`?template=…&version=…`).
- AC-207-01: Given version 1.2.0, Then "Relatar problema" links to
  `https://github.com/BryanWalace/UniWake/issues/new?template=bug_report.yml&version=1.2.0` and
  "Sugerir função" to the feature form, both opening in a new tab.

## 6b. Functional requirements — v1.3 "Desligar" (replaces RM-2; ADR-042..048)
Shut down and restart lab PCs, manually and on a schedule, **without installing any program** on
them: the preparation command adds two Windows scheduled tasks and two small PowerShell scripts; the
machines **pull** orders and their shutdown agenda from the hub and execute the agenda by
themselves, also while the hub is off (owner's routine: wake at 17:40, hub off at 21:20, labs off at
22:40). Machines prepared with v1.2 keep waking normally and gain shutdown when they run the new
preparation command once.

**Context assumed** (owner, 2026-10-11): lab PCs use **local accounts** (workgroup, no domain); the
owner's institution does **not** use freezing software, but other institutions do, so freezing is a
requirement (FR-308); only built-in Windows components may be used on lab PCs (PowerShell 5.1, Task
Scheduler, `shutdown.exe`, `quser`, WMI/CIM, .NET Framework).

### FR-301 Preparation: "Desligamento remoto" step
**FR-301.1 New idempotent step** in `prepare-target.ps1`, after the existing steps (which keep
their behaviour; what is already right is only checked):
1. Writes `C:\ProgramData\UniWake\agent\uniwake-agent.ps1` and `uniwake-aviso.ps1`, downloaded
   from the hub and accepted only if their SHA-256 equals the hashes in the **signed** enrollment
   answer (ADR-044; the same check is used for self-update); ACL: Administrators and SYSTEM full
   control; the warning script is readable by Users.
2. Stores the machine's **agent token** issued by the hub in the enrollment answer (FR-302.2) in a
   SYSTEM/Administrators-only file (ACL only; DPAPI would add nothing against local administrators
   and breaks on frozen machines, ADR-043). The enrollment answer also carries the hub's public
   signing key, accepted only if its fingerprint equals `-HubKeyId` from the copied command
   (ADR-044).
3. Registers the scheduled task **"UniWake"** (SYSTEM, at startup and every 1 minute, no wake),
   **"UniWake Despertar"** (SYSTEM, one-time triggers at the agenda's times, "Ativar o computador
   para executar esta tarefa", rewritten by the agent when the agenda changes, ADR-045) and
   **"UniWake Aviso"** (group Users, interactive, at logon and on demand, ADR-046).
4. **Enables** "Permitir temporizadores de ativação" on AC in the active power plan (idempotent;
   summary "Temporizadores de ativação: ativados" / "já estavam ativados") and **only reads** the
   plan's sleep timeout on AC, never changing it: summary "Suspensão: após 30 min" or "Suspensão:
   nunca" (Q-3). The value is sent with enrollment and every check-in and shown on the device page.
5. Detects freezing software and its state (FR-308.1).
6. Adds the summary line **"Desligamento remoto: OK"** (or "ATENÇÃO" / "FALHOU" with the reason in
   pt-BR). Running it again repairs a missing or changed task, script or token.

**FR-301.2 Compatibility.** A v1.2 machine (enrolled, no agent token) keeps waking and monitoring.
The device page and the room list show **"Pronta para desligar"** or **"Precisa do novo preparo"**
(FR-309). Old one-liners keep working (they enroll; the hub answers without a token to scripts that
do not ask for one).

**FR-301.3 Removal.** `prepare-target.ps1 -RemoveAgent` removes the tasks, scripts and token
(revoking it in the hub needs the panel, FR-302.3).

- AC-301-01 [Pester]: Given a v1.2-prepared machine, When the new command runs, Then the three tasks
  exist with the specified principals and triggers, the scripts have the specified ACL, the summary
  shows "Desligamento remoto: OK", and running it again changes nothing.
- AC-301-02 [Pester]: Given the hub does not return an agent token (older hub), Then the step ends
  "NÃO SE APLICA" with the reason and every other step still runs.
- AC-301-03 [Pester]: Given `-WhatIf`, Then nothing is written and the summary lists what would be
  done.
- AC-301-04 [Pester]: Given `-RemoveAgent`, Then the tasks, scripts and token are gone.

### FR-302 Agent channel (hub side)
**FR-302.1 One check-in route** on the agent listener (port 47101): `POST /agent/v1/checkin`,
authenticated by the machine's agent token (`Authorization: Bearer`). The request carries pending
reports and the machine's status; the answer carries immediate orders, the shutdown agenda, the
list of team hubs and the agent script version — **signed by the hub** (ADR-044) and bound to a
nonce sent by the machine. `GET /agent/v1/scripts/{uniwake-agent.ps1|uniwake-aviso.ps1}` serves
the current scripts for preparation and self-update (verified with the signed hashes before use).
The enrollment answer is signed the same way when the script asks for an agent token.

**FR-302.2 Token per machine.** Issued at enrollment when the preparation script asks for it
(256 random bits); the hub stores only its SHA-256. **Rotation**: every 30 days the check-in answer
carries a new token; the old one stays valid until the machine uses the new one. A machine that
reports "congelada" without a persistent area is **not** rotated (it would lose the new token at
the next restart and lock itself out); the device page shows the token age. **Revocation**:
"Revogar desligamento remoto" on the device page invalidates only that machine's token.

**FR-302.3 Limits.** Per token: 6 check-ins/minute; per IP: 60/minute; body ≤ 64 KB; unknown or
revoked token → 401 without detail; every request validated (Zod).

- AC-302-01 [API]: Given a valid token, Then the check-in returns orders, agenda and signature that
  verify with the hub's public key over the body and the machine's nonce.
- AC-302-02 [API]: Given a revoked, unknown or missing token, Then 401 and no data.
- AC-302-03 [API]: Given 7 check-ins in a minute with one token, Then the 7th gets 429.
- AC-302-04: Given a token older than 30 days, Then the answer carries a new token and both work
  until the machine uses the new one; afterwards only the new one works.

### FR-303 Local agenda on the machine
**FR-303.1 Content — an explicit window.** For each prepared machine the hub sends the
**concrete dates and times of the next 14 days** (Q-4): the window `[from, to]` (to = generation
time + 14 days; from = generation time − 6 h, so a PC checking in during a warning, a postpone or
a late wake still sees the item it is handling) and the shutdown occurrences inside it, computed from the schedules that
target the machine (rooms, tags, devices, all — same scoping rules as waking, spec §4) with
holidays, vacations/exceptions and the pause already applied, minus exclusions (FR-306.2), plus the
machine's **next wake times** in the window (needed by FR-303.5). Each item: occurrence id
(deterministic, ADR-031), instant (UTC), action, warning time, postpone policy. Holidays and
vacations simply do not appear in the list; old rules are never re-evaluated on the machine.

**FR-303.2 Storage.** The agent stores the last agenda locally (or in the persistent area of a
freezing product, FR-308.4) and rewrites the "UniWake Despertar" triggers when it changes.

**FR-303.3 Execution without the hub.** At an item's time the agent executes it (FR-304) using its
clock corrected by the offset measured at the last successful check-in (ADR-045). It records the
result and reports it at the next successful check-in.

**FR-303.4 Window and change.** The machine executes only listed items inside the window; there
is no separate validity rule: after `to` nothing is executed until a hub sends a new window. A
newer agenda replaces the old one entirely (schedules edited, deleted, paused or exceptions added
take effect at the next check-in).

**FR-303.5 Sleep and boot.**
- Woken by the wake timer on time → executes (with the warning).
- Woken late (wake timers blocked): executes with the warning only if at most **60 minutes**
  late **and** before the machine's next wake time (Q-9), report "estava em suspensão"; otherwise
  it does not execute and reports "pulado: acordou {n} min após o horário". The cap
  exists because a late wake with timers blocked is almost always a person (or the hub's WoL)
  waking the PC on purpose.
- "Asleep" = the agent's heartbeat file shows a gap > 3 minutes while the last boot is older than
  the item; "hibernated" counts as asleep (Fast Startup is already disabled by the preparation, so
  the last boot time is reliable).
- Machine **booted after** the item's time (it was off) → never executes it; report "máquina
  estava desligada". A freshly turned-on PC is never shut down by an old item.

- AC-303-01: Given a schedule "Desligar" Mon–Fri 22:40 on room R, a holiday on Wednesday and
  device D in R, generated on Monday noon, Then D's 14-day agenda lists Mon, Tue, Thu, Fri of this
  week and Mon–Fri of the next, all at 22:40 local, and no Wednesday of this week; after pausing
  until Friday this week it starts on Friday.
- AC-303-02 [Pester]: Given an agenda item at 22:40 and the hub unreachable since 21:20, Then the
  agent shuts the machine down at 22:40 (with warning) and reports it at the next check-in.
- AC-303-03 [Pester]: Given an agenda whose window ended yesterday and an item listed after it by
  a tampered file, Then nothing is executed; given a vacation week, Then the generated window has
  no items in it.
- AC-303-04 [Pester]: Given an item at 22:40, last boot at 07:00, next wake at 07:00 next day and
  the agent resuming from sleep at 22:55, Then it shuts down with warning and reports "estava em
  suspensão"; resuming at 23:50 (70 min late) or at 07:05, Then it does not shut down and reports
  "pulado: acordou 70 min após o horário" (resp. 505 min).
- AC-303-05 [Pester]: Given an item at 22:40 and last boot at 23:10, Then it is never executed.
- AC-303-06 [Pester]: Given the machine clock 10 minutes fast and the measured offset, Then the
  item runs at 22:40 hub time.

### FR-304 Warning, postpone and the shutdown itself
**FR-304.1 Warning.** The schedule's time is the **shutdown time T**; the warning starts **5
minutes** before T by default (configurable per schedule, 0–30). A manual order received at R
shuts down at R + warning (manual default 1 minute, FR-305). If a user is logged on, the "UniWake
Aviso" task shows a pt-BR window in the user's session: the message with T, a countdown, and
**"Adiar 15 min"** while postpones remain. With a user logged on and active the machine still
shuts down after the warning and postpones (Q-2).

**FR-304.1a Message (Q-8).** Default: "Este computador será desligado às {hora} pela equipe de TI.
Salve seus arquivos: o que não for salvo será perdido." When postpones remain, the suffix "Você
pode adiar mais {n} vez(es)." is appended. Both texts are settings ("Configurações → Desligar"),
1–300 characters; saving is refused unless the main text keeps `{hora}` and the suffix keeps
`{n}`. The same text (without the suffix) goes to `shutdown /c` (limit 512 characters).

**FR-304.2 Postpone.** Default up to **2** postpones of **15 minutes** (both configurable per
schedule, "Permitir adiar" can be off). Each postpone moves T by the postpone length and the
warning shows again before the new T. After the last one, or without an answer, the countdown ends
and the machine shuts down. History records "adiado N× por usuário".

**FR-304.3 Shutdown.** `shutdown /s /t 30 /c "<mensagem>"` (restart `/r`) at T − 30 s;
`/t > 0` forces open applications to close (Microsoft: "/f is implied"), so unsaved work is lost:
the warning says so. Just before it, the agent tries once to send its report to the hub (frozen
machines lose queued reports at restart, FR-308.4). If the warning window cannot be shown (no session, task failure), the
agent falls back to the native warning `shutdown /s /t <aviso> /c "<mensagem>"` without postpone.
No user logged on → shutdown without warning window (`/t 30`).

**FR-304.4 Cancel.** An immediate "cancel" order, or deleting/pausing the schedule before the
machine starts the warning, stops it; during the warning the agent runs `shutdown /a` when it
receives a cancel order.

**FR-304.5 Report.** Each execution reports: outcome (desligou, reiniciou, adiou N×, cancelado,
pulado + reason, falhou + error), planned and actual time, **whether a user was logged on and how
many sessions** (`quser`), was asleep, freezing state. **User names are never collected, sent or
stored** (LGPD, Q-6); the agent drops them while parsing.

- AC-304-01 [Pester]: Given a logged-on user, Then the warning task is started in the user's
  session with the message, countdown and postpones left.
- AC-304-02 [Pester]: Given T = 22:40, warning from 22:35, two postpones then no answer, Then the
  shutdown happens at 23:10 and the report says "adiado 2× por usuário".
- AC-304-03 [Pester]: Given the warning task fails to start (no window heartbeat within 20 s),
  Then the agent uses `shutdown /s /t <seconds left to T> /c …` (≈ 280 s for a 5-min warning) and
  reports "aviso nativo (sem adiar)".
- AC-304-04 [Pester]: Given a cancel order during the warning, Then `shutdown /a` runs and the
  report says "cancelado".
- AC-304-05: Given a postpone request beyond the limit (tampered response file), Then it is ignored.

### FR-305 Manual shutdown and restart
"Desligar" and "Reiniciar" next to "Ligar sala" (room) and on the device page / selection, with the
same preview and confirmation rules as waking (spec §4, SR-10): the preview lists how many are
**ready** and how many **need the new preparation** (excluded), and **how many have a user logged
on** (from their last check-in) before confirming. Warning option (Q-7): **"Aviso: 1 min"**
(default, no postpone) | **"5 min com adiamento (padrão dos agendamentos)"**. Machines flagged
"Nunca desligar por agendamento" (FR-306.2) are listed by name and need an extra confirmation
checkbox. The hub creates one **order** per machine,
delivered at the machine's next check-in (≤ 1 minute + warning), and follows the job live:
ordered → received → warning → shut down (confirmed by ping/TCP going offline, reusing the monitor)
or postponed/cancelled/failed. "Cancelar" cancels orders not yet executed. Orders expire after 2 h.

- AC-305-01 [API]: Given room R with 10 ready machines (3 with a user logged on) and 2 v1.2
  machines, Then the preview says 10 will shut down, 3 have a user logged on and 2 need the new
  preparation, and only 10 orders are created, with a 1-minute warning and no postpone by default.
- AC-305-04 [API]: Given a device flagged "Nunca desligar por agendamento" in the target, Then the
  preview names it and the order is refused (409 `POWER_PROTECTED_CONFIRMATION`) unless the request
  confirms it explicitly.
- AC-305-02: Given the orders delivered and the machines going offline, Then the job shows
  "desligou" per machine; a machine still online 5 min after its reported shutdown shows "não
  confirmou".
- AC-305-03 [E2E]: Given the demo hub, When "Desligar" is used on a room, Then the drawer shows the
  machines receiving the order, one postponing and the rest shutting down.

### FR-306 Schedules with action "Desligar"
**FR-306.1** "Ação: Ligar | Desligar" in the schedule form (scheduled restart is roadmap RM-8,
Q-10); days, time, targets, holidays and pause work as today; existing schedules become "Ligar".
"Desligar" adds: warning minutes, allow postpone, postpone count and length (the message is the
global setting, FR-304.1a). The hub's scheduler **does not execute** shutdown schedules (it never
sends shutdown at the tick): each machine executes its own agenda (FR-303), so no execution lease
is involved (ADR-048). Schedules sync in Modo equipe like the others.

**FR-306.2 Exclusions (Q-1)**, none by default:
- per schedule: "Não desligar máquinas com as etiquetas…" (tag list, shutdown schedules only);
- per machine: flag **"Nunca desligar por agendamento"** in the device form.
Excluded machines never get the schedule's items in their agenda. Manual shutdown of a flagged
machine needs an extra confirmation (FR-305).

- AC-306-01 [API]: Given a shutdown schedule, Then the scheduler tick creates no wake job and no
  order for it, and the affected machines' agendas include it.
- AC-306-02 [E2E]: Given the demo hub, When a "Desligar" schedule is created, Then its next runs
  are listed and the schedule list shows the action.
- AC-306-03: Given a shutdown schedule on room R excluding tag "professor", device P in R tagged
  "professor" and device F in R flagged "Nunca desligar por agendamento", Then neither P's nor F's
  agenda contains the schedule's items and the other devices' agendas do.

### FR-307 History
Shutdowns and restarts appear in "Histórico" next to wakes: manual jobs, and **scheduled
occurrences aggregated from the machines' reports** ("Desligamento 22:40 — 28/30 desligaram, 1
adiou 2×, 1 estava desligada"), including those executed while the hub was off, which arrive when
the machines next check in. A machine whose report was lost (frozen, no persistent area) but whose
next check-in shows a boot after T and that the monitor saw going offline near T counts as
"provavelmente desligou (sem relatório)". The schedule log shows the occurrence with the same identity on every
team PC. Audit records who ordered manual shutdowns, revocations and schedule changes.

- AC-307-01 [API]: Given reports for one occurrence arriving over several check-ins (hub off at the
  time), Then one history row aggregates them by outcome.

### FR-308 Freezing software (Deep Freeze and similar)
**FR-308.1 Detection** in the preparation step and in every check-in (ADR-047 lists each product's
method and how sure it is): Deep Freeze, Reboot Restore Rx, Shadow Defender, Windows Unified Write
Filter (UWF). Result per machine: **"Congelamento: não detectado / detectado (congelada) / detectado
(descongelada) / detectado (estado não verificado) / não verificado"**, with the product name.

**FR-308.2 Preparation warning.** Frozen machine → the step ends **"ATENÇÃO"** with the pt-BR
instruction: descongele (Thawed / modo manutenção), execute o comando de novo e congele outra vez.
Enrollment and the other steps still run.

**FR-308.3 Lost remote shutdown.** A machine that had remote shutdown and has answered ping/TCP
**without interruption for 15 minutes** (counted from its last offline→online transition, so a PC
that just booted is not flagged; Q-5) without checking in since it came online shows
**"Desligamento remoto perdido: provável congelamento ou tarefa removida"** with a link to the
help page. "Saúde do sistema" shows how many machines are in this state.

**FR-308.4 Agenda on a frozen machine.** The agent always fetches the agenda at startup. If a
persistent area is configured (`-PersistentPath`, e.g. Deep Freeze ThawSpace `T:\UniWake`) or the
product allows an exclusion (UWF file exclusion, ADR-047), the agenda and pending reports are kept
there. Otherwise: **the scheduled shutdown depends on the machine having talked to the hub after its
last restart**; the help page and README explain it. The persistent folder is locked down to
Administrators and SYSTEM, so it must be a folder of its own: the panel and the script refuse a
top-level Windows folder (Windows, Users, ProgramData, Recovery, Boot, PerfLogs, EFI), "." or ".."
parts, and (script) an existing folder that already holds files not created by UniWake (D-M19-01).

**FR-308.5** Help page and README section "Laboratórios com Deep Freeze ou similar".
**FR-308.6** (roadmap only) Integration with the products' own features (e.g. Deep Freeze
shutdown schedules).

- AC-308-01 [Pester]: Given each detection fixture (none, Deep Freeze frozen, Deep Freeze thawed,
  UWF enabled, UWF disabled-next-boot, Reboot Restore Rx present), Then the reported state matches
  ADR-047's table, and unknown cases say "não verificado".
- AC-308-02 [Pester]: Given a frozen machine, Then "Desligamento remoto" is "ATENÇÃO" with the
  instruction and enrollment still succeeds.
- AC-308-03: Given a prepared machine online without interruption for 20 minutes without
  check-ins, Then the device shows "Desligamento remoto perdido" with the help link and "Saúde do
  sistema" counts it; given one online for 10 minutes after being offline, Then it is not flagged;
  a check-in clears it.
- AC-308-04 [Pester]: Given `-PersistentPath T:\UniWake` reachable, Then agenda and reports are
  stored there.

### FR-309 Readiness in the panel
Device list, device page and room page show **"Pronta para desligar"**, **"Precisa do novo
preparo"**, **"Desligamento remoto perdido"** or **"Desligamento remoto revogado"**, plus the
freezing state (FR-308.1), last check-in, agent version, sleep timeout ("Suspensão: após 30 min" /
"nunca" / "desconhecida", FR-301.1) and wake-timer state.

- AC-309-01: Given ready, v1.2, lost and revoked machines, Then each shows its state and only ready
  machines receive orders or agendas.

### FR-310 Demo mode
The simulated network gains simulated agents: ready machines check in, shut down on orders and
agendas, one postpones twice, two are v1.2 machines, one is frozen and becomes "perdido".

- AC-310-01: Given a demo start, Then those cases are present and nothing real is sent.

### FR-311 Help and README
Help pages "Desligar computadores" and "Laboratórios com Deep Freeze ou similar"; README:
features, preparation step, roadmap, troubleshooting (task missing, wake timers, freezing, clock).

- AC-311-01: Given the help menu, Then both pages open.

### v1.3 non-functional requirements
- **NFR-301 Load:** 500 machines checking in every 60 s → ≈ 8.3 requests/s; a check-in costs ≤ 5 ms
  of hub CPU without changes and the agenda is cached per device until relevant data change
  [perf test].
- **NFR-302 Lab PC cost:** the 1-minute task finishes in < 2 s when the hub answers or refuses the
  connection (service stopped); with every hub PC off it waits at most 3 attempts × 5 s (idle
  waiting, not CPU; amended in V3-T01: one 5 s timeout per request) [manual measurement in V3].
- **NFR-303 Security:** per-machine tokens (hash only), rotation, revocation, rate limits, signed
  answers and signed self-update (ADR-043, ADR-044); no inbound port on lab PCs.

### Owner decisions (2026-10-11, answers to Q-1..Q-10)
| Q | Decision | Where |
|---|---|---|
| Q-1 Exclusions | None by default; per schedule "não desligar máquinas com as etiquetas…"; per machine "Nunca desligar por agendamento"; manual shutdown of a flagged machine needs extra confirmation | FR-306.2, FR-305 |
| Q-2 User active | Shut down after warning and postpones; text says unsaved work is lost | FR-304.1, FR-304.1a |
| Q-3 Sleep | Prepare enables wake timers (AC, active plan, idempotent, in the summary); sleep timeout only read and reported, shown on the device page | FR-301.1, FR-309 |
| Q-4 Agenda | Explicit window of the next 14 days with concrete instants; nothing outside it runs; no separate validity rule | FR-303.1, FR-303.4 |
| Q-5 Lost | 15 min of uninterrupted ping/TCP without check-in; count on "Saúde do sistema" | FR-308.3 |
| Q-6 Privacy | Only "havia usuário logado" + number of sessions; user names never stored (LGPD) | FR-304.5 |
| Q-7 Manual | Default 1-min warning without postpone; choice "1 min" / "5 min com adiamento"; preview shows machines with a user logged on | FR-305 |
| Q-8 Message | Default text with {hora} + "Você pode adiar mais {n} vez(es)." suffix; customizable keeping placeholders | FR-304.1a |
| Q-9 Late wake | Run only if ≤ 60 min late and before the next "Ligar"; else "pulado: acordou {n} min após o horário" | FR-303.5 |
| Q-10 Restart | Manual only in v1.3; scheduled restart → roadmap RM-8 | FR-306.1, §11 |

## 6c. Functional requirements — v1.4 "Backup e migração" (roadmap §D; ADR-049..052)

Purpose: move or recover the UniWake **data** between PCs or after a reinstall with one portable
`.uniwake` file, made from the panel, on a schedule or from the command line. The existing
database backups (FR-014) stay: they restore this PC's whole database; a `.uniwake` file carries
only what makes sense on another PC.

**Assumptions taken by the Architect** (the owner asked for autonomous work; each is an ADR and can
be changed): A-1 file format is a gzip-compressed JSON document, not a zip (no new dependency,
ADR-049); A-2 secrets travel only inside a password-encrypted part (argon2id + AES-256-GCM,
ADR-050); A-3 import is blocked while the PC is in a team (ADR-051); A-4 an imported copy starts
"em espera": schedules paused and lab-PC check-ins refused until an administrator activates it
(ADR-051); A-5 automatic exports never carry secrets (no stored password, ADR-052).

### FR-401 Export
**FR-401.1** Page **"Backup e migração"** (admins): "Exportar" with section checkboxes, an optional
password (twice) and a download of `UniWake-<PC>-<AAAA-MM-DD>.uniwake`.

**FR-401.2 Sections** (default all but history):

| Section | Content | Needs password |
|---|---|---|
| Cadastro | rooms, tags, devices (with tags, notes, flags) | no |
| Agendamentos | schedules (wake and shutdown), exceptions, pause state | no |
| Configurações gerais | settings with scope `shared` | no |
| Usuários | users with their password hashes and roles | **yes** |
| Desligamento remoto | the machines' agent records (token hashes, readiness data) and this hub's signing key | **yes** |
| Histórico | schedule runs, shutdown jobs, orders and reports | no (off by default) |

Never exported: machine settings (scope `machine`: interfaces, addresses, ports, update, backup),
the instance id, team keys and members' secrets, sessions, enrollment tokens, wake jobs, packet
logs, audit, logs, backups. Without a password the sections that need one are left out and the
page says what must be redone on the other PC (create users; prepare the lab PCs again for
"Desligar").

**FR-401.3 File** (ADR-049): manifest (format version, app version, schema version, created at,
source PC name, sections, counts, whether secrets are included) + sections; SHA-256 of the
content in the manifest; the encrypted part has its own authentication tag. Maximum 50 MB.

### FR-402 Password and secrets (ADR-050)
**FR-402.1** Password of at least 10 characters, typed twice; never stored, logged or sent back.
**FR-402.2** Key from argon2id (salt per file, parameters in the file); secrets encrypted with
AES-256-GCM; the hub signing key is decrypted from DPAPI only to be re-encrypted.
**FR-402.3** A wrong password or a tampered file → "Senha incorreta ou arquivo alterado", nothing
imported.

### FR-403 Import (ADR-051)
**FR-403.1** "Importar": choose a file → the panel shows the manifest (origin PC, date, app version,
sections, secrets yes/no) → password if needed → **preview** → choose **Mesclar** or **Substituir**
→ type `IMPORTAR` to confirm.
**FR-403.2 Preview**: per section, how many items will be created, updated, kept unchanged, and the
conflicts with how they resolve (same name or MAC with another identity: renamed or kept, as in
team sync). Computed by applying the file inside a transaction that is rolled back.
**FR-403.3 Mesclar**: items are matched by their stable UUID; the newer version wins (same rule as
team sync); nothing on this PC is deleted. **Substituir**: Cadastro, Agendamentos, Desligamento remoto and
Histórico become exactly the file's (they reference each other), and Usuários and Configurações
gerais too when the file has them. Items the file also has are updated in place (their machine-local
history, status and test results stay); the others are removed. Machine settings, wake history,
audit and logs stay. It needs Cadastro and Agendamentos in the file. The hub signing key is imported only
when this PC has no prepared lab machine of its own; otherwise the preview says those machines
keep this PC's key and the machines of the other PC need the preparation command again.
**FR-403.4 Safety**: a database backup (kind `pre-import`) is taken first; after the import the
page offers **"Desfazer importação"** (until the next import or for 7 days), which restores that
backup (the existing restore flow, FR-014); the confirmation says that changes made after the
import are undone too. The import, its sections and mode are audited.
**FR-403.5 Versions**: files of older formats are converted; a file from a **newer** UniWake is
refused ("Arquivo de uma versão mais nova do UniWake (x.y.z): atualize este PC antes de importar").
**FR-403.6 Team**: while the PC is in a team, import is refused with the next step ("Importe num PC
fora da equipe e depois pareie" or "Saia da equipe"). Export works in a team.

### FR-404 Standby after import (ADR-051)
After an import with Agendamentos or Desligamento remoto the hub is **"em espera"**: schedules are
paused with reason "Importado de outro PC — revise e ative", lab-PC check-ins are answered with
"em espera" (no orders, no agenda changes), and a banner on every page offers **"Ativar este
UniWake"** (admins, typed confirmation). Wake and shutdown by hand keep working. Joining a team clears standby (the PC takes the team's
live data). This prevents two
PCs (old and new) from running the same schedules or answering the same machines with the same key.

### FR-405 Automatic exports (ADR-052)
Machine settings "Exportação automática": off by default; folder (local or network share
`\\servidor\pasta`), time, how many to keep. Files carry every section that does not need a
password. A failure (folder missing, no permission) appears in "Saúde do sistema". The service runs
as LocalSystem: on a share, the **computer account** needs write access (**não verificado** on the
institution's network; README explains).

### FR-406 Command line
`node.exe server.mjs` (install folder) `--export <file> [--sections a,b] [--password-env <VAR>]` (works while
the service runs: read-only snapshot) and `--import <file> --mode merge|replace
[--password-env <VAR>]` (refused while the service runs: "Pare o serviço UniWake antes"). Exit
codes: 0 ok, 2 usage, 3 refused (service running, team, newer file), 4 wrong password or damaged
file.

### FR-407 Help and README
Help page "Backup e migração": move to a new PC, reinstall, what needs the password, standby,
automatic exports to a share. README section.

### Acceptance criteria
- AC-401-01: Given a populated hub, When exported without password, Then the file has Cadastro,
  Agendamentos and Configurações gerais, no user, no key, no machine setting, and its manifest
  checksum matches.
- AC-401-02: Given "Usuários" ticked without a password, or a password shorter than 10
  characters, Then the export is refused with the reason.
- AC-402-01: Given an export with password, When imported with the wrong password or one changed
  byte, Then nothing changes and the error is "Senha incorreta ou arquivo alterado".
- AC-402-02: Given an export with password, Then no secret (password hash, private key) appears in
  clear in the file.
- AC-403-01: Given a file and a PC with overlapping data, Then the preview counts creates, updates,
  unchanged and conflicts, and the database is unchanged afterwards.
- AC-403-02: Given Mesclar, Then nothing local is deleted and newer versions win; given Substituir,
  Then the exported sections equal the file's and machine settings stay.
- AC-403-03: Given an import, Then a `pre-import` backup exists and "Desfazer importação" requests
  its restore.
- AC-403-04: Given a file from a newer format, Then it is refused with the version in the message.
- AC-403-05: Given a PC in a team, Then import is refused and export works.
- AC-403-06 [E2E]: Given the panel, When an admin exports with a password and imports the file into
  another hub with preview and confirmation, Then the rooms appear on the other hub.
- AC-404-01: Given an imported copy, Then schedules are paused, check-ins get "em espera", and
  "Ativar este UniWake" ends both.
- AC-405-01: Given automatic export on, When its time comes, Then a file is written to the folder,
  only the newest N are kept, and a missing folder shows in "Saúde do sistema".
- AC-406-01: Given the CLI, Then `--export` writes a valid file and `--import` refuses while the
  hub runs, with the exit codes of FR-406.
- AC-407-01: Given the help menu, Then "Backup e migração" opens.

### v1.4 non-functional requirements
- **NFR-401** Export and preview of 500 devices, 50 schedules and a year of runs in < 3 s; file
  < 5 MB.
- **NFR-402** Import is one transaction: a crash leaves the database as before.
- **NFR-403** No new runtime dependency (gzip from `node:zlib`, crypto from `node:crypto`).

## 6d. Field fixes — v1.5 "Desligamento agendado e status confiáveis" (ADR-053..056)

Field report on v1.4.0 (2026-10-15): scheduled wake works; manual shutdown works; **scheduled
shutdown never happens on any PC** (agent agenda `{"items":[],"nextWakes":[]}`, version
`8a818e7a…` constant, i.e. the hub served an agenda that matched no schedule at all — not even the
wake schedules that do wake those PCs); **online status is wrong for PCs that are on**; the log
shows "probe helper missed its deadline; restarting it" at every start.

Root causes found (Phase 13 debug, `specs/reviews/phase-13-debug.md`):
- **Status:** one empty address in a ping batch makes the ICMP helper answer `{"id":null,…}`; the
  hub ignored that answer, waited for the deadline, restarted the helper and marked **every device
  of the batch** (up to 256) dead. Reproduced and fixed (FR-503.5).
- **Scheduled shutdown:** by design (ADR-048) shutdowns ran **only** from the agent's agenda, with no
  path from the hub at fire time and nothing in the schedule history, so any agenda problem was
  silent. The served agenda matched no schedule for the agent's device; the matching code is the one
  the working wake scheduler uses, and fresh or v1.2-upgraded databases produce correct agendas, so
  the field data (most likely the device record the agent token points to vs the records the
  schedules target) could not be reproduced here. FR-501..502 add the hub path, per-schedule
  explanations and duplicate detection so the field shows exactly why.

### FR-501 Scheduled shutdown: two paths, one execution
**FR-501.1 Pull (agenda).** Unchanged contract; the agenda for a device lists every enabled
shutdown occurrence whose target includes it (same resolution as the wake scheduler and manual
shutdown), minus excluded tags and "Nunca desligar por agendamento"; its version changes whenever
its items change and the cache is invalidated by any schedule change. The agent runs items from
its stored agenda even with the hub off.
**FR-501.2 Push (order).** When the hub is running, at **T − aviso − 1 min** (T = shutdown time) the
scheduler sends a shutdown order for the occurrence to every targeted ready machine **through the
manual-shutdown service** (same orders, warning, postpone and active-user rules, same live job
view). In team mode only the hub that wins the schedule lease sends it.
**FR-501.3 One execution.** Both paths carry the same run id (the occurrence UUID, v5 of schedule
UUID + T). The agent records it in its handled ids whichever path runs first and ignores the other.
**FR-501.4 Reconciliation.** 10 minutes after T, per targeted machine: **desligou** (report or
monitor offline) with the path that ran it (**agenda** / **ordem direta**), **adiado — usuário
ativo**, **ainda ligado**, **sem agente**, **agenda desatualizada** (its last check-in got an agenda
version without the item), **sem resposta** (no check-in since before the warning). "Ainda ligado"
with no reason gets **one** retry through the push path. Results appear in the schedule's
history (Agendamentos › Execuções) and in Histórico.
**FR-501.5 This PC.** If a shutdown (scheduled or manual) targets the PC that runs the hub, the
form and the preview say so ("Inclui este PC, que roda o UniWake…"); it is never skipped silently.
**FR-501.6 Wake unchanged.** The scheduled wake path changes only in shared code.

### FR-502 Why a machine has (no) scheduled shutdown
**FR-502.1** Per device, for each enabled shutdown schedule: included or the reason (target does not
include it — with the target and the machine's room/tags —, excluded tag, "Nunca desligar por
agendamento", machine disabled, no occurrence in the window, holiday/vacation/pause).
**FR-502.2** Enrollment that **creates** a new device while another device has the same hostname
records a notice "Possível máquina duplicada" (both names and MACs) on the dashboard and the
device page.

### FR-503 Online status from several signals
**FR-503.1** A device is **online if any signal is positive**: (1) **agent check-in** in the last 2
minutes (strongest), (2) ICMP echo, (3) TCP connect on the configured ports (135, 445, 3389), (4)
the hub's neighbor (ARP) table has the device MAC in state *Reachable*. Lab PCs open no port of
their own (the agent only connects out), so there is no agent port to probe.
**FR-503.2** Offline only after `monitor.offlineAfter` (default 2) consecutive sweeps with every
signal negative.
**FR-503.3** The device's IP follows its MAC: the source address of its last agent check-in, then
its neighbor-table entry, then DNS; a changed IP is recorded with its source and used from the next
sweep (never keep probing a stale DHCP address).
**FR-503.4** The panel shows the confirming signal and time: "Ligada — agente/ping/porta/ARP, há 1
min", and the IP's source.
**FR-503.5** The ICMP helper answers every request with its id, errors per address; the hub never
sends an empty address; if the helper fails, the sweep logs one warning and uses the other
signals.

### FR-504 Diagnostics
**FR-504.1** Device page "Desligamento remoto": agent version, last check-in, agenda version and item
count it holds (as last served), next scheduled shutdown (local time), last shutdown result and
path, current IP and how it was learned, plus FR-502.1.
**FR-504.2** Info-level hub log lines: schedule fired (action, schedule, targets), agenda changed
(device, version, items), agenda served with a new version (device, version), push order sent
(occurrence, count), reconciliation result (occurrence, counts).
**FR-504.3** "Testar agendamento" (device page, admin/operator): a one-off scheduled shutdown of that
machine in N minutes (2–60), delivered through **both** paths and reconciled like a schedule.

### Acceptance criteria
- AC-501-01: Given a room-, tag- or device-targeted shutdown schedule, Then the agenda of every
  targeted ready device lists its occurrences (America/Sao_Paulo time) and its version changes when
  the schedule is created, edited, disabled or deleted.
- AC-501-02: Given the hub running at T − aviso − 1 min, Then each targeted ready machine gets one
  order carrying the occurrence id, with the schedule's warning and postpone policy, excluded tags
  and flagged machines left out.
- AC-501-03 [Pester]: Given the same occurrence by agenda and by order, Then the agent runs it once,
  whichever comes first.
- AC-501-04: Given the hub off at fire time, Then nothing is pushed and the agent's agenda still
  shuts the machine down (fake agent); after a hub restart before T + 60 min the push is sent and
  ignored by the agent that already ran it.
- AC-501-05: Given reconciliation at T + 10 min, Then each machine has one result with its path,
  and "ainda ligado" without a reason gets exactly one retry.
- AC-501-06: Given a shutdown targeting the hub's own PC, Then the preview and the schedule form
  warn.
- AC-501-07: Given scheduled wake schedules, Then they fire exactly as before (regression).
- AC-502-01: Given a device not targeted, Then the explanation names the schedule and the reason.
- AC-502-02: Given an enrollment that creates a device with the hostname of another, Then a
  duplicate notice is recorded.
- AC-503-01: Given ICMP blocked but a check-in 1 minute ago, Then the device is online "via
  agente".
- AC-503-02: Given a DHCP change (new IP in the check-in source / neighbor table), Then the next
  sweep probes the new IP and an IP change event names its source.
- AC-503-03: Given one negative sweep, Then the status stays online; after two, offline.
- AC-503-04 [CI-Win]: Given an empty or invalid address in a batch, Then the helper answers with the
  request id and per-address errors; the hub resolves the batch without a deadline restart.
- AC-504-01: Given "Testar agendamento" in 5 minutes, Then the device agenda has a one-off item and
  the push is sent at its time; the result is reconciled.
- AC-504-02: Given the device page, Then it shows agenda version, item count, next shutdown, last
  result with path and the IP source.

## 6e. v1.6 "Máquinas que se atualizam e avisam" (ADR-058..061)

Owner request after the v1.5.0 field test (2026-10-16): the log showed a test schedule whose only
machine was **excluded** ("1 excluída", `Nunca desligar por agendamento` or an excluded tag) while the
schedule form had said it reached "1 máquina pronta"; both orders left ~100 s **after** T because the
schedule was saved with a time already past. The owner also asked (a) whether hibernated computers can
be shut down, (b) for an update of prepared machines that really works without preparing them again,
and (c) to be told when an antivirus blocks a UniWake file.

### FR-601 Excluded machines are never hidden
**FR-601.1** The reach summary of a "Desligar" schedule (form) uses the schedule's own rules: machines
marked "Nunca desligar por agendamento" and machines with an excluded tag are not counted as reached;
they are listed apart with the reason (`never_flag` / `excluded_tag`), up to 5 names and a count.
**FR-601.2** Reconciliation and history count excluded targeted machines as **"excluída do
agendamento"** with the reason; "nenhuma máquina no alvo" only when the target has no machine at all.

### FR-602 Saving a schedule never shuts machines down at once
**FR-602.1** An occurrence of a "Desligar" schedule whose time is not after the schedule's last save
(create, edit, enable) is neither pushed by the hub nor listed in the agendas. Occurrences that pass
while the hub is off keep the 60-minute late rule (ADR-053). Wake schedules are unchanged.

### FR-603 Agent update that works and tells what happened
**FR-603.1** The signed answer lists the hub's features (`features`); the agent sends the optional
`health` part of the check-in only to hubs that list `health` (a mixed team keeps working).
**FR-603.2** Self-update verifies what it wrote: after replacing a script the agent reads it back and
compares its SHA-256. Outcome per update attempt: `updated`, `download_failed`, `hash_mismatch`,
`write_blocked` (Windows refused the write; the virus error codes 225/226 mean the antivirus),
`removed_after_write` (gone or changed right after writing: antivirus probable). The last outcome,
the file and the time go in `health.update`.
**FR-603.3** Self-install: when the running script's install level is newer than the one recorded on
the machine, the agent itself applies the install steps of each newer level (level 2, v1.6.0: the
verified copy of its scripts and the repair task; later levels add their own, e.g. new task
definitions). Machines whose agent runs never need "Preparar máquinas" again for agent changes.
**FR-603.4** Repair task "UniWake Reparo" (SYSTEM, at start-up and every 30 min; an inline command, no
script file of its own): when an agent script is missing or differs from the verified copy, it restores
the copy and leaves a note; the agent reports the note at its next check-in (`health.repairs`). When it
cannot restore, it sends `POST /agent/v1/alert` (token-authenticated, nothing executed from the answer).
**FR-603.5** The hub keeps the latest health of each machine (machine-local) and shows on the device
page: agent version vs. the version this hub ships, last update outcome and reason, repairs, antivirus.
The Dispositivos list marks machines whose agent is blocked or outdated; "Saúde do sistema" counts
machines with an outdated agent.

### FR-604 Antivirus that blocks UniWake is reported
**FR-604.1** Every 15 minutes, and right after a failed update or a repair, the agent reads the
installed antivirus products (Windows Security Center: name, enabled, up to date) and the Microsoft
Defender detections of the last 14 days that touch the UniWake folders (threat, file, time, action).
It sends them only when they change.
**FR-604.2** A new detection, a blocked/removed update or a repair creates the dashboard notice
**"Antivírus bloqueou o UniWake em <máquina>"** (one per machine and kind per day) naming the product,
the file, the time and the folder to allow; the device page shows the same.
**FR-604.3** A prepared machine that answers the network but whose agent stopped checking in
("Desligamento remoto perdido") shows the probable causes (antivirus, task disabled, freezing) and the
last health it sent.

### FR-605 Sleeping and hibernated machines
**FR-605.1** The agent reports how it came back after a gap (same boot = suspended or hibernated,
`Kernel-Power` event 42 tells which when readable) and its hibernation settings; the device page shows
the last one ("estava hibernada de … a … — não desligou").
**FR-605.2** "Acordar para desligar" (setting `power.wakeForShutdown`, default on): when a scheduled
shutdown is pushed or a manual "Desligar" is sent, ready targeted machines that do not answer but whose
agent checked in during the last 12 hours get one magic packet; the queued order runs when they wake.
**FR-605.3** "Impedir suspensão e hibernação" (setting `power.preventSleep`, default **off**): the agent
sets the AC sleep and hibernate timeouts to "never" and turns hibernation off (which also turns off
Fast Startup), saving the previous values, and restores them when the setting is turned off.

### Acceptance criteria
- AC-601-01: Given a "Desligar" schedule targeting a room with one machine marked "Nunca desligar por
  agendamento" and one with an excluded tag, Then the reach says 0 machines reached and lists both with
  their reasons.
- AC-601-02: Given that schedule fired and reconciled, Then the run detail says "2 excluídas do
  agendamento" (not "nenhuma máquina no alvo") and the history lists both as excluded with the reason.
- AC-602-01: Given a schedule saved at 11:33 for 11:32, Then no order is pushed and no agenda lists
  11:32; the next day's 11:32 is pushed and listed normally.
- AC-602-02: Given a schedule saved at 11:00 for 11:32 and the hub off from 11:20 to 11:40, Then at
  11:40 the order is pushed (late) as before.
- AC-603-01: Given a hub without `health` in `features` (v1.5.0), Then the agent sends no `health`
  and the check-in is accepted; with the feature, `health` is sent and stored.
- AC-603-02: Given a script write refused with error 225, Then the outcome is `write_blocked` with the
  antivirus reason; a file gone right after writing is `removed_after_write`; both reach the hub and
  create the notice.
- AC-603-03: Given a machine prepared with an older install level, Then the next run re-registers the
  tasks, writes the verified copy and the repair task, and records the new level, once.
- AC-603-04: Given the agent script deleted, Then the repair command restores it from the verified
  copy and leaves the note the agent reports; with the copy deleted too, it posts the alert.
- AC-603-05: Given health reports, Then the device page shows version vs. latest, update outcome,
  repairs and antivirus; the list marks blocked/outdated machines; health counts outdated agents.
- AC-604-01: Given a Defender detection on a UniWake file, Then the next check-in carries it once and
  the hub creates one notice naming product, file and time.
- AC-604-02: Given a "perdido" machine, Then its page lists the probable causes and its last health.
- AC-605-01: Given a gap with the same boot time, Then the agent reports a resume (`hibernate` when
  event 42 says so) and the device page shows it.
- AC-605-02: Given a pushed scheduled shutdown and a manual "Desligar", Then ready offline machines
  seen in the last 12 h get one magic packet (fake sender) and the others none; with the setting off,
  none.
- AC-605-03: Given `power.preventSleep` turned on and then off, Then the agent applies the AC timeouts
  and hibernation off, then restores the saved values (powercfg calls asserted, nothing real run).

## 7. Non-functional requirements
| ID | Requirement | Measure / test |
|---|---|---|
| NFR-01 | Scale | 500+ devices; sweep < 30 s with defaults (AC-004-06); device list API for 500 devices < 300 ms [API benchmark]; dashboard with 500 devices interactive < 2 s [E2E on CI]. |
| NFR-02 | Resilience | Auto-start after reboot (AC-001-01b); network loss: sends fail and are logged, scheduler keeps ticking (AC-003-16); restart mid-job (AC-003-17); claim-then-execute (AC-005-03). |
| NFR-03 | Configurable | Every setting has a UI control (AC-016-01). |
| NFR-04 | Logs | pino JSON; rotation 10 MB × 10 files; viewer (FR-016). |
| NFR-05 | Privacy | Outbound HTTP only to `api.github.com`, `github.com` and `objects.githubusercontent.com` / `release-assets.githubusercontent.com`; enforced by the HTTP client adapter allowlist (unit test). |
| NFR-06 | Quality | Core coverage ≥ 80% (constitution §5); CI green before any release. |
| NFR-07 | Accessibility | Playwright + axe: no serious/critical violations on dashboard, room, devices, schedules, settings, login. |
| NFR-08 | Footprint | Idle hub < 300 MB RAM, < 2% average CPU between sweeps [manual]. |
| NFR-09 | Browsers | Current Edge and Chrome. |

## 8. Conventions and limits
**UI conventions.** pt-BR; dates `dd/mm/aaaa HH:mm` (24 h); relative times with absolute on hover;
touch targets ≥ 44 px on primary actions; every list has loading/empty/error states.

**Field limits** (shared Zod schemas):

| Field | Limit |
|---|---|
| Device name, room name, schedule name | 1–64 chars |
| Tag name | 1–32 chars |
| Hostname | ≤ 253 chars, DNS charset |
| Notes, descriptions | ≤ 1000 chars |
| Room code | `[A-Z0-9-]{2,16}` |
| Username | 3–32 chars `[a-z0-9._-]` |
| Password | 10–128 chars |
| CSV import file | ≤ 2 MB, ≤ 5000 rows |
| Enrollment body | ≤ 8 KB |

## 9. Defaults
| Setting | Default |
|---|---|
| Panel port / bind | 47100 / 127.0.0.1 (HTTPS on LAN address when enabled) |
| Agent listener port / bind | 47101 / 0.0.0.0 |
| Confirmation threshold | 40 devices |
| Wake ports / repeat | [9, 7] / 3 (100 ms apart) |
| Stagger batch / delay / global cap | 10 devices / 5 s / 30 devices per step |
| Verify interval / window | 15 s / 5 min |
| Sweep interval / concurrency | 60 s / 64 |
| ICMP / TCP timeout | 1000 ms / 800 ms |
| TCP probe ports | 135, 445, 3389 |
| Offline after | 2 consecutive failed sweeps |
| Hostname resolution cache | 5 min |
| Schedule grace window | 15 min |
| Update mode / window / check interval | auto / 03:00–05:00 / 6 h |
| Update health-check timeout | 120 s |
| Session idle / absolute | 12 h / 7 d |
| Enrollment token expiry / max uses | 8 h / 100 |
| Rate limits | wake 30/min/user; login 20/min/IP; enroll 10/min/IP |
| Retention: history / packet log / audit | 180 d / 30 d / 365 d |
| Backup time / retention | 02:30 / 14 daily |
| Timezone | America/Sao_Paulo |

## 10. Out of scope for v1.0
- FR-101 (v1.1) and the roadmap.
- IPv6 Wake-on-LAN; Wake-on-Wireless.
- Per-room permissions (every operator can wake every room).
- (v1.0 only) Syncing several installations: team mode is v1.2 (§6a); v1.0 stores data ready for it.
- Mobile app (the panel is usable on a tablet).
- TLS on the agent listener (RM-5; v1.3 signs agent answers instead, ADR-044).

## 11. Roadmap (spec only)
Versions after v1.1 (`.agents/07-roadmap-features.md`): **v1.2** team mode (LAN sync between
instances, pairing, schedule lease), **v1.3** remote/scheduled shutdown through scheduled tasks on
the lab PCs (§6b, replaces RM-2), **v1.4** backup, restore and migration (portable `.uniwake` export/import, §6c). Each gets its own
spec section when its SDD cycle starts.
- **RM-1 Relay agent per VLAN** — authenticated service on one PC per VLAN that broadcasts locally
  on hub request.
- **RM-2** — moved to §6b (v1.3). Still roadmap: CPU/RAM/disk inventory reported by the agent.
- **RM-3 Notifications** (e-mail/Telegram) for failed scheduled wakes, fed by FR-013.
- **RM-4 Vendor BIOS tooling** (Dell Command | Configure, HP BCU, Lenovo WMI) to enable WoL remotely.
- **RM-5 TLS on the agent listener** with certificate thumbprint pinned in the command (IMP-023).
- **RM-6 Per-room permissions** for larger IT teams.
- **RM-7 Freezing products' own features** — e.g. drive Deep Freeze's own shutdown/maintenance
  schedules from UniWake (FR-308.6).
- **RM-8 Scheduled restart** (e.g. weekly) as a schedule action (owner, Q-10).

## 12. Traceability: improvements → requirements
| IMP | Requirement |
|---|---|
| IMP-001 | FR-015 |
| IMP-002 | FR-009 |
| IMP-005 | FR-010, FR-007.4 |
| IMP-006 | FR-003.6 |
| IMP-007 | FR-011 |
| IMP-008, IMP-013, IMP-022 | FR-012 |
| IMP-009 | FR-010 |
| IMP-010 | FR-014 |
| IMP-011 | FR-004.3 |
| IMP-012 | FR-002.1 (AC-002-03/04), FR-007.1 |
| IMP-014, 015, 017, 018 | constitution §5, §6, §4.2 |
| IMP-019 | FR-013 |
| IMP-020 | FR-005.6 |
| IMP-021 | FR-007.1 step 5 |
| IMP-023 | RM-5 |
| IMP-024 | FR-003.3 |
| IMP-025 | FR-007.3 |
| IMP-026 | FR-004.7 |
| IMP-027 | FR-001.3 (AC-001-13) |
