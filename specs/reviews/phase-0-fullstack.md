# Phase 0 review — Senior Fullstack Developer

Reviewed: `specs/constitution.md` v0.1 · Date: 2026-10-04
Lens: feasibility, developer experience, simpler alternatives, UI/UX, hard parts.

## 1. Feasibility check of the draft

| Section | Verdict | Notes |
|---|---|---|
| §2.1 hexagonal | OK, keep it light | Good for network/clock/OS. Risk: ceremony on CRUD. Rule of thumb I'll apply: a port exists only where we need a fake or have more than one implementation. |
| §2.2 `Repositories` port with fakes | **Change** | Faking repositories means writing and maintaining a second in-memory database that drifts from SQL behavior (constraints, unique MAC, cascades). SQLite `:memory:` is fast (< 5 ms per test DB) and is the real engine. Proposal: repositories are concrete SQLite classes; tests use a fresh in-memory DB with migrations applied. Ports remain for clock, network, FS, process, release source. |
| §3 Node LTS | **Specify the version** | Brief says Node 22. The dev machine has Node 24.15, and Node 24 is the Active LTS today (Node 22 is in maintenance, EOL April 2027). We ship our own runtime inside the installer, so the operator machine never needs Node installed. Proposal: Node 24 LTS, pinned in `.nvmrc`, `engines`, and the bundled runtime. |
| §3 npm workspaces | OK | pnpm is not installed here; npm ships with Node. One less tool. |
| §4 "UI strings in web, HTTP maps codes to pt-BR message" | **Contradiction** | §4 says the HTTP layer maps codes to pt-BR messages *and* that UI strings live only in the web app. `prepare-target.ps1` also needs pt-BR errors from the enrollment API, and it is not the web app. Proposal: one catalog `packages/shared/src/messages.pt-BR.ts` mapping `ErrorCode → pt-BR template`. Server returns `{ code, message, details }`; web may override the presentation but uses the same codes. |
| §5 Vitest + Playwright | OK | Playwright needs browser download (~150 MB) in CI; cache it. E2E only needs Chromium. |
| §2.5 dry-run | OK, extend | Dry-run alone records packets but nothing "comes online", so the UI can't be developed or demoed realistically. See IMP-001. |

## 2. Native modules: the hidden packaging cost
`better-sqlite3` and `argon2` are native addons. Each needs a prebuilt binary for **exactly** the
Node ABI we ship, or the service fails at startup after an update. Since we bundle our own
`node.exe`, the ABI is fixed, which makes this manageable, but every native addon adds a failure
point to the install and update path. Request: the constitution should say native addons need an
ADR and must have prebuilt win-x64 binaries. For password hashing, built-in options exist
(`crypto.scrypt`, and `crypto.argon2` in recent Node 24 releases, still experimental), so §6
should not force a native dependency. The final pick belongs in Plan.

## 3. Developer experience requests
- `npm run verify` as the single CI gate: agree.
- Add `npm run dev`: hub in dry-run with a seeded demo DB plus Vite dev server with proxy.
- Shared Zod schemas in `packages/shared` give typed API calls in the web app without codegen.
- Recommend SSE over WebSocket for realtime: server→client only, automatic reconnect, works with
  the session cookie, no extra library. (Decision belongs to Plan; flagging early.)

## 4. UI/UX proposals (operator at 7:00 AM)
- Dashboard = grid of room cards sorted by block/floor/name. Each card: name, color strip,
  `online/total` with a bar, last action ("Ligada às 06:50 por agendamento — 28/30 acordaram"),
  buttons **Ligar sala**, **Ligar só os desligados**, **Ver máquinas**.
- After any wake, open a progress drawer: pacotes enviados X/Y, acordaram Z, aguardando W,
  countdown of the verification window, list of "não responderam" with a link to diagnostics
  (IMP-002).
- Each room has its own URL (`/salas/:id`) so a technician can bookmark "Lab 3".
- Global search with `/` shortcut (name, IP, MAC, hostname).
- Responsive down to a 768 px tablet; no dark mode in v1 (not worth the test matrix).

## 5. Hard-part estimates

| Item | Size | Why |
|---|---|---|
| Self-update with rollback | **L** | A running service cannot overwrite its own files; needs an external updater process, health check and rollback. Most failure-prone feature. |
| Windows service wrapper | M | WinSW is simple, but recovery options, logs and stop timeouts need care. |
| Packaging (bundled node.exe + app + native addons) | M | See §2. |
| ICMP without admin raw sockets | M | Raw sockets need admin; options are spawning `ping.exe`, or calling `IcmpSendEcho` through FFI. Must still meet 500 devices < 30 s. |
| ARP parsing (v1.1) | S–M | `arp -a` output is **localized** (pt-BR Windows prints "Endereço IP", "dinâmico"). Prefer `Get-NetNeighbor | ConvertTo-Json`. |
| Scheduler with DST/grace/no double fire | M | Logic is small, but the test matrix is large. |

## 6. Improvements proposed
- **IMP-001** Demo mode: seeded rooms/devices and a simulated prober where woken devices come
  online after a random delay (some never do). Powers `npm run dev`, E2E tests and operator
  training.
- **IMP-002** Wake-job live progress drawer (above).
- **IMP-003** Shared pt-BR error/message catalog in `packages/shared` (fixes the §4 contradiction).
- **IMP-004** OpenAPI document generated from the Zod schemas, served to admins. It documents the
  enrollment contract for the PowerShell script. Low priority.
