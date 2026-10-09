# UniWake — agent guide

Wake-on-LAN + monitoring + scheduling (later: shutdown and team sync) for a college's
Windows PCs, organized by rooms and tags.

## Start here
1. `specs/handoff/NEXT.md` — exact current state and next step. Always read first.
2. `.agents/01-project-brief.md` — product intent (v1.0/v1.1).
3. `.agents/07-roadmap-features.md` — versions v1.2–v1.4 and design decisions that apply
   from v1.0 (section A). Read it before changing the data model or scheduler.
4. `.agents/06-orchestrator.md` — process.
5. `specs/constitution.md` — binding rules (architecture, tests, security, DoD, commits).
6. `specs/spec.md`, `specs/plan.md`, `specs/tasks.md` — once they exist.
7. `specs/decisions.md` (ADRs), `specs/improvements.md` (IMP-xxx), `specs/handoff/BLOCKERS.md`.

## Working mode
- Single agent playing Architect / Senior Fullstack / Debug / Code Reviewer, fully autonomous.
  Do not ask for approval; decide, record ADRs, continue.
- Every phase: each role writes `specs/reviews/phase-<N>-<role>.md`, then the lead consolidates.
- Code, specs, commits in English. UI and README in pt-BR. Talk to me in pt-BR.
- Never send real magic packets, real shutdown commands, or scan real networks from tests.
- Before ending a session, update `specs/handoff/NEXT.md` with exact next steps.

## Stop points
- After v1.0 is validated on `dev`: STOP and explain in pt-BR, step by step, how I test it
  on real PCs. Wait for me to say "continue".
- Then go through v1.1 → v1.4 autonomously and STOP with a final report.

## Git workflow (mandatory — overrides constitution §10 and anything in .agents/)
- All work happens on branch `dev` (create it from current `main` if it does not exist).
- Commit after each completed task (Conventional Commits, see constitution §10) and push
  to `origin dev` only.
- NEVER commit to, merge into, rebase onto, or push to `main`. Never open or merge a PR into `main`.
- NEVER create release tags (`v*`) — tags publish releases and trigger auto-update on real PCs.
- CI on `dev`: lint, typecheck, tests only. Releases only from `v*` tags on `main`.
- Only when I explicitly say "pode subir a dev para a main" you may merge `dev` into `main`,
  after confirming all tests pass, and then (only if I ask) create the release tag.

## Environment notes
- Dev machine: Windows 11, Node 24, npm 11, git. No `gh`, `pnpm`, Go or Inno Setup installed locally.
- Shell: Git Bash (POSIX) and PowerShell 5.1 both available.