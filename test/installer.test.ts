/**
 * The installer is compiled and exercised end to end in the windows CI job (M8-T09); these checks
 * keep its hand-written values consistent with the server (ports, layout, service settings).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../apps/server/src/config';

const root = join(import.meta.dirname, '..');
const iss = readFileSync(join(root, 'installer/UniWake.iss'), 'utf8');
const xml = readFileSync(join(root, 'installer/UniWakeService.xml'), 'utf8');

describe('installer (M8-T03, FR-001.1)', () => {
  it('opens the panel and agent ports the hub listens on by default', () => {
    expect(iss).toContain(`#define PanelPort "${CONFIG_DEFAULTS.panelPort}"`);
    expect(iss).toContain(`#define AgentPort "${CONFIG_DEFAULTS.agentPort}"`);
    expect(iss).toContain(`AddFirewallRule('UniWake Painel', '{#PanelPort}')`);
    expect(iss).toContain(`AddFirewallRule('UniWake Cadastro', '{#AgentPort}')`);
    expect(iss).toMatch(/profile=domain,private/);
    expect(iss).toContain('String: "http://127.0.0.1:{#PanelPort}/"');
  });

  it('removes on uninstall exactly the firewall rules it creates', () => {
    for (const name of ['UniWake Painel', 'UniWake Cadastro']) {
      expect(iss).toContain(`delete rule name=""${name}"""`);
    }
  });

  it('installs each version in its own directory and keeps data outside it', () => {
    expect(iss).toContain('DestDir: "{app}\\versions\\{#AppVersion}"');
    expect(iss).toContain('Name: "{commonappdata}\\UniWake"; Flags: uninsneveruninstall');
    expect(iss).toMatch(/not UninstallSilent\(\)/);
  });

  it('the service runs the bundled node.exe of one version, starts automatically and restarts on failure', () => {
    expect(xml).toContain('<id>UniWake</id>');
    expect(xml).toContain('<executable>%BASE%\\versions\\@VERSION@\\node.exe</executable>');
    expect(xml).toContain('<arguments>"%BASE%\\versions\\@VERSION@\\server.mjs"</arguments>');
    expect(xml).toContain('<startmode>Automatic</startmode>');
    expect(xml.match(/<onfailure action="restart"/g)).toHaveLength(3);
    expect(xml).not.toMatch(/<serviceaccount>/); // WinSW default: LocalSystem (ADR-021)
    // WinSW reads the file as UTF-8; ASCII keeps the Inno round trip byte-exact.
    expect([...xml].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});
