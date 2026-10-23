import { createXXHash64 } from 'hash-wasm';

/** xxhash64 of bytes, as 16 hex characters. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const h = await createXXHash64();
  h.init();
  h.update(bytes);
  return h.digest('hex');
}

export function hashString(input: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(input));
}

/** Stable JSON: object keys sorted, so the digest does not depend on key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      );
    }
    return v;
  });
}
