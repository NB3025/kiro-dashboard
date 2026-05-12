// Defensive renderer for at_a_glance string fields.
//
// BACKGROUND: `at_a_glance` is supposed to return 4 string values
// (whats_working / whats_hindering / quick_wins / ambitious_workflows).
// However Opus occasionally ignores the schema and returns objects or arrays,
// which crashes React with error #31 ("Objects are not valid as a React
// child"). This helper never throws and always produces a string, protecting
// the UI regardless of what the LLM returned.

function coerceObject(obj: Record<string, unknown>): string {
  const title = typeof obj.title === 'string' ? obj.title : '';
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
  if (title || rationale) {
    return [title, rationale].filter(Boolean).join(' — ');
  }
  // Unknown object shape — serialize as JSON for transparency.
  try {
    return JSON.stringify(obj);
  } catch {
    return '';
  }
}

export function renderGlanceField(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const items = v
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return coerceObject(item as Record<string, unknown>);
        return String(item ?? '');
      })
      .filter((s) => s.length > 0);
    return items.map((s) => '• ' + s).join('\n');
  }
  if (typeof v === 'object') {
    return coerceObject(v as Record<string, unknown>);
  }
  return String(v);
}
