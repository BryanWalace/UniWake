# M3 review — Code Reviewer

Milestone: **M3 WoL engine, scoped wake, verification** (M3-T01..T12, M3-D, M3-F1..F3) · Date: 2026-10-04
Evidence: `npm run verify` green (≈316 tests), Playwright 8/8, core coverage ≈95.7% stmts /
87.5% branches. Property tests: scope resolution vs independent oracle (500 runs), stagger (300 runs).

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-003.1–.8 and FR-009: AC-003-01..19 have tests (domain, API end-to-end with fakes, E2E). |
| Scoping enforced server-side | ✔ | Clients send descriptors only (schema rejects MAC lists); sent MACs ⊆ resolved set (AC-003-05/18). |
| No real network in tests | ✔ | Fake sender everywhere; real UDP sender only in a loopback contract test; E2E hub forced to demo/dry-run; a demo hub never constructs the real sender. |
| Security | ✔ | Wake routes operator-only (route-table test); per-user rate limit; large-action guard enforced on the server. |
| Reliability | ✔ | Interfaces read at send time; per-interface failures isolated; network retry for scheduled jobs; restart recovery; clock-jump safe (M3-F1); runner stops before DB close (M3-F3). |
| Code | ✔ | Domain pure (magic packet, network, scope, stagger); ports respected. |
| UI | ✔ | Preview always shows count and rooms; explicit count confirmation; live progress; pt-BR results. |

## Findings
No CRITICAL or MAJOR findings open.

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M3-01 | MINOR | `job-runner.ts` | `wake.finish` audit entries had `actorUserId = null` even for manual jobs, so filtering the audit by user missed them. | Job keeps `requestedById`. | fixed (M3-R) |
| R-M3-02 | MINOR | `JobDrawer.tsx` | A job that failed for an unexpected reason showed only "Falhou", with no next step. | pt-BR guidance for `falhou` and `interrompido`. | fixed (M3-R) |
| R-M3-03 | MINOR | demo/dry-run | Dry-run jobs still need a real interface with a gateway; a demo on a laptop without one fails with NO_NETWORK_INTERFACE. | Simulated interfaces in demo mode. | M4-T09 |
| R-M3-04 | SUGGESTION | `tcp-prober.ts` | After the first positive port answer, other port attempts stay open until their own timeout (≤ 800 ms). | Bounded; revisit if sweeps show socket pressure (M4). | — |
