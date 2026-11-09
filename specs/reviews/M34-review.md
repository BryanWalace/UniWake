# M32–M34 review — WoL kept armed, a shutdown that insists, errors never silent (v1.7.0)

Date: 2026-11-08 · Scope: M32-T01..T02, M33-T01..T03, M34-T01..T03 · agent 1.8.0
(`Invoke-UwWolCheck`, `Invoke-UwPowerCommand`, `Invoke-UwWatchdog`, `Write-UwLog`, health state and
report), hub (`crash-guard.ts`, `agent-service.ts` log lines, `power-repo.ts` health merge, device
page), settings `power.keepWakeOnLan`.

## Architect
- ADR-064: the fallback chain only replaces a failed `shutdown.exe`; the warning, postpone and cancel
  rules (ADR-046) are untouched. The watchdog acts only on a run the agent itself reported done, on the
  same boot time, after a 3-minute grace, at most 3 times and never after 30 minutes.
- ADR-065 repeats the preparation's own checks with the same keyword/display rules; it changes
  nothing the preparation would not change, and `power.keepWakeOnLan` turns it off.
- ADR-066: the hub log stays the only log the panel reads; WinSW's stderr log is quoted in the
  "did not stop cleanly" line instead of being exposed by a new route.

## Debug
- **D-M34-01 (MAJOR, fixed)** found while reviewing the watchdog: with Fast Startup a PC turned back on
  can keep its boot time, so "same boot" alone could force a shutdown on someone who just turned the
  machine on. The watch now also ends when the agent did not run for more than 3 minutes (no
  heartbeat: the PC was off or asleep) — Pester case added.
- **D-M34-02 (MAJOR, fixed)** the heartbeat was written only at the start of a run, so after a 5-minute
  warning the next run saw a false gap, which the fix above would have read as "was down". The run now
  refreshes the heartbeat after an execution (the integration test covers the whole sequence).
- **D-M34-03 (MINOR, fixed)** a step failing every minute would have sent the same error to the hub
  every minute (a warn line per machine per minute). The same error is now written and sent at most
  once an hour (`errorSeen`, kept in `health.json`).
- The native-warning path used to report "failed" when `shutdown /t 300` failed; now it logs and the
  shutdown happens at its time through the chain (a missed warning is better than a missed shutdown;
  the window-or-native warning was already attempted).
- Events (errors, relays, escalations) are cleared only by the count the accepted check-in carried, so
  an error logged while the request was on the way is not lost (Pester).
- CIM `Win32Shutdown` may need the shutdown privilege enabled; if it fails, `Stop-Computer -Force`
  follows (it enables it). **Não verificado em hardware** — listed in the owner checklist.

## Code Reviewer
- New wrappers (`Invoke-UwCimShutdown`, `Invoke-UwStopComputer`, `Get-UwWolAdapter`,
  `Get-UwWolState`, `Set-UwWolSetting`) assert the real system and are faked; PSScriptAnalyzer clean,
  UTF-8 BOM + CRLF kept.
- `Write-UwLog` never throws; texts are trimmed to 300 characters, no user names or tokens.
- Hub: the shared contract fixture `checkin-health-v18.json` is checked by Vitest (schema keeps every
  field) and by Pester (the agent report has the same keys), so both sides agree.
- `uncaughtException` handler writes synchronously and exits 1 (Node's guidance: never continue after
  it); `unhandledRejection` only logs. Both covered with an EventEmitter, plus a real-hub marker test.

No open CRITICAL/MAJOR.
