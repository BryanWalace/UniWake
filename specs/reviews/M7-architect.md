# M7 — Architect conformance check (Phase 4 guardian)

Date: 2026-10-05

| Plan item | Status | Note |
|---|---|---|
| Agent listener, exactly three routes (ADR-011, plan §6.2) | ✔ | Asserted on the hub's route table and on a standalone agent app. Enrollment token in `Authorization: Bearer`, checked in `onRequest` before the body. |
| Hash-pinned one-liner (ADR-011) | ✔ | `buildCommand` output is pinned by a golden fixture that the Pester test executes; E2E checks the pinned hash against the bytes the demo hub serves. |
| Enrollment flow (plan §7.3) | ✔ | One transaction: token use, upsert by MAC (now also by reported other MACs, M7-F1), device events, audit; move notice for 24 h. |
| ICMP rule (FR-007.1 step 5) | changed | ADR-028: dedicated `UniWake-ICMPv4-In` rule for Domain/Private instead of the built-in rule. Spec and IMP-021 amended. |
| Data model (plan §5) | changed | Migration 003 adds `test_wol_runs`; plan table updated. |
| Error catalog (plan §6.6) | changed | `PREPARE_SCRIPT_MISSING` added. |
| Layering | ✔ | File and PowerShell access stay in adapters (`PrepareScriptFile`); the test-WoL flow reuses the wake engine (`source: 'test'`, `assumeOffline`) instead of sending on its own. |
| Tooling (IMP-018) | ✔ | Pester 5.9.1 and PSScriptAnalyzer 1.25.0 pinned by SHA-256 and fetched into `.tools/` by `scripts/test-ps.ps1`; windows CI job runs it. |

No further plan change needed. M8 may start.
