# Phase 7 review — Architect (v1.2 Modo equipe: spec §6a, plan §14, ADR-035..040)

Date: 2026-10-09 · Input: `.agents/07-roadmap-features.md` §B, owner request of 2026-10-09.

## Coverage of roadmap §B
| §B item | Where |
|---|---|
| 6-digit code, 5 min, single use, attempt limit | FR-201.1, AC-201-01 |
| PAKE, code never travels | FR-201.3, ADR-036, AC-201-02 |
| Team key encrypted with DPAPI | FR-201.4, ADR-037, AC-201-04 |
| Peers list, rename, revoke rotates key | FR-201.5, ADR-038, AC-201-05 |
| UDP announcement (team hash + version, no data) + manual address | FR-202.1, AC-202-03 |
| TCP, mutual auth + encryption from team key (TLS-PSK) | FR-202.2, ADR-038, AC-202-04 |
| Changes since N, one transaction, idempotent | FR-202.3, AC-202-02 |
| LWW (logical clock, instance id), conflict log | FR-203, ADR-040 |
| Tombstones, compaction after acknowledgements | FR-202.5 (state-based log already compacts, ADR-031) |
| Firewall rule private/domain | FR-205 |
| Status, Sincronizar agora | FR-202.6, AC-202-07 |
| One executor per run; alone → execute; records synced; missed runs offered | FR-204, ADR-039 |
| README: 2-PC setup, Power On by RTC | FR-206, M15-T03 |

## Decisions taken here
- Membership replicated as an entity (ADR-035); keys never replicated (ADR-038).
- The PC that shows the code keeps its data (ADR-035).
- No new runtime dependency (ADR-036): SPAKE2 on a MODP group; TLS-PSK from `node:tls`.

All Fullstack, Debug and Reviewer findings below were applied to spec v1.3 / plan v1.2 / tasks
M11–M15. **M11 may start.**
