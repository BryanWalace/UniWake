# M9 review — Code Reviewer

Milestone: **M9 v1.1 network discovery** (M9-T01..T04, M9-D, M9-F1..F3) · Date: 2026-10-06
Evidence: `npm run verify` green (≈725 tests), Playwright discovery spec on the demo hub and in the
axe sweep, real pt-BR `arp -a` and `Get-NetNeighbor` output parsed on the dev machine.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-101: AC-101-01 (confirmation above /22, API + web), AC-101-02 (pt-BR = en-US arp parsing), AC-101-03 (already registered, never added twice; API, web, E2E). |
| Safety | ✔ | Only this computer's own subnets can be swept (also limits misuse); at most /16; one sweep at a time; probes go through the low-priority queue; tests use fakes only. |
| Privacy (NFR-05) | ✔ | Vendor list bundled (IEEE MA-L, refreshed by `scripts/update-oui.ts` at development time); no runtime download. |
| Locale | ✔ | Neighbor cache read by addresses and numeric states only. |
| UI | ✔ | Clear statement that only own subnets are visible; virtual/random MACs flagged; registered rows link to the device. |

## Findings
No CRITICAL or MAJOR findings open.

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M9-01 | SUGGESTION | discovery | NetBIOS names come only through the OS resolver (reverse lookup); machines without DNS/LLMNR records show no name. | Acceptable; a NetBIOS node-status query would add a raw UDP client. | roadmap |
| R-M9-02 | SUGGESTION | discovery | A /16 sweep shares the low-priority probe lane with monitoring sweeps, which can lag while it runs. | Batches of 256 interleave with sweeps; documented in the UI warning for large networks. | — |
