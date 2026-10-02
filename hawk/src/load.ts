import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import { Persona, Scenario } from './schema.js';

async function loadDir<T extends z.ZodType>(dir: string, schema: T): Promise<z.output<T>[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  const out: z.output<T>[] = [];
  for (const file of files) {
    const raw = parse(await readFile(join(dir, file), 'utf8')) as unknown;
    const docs = Array.isArray(raw) ? raw : [raw];
    for (const [i, doc] of docs.entries()) {
      const parsed = schema.safeParse(doc);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`);
        throw new Error(`${file}[${i}] is invalid:\n  ${issues.join('\n  ')}`);
      }
      out.push(parsed.data);
    }
  }
  return out;
}

export async function loadSuite(root: string) {
  const personas = await loadDir(join(root, 'personas'), Persona);
  const scenarios = await loadDir(join(root, 'scenarios'), Scenario);
  const byId = new Map(personas.map((p) => [p.id, p]));
  const ids = new Set<string>();
  for (const s of scenarios) {
    if (ids.has(s.id)) throw new Error(`duplicate scenario id "${s.id}"`);
    ids.add(s.id);
    if (!byId.has(s.persona)) throw new Error(`scenario "${s.id}": unknown persona "${s.persona}"`);
  }
  return { personas: byId, scenarios };
}
