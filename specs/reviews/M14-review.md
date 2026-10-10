# M14 review — Code Reviewer (team UI, installer, two-instance tests)

Reviewed: commits 8d9a6aa..64211f7 · Date: 2026-10-09

- Pages have loading/empty/error states and tests (constitution §8); axe sweep covers /equipe,
  /equipe/conflitos and /ajuda/team-mode with no serious violations.
- Playwright pairs two hubs through the UI; the joiner's session ends (users replaced) and the user
  logs in with the team account, as the UI copy says.
- Installer: "UniWake - Modo equipe" TCP+UDP 47102, Domain/Private, removed on uninstall; verified
  on the Windows runner (AC-205-01).
- **R-M14-01 (MAJOR, fixed)** PSScriptAnalyzer (PSUseSingularNouns) failed the Windows CI job on the
  new firewall check; the commit helper now runs `npm run test:ps` whenever a .ps1 changes.
- **R-M14-02 (MINOR, fixed 2026-10-09 after it reached CI on main `bc705e4`)** Windows-only: a Vitest worker occasionally exits with
  0xC0000409 under the full parallel coverage run (seen 3× locally in this session, in different
  files; never in CI so far). Rerun passes. Candidate cause: native teardown of sockets/SQLite in
  forked workers. Fix: the server project runs in worker threads (`pool: 'threads'`): 0 crashes in
  8 consecutive full runs on the dev PC (forks: 1 in 3).
- **R-M14-03 (INFO)** Issue templates and SECURITY.md links point to `main`: they appear on GitHub
  only after the owner merges `dev` (NEXT.md lists it).

No open CRITICAL/MAJOR.
