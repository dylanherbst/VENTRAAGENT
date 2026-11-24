/**
 * Optional, silent loader for apps/web/.env.local (Node 24).
 * Never prints values. Does not override non-empty process.env entries.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function mergeOne(envPath: string): Promise<void> {
  try {
    const fileEnv = parseEnvFile(await readFile(envPath, 'utf8'));
    for (const [key, value] of Object.entries(fileEnv)) {
      if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function loadOptionalTestEnv(envPath?: string): Promise<void> {
  const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (envPath) {
    await mergeOne(envPath);
    return;
  }
  // Public/app keys from .env.local; admin fixture key from custom file Next does not auto-load.
  await mergeOne(path.join(webRoot, '.env.local'));
  await mergeOne(path.join(webRoot, '.env.s01-integration'));
}
