import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '@uniwake/shared';
import { JsonConfigFile } from '../src/adapters/config-file';
import {
  SettingsAdminService,
  type SettingsView,
} from '../src/application/settings/settings-admin';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  const admin = await h.as('admin');
  const call = async <T>(method: 'GET' | 'PATCH', payload?: unknown, cookie = admin) => {
    const r = await h.inject({
      method,
      url: '/api/settings',
      cookie,
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: r.statusCode, body: r.json<T>() };
  };
  return { h, admin, call };
}

describe('settings API (FR-016)', () => {
  it('admins read every setting and save changes that apply at once, with an audited diff', async () => {
    const { h, call } = await setup();
    const view = await call<SettingsView>('GET');
    expect(Object.keys(view.body.values).sort()).toEqual([...SETTING_KEYS].sort());
    expect(view.body.pendingRestart).toEqual([]);

    const saved = await call<{ changes: { key: string }[]; restartRequired: string[] }>('PATCH', {
      'monitor.intervalSeconds': 30,
      'wake.confirmThreshold': 40, // unchanged: not a change
      'scheduler.timezone': 'America/Manaus',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.changes.map((c) => c.key).sort()).toEqual([
      'monitor.intervalSeconds',
      'scheduler.timezone',
    ]);
    expect(saved.body.restartRequired).toEqual([]);
    expect(h.services.settings.get('monitor.intervalSeconds')).toBe(30);
    const audit = h.services.db.get<{ details: string; actor_label: string }>(
      "SELECT details, actor_label FROM audit_log WHERE action = 'settings.update'",
    )!;
    expect(audit.actor_label).toBe('admin-user');
    expect(JSON.parse(audit.details).changes).toContainEqual({
      key: 'monitor.intervalSeconds',
      old: 60,
      new: 30,
    });
  });

  it('rejects invalid values with the field path', async () => {
    const { call } = await setup();
    for (const bad of [
      { 'monitor.intervalSeconds': 5 },
      { 'scheduler.timezone': 'Marte/Olimpo' },
      { 'nao.existe': 1 },
      'texto',
    ]) {
      const r = await call<{ code: string; details: { path: string }[] }>('PATCH', bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    const r = await call<{ details: { path: string }[] }>('PATCH', {
      'monitor.intervalSeconds': 5,
    });
    expect(r.body.details[0]!.path).toBe('monitor.intervalSeconds');
  });

  it('AC-016-02: operators get 403 on settings reads and writes', async () => {
    const { h, call } = await setup();
    const operator = await h.as('operator');
    expect((await call('GET', undefined, operator)).status).toBe(403);
    expect((await call('PATCH', { 'monitor.intervalSeconds': 30 }, operator)).status).toBe(403);
    expect(h.services.settings.get('monitor.intervalSeconds')).toBe(60);
  });

  it('bootstrap keys go to config.json and apply after a restart', async () => {
    const { h } = await setup();
    const dir = mkdtempSync(join(tmpdir(), 'uniwake-cfg-'));
    dirs.push(dir);
    const path = join(dir, 'config.json');
    writeFileSync(path, '﻿{"agentBind":"0.0.0.0"}'); // Notepad BOM, unrelated key kept
    const admin = new SettingsAdminService({
      settings: h.services.settings,
      audit: h.services.audit,
      transaction: (fn) => h.services.db.transaction(fn),
      configFile: new JsonConfigFile(path),
      running: { panelPort: 47100, agentPort: 47101, syncPort: 47102, logLevel: 'info' },
    });
    const r = admin.save(
      { 'bootstrap.panelPort': 48100, 'bootstrap.logLevel': 'debug' },
      { id: 1, label: 'admin' },
    );
    expect(r.restartRequired.sort()).toEqual(['bootstrap.logLevel', 'bootstrap.panelPort']);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      agentBind: '0.0.0.0',
      panelPort: 48100,
      logLevel: 'debug',
    });
    expect(admin.view()).toMatchObject({
      values: { 'bootstrap.panelPort': 48100, 'bootstrap.agentPort': 47101 },
      pendingRestart: ['bootstrap.panelPort', 'bootstrap.logLevel'],
    });
    // the API harness has no config file: bootstrap keys are read-only there
    const { call } = await setup();
    expect((await call('PATCH', { 'bootstrap.panelPort': 48100 })).status).toBe(422);
  });
});
