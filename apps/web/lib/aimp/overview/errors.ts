// Shared by build.ts and collect.ts (exported to callers from collect.ts). No other imports, so there is no cycle.
export class OverviewError extends Error {
  readonly code: 'invalid_scope';
  constructor(message: string) { super(message); this.name = 'OverviewError'; this.code = 'invalid_scope'; }
}

const ID = /^[A-Za-z0-9._:-]{1,100}$/;
/** A plain id: letters, digits and . _ : - only, 1 to 100 long, and never `.` or `..`. */
export const isPlainId = (v: unknown): v is string => typeof v === 'string' && ID.test(v) && v !== '.' && v !== '..';
