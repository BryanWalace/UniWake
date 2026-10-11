# Phase 9 review — Senior Fullstack

Date: 2026-10-11 · Lens: can this be built and tested with the current code?

- **F9-01 (MAJOR)** Embedding the agent scripts inside `prepare-target.ps1` would duplicate them
  (two copies to keep in sync, or a build step that changes the pinned file). → scripts live in
  `scripts/agent/`, served by `/agent/v1/scripts/:name`, checked against hashes in the signed
  enrollment answer (FR-301.1, ADR-044).
- **F9-02** `Invoke-WebRequest` in 5.1 returns decoded strings; a signature must be checked over
  the exact bytes → `HttpWebRequest` and the raw stream (ADR-044).
- **F9-03** Agenda logic exists twice (TypeScript generator, PowerShell executor). → shared JSON
  contract fixtures in `packages/shared/fixtures/agent/` used by Vitest and Pester (ADR-045).
- **F9-04** The schedule engine's occurrence expansion is reused by the agenda generator instead of
  a second implementation (plan §15.2).
- **F9-05** Last check-in as a replicated field would bump the device revision every minute on 500
  PCs → separate `device_agent` entity with a 30-minute coarse time; exact time is machine-local
  (ADR-048).
- **F9-06** Route-table authz test must learn the new agent-token auth kind (M17-T02).
- **F9-07** `power_report` is insert-only with a machine UUID: duplicates from two hubs merge
  without conflict rules (ADR-048).

Estimate: M16 ≈ 5 tasks, M17 ≈ 6, M18 ≈ 6, M19 ≈ 5, M20 ≈ 4 — similar to v1.2.
