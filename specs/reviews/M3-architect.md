# M3 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-04

| Plan item | Status | Note |
|---|---|---|
| Per-interface send, interfaces at send time (plan §2.6, RK-09) | ✔ | One bound socket per source IP; `route print` / `/proc/net/route` for gateways. |
| Packet log (P4, IMP-006) | ✔ | One row per (device, source, destination, port, repeat). Retention job pending (M4-T16). |
| Scope rules SR-01..SR-12 | ✔ | Pure resolver + property test. |
| Job lifecycle + recovery (FR-003.5, AC-003-17) | ✔ | Plus graceful stop (M3-F3). |
| Spec change | ✔ | New device result `nao_verificado` ("Sem IP para verificar") added to FR-003.5. |
| Early work | ✔ | TCP prober (M4-T02) and DNS adapter delivered in M3 so the hub verifies for real; ICMP helper remains M4-T03/T04. |
| Realtime | pending | Drawer polls every 2 s; switches to SSE in M4-T07/T11. |

No plan change needed. M4 may start.
