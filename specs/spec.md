# UniWake — Specification

Version: **1.1** · Date: 2026-10-04 · Owner: Architect
History: v0.1 draft → reviewed in `specs/reviews/phase-1-*.md` → consolidated as v1.0 → v1.1
(Phase 2: AC-001-13/14, FR-004.7).
Sources: `.agents/01-project-brief.md`, `specs/constitution.md`, `specs/improvements.md`,
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
Per-device result: `acordou`, `já estava ligado`, `não respondeu`, `falha no envio`, `excluído`.
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
5. Unless `-NoFirewallChange`, enable the built-in "Echo Request – ICMPv4-In" rule for Domain and
   Private profiles (IMP-021).
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
05:00–08:00, with pt-BR instructions.
- AC-012-01: Given the scheduler's last tick older than 2 min, Then the page shows "Agendador
  parado" in red and public health is `degraded`.
- AC-012-02 [API]: Given no session, Then `/api/health` body has only `status`.
- AC-012-03: Given a GitHub `Date` 5 min ahead of the local clock, Then a clock warning is shown.

### FR-013 Morning result (IMP-019)
After each scheduled run's verification window, a "Resultado da manhã" card shows per room the
devices that did not wake (and `falhou` runs), pinned on the dashboard until acknowledged.
- AC-013-01: Given a scheduled run with 2 non-responders in Lab 1, Then the card lists them and
  disappears after "Ciente" (acknowledgement audited).

### FR-014 Backups (IMP-010)
Daily backup (default 02:30) + pre-migration + pre-update; retention default 14 daily. Admin
lists and restores from the panel; restore takes a backup of the current DB first, requires typing
the backup date to confirm, is audited, and restarts the service.
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
- Multiple hubs / high availability.
- Mobile app (the panel is usable on a tablet).
- TLS on the agent listener (RM-5).

## 11. Roadmap (spec only)
- **RM-1 Relay agent per VLAN** — authenticated service on one PC per VLAN that broadcasts locally
  on hub request.
- **RM-2 Remote shutdown/restart; lightweight target agent** (CPU/RAM/disk/logged user).
- **RM-3 Notifications** (e-mail/Telegram) for failed scheduled wakes, fed by FR-013.
- **RM-4 Vendor BIOS tooling** (Dell Command | Configure, HP BCU, Lenovo WMI) to enable WoL remotely.
- **RM-5 TLS on the agent listener** with certificate thumbprint pinned in the command (IMP-023).
- **RM-6 Per-room permissions** for larger IT teams.

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
