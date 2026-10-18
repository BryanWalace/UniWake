# Public documents review 2026-10-18 (after v1.6.0; ADR-062)

Roles: Code Reviewer (lead), Senior Fullstack. Owner request: README, LICENSE, CONTRIBUTING, SECURITY
and anything else needed to look professional and well guided; the roadmap looked stale.

| Document | Finding | Change |
|---|---|---|
| README | Roadmap stopped at 1.4; news box cited 1.2/1.4; features and troubleshooting missed the 1.6 agent | Roadmap rows 1.5 and 1.6, news box for 1.6.0, "Agente que se cuida" feature, agent update under Atualizações, antivirus rule under Segurança, four troubleshooting rows, links to CHANGELOG and CODE_OF_CONDUCT |
| CHANGELOG | Missing | Created (Keep a Changelog, pt-BR) from `specs/releases/` and the tags |
| CODE_OF_CONDUCT | Missing | Created (based on Contributor Covenant 2.1, pt-BR) |
| PR template | Missing | Created, with the documentation and privacy checklist |
| CONTRIBUTING | CI only "on dev"; no PR or release steps; no shutdown/documentation labels | CI on dev and main, PR section, maintainer release steps, `shutdown` and `documentation` labels, conduct link |
| SECURITY | Scope had no remote shutdown, agent update or backup file; no supported versions | Scope extended; supported-versions table |
| LICENSE | MIT, correct | — |
| Repository | Empty `cancel` file committed by mistake (6eaa3f0) | Removed |

Enforcement: `npm run check:docs` in `verify` and in the release workflow (tag version).
Open: the `shutdown` label must be created on GitHub by the owner (no `gh` locally).
