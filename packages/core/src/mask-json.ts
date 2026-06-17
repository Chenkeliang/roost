// Replace every leaf value in a JSON document with a mask, preserving object
// keys and array structure. Used to preview the SHAPE of an encrypted/secret
// JSON file without exposing any value (I6: secrets never show in the UI).
// Returns null if the text isn't valid JSON.
export function maskJsonStructure(text: string, mask = "••••"): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>)) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return mask; // leaf: string | number | boolean | null → masked
  };
  return JSON.stringify(walk(parsed), null, 2);
}
