import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadBusinessConfig, parseBusinessConfig } from '../src/index.js';

const clinicsDir = resolve(import.meta.dirname, '../../../clinics');

describe('business config', () => {
  it('loads the demo clinic', async () => {
    const cfg = await loadBusinessConfig(resolve(clinicsDir, 'smile-dental.yaml'));
    expect(cfg.id).toBe('smile-dental');
    expect(cfg.resources.map((r) => r.id)).toEqual(['dr-mehta', 'dr-rao']);
    expect(cfg.hours.sun).toEqual([]);
    expect(cfg.recordCalls).toBe(false);
    expect(cfg.killSwitch).toBe(false);
  });

  const issuesFor = (yaml: string): string => {
    try {
      parseBusinessConfig(yaml, 'broken.yaml');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      return (e as ConfigError).issues.join('\n');
    }
    return expect.unreachable('config should have been rejected');
  };

  it('rejects an unsupported language with its path', async () => {
    const yaml = await readFile(resolve(clinicsDir, 'smile-dental.yaml'), 'utf8');
    expect(
      issuesFor(yaml.replace('greetingLanguage: hinglish', 'greetingLanguage: tamil')),
    ).toContain('greetingLanguage');
  });

  it('rejects a doctor offering a service the clinic does not have', async () => {
    const yaml = await readFile(resolve(clinicsDir, 'smile-dental.yaml'), 'utf8');
    const issues = issuesFor(
      yaml.replace('services: [consultation, cleaning, braces-review]', 'services: [whitening]'),
    );
    expect(issues).toContain('resources.1.services.0: unknown service "whitening"');
  });

  it('rejects a greeting language the clinic does not allow', async () => {
    const yaml = await readFile(resolve(clinicsDir, 'smile-dental.yaml'), 'utf8');
    expect(
      issuesFor(yaml.replace('languages: [en, hi, hinglish]', 'languages: [en, hi]')),
    ).toContain('greetingLanguage: must be one of languages');
  });

  it('rejects a time range that ends before it starts', () => {
    const yaml = `
id: x
tenantId: x
vertical: clinic
name: X
phone: '9800000001'
humanHandoffNumber: '9800000002'
languages: [en]
greetingLanguage: en
hours: { mon: [{ start: '13:00', end: '10:00' }] }
resources: [{ id: a, name: A, services: [s], hours: {} }]
services: [{ id: s, name: S, durationMin: 15 }]
`;
    expect(() => parseBusinessConfig(yaml)).toThrow(/start must be before end/);
  });
});
