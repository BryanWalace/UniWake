# Phase 2 review — Debug & Problem Solver

Reviewed: `specs/plan.md` v0.1 · Date: 2026-10-04
Lens: where will this design break in the field?

## CRITICAL
**D2-01 The updater will be killed by the service it stops.** Plan §8: the hub spawns the updater
"detached", then the updater stops the service. WinSW terminates the **whole process tree** of the
wrapped process on stop (default behavior since 2.x). A detached child of `node.exe` is still in
that tree, so the updater dies mid-update, the service is left stopped, and nobody is there at
03:00 to notice. Next morning: no hub, no wake.
*Fix:* launch the updater outside the service's process tree, through **Task Scheduler**: the hub
registers a one-shot task `UniWake-Updater` (runs as SYSTEM, fixed command
`versions\<current>\node.exe versions\<current>\updater.mjs <plan.json>`) and runs it with
`schtasks /Run`. Task Scheduler is the parent; WinSW cannot touch it. Add a test that the updater
command line contains no user-controlled text other than the validated plan path.

**D2-02 A stopped service must always come back.** If the updater itself crashes after stopping the
service (bug, power loss, AV kill), the service stays stopped. *Fix:* (1) the updater writes
`update-state.json` progress markers; (2) a **second one-shot scheduled task** "UniWake-Watchdog"
created before the stop, runs 15 min later: if the service is not running, start it with the
previous version (rollback); deleted on success. (3) The service start type stays Automatic, so a
reboot also recovers.

## MAJOR
**D2-03 Probe helper failure modes.** PowerShell can be blocked (AppLocker, Constrained Language
Mode, AV/AMSI killing scripts started by services). Then ICMP disappears silently and every
firewalled PC looks offline. *Fix:* the composite prober detects helper failure (start failure,
3 restarts in 5 min) and switches to `ping.exe` fallback (parse `TTL=`, ignore localized text);
health shows "Sondagem ICMP em modo alternativo". Helper sets `$ProgressPreference =
'SilentlyContinue'`, writes only JSON lines; the adapter ignores non-JSON lines.

**D2-04 Synchronous SQLite on the event loop.** `node:sqlite` is synchronous. A slow query (uptime
across 180 days × 500 devices) or a WAL checkpoint during a sweep blocks the loop, delays UDP sends
and SSE. *Fix:* (a) precompute `daily_uptime` nightly; (b) write sweep results in one transaction
per sweep; (c) indexes as listed; (d) a test that the 500-device dashboard query runs < 50 ms;
(e) backups with the online `backup()` API (async, page-stepped) instead of `VACUUM INTO`.

**D2-05 Rollback loses data written after the pre-update backup.** If v(N+1) runs migrations and
then fails health, restoring the pre-update DB loses at most the minutes between backup and
rollback. Acceptable, but: the updater must **not** restore the DB when the new version never
started (no migration ran) — restoring needlessly is a risk on its own. Decide by checking
`schema_migrations` max version vs the plan's recorded version.

**D2-06 Disk space.** Download, backup and a second version dir need space. Check free space
≥ 3 × installer size + DB size before downloading; otherwise `UPDATE_DISK_SPACE` (add code).

**D2-07 Port already in use.** WinSW restarts the service forever in a loop if 47100 is taken.
*Fix:* on `EADDRINUSE`, log a clear error, write it to the Windows Application event log (via
WinSW's own log is not enough), and exit with a distinct code; WinSW failure actions back off
(10 s / 30 s / 60 s).

**D2-08 Per-interface send failures.** When an interface disappears between enumeration and bind,
`bind` throws `EADDRNOTAVAIL`. *Fix:* catch per interface, log a `packet_log` row with
outcome `error`, continue with the other interfaces; a job fails only if **every** send failed.

**D2-09 Installer hangs.** Inno Setup can block on a "files in use" prompt if the service didn't
stop. *Fix:* updater kills remaining `node.exe` processes running from the old version dir (by
path) after the stop timeout; installer always run with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART
/CLOSEAPPLICATIONS`; 10 min timeout then rollback.

## MINOR
- **D2-10** `route print` returns several default routes (multiple NICs, VPN). Pick per interface
  by matching the interface IP column; a VPN default route with metric 1 is not a reason to send
  through the VPN interface (it has no LAN broadcast domain). Keep the "gateway" rule per interface.
- **D2-11** SSE behind the session: when the session expires the stream must close with an event
  so the UI goes to login instead of silently showing stale data.
- **D2-12** Self-signed cert generation needs the certificate's private key exportable; use
  `-KeyExportPolicy Exportable` and remove it from the store after export (keep only the PFX).
- **D2-13** Scheduler tick 15 s + grace 15 min: persist `lastTick` at most every tick, not every
  second; on clock jump forward > 1 h (e.g. CMOS reset), runs are `perdido`, never a burst.
- **D2-14** Demo mode in production builds must be impossible to enable by accident on a real
  hub with data: refuse `--demo` when the data dir has non-demo data.

## Improvements proposed
- **IMP-027** Update watchdog task (D2-02). Effort S. (Accept as part of FR-001.3.)
- **IMP-028** Windows Application event log entries for fatal start errors (D2-07). Effort S.
