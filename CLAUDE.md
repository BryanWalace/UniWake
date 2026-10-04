# UniWake — agent guide

Wake-on-LAN + monitoring + scheduling for a college's Windows PCs, organized by rooms and tags.

## Start here
1. `specs/handoff/NEXT.md` — exact current state and next step. Always read first.
2. `.agents/01-project-brief.md` — product intent. `.agents/06-orchestrator.md` — process.
3. `specs/constitution.md` — binding rules (architecture, tests, security, DoD, commits).
4. `specs/spec.md`, `specs/plan.md`, `specs/tasks.md` — once they exist.
5. `specs/decisions.md` (ADRs), `specs/improvements.md` (IMP-xxx), `specs/handoff/BLOCKERS.md`.

## Working mode
- Single agent playing Architect / Senior Fullstack / Debug / Code Reviewer, fully autonomous.
- Every phase: each role writes `specs/reviews/phase-<N>-<role>.md`, then the lead consolidates.
- Commit + push to `origin main` after each completed task (Conventional Commits, see constitution §10).
- Code, specs, commits in English. UI and README in pt-BR.
- Never send real magic packets or scan real networks from tests.

## Environment notes
- Dev machine: Windows 11, Node 24, npm 11, git. No `gh`, `pnpm`, Go or Inno Setup installed locally.
- Shell: Git Bash (POSIX) and PowerShell 5.1 both available.
