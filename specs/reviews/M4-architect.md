# M4 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-04

| Plan item | Status | Note |
|---|---|---|
| Composite prober: PowerShell ICMP helper + `ping.exe` fallback + TCP (ADR-019) | ✔ | Helper now announces readiness; requests wait for it (cold PowerShell start no longer counts as a missed deadline). |
| One probe pool, verification first (FR-004.2) | ✔ | `ProbeQueue` (high/low); sweeps drop their queued probes on stop. |
| Sweeps: DNS cache, IP drift, one transaction (plan §5.1) | ✔ | Plus: verification results count as probes; ≤ 32 concurrent lookups. |
| SSE (ADR-020) | ✔ | Heartbeat 20 s, `session.expired`, 1 MB cap, `counters` with fresh counts; hidden tabs release the stream. |
| Uptime: nightly rollup 00:10, today on demand (plan §5.2) | ✔ | ADR-027 records the semantics (DST days, hub downtime, retention). |
| Retention chunked, nightly (plan §5.1) | ✔ | 01:30 local; 10 min after start when a run was missed. |
| Demo mode (FR-015) | ✔ / pending | Simulated LAN and seed done; 2 schedules + morning-result notice join the seed in M5-T07. |
| Test pipeline | changed | `npm run verify` now ends with `test:perf` (wall-clock budgets, sequential, no coverage); plan §5.1 updated. |
| Spec change | none | FR-004.1 already said "sweep **or verification**"; the implementation now matches it. |

ADR-027 amended (idle header, hidden tabs). No other plan change. M5 may start.
