# Phase 13 — Architect

- ADR-053 amends ADR-048: the "no lease" decision was right for robustness with the hub off, wrong
  as the only path. Push goes through `PowerOrdersService` (one implementation, the proven one);
  identity = occurrence UUID on both paths; the existing schedule lease elects the pushing hub.
- Timing: pushing at T (like a wake) would start the warning after T; pushing at T − warning −
  1 min makes both paths start the warning at the same moment.
- Reconciliation stores counts in the run and computes the per-machine view on demand from
  replicated data (no new replicated entity).
- Migration 008 adds machine-local columns only (device_state, agent_seen) and the machine-local
  `power_tests`; replicated snapshots unchanged except `power_job` (occurrence) → rev reset as in
  006.
- **A13-01 (MAJOR)** lab PCs listen on no port (ADR-042): the "agent port" signal requested in the
  field report does not exist; the agent check-in is the stronger equivalent (FR-503.1 says so).
