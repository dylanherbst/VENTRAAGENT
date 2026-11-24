// Where the studio keeps its state. One JSON value per key. Three backends, same interface:
//   memory (tests), file (your Mac: a folder on disk), supabase (hosted: one row per key in public.studio_snapshots, service key, server only).
// The studio is single-owner: last write wins per key, which is fine for one person and keeps the model simple.
export interface Vault {
  kind: 'memory' | 'file' | 'supabase';
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const KEY = /^[a-z0-9][a-z0-9:/_-]{0,180}$/;
const check = (key: string) => { if (!KEY.test(key)) throw new Error('bad_vault_key'); };

export function memoryVault(): Vault & { dump(): Map<string, string> } {
  const m = new Map<string, string>();
  return {
    kind: 'memory', dump: () => m,
    async get(key) { check(key); const v = m.get(key); return v === undefined ? null : JSON.parse(v); },
    async put(key, value) { check(key); m.set(key, JSON.stringify(value)); },
    async del(key) { check(key); m.delete(key); },
  };
}

export async function fileVault(dir: string): Promise<Vault> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = (key: string) => { check(key); return path.join(dir, `${key.replace(/[/:]/g, '__')}.json`); };
  return {
    kind: 'file',
    async get(key) { try { return JSON.parse(await fs.readFile(file(key), 'utf8')); } catch (e) { if ((e as { code?: string }).code === 'ENOENT') return null; throw e; } },
    async put(key, value) {
      // The folder is (re)created on every write: it may have been removed while the server was running.
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const f = file(key); const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(tmp, f);
    },
    async del(key) { try { await fs.unlink(file(key)); } catch { /* already gone */ } },
  };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export function supabaseVault(deps: { url: string; serviceKey: string; fetch: Fetch; table?: string }): Vault {
  const base = `${deps.url.replace(/\/$/, '')}/rest/v1/${deps.table ?? 'studio_snapshots'}`;
  const h = { apikey: deps.serviceKey, authorization: `Bearer ${deps.serviceKey}`, 'content-type': 'application/json' };
  return {
    kind: 'supabase',
    async get(key) {
      check(key);
      const r = await deps.fetch(`${base}?key=eq.${encodeURIComponent(key)}&select=value`, { method: 'GET', headers: h });
      if (!r.ok) throw new Error(`vault_get_${r.status}`);
      const rows = (await r.json()) as { value: unknown }[];
      return rows[0]?.value ?? null;
    },
    async put(key, value) {
      check(key);
      const r = await deps.fetch(`${base}?on_conflict=key`, { method: 'POST', headers: { ...h, prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
      if (!r.ok) throw new Error(`vault_put_${r.status}`);
    },
    async del(key) {
      check(key);
      const r = await deps.fetch(`${base}?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: h });
      if (!r.ok) throw new Error(`vault_del_${r.status}`);
    },
  };
}
