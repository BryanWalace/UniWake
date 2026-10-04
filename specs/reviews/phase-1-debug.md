# Phase 1 review — Debug & Problem Solver

Reviewed: `specs/spec.md` v0.1 · Date: 2026-10-04
Lens: does each requirement survive the failure modes from Phase 0?

## 1. Monitoring semantics (FR-004)
**D1-01 Firewalled PCs look offline.** AC-004-04 marks a device `offline` when all probes time out.
A PC with ICMP blocked and 135/445/3389 filtered (common with third-party AV firewalls) is on but
shows `offline`. Consequences: misleading dashboard, "Ligar só os desligados" includes it (harmless),
and **verification reports `não respondeu` for a PC that did wake** (harmful: wrong diagnosis).
*Proposals:*
1. `prepare-target.ps1` enables the built-in "Echo Request – ICMPv4-In" firewall rule for
   Domain/Private profiles (switch `-NoFirewallChange` to skip). (IMP-021)
2. Device flag **"nunca respondeu"** when a device has never been seen online; the UI explains
   that it may be firewalled and links to diagnostics.
3. Debounce: online → offline only after **2 consecutive** failed sweeps (configurable);
   offline → online immediately. Avoids flapping on packet loss.

**D1-02 `desconhecido` is underspecified.** Define: no IP and hostname unresolvable; device
disabled; or not probed since the hub started (stale status must not be shown as current).

**D1-03 Verification must probe directly.** Wake verification should probe its devices on the
priority queue, not read the cached status from the last sweep (up to 60 s old).

## 2. Wake engine (FR-003)
**D1-04 Default interface set is too wide.** "Gateway or private address" includes Hyper-V
"Default Switch" (172.x), VirtualBox host-only (192.168.56.x) and VPN adapters. Packets there
are noise and make the packet log misleading.
*Proposal:* default = up, non-loopback IPv4 interfaces **with a default gateway**; exclude APIPA
(169.254/16); others are opt-in in settings.

**D1-05 Network not ready at boot.** The controller reboots at 06:45 (Windows Update), the service
starts, the 06:50 run fires, DHCP isn't finished → `NO_NETWORK_INTERFACE` → whole morning lost.
*Proposal:* for scheduled jobs, when no interface is usable, retry every 30 s until the grace
window ends, then fail with a clear log entry.

**D1-06 Parallel rooms defeat stagger.** Stagger exists to avoid inrush current on circuits. Ten
rooms in parallel × batch 10 = 100 PCs at once. *Proposal:* a global limiter
`wake.maxDevicesPerStep` (default 30) caps devices started per stagger step across all rooms.

**D1-07 "Testar WoL" right after shutdown.** Some NICs only arm WoL a few seconds after power-off.
The flow should wait for `offline` **plus 30 s** before sending.

## 3. Scheduler (FR-005)
**D1-08 Multiple missed occurrences.** If the hub was down for a weekend, only the most recent
occurrence inside the grace window may run; every other one is logged `perdido`. Add an AC.
**D1-09 Restart mid-job.** A job interrupted by a restart must resume verification if its window
hasn't ended, else close as `interrompido`. Add AC (NFR-02 mentions it, no AC).

## 4. Update (FR-001)
**D1-10 Default `update.mode = manual` contradicts the brief** ("Installer & auto-update",
"silent install"). *Proposal:* default `auto`, maintenance window 03:00–05:00 local (the controller
runs 24/7 for schedules anyway), and the updater **must not start** if a schedule is due within
60 min or a wake job is active. Manual "Atualizar agora" always available to admins.
**D1-11** Health-check timeout for the new version: 120 s default. Backup at 02:30, before the
window.

## 5. Environment
**D1-12 Windows Update reboots the controller** near the morning schedule. Health page should warn
when a reboot is pending and when Windows Update active hours don't cover 05:00–08:00, with
instructions. (IMP-022)
**D1-13 Time sync without parsing localized `w32tm` output.** Use the `Date` header from the
GitHub update check (already an allowed call, P5) to estimate clock skew; warn when > 2 min.
**D1-14 Junk SMBIOS data.** Serial/model strings like "To be filled by O.E.M.", "Default string",
"System Serial Number" → store as null.
**D1-15 Multiple wired adapters** (docking stations, USB-Ethernet). Enrollment payload includes
`otherMacs[]`; diagnostics shows them so IT can see if the wrong one was registered.
**D1-16 Packet log growth.** 500 devices × 2 destinations × 2 ports × 3 repeats ≈ 6 000 rows per
morning job. Retention default 30 days for the packet log (separate from the 180-day history).
**D1-17 Brute force on the agent listener.** Rate limit enrollment per source IP (default
10/min).

## 6. Improvements proposed
- **IMP-021** prepare-target enables ICMPv4 echo rule (Domain/Private). Effort S.
- **IMP-022** Health warnings for pending reboot and Windows Update active hours. Effort S.
