const encoder = new TextEncoder();
/** UTF-8 byte length of a string. `.length` counts UTF-16 units and under-counts non-ASCII text. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}
/** Response size caps (bytes) for read-only workspace routes. Export stays under the import file limit (5,000,000). */
export const responseByteCaps = { export: 4_900_000, search: 1_000_000, activity: 1_000_000 } as const;
