import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { BusinessConfig } from './config.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`Invalid business config ${file}:\n  - ${issues.join('\n  - ')}`);
  }
}

/** Parses and validates a business config. Throws `ConfigError` listing every problem. */
export function parseBusinessConfig(yamlText: string, file = '<inline>'): BusinessConfig {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (e) {
    throw new ConfigError(file, [e instanceof Error ? e.message : String(e)]);
  }
  const result = BusinessConfig.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      file,
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

export async function loadBusinessConfig(path: string): Promise<BusinessConfig> {
  return parseBusinessConfig(await readFile(path, 'utf8'), path);
}
