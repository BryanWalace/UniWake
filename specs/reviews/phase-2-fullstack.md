# Phase 2 review — Senior Fullstack Developer

Reviewed: `specs/plan.md` v0.1 · Date: 2026-10-04
Lens: can I build this efficiently, and will the toolchain hold together?

## 1. Toolchain compatibility (checked with `npm view` today)
| Package | Latest | Issue | Proposal |
|---|---|---|---|
| typescript | 7.0.2 (native compiler) | `typescript-eslint` 8.71 peer range is `>=4.8.4 <6.1.0`; type-aware lint would break. | **Pin TypeScript 6.0.x.** Revisit TS 7 when typescript-eslint supports it. |
| eslint | 10.12 | `eslint-plugin-react` 7.37.5 supports ESLint ≤ 9. | Use ESLint 10 **without** eslint-plugin-react; enforce the no-`dangerouslySetInnerHTML` rule with `no-restricted-syntax` (`JSXAttribute[name.name='dangerouslySetInnerHTML']`). `eslint-plugin-react-hooks` 7 supports ESLint 10. |
| @types/node | 26.x | Must match the shipped runtime. | **Pin `@types/node@24`**. |
| vitest | 5.0.3 | needs vite 6–8. | vite 8 + vitest 5 + `@vitejs/plugin-react` 6. |
| fastify-type-provider-zod | 7.0.0 | peer zod ≥ 4.1.5, fastify ^5.5. | Fastify 5.12 + Zod 4.6. |
| react-router | 8.4 | Library ("declarative") mode is enough; no framework mode. | `createBrowserRouter`. |
| eslint-plugin-import-x | 4.17 | Supports ESLint 10; has `no-restricted-paths`. | Use it for layer boundaries (plan §3 says eslint-plugin-import). |

## 2. Simplifications
- **F2-01 Rate limiting:** `@fastify/rate-limit` is fine for per-IP limits, but per-user wake limits
  and per-account login backoff need custom keys anyway. Proposal: keep the plugin for per-IP
  limits; write a 40-line in-memory keyed limiter for per-user/per-account (testable with the fake
  clock, which the plugin isn't).
- **F2-02 Luxon:** Luxon shifts a non-existent local time forward **by the size of the gap**
  (02:30 → 03:30), not to the transition instant (03:00) required by ADR-008. Domain code must
  detect the invalid local time and compute the transition instant itself. Fine, but flag it so
  nobody trusts Luxon's default.
- **F2-03 `csv-parse` / `csv-stringify`:** OK. Both are small and pure JS.
- **F2-04 Settings form generation** from `packages/shared/settings.ts` metadata: agreed; gives
  NFR-03 test for free.
- **F2-05 `rotating-file-stream`** works as a pino destination without worker threads, which keeps
  the esbuild bundle simple. Agreed.
- **F2-06 Dev loop:** `npm run dev` = `concurrently "tsx watch apps/server/src/main.ts --demo
  --data-dir .dev-data" "vite"`; Vite proxies `/api` to 47100. Add `.dev-data/` to `.gitignore`.
- **F2-07 Static web in production:** the hub serves `web/` with SPA fallback to `index.html`, but
  only for non-`/api` and non-`/agent` paths, so API 404s stay JSON.

## 3. Gaps in the plan
- **F2-08** The **web routes/pages** list is missing. Proposal (pt-BR URLs): `/` painel, `/salas/:id`,
  `/dispositivos`, `/dispositivos/:id` (detalhe + diagnóstico), `/agendamentos`, `/historico`
  (jobs + execuções), `/historico/jobs/:id`, `/preparar`, `/configuracoes`, `/usuarios`,
  `/auditoria`, `/saude`, `/logs`, `/ajuda/:topico`, `/login`, `/primeiro-acesso`.
- **F2-09** `GET /api/devices` pagination: the dashboard needs all 500 devices with state at once.
  Proposal: `/api/dashboard` returns rooms + counters; `/api/devices?all=1` returns the compact list
  (id, name, room, status, ip, tags) unpaginated up to 2 000 items; paginated otherwise.
- **F2-10** Demo/simulated prober is in `adapters/`, good. The fake clock for tests should live in
  `apps/server/test/fakes/`, not in production code.
- **F2-11** Version injection: `server.mjs` needs its version at build time (esbuild `define`
  `__APP_VERSION__` from the tag), and dev shows `0.0.0-dev`.

## 4. Estimates of the hard parts (refined)
| Item | Size | Comment |
|---|---|---|
| Probe helper + supervision | M | Contract test on loopback in Windows CI. |
| Scheduler domain (occurrences, DST, grace) | M | Mostly tests. |
| Update service + updater + rollback | L | Biggest item; split into 5+ tasks. |
| Installer (Inno + WinSW + versions dir) | M | Needs Windows CI to iterate. |
| Web panel | L | ~16 pages; reuse table/list/dialog components. |

## 5. Improvements proposed
- **IMP-026** Keyboard-first "Ligar sala" palette: `Ctrl+K` opens a room/tag/device picker with
  preview and Enter-to-wake (confirmation rules unchanged). Effort S. Nice for the morning rush.
