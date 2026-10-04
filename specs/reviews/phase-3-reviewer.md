# Phase 3 review — Code Reviewer

Reviewed: `specs/tasks.md` v0.1 · Date: 2026-10-04
Lens: does every task have a meaningful test, and can the "every AC has a test" promise be checked?

## MAJOR
**R3-01 "Every AC maps to a test" is not enforceable.** Today it is only a table in a markdown file.
*Fix:* convention — every test that proves an AC includes the AC ID in its title
(`it('AC-003-05 waking room A sends zero packets to room B', ...)`), Pester `It` blocks too. A
script `npm run check:trace` fails when a non-[manual] AC in `spec.md` has no test title
containing it, or when a task-referenced AC is missing from the spec. Runs in `verify`. (IMP-030)

**R3-02 Web tasks say "component tests" only.** Constitution §8 requires loading, empty and error
states for every list. *Fix:* every web task's tests include those three states plus the main
interaction; state this once in the header so it applies to all web tasks.

**R3-03 E2E arrives too late.** Playwright starts in M4-T13, so M2/M3 UI ships without browser
tests and the CSP (constitution §6.1) is never exercised against the real Vite build until M4.
*Fix:* move the Playwright harness to M2 (temp data dir, admin created through the setup API from
loopback, data seeded through the API), and make the harness **fail on any CSP violation or console
error**. Demo-mode-specific E2E stay in M4.

**R3-04 Fault injection is promised (constitution §5) but not named in the tasks** that need it:
M3-T08 (sender failures, interface vanishes), M4-T06 (helper deadline, DNS timeout), M5-T04 (clock
jumps, DB busy), M8-T07 (stop timeout, installer hang, health never OK). *Fix:* list the injected
failures in those tasks' test column.

## MINOR
- **R3-05** M3-T06: add a loopback contract test — the real UDP sender sends a magic packet to a
  UDP listener on 127.0.0.1 and the received bytes equal the domain payload. Loopback is allowed by
  the network guard; no real network is touched.
- **R3-06** M1-T05: secret scanning tool unspecified. Use gitleaks (pinned by SHA, per §6.4).
- **R3-07** M8-T03 has no test of its own; acceptable since M8-T09 smoke-tests the installer, but
  link them explicitly.
- **R3-08** NFR-09: add an E2E smoke on the `msedge` channel in the Windows CI job.

## SUGGESTION
- **IMP-030** `check:trace` script (R3-01).
