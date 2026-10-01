import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContractSchema, CONTRACT_SCHEMA_PATH } from '../src/json-schema.js';
import { TOOLS } from '../src/tools.js';

describe('exported JSON Schema', () => {
  it('is up to date (run `pnpm schemas:export` if this fails)', async () => {
    const committed = JSON.parse(
      await readFile(resolve(import.meta.dirname, '..', CONTRACT_SCHEMA_PATH), 'utf8'),
    ) as unknown;
    expect(committed).toEqual(buildContractSchema());
  });

  it('has an input and output definition for every tool', () => {
    const defs = Object.keys(buildContractSchema().$defs as object);
    for (const tool of Object.keys(TOOLS)) {
      const base = tool
        .split('_')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('');
      expect(defs).toContain(`${base}Input`);
      expect(defs).toContain(`${base}Output`);
    }
  });

  it('keeps every $ref resolvable inside the document', () => {
    const doc = buildContractSchema();
    const defs = doc.$defs as Record<string, unknown>;
    const refs = JSON.stringify(doc).match(/"\$ref":"#\/\$defs\/[^"]+"/g) ?? [];
    for (const ref of refs) {
      const name = ref.split('/').pop()!.replace('"', '');
      expect(defs, `missing ${name}`).toHaveProperty(name);
    }
  });
});
