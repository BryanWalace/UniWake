# Phase 9 review — Debug / Problem Solver

Date: 2026-10-11 · Lens: real lab PCs, real failures.

- **D9-01 (CRITICAL)** `C:\ProgramData` lets ordinary users create folders. A student could
  pre-create `C:\ProgramData\UniWake\agent\uniwake-agent.ps1` and have SYSTEM run it. → preparation
  takes ownership, disables inheritance, sets an explicit ACL and re-checks it; the agent refuses
  to run if owner/ACL changed (ADR-042, constitution §6.3a, M18-D).
- **D9-02 (CRITICAL)** The warning IPC needs a Users-writable folder; if SYSTEM deletes files there,
  a planted junction/hard link turns it into an arbitrary-delete primitive. → SYSTEM never writes
  or deletes in Users-writable folders, skips reparse points, reads ≤ 4 KB, checks the request id
  (ADR-046).
- **D9-03 (MAJOR)** Token rotation on a frozen PC: the new token is lost at restart, the hub has
  already dropped the old one → machine locked out. → no rotation while frozen without a
  persistent area (FR-302.2, ADR-043). Same reason DPAPI re-protection of the token was dropped.
- **D9-04 (MAJOR)** Late wake from sleep with wake timers blocked is almost always a person or the
  hub's WoL waking the PC → shutting it down would be hostile. → 60-minute cap (Q-9) on top of
  "before the next Ligar" (FR-303.5, ADR-045).
- **D9-05 (MAJOR)** `WakeToRun` on the 1-minute task would wake sleeping PCs every minute. →
  separate "UniWake Despertar" task with one-time triggers (ADR-045).
- **D9-06 (MAJOR)** A PC turned on in the morning must never be shut down by last night's item. →
  boot rule: last boot after T → never run (AC-303-05).
- **D9-07** Frozen PCs lose queued "desligou" reports at the restart the shutdown causes. →
  best-effort send before `shutdown`, and the hub's "provavelmente desligou (sem relatório)"
  inference from the next boot time + monitor (FR-307, ADR-047).
- **D9-08** The warning run lasts up to ~40 min; with the default 72 h limit that is fine, but an
  explicit `ExecutionTimeLimit=PT2H` and `IgnoreNew` keep runs from piling up (ADR-042).
- **D9-09** Clock drift on lab PCs → offset from `serverTime`, reported when > 2 min (ADR-045).
- **D9-10** Antivirus/EDR may flag a SYSTEM PowerShell task every minute → plain, readable
  scripts, no `-EncodedCommand`, help page entry (RK-24).
- **D9-11** Modern Standby PCs and power-plan defaults for wake timers are not verified → marked
  "não verificado" in ADR-045; covered by the owner checklist (V3-T02).
- **D9-12 (CRITICAL, found while fitting the owner's answers to the code)** A v1.2 team member
  applying a v1.3 schedule snapshot ignores the unknown `action` field, stores a **wake** schedule
  (waking the labs at shutdown time) and logs it back to the team. → team `PROTOCOL_VERSION` 2,
  mixed versions do not sync and the peer shows "Versão diferente" (ADR-048, M16-T03).
