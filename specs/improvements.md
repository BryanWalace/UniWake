# UniWake — Improvements register

Format (brief §7): `IMP-xxx | proposed by | problem | proposal | impact | effort | status`.
Status values: proposed · accepted (→ FR/NFR id) · deferred · roadmap · rejected.
Accepted items receive FR/NFR IDs in `spec.md` during Phase 1.

| ID | By | Problem | Proposal | Impact | Effort | Status |
|---|---|---|---|---|---|---|
| IMP-001 | Fullstack | Dry-run records packets but nothing comes online; UI can't be built, tested or demoed realistically. | Demo mode: seeded rooms/devices + simulated prober (woken devices come online after a random delay, some never). Powers `npm run dev`, E2E, training. | Productivity, testability | M | accepted (constitution §2.5; FR id in Phase 1) |
| IMP-002 | Fullstack | After "Ligar sala" the operator doesn't know what's happening. | Live wake-job progress drawer: sent X/Y, woke Z, waiting W, countdown, "não responderam" list linking to diagnostics. | Operator productivity | M | accepted (FR id in Phase 1) |
| IMP-003 | Fullstack | pt-BR messages needed by web and PowerShell; draft contradicted itself. | Shared error-code + pt-BR catalog in `packages/shared`. | Consistency | S | accepted (ADR-006) |
| IMP-004 | Fullstack | Enrollment API contract undocumented for script authors. | OpenAPI generated from Zod schemas, admin-only. | Maintainability | S | deferred (Plan decides) |
| IMP-005 | Debug | When a PC doesn't wake, IT has no structured way to find out why. | "Diagnóstico de WoL" per device: automated checks + BIOS checklist. | Reliability, productivity | M | accepted (FR id in Phase 1) |
| IMP-006 | Debug | No proof packets were sent, or from which interface. | Packet send log per job/device. | Observability | S | accepted (constitution P4/§2.6) |
| IMP-007 | Debug | Operator can't see where packets will go. | Interface/broadcast preview in settings. | Reliability | S | accepted (FR id in Phase 1) |
| IMP-008 | Debug | Silent failures of scheduler, sweeps, backups, update. | Health page (uptime, DB, backups, scheduler tick, sweep duration, update, time sync, sleep warning). | Reliability | M | accepted (FR id in Phase 1) |
| IMP-009 | Debug | NIC driver/Windows updates silently break WoL on machines that used to wake. | Per-device wake success rate + "parou de acordar" flag. | Reliability | S | accepted (FR id in Phase 1) |
| IMP-010 | Debug | Power loss / failed update / bad migration could lose data. | Automatic DB backups: daily, pre-migration, pre-update; retention; restore doc. | Safety | S | accepted (constitution §2.3) |
| IMP-011 | Debug | DHCP reuse causes false online/offline. | Re-resolve hostname per sweep, ARP MAC check on same subnet, "IP mudou" flag. | Reliability | M | accepted (FR id in Phase 1) |
| IMP-012 | Debug | Wi-Fi/virtual/randomized MACs registered by mistake never wake. | Prefer wired physical adapter in enrollment; flag wireless/virtual/locally administered MACs in enrollment, CRUD and CSV. | Reliability | S | accepted (FR id in Phase 1) |
| IMP-013 | Debug | Controller PC sleeping at night skips the morning schedule. | Health warning when power plan allows sleep; optional installer setting. | Reliability | S | accepted (FR id in Phase 1) |
| IMP-014 | Reviewer | A forgotten auth hook opens an endpoint. | Route-table authz test; undeclared auth fails startup. | Security | S | accepted (constitution §5/§6.2) |
| IMP-015 | Reviewer | First-run takeover and DNS rebinding. | Host allowlist + loopback-only first-run setup. | Security | S | accepted (constitution §6) |
| IMP-016 | Reviewer | Unsigned installer: AV/SmartScreen friction; updates prove integrity, not authorship. | Authenticode signing + signature verification in updater. | Security | M | accepted — blocked on certificate (B-001) |
| IMP-017 | Reviewer | No supply-chain controls. | `npm ci`, audit gate, Dependabot, action pinning, secret scan. | Security | S | accepted (constitution §6.4) |
| IMP-018 | Reviewer | PowerShell script untested yet runs on hundreds of PCs. | PSScriptAnalyzer + Pester in CI, `-WhatIf`, transcript. | Reliability | S | accepted (constitution §4.2) |
| IMP-019 | Architect | Operator's real 7:00 question, "what didn't come up?", has no direct answer. | "Resultado da manhã": per-room summary of non-responders after each scheduled run, pinned until acknowledged. | Productivity | S–M | accepted (FR id in Phase 1) |
| IMP-020 | Architect | A forgotten global pause leaves labs off silently. | Pause requires reason, optional auto-resume date, red banner, skipped runs logged as "pulado (pausa)". | Safety | S | accepted (FR id in Phase 1) |
| IMP-021 | Debug | Firewalled PCs look offline; verification reports false "não respondeu". | prepare-target enables the built-in ICMPv4 echo rule (Domain/Private), `-NoFirewallChange` to skip. | Reliability | S | accepted (FR-007.1 step 5) |
| IMP-022 | Debug | Windows Update reboots the controller near the morning run. | Health warnings: pending reboot, active hours not covering 05:00–08:00. | Reliability | S | accepted (FR-012) |
| IMP-023 | Reviewer | Enrollment token travels in clear on the LAN. | TLS on agent listener with thumbprint pinned in the command. | Security | M | roadmap (RM-5, ADR-013) |
| IMP-024 | Fullstack | UI can't show the confirmation count before the server resolves the target. | `POST /api/wake/preview` for every wake; summary always shown. | Productivity, safety | S | accepted (FR-003.3) |
| IMP-025 | Fullstack | Getting the script onto each PC needs a USB stick. | Agent listener serves the script; panel shows a hash-pinned one-liner. | Productivity | S | accepted (FR-007.3, ADR-011) |
