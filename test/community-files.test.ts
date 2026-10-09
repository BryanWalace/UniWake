/**
 * M15-T02: GitHub issue forms and community files (owner request, item 5). GitHub rejects an
 * invalid form silently (the template just disappears), so the structure is checked here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const dir = join(process.cwd(), '.github', 'ISSUE_TEMPLATE');
const form = (name: string) =>
  parse(readFileSync(join(dir, name), 'utf8')) as {
    name: string;
    description: string;
    labels: string[];
    body: {
      type: string;
      id?: string;
      attributes: Record<string, unknown>;
      validations?: { required?: boolean };
    }[];
  };

const ids = (f: ReturnType<typeof form>) => f.body.filter((b) => b.id).map((b) => b.id);

describe('issue forms', () => {
  it.each(['bug_report.yml', 'feature_request.yml', 'question.yml'])(
    '%s is a valid issue form',
    (name) => {
      const f = form(name);
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.body.length).toBeGreaterThan(0);
      for (const b of f.body) {
        expect(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes']).toContain(b.type);
        if (b.type !== 'markdown') expect(typeof b.attributes.label).toBe('string');
      }
      expect(new Set(ids(f)).size).toBe(ids(f).length); // ids are unique
    },
  );

  it('the bug form asks for version, Windows, installation type, steps, expected/actual, logs, screenshots', () => {
    const f = form('bug_report.yml');
    expect(f.labels).toEqual(['bug']);
    expect(ids(f)).toEqual(
      expect.arrayContaining([
        'version',
        'windows',
        'install',
        'steps',
        'expected',
        'actual',
        'logs',
        'screenshots',
      ]),
    );
    const install = f.body.find((b) => b.id === 'install')!;
    expect(install.attributes.options).toEqual([
      'Um PC (instalação simples)',
      'Modo equipe (dois ou mais PCs sincronizados)',
    ]);
    // The required privacy warning: no real IPs, MACs, hostnames, passwords or tokens.
    const privacy = f.body.find((b) => b.id === 'privacy')!;
    const option = (privacy.attributes.options as { label: string; required: boolean }[])[0]!;
    expect(option.required).toBe(true);
    for (const word of ['IPs', 'MAC', 'computadores', 'senhas', 'tokens'])
      expect(option.label).toContain(word);
    // Where logs are in the panel.
    expect(String(f.body.find((b) => b.id === 'logs')!.attributes.description)).toMatch(/Logs/);
  });

  it('the panel pre-fills the "version" field of the bug and feature forms (FR-207)', () => {
    expect(ids(form('bug_report.yml'))).toContain('version');
    expect(ids(form('feature_request.yml'))).toContain('version');
    expect(ids(form('feature_request.yml'))).toEqual(
      expect.arrayContaining(['problem', 'solution', 'alternatives', 'who']),
    );
  });

  it('blank issues are disabled and vulnerabilities go to private reporting', () => {
    const c = parse(readFileSync(join(dir, 'config.yml'), 'utf8')) as {
      blank_issues_enabled: boolean;
      contact_links: { url: string }[];
    };
    expect(c.blank_issues_enabled).toBe(false);
    expect(c.contact_links.map((l) => l.url)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/security/advisories/new'),
        expect.stringContaining('SECURITY.md'),
      ]),
    );
  });
});

describe('community files', () => {
  it('SECURITY.md forbids public issues and points to private vulnerability reporting', () => {
    const s = readFileSync('SECURITY.md', 'utf8');
    expect(s).toMatch(/Não abra uma issue pública/);
    expect(s).toContain('/security/advisories/new');
  });

  it('CONTRIBUTING.md documents the dev workflow, tests, commits and every label', () => {
    expect(existsSync('CONTRIBUTING.md')).toBe(true);
    const c = readFileSync('CONTRIBUTING.md', 'utf8');
    for (const s of ['git switch dev', 'npm run verify', 'npm run e2e', 'Conventional Commits'])
      expect(c).toContain(s);
    for (const label of [
      'bug',
      'enhancement',
      'question',
      'sync',
      'wol',
      'scheduler',
      'installer',
      'good first issue',
    ]) {
      expect(c).toContain(`| \`${label}\` |`);
    }
  });
});
