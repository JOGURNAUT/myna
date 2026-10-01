import { z } from 'zod';
import { CallEvent, StartCallInput, StartCallOutput } from './calls.js';
import { BusinessConfig } from './config.js';
import { Appointment, NewPatient, PatientSummary, Slot } from './domain.js';
import { ToolError } from './errors.js';
import { TOOLS } from './tools.js';

const pascal = (s: string) =>
  s
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

/**
 * Builds one JSON Schema document (draft 2020-12) holding every contract the Python agent
 * needs, under `$defs`. Inputs are exported in their input shape (what the agent sends) and
 * outputs in their output shape (what it receives). Shared types become named `$defs`, so the
 * generated Pydantic models reuse one class per type.
 */
export function buildContractSchema(): Record<string, unknown> {
  const shared = {
    Appointment,
    Slot,
    PatientSummary,
    NewPatient,
    ToolError,
  };

  const exportOne = (schema: z.ZodType, io: 'input' | 'output') => {
    const registry = z.registry<{ id: string }>();
    for (const [id, s] of Object.entries(shared)) registry.add(s, { id });
    const out = z.toJSONSchema(schema, {
      io,
      target: 'draft-2020-12',
      unrepresentable: 'any',
      metadata: registry,
      reused: 'inline',
    }) as Record<string, unknown>;
    // Hoist nested definitions so all $refs resolve inside one document.
    const defs = (out.$defs ?? {}) as Record<string, unknown>;
    delete out.$defs;
    delete out.$schema;
    return { schema: out, defs };
  };

  const $defs: Record<string, unknown> = {};
  const add = (name: string, schema: z.ZodType, io: 'input' | 'output') => {
    const { schema: s, defs } = exportOne(schema, io);
    Object.assign($defs, defs);
    $defs[name] = s;
  };

  for (const [id, s] of Object.entries(shared)) add(id, s, 'output');
  for (const [name, t] of Object.entries(TOOLS)) {
    add(`${pascal(name)}Input`, t.input, 'input');
    add(`${pascal(name)}Output`, t.output, 'output');
  }
  add('BusinessConfig', BusinessConfig, 'output');
  add('StartCallInput', StartCallInput, 'input');
  add('StartCallOutput', StartCallOutput, 'output');
  add('CallEvent', CallEvent, 'input');

  const sorted = Object.fromEntries(Object.entries($defs).sort(([a], [b]) => a.localeCompare(b)));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://myna.local/contracts.json',
    title: 'MynaContracts',
    description: 'Generated from packages/shared (Zod). Do not edit by hand.',
    $defs: sorted,
  };
}

export const CONTRACT_SCHEMA_PATH = 'json-schema/contracts.json';
