// Design §10: greedy outermost-brace matching for Bedrock responses that may
// wrap JSON in prose. `[\s\S]*` is greedy so nested objects are preserved.

const OUTERMOST_OBJECT_RE = /\{[\s\S]*\}/;

export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const match = text.match(OUTERMOST_OBJECT_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
