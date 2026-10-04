# Phase 0 review — Debug & Problem Solver

Reviewed: `specs/constitution.md` v0.1 · Date: 2026-10-04
Lens: what will go wrong, and which **rules** must be in the constitution so the fix is built in
from day one. Detailed behavior goes to the spec (Phase 1); the items marked → Spec are carried over.

## 1. Conflict found in the draft (must resolve)
**P2 "panel bound to 127.0.0.1" vs FR-007 self-enrollment.** `prepare-target.ps1` runs on the
target PC and POSTs to the hub. If the hub listens only on loopback, enrollment can never work
out of the box. The technician will then enable "LAN exposure" for the whole panel to make
enrollment work and leave it on, which is worse than either option alone.
Proposal: two surfaces. (a) Panel + full API on loopback by default. (b) A minimal LAN
"agent" surface exposing only enrollment and health, with its own firewall rule. Full panel on
LAN stays an explicit admin setting.

## 2. Failure-mode analysis

### 2.1 Magic packet does not reach the target
| Failure | Cause | Rule / mitigation |
|---|---|---|
| Different VLAN | Limited broadcast (255.255.255.255) never crosses a router; directed broadcast is disabled by default on most routers. | → Spec: per-room "network" (subnet + optional unicast/relay target). UI must say plainly that cross-VLAN needs router config or a relay (roadmap). Blocker for real validation: network team. |
| Wrong interface | On a multi-NIC Windows host, a socket sending to 255.255.255.255 goes out **one** interface (the route with lowest metric), not all. VPN, Hyper-V vEthernet and Wi-Fi adapters are common on an IT PC. | Constitution: the sender binds one socket per selected interface's local IPv4 and sends both limited and subnet-directed broadcast from each. Interface list is read at send time, not cached at startup (DHCP can change the controller's IP). |
| Wi-Fi MAC registered | Technician copies the MAC from "Wi-Fi" in Settings; WoL over Wi-Fi basically never works from S5. | → Spec: enrollment picks the wired physical adapter; reject/flag wireless, virtual and locally-administered (randomized) MACs (IMP-012). |
| Packet sent but nobody can prove it | — | Constitution P4: every packet sent is logged (job, MAC, interface IP, destination, port, timestamp, error). (IMP-006) |

### 2.2 Target does not wake
BIOS WoL off, ErP/EuP "deep sleep" on, Fast Startup (hybrid shutdown leaves NIC in a state some
drivers won't wake from), NIC "Wake on Magic Packet from power off state" (Intel) / "Shutdown
Wake-On-Lan" (Realtek) disabled, PC unplugged from power or switch port, switch port PoE/EEE
power saving. **Windows feature updates and NIC driver updates silently reset advanced NIC
properties**, so a machine that woke last month may stop.
- → Spec: per-device wake history and success rate, with a "parou de acordar" flag when a device
  that used to wake stops (IMP-009). Diagnostic page per device (IMP-005).
- prepare-target.ps1 must be idempotent and safe to re-run after updates.

### 2.3 False offline / false online
- ICMP blocked by Windows Firewall by default → TCP probe 135/445/3389.
- **A TCP connection refused (RST) means the host is ON.** Only a timeout means "no answer".
  Treating `ECONNREFUSED` as offline would mark every firewalled-but-up PC offline. → Spec + test.
- Host up but all probes filtered → "desconhecido", never "offline" by default. → Spec.
- **DHCP reuse:** the device's old IP now belongs to another PC, which answers → false online.
  And the device itself got a new IP → false offline. Mitigation: re-resolve hostname each sweep
  (with cache), verify MAC via ARP cache on the same subnet, flag "IP mudou". (IMP-011)

### 2.4 Scheduler
| Failure | Rule |
|---|---|
| Service down / controller rebooting at 06:50 | On start, run missed occurrences only inside the grace window; outside it, record "perdido" with reason. |
| Double execution (two timers, restart mid-run, clock jumps back) | Constitution: **claim-then-execute** — insert a row with a unique key `(schedule_id, planned_at_utc)` in a transaction before firing; a second claim fails. |
| DST | Brazil has no DST since 2019, but timezone is configurable. Rules: a local time that doesn't exist (spring forward) runs at the first valid instant after it; an ambiguous time (fall back) runs once at the first occurrence. |
| Clock drift / NTP correction | Never schedule with one long `setTimeout`. Tick every ≤ 30 s and compare the wall clock against "next due"; this tolerates jumps and sleep. Health page shows time-sync status. |
| Controller PC sleeps at night | Nothing fires. Health page warns if the power plan allows sleep; installer may set "never sleep" on AC (IMP-013). |
| Holiday forgotten / global pause forgotten after a holiday | Exception dates; paused state banner (see Architect IMP). |

### 2.5 Update
| Failure | Rule |
|---|---|
| Download interrupted / truncated | Download to a temp file, check size, verify SHA-256, then rename. Retry with backoff. |
| Checksum mismatch | Abort, keep current version, audit + log, show in panel. Never execute an unverified file. |
| AV quarantines unsigned installer; SmartScreen | Install runs from the service (no Mark-of-the-Web / interactive SmartScreen), but Defender can still flag unsigned binaries. Code signing needed → BLOCKER for owner. |
| New version fails to start | Previous version kept side by side; updater (a **separate process**, since the service cannot replace its own files while running) waits for the health endpoint; on failure, restores previous binaries **and the pre-update DB backup** and restarts. |
| Migration fails half-way | Migrations transactional; DB backup taken before the first migration of a new version. |

### 2.6 Concurrency
- Two operators press "Ligar sala" on the same room within seconds (different shifts overlap):
  two jobs, double packets, two verification windows racing on the same device rows.
  → Spec: a device belongs to at most one *active* wake job; a second request reports
  "já em andamento" and links to the running job (sending extra packets is harmless, but double
  job state and double audit results are confusing).
- Status sweep running during a large wake: verification polling must not wait behind a full
  500-device sweep. → Plan: prober work queue with priority for verification probes.
- SQLite: single writer. All writes go through one connection; long reads don't block in WAL.

### 2.7 Enrollment
| Failure | Rule → Spec |
|---|---|
| Same MAC already registered | Update that device (hostname/IP/hardware info), never create a duplicate. |
| Device already in another room | Move it to the token's room and write an audit entry "movida de X para Y"; show it in the panel. |
| Token expired / revoked / max uses reached | Clear pt-BR error to the script, distinct per case. |
| Token leaked (plain HTTP on LAN) | Tokens short-lived, room-scoped, revocable, stored hashed. Acceptable risk for v1, documented. |

### 2.8 Environment traps that are constitution-level
- **PowerShell 5.1 + encoding:** `prepare-target.ps1` is run with Windows PowerShell 5.1, which
  reads a BOM-less file as the ANSI codepage, so pt-BR accents become mojibake and string
  comparisons can break. Rule: `.ps1` files are UTF-8 **with BOM**, CRLF, PS 5.1-compatible
  (no `??`, ternary, `-Parallel`), `Set-StrictMode -Version Latest`, `$ErrorActionPreference = 'Stop'`.
- Execution policy blocks the script: the panel's command line must use
  `powershell -NoProfile -ExecutionPolicy Bypass -File ...`.
- **Power loss on the controller:** WAL with `synchronous=NORMAL` can lose the last transactions on
  power loss (not corrupt), `FULL` keeps them. Our write volume is low; use `FULL`. Daily DB backups
  with retention (IMP-010).
- Log disk fill: rotation by size and count (NFR-04).

## 3. Fault injection requirement
§2.2 says every port has a fake. Fakes must also support **injected failures**: timeouts,
partial results, errors on Nth call, interface disappearing mid-send, clock jumps. Otherwise
we only ever test the happy path.

## 4. Improvements proposed
- **IMP-005** "Diagnóstico de WoL" per device: automated checklist (MAC valid and wired, last
  successful wake, which interfaces/broadcasts would be used, subnet match with the controller,
  probe ports reachable, prepare-target run date) plus manual BIOS checklist.
- **IMP-006** Packet send log, queryable per job and per device.
- **IMP-007** Interface/broadcast preview in settings: "os pacotes sairão por: Ethernet
  (10.0.3.15) → 10.0.3.255 e 255.255.255.255".
- **IMP-008** Health page: service uptime, DB size and last backup, scheduler next run and last
  tick, last sweep duration vs NFR-01, update status, time sync, power-plan sleep warning.
- **IMP-009** Wake reliability per device, "parou de acordar" regression flag.
- **IMP-010** Automatic DB backups: daily, pre-migration, pre-update; retention N; restore steps in README.
- **IMP-011** IP drift detection (hostname re-resolution, ARP MAC check, "IP mudou" flag).
- **IMP-012** Enrollment/CSV MAC sanity: prefer wired physical adapter; flag wireless, virtual and
  locally administered MACs.
- **IMP-013** Controller sleep guard (health warning; optional installer power setting).
