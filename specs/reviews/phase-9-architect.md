# Phase 9 review — Architect (v1.3 Desligar: spec §6b, plan §15, ADR-042..048)

Date: 2026-10-11 · Input: owner request of 2026-10-11 (pull model, built-in Windows only, hub on
part of the day, freezing software as a requirement).

## Coverage of the owner's request
| Request item | Where |
|---|---|
| Local accounts, no domain; no downloaded program on lab PCs | §6b context; ADR-042; constitution §2.6 |
| Pull model; `shutdown /m`, WMI/WinRM rejected | ADR-042 (alternatives) |
| New idempotent prepare step, scripts in ProgramData with Admin+SYSTEM ACL, task "UniWake" SYSTEM at startup + 1 min, per-machine token (hash only, revocable), summary "Desligamento remoto: OK" | FR-301.1, ADR-042, ADR-043 |
| Outbound calls, immediate orders, agenda for next days with holidays resolved, works with hub off, reports later | FR-302, FR-303, ADR-043, ADR-045 |
| `shutdown /s /t <aviso> /c`, `quser` in reports | FR-304.3, FR-304.5, ADR-046 |
| Expired agenda not executed | FR-303.4, AC-303-03 |
| v1.2 machines keep waking; "prontas para desligar" vs "precisam do novo preparo" | FR-301.2, FR-309 |
| Schedules "Ação: Ligar / Desligar" with warning, postpone count/length | FR-306 |
| Desligar / Reiniciar buttons, preview, live tracking by ping/TCP | FR-305 |
| History incl. shutdowns done with hub off | FR-307 |
| Audit, profiles, team sync; execution independent of lease (explained) | FR-306, FR-307, ADR-048, plan §15.5 |
| Warning 5 min, postpone 2×15 min, then forced; "adiado N× por usuário" | FR-304.1–.2 |
| Second task in the user session with "Adiar", secure local channel, built-in only (ADR) | ADR-046 |
| Wake timer, late wake rule, "estava em suspensão" (ADR) | FR-303.5, ADR-045 |
| Freezing: detection per product with sources, "não verificado" where unconfirmed; ATENÇÃO; lost heuristic; agenda at start-up, ThawSpace/UWF exclusion, limitation; per-machine field; help + README; product integration on roadmap | FR-308, ADR-047, RM-7 |
| Security NFRs: token, rotation, revocation, rate limit, script hash check; RM-5 decision recorded | FR-302, ADR-043, ADR-044, constitution §6.3a |
| Tests: Vitest, PSScriptAnalyzer + Pester with freeze fixtures, agenda logic, Playwright demo | plan §15.6, M16–M19 |
| Demo simulates shutdown, postpone, frozen machine | FR-310 |
| README, test guide | FR-311, M20, V3-T02 |

## Decisions taken here
- Answers that can make a PC act are **signed** (RSA, verified with built-in .NET); TLS stays RM-5
  (ADR-044). Trust anchor is `-HubKeyId` in the copied command, like the script hash today.
- `prepare-target.ps1` stays one static, pinned file; the agent scripts are downloaded and checked
  against hashes in the signed enrollment answer — one mechanism for preparation and self-update.
- The scheduled time is the **shutdown** time; the warning precedes it (FR-304.1).
- A separate wake task ("UniWake Despertar") because `WakeToRun` is per task (ADR-045).
- Shutdown schedules never go through the scheduler or the lease (ADR-048).
- Two items need proof before code depends on them: RSA verification in PowerShell 5.1 (M16-T01)
  and the user-session task (M18-T01). Both have a written fallback.

## Open questions for the owner
Q-1..Q-10 in spec §6b. **M16 does not start before the owner approves.**
