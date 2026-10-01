import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractSchema, CONTRACT_SCHEMA_PATH } from '../src/json-schema.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, CONTRACT_SCHEMA_PATH);

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(buildContractSchema(), null, 2)}\n`, 'utf8');
console.log(`wrote ${out}`);
