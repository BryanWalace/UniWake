# M8 review — Code Reviewer

Milestone: **M8 Service, installer, auto-update, release** (M8-T01..T11, M8-D, M8-F1..F4) ·
Date: 2026-10-05
Evidence: `npm run verify` green (≈700 tests + perf), Playwright 21/21 on Chromium and the smoke +
wake specs on Edge (locally; Windows CI job), `npm run test:ps` clean, gitleaks clean on staged
changes. Installer smoke and release workflow run only on GitHub's Windows runners.

## Checklist
| Area | Result | Notes |
|---|---|---|
| Spec compliance | ✔ | FR-001.1–.4: AC-001-04..11, 13, 14 tested with fakes; AC-001-01a/02/03 by the CI installer smoke; AC-001-12 by release.yml. |
| Supply chain | ✔ | Node runtime (SHASUMS256 from nodejs.org), WinSW, Pester and PSScriptAnalyzer pinned by SHA-256; update source compiled in (ADR-025), test builds only point at loopback. |
| Update safety | ✔ | Disk-space guard, verified size + SHA-256 before anything runs, pre-update backup, plan re-validated by the SYSTEM updater (installer and backup confined to the data dir, loopback health), rollback that restores the DB only after a migration, watchdog, no retry loop on a broken version (M8-F4). |
| Windows specifics | ✔ | Locale-independent `sc` parsing (verified against pt-BR output), task XML instead of locale-dependent `schtasks /SD`, event log on start-up failure. |
| Process execution | ✔ | Argument arrays, System32 absolute paths, task names and arguments validated (plan §9.1). |
| UI | ✔ | Update card on the health page; install buttons for admins only; override confirmation near schedules. |

## Findings
No CRITICAL or MAJOR findings open.

| ID | Sev | Where | Problem | Fix | Task |
|---|---|---|---|---|---|
| R-M8-01 | MINOR | CI | The full update path (download → updater → new version running, and a rollback) is exercised only with fakes; FR-001.3 asks for an end-to-end run against a local fake release server on Windows. | New task M8-T12. | M8-T12 |
| R-M8-02 | SUGGESTION | release | Installers are unsigned: SmartScreen warns on manual installs. | Needs the owner's certificate. | B-001 |
| R-M8-03 | SUGGESTION | installer | Firewall rules use the default ports; a changed `panelPort`/`agentPort` in config.json is not reflected in the rules. | Document in README; a future installer can read config.json. | — |
