# Field test 2026-10-18 — v1.6.0 on a real notebook (Wi-Fi only)

Roles: Debug & Problem Solver (lead), Senior Fullstack, Code Reviewer. Branch `dev`.

## Setup
- Target: the owner's Wi-Fi-only notebook (Windows 11), prepared with `prepare-target.ps1` against a
  temporary test hub on the owner's PC (ports 47300–47302, its own data folder). The notebook's
  identifiers were used only for this test and removed afterwards (nothing committed, nothing in memory).
- The stage copy of `prepare-target.ps1` was patched **for this test only** to accept a Wi-Fi adapter
  (the product keeps refusing Wi-Fi: WoL needs a wired adapter). Rebuilt clean after the test.
- Real shutdowns of the notebook and real magic packets to its MAC only, approved by the owner.
- Remote access over a temporary OpenSSH server and key, removed at the end.

## Proven on real hardware
| Area | Result |
|---|---|
| Self-update (FR-603.2) | outcome `updated`, agent 1.7.0 |
| Repair task (FR-603.4) | deleted warning script restored, dashboard notice, "Agente bloqueado" mark |
| Defender reading (FR-604) | reading stored and shown |
| Schedule reach / exclusions (FR-601), save rule (FR-602) | as specified |
| Prevent sleep (FR-605.3) | applied and restored (standby AC and hibernation back to the previous values) |
| Warning with "Adiar" (FR-304) | two postpones, then "Cancelar" from the panel closed the window, no shutdown |
| Hibernation (S4) | wake timer woke the notebook; warning; shut down at T |
| Early shutdown | turned off before T, turned on after T: order skipped `was_off`, no warning, no shutdown |

## Findings and fixes
| # | Severity | Finding | Fix | Evidence |
|---|---|---|---|---|
| F1 | MAJOR | The warning window never opened ("Adiar" missing; only the native warning): after a self-update or a repair the file `uniwake-aviso.ps1` had only SYSTEM/Administrators access, and the "UniWake Aviso" task runs as the user (result `0xFFFD0000`). Present since v1.3 on every rewrite of the file. | `Repair-UwWarningAccess` restores Users read/execute on every run (`GetAccessControl('Access')`/`SetAccessControl`, no SeSecurityPrivilege needed) | Pester `agent-update` |
| F2 | MAJOR | A machine woken by the wake timer went back to sleep after ~2 min (unattended wake), before the warning ended | `Set-UwKeepAwake` (SetThreadExecutionState) during the warning and the shutdown, released in `finally` | Pester `agent-executor`; `powercfg /requests` on the notebook |
| F3 | MAJOR | After hibernation the every-minute task stalled until something started it | Event trigger on Power-Troubleshooter event 1 (resume) on "UniWake"; install level 3 adds it to prepared machines by itself | Pester `agent-repair` (+ CI-only real task) |
| F4 | MAJOR (owner) | "Acordar para desligar" on by default turned on machines that were off only to shut them down. Owner: only a hibernated/suspended machine should be handled; an off machine must stay off | `power.wakeForShutdown` default **off**; label/help say it turns on machines that are off (ADR-061 amended, FR-605.2) | `sleeping-machines` |
| F5 | MAJOR (owner) | People turn lab PCs off before the scheduled time; turned on again later the same day, the pending order shut them down while in use | Orders carry `plannedAt`/`issuedAt`; a machine booted after it skips the order (`was_off`). A resume keeps the boot time, so a hibernated machine still shuts down | Pester `agent-executor` (3 cases); `scheduled-shutdown` AC-501-02 |
| F6 | MINOR | A manual job showed "Falhou" for a machine skipped as `was_off` | New panel state `was_off` from a fixed hub-side detail (no migration) | `power-orders`, `agent-checkin`, web `power-ui` |
| F7 | MINOR | The window wrote an `alive` file every 5 s; a long warning piled up hundreds | The window keeps only its newest `alive` | Pester `agent-warning` |
| F8 | MINOR | `-RemoveAgent` left the agent-made "UniWake Reparo" task behind | Removed with the other three | Pester `prepare-target.agent` |
| F9 | MINOR | Hibernation shown as unknown when only the default registry value existed; an unsent Defender reading was dropped within 15 min | `ConvertTo-UwHibernateEnabled`; pending reading re-offered | Pester `agent-sleep`, `agent-antivirus` |

## Not verified
- Wake from **S5** (fully off) is out of scope by design: wake timers do not wake S5; WoL from S5
  needs a wired adapter, which the notebook does not have.
- Other models' resume events and third-party antivirus (unchanged from v1.6.0 validation).

## Verdict
No open CRITICAL/MAJOR. All fixes covered by tests; full verify, Pester and CI green before the merge.
