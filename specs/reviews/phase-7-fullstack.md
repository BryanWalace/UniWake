# Phase 7 review — Senior Fullstack

Date: 2026-10-09 · Lens: buildable on the existing hub without destabilising v1.0/v1.1.

- **F7-01 (MAJOR)** `SettingsService` caches values; remote setting changes would be invisible
  until restart. → `reload()` with change notification, called after a batch (plan §14.4).
- **F7-02** The application layer may not import `node:net|tls|dgram` (constitution §2.1). →
  `SyncNetwork` port; adapters own sockets (plan §14.1).
- **F7-03** Two hubs in one Vitest process need configurable ports and announcement targets;
  `syncPort: 0` (ephemeral) and explicit loopback targets in tests.
- **F7-04 (MINOR)** The first "Parear com outro PC" on a PC with no team creates the team
  (random team id, epoch 1, own member record). No separate "create team" step in the UI.
- **F7-05 (MINOR)** SSE: one `sync` event after each applied batch; the web client invalidates
  every query (a batch can touch anything).
