# M17 review — Agent channel and power orders (hub, v1.3)

Date: 2026-10-11 · Scope: M17-T01..T06, M17-D · Commits `8d93cc8`..`e87c27a` + M17-D commit.

## Debug break-it (M17-D)
| # | Check | Result |
|---|---|---|
| 1 | Full suite 3× | Windows CI hit the native Vitest crash once (R-M16-01) and a 1-s loopback echo once → CI reruns only the crash signature with a warning; the ICMP contract test uses 5-s echoes (it checks the contract). |
| 2 | Hub killed mid-check-in | One transaction: a failure after storing a report leaves no report and the order still "pending"; the machine's retry completes it (`breakit-m17`). |
| 3 | Max/malformed input | 64 KB route limit over the 8 KB listener limit (50 reports fit, 70 KB → 413); strict schema refuses unknown fields such as a user name (422). |
| 4 | Fake port failing | Scripts missing → enrollment still succeeds without a token ("Arquivos do agente ausentes"); unknown agent protocol → same. |
| 5 | Clock jumps | Orders expire by hub time; agenda is a pure function of `now` (M16-D). |
| 6 | Same action twice / from two hubs | Same report to two hubs → one row, no conflict (after D-M17-02); order delivered by two hubs → the machine dedupes by UUID; ack is idempotent. |
| 7 | Logs without secrets | Tokens never logged or stored (only SHA-256; test checks the row dump); 401 answers carry no detail. |

## Findings
- **D-M17-01 (MAJOR, fixed in M17-T06)** A 1-minute order is often acknowledged and reported in the
  same check-in; reports were settled before receipts, so "delivered by" was lost and the panel
  skipped "recebida". → receipts first. Found by the two-hub test.
- **D-M17-02 (MINOR, fixed)** The same report sent to two team hubs (answer lost, retried with the
  other hub) carried each hub's `received_at`: two different versions → a "conflito resolvido" for
  nothing. → `received_at` is local, not in the snapshot. Regression test fails without the fix.
- **D-M17-03 (MAJOR, fixed — found in review)** The replicated last check-in was rounded **down** to
  30 min, so on a team hub the machine does not talk to, it was older than the machine's
  `online_since` → false "Desligamento remoto perdido". → exact time, refreshed at most every
  30 min (ADR-048 amended; regression test).
- **D-M17-04 (MINOR, fixed)** ICMP helper contract test missed a 1-s loopback echo once on CI.
- **R-M17-01 (INFO)** The team hub list uses the default agent port 47101 for peers (their agent
  port is not replicated). Documented for M20 (README: keep 47101 on every team PC).
- **R-M17-02 (INFO)** History marks a targeted machine "sem relatório" after 24 h using today's
  target (rooms/tags as they are now), not the target at the occurrence time. Accepted: shutdown
  schedules rarely change targets; M19 shows it as an estimate.
- **R-M17-03 (INFO)** `agent_seen` (exact sighting, sessions) is machine-local: the manual
  shutdown preview on a team hub the machines do not talk to shows `withUser` from that hub only.

## Review notes (Code Reviewer)
- Agent listener has exactly the five routes of plan §6.2; the route-table test enumerates them and
  checks anonymous → 401 for the `agent` level; revoke is admin.
- Every replicated write goes through the change log (`verifyChangeLog` runs on every API test
  close); tests that set rows up with raw SQL log them with `relogPower`.
- Orders and reports in team mode: entities, orphan drops, cascaded tombstones on device/job
  delete, insert-only reports keyed by the machine's UUID.

No open CRITICAL/MAJOR. **M18 may start.**
