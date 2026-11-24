// Shared by the Test Lab page and its action. Kept out of the 'use server' file, which may only export async functions.
export interface MockCustomer {
  businessId: string; shopSlug: string | null; seededAt: string; buyers: string[];
  steps: { label: string; ok: boolean; note: string }[];
}
type G = typeof globalThis & { __aimpLab?: MockCustomer };
export const BUYERS = ['jordan.buyer@example.test', 'sam.refund@example.test'];
export const currentMockCustomer = (): MockCustomer | null => (globalThis as G).__aimpLab ?? null;
export const rememberMockCustomer = (c: MockCustomer): void => { (globalThis as G).__aimpLab = c; };
