# Phase 3 review — Debug & Problem Solver (optional contributor)

Reviewed: `specs/tasks.md` v0.1 · Date: 2026-10-04

## Findings
- **D3-01 No owner for data growth.** Retention cleanup (history, packet log, audit, sessions,
  expired tokens, old notices) has no task. On a 500-device site the packet log alone grows by
  ~6 000 rows per morning. Same finding as the Architect; I add: cleanup must run in chunks and must
  never run during a wake job.
- **D3-02 Break-it passes need a fixed checklist**, otherwise they depend on mood. Proposed standing
  checklist for every `M<n>-D` task:
  1. Run the full suite 3× in a row (flakiness).
  2. Kill the hub mid-operation of the milestone's main flow; restart; check DB state.
  3. Feed max-length and malformed inputs to every new endpoint.
  4. Run the main flow with every fake port failing once (timeout, error, partial).
  5. Run with the clock jumped ±1 h and across midnight.
  6. Concurrency: the same action twice in parallel.
  7. Check logs contain no secrets and errors are pt-BR with a next step.
- **D3-03 Scheduler tests across midnight and month ends** (31 → 1, Feb 28/29) belong in M5-T01.
- **D3-04 Probe-helper soak.** M4-T03 should include a 10 000-request soak on loopback in the
  Windows job to catch handle leaks in the PowerShell helper (`Ping` objects not disposed).
