// Pure helpers for the Suggestions tab view. The drilldown LLM output can be
// partial or malformed (clients receive a mixed bag during SSE), so we
// normalize before rendering. Kept out of the React component so the shapes
// stay unit-testable.

export interface SteeringAddition {
  addition: string;
  why: string;
  target_filename: string;
  prompt_scaffold: string;
}

export interface FeatureToTry {
  feature: string;
  one_liner: string;
  why_for_you: string;
  example_code: string;
}

export interface UsagePattern {
  title: string;
  suggestion: string;
  detail: string;
  copyable_prompt: string;
}

export interface NormalizedSuggestions {
  steering_additions: SteeringAddition[];
  features_to_try: FeatureToTry[];
  usage_patterns: UsagePattern[];
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeSteeringAdditions(arr: unknown): SteeringAddition[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(isObj)
    .map((r) => ({
      addition: asString(r.addition),
      why: asString(r.why),
      target_filename: asString(r.target_filename),
      prompt_scaffold: asString(r.prompt_scaffold),
    }))
    .filter((x) => x.addition.length > 0);
}

function normalizeFeaturesToTry(arr: unknown): FeatureToTry[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(isObj)
    .map((r) => ({
      feature: asString(r.feature),
      one_liner: asString(r.one_liner),
      why_for_you: asString(r.why_for_you),
      example_code: asString(r.example_code),
    }))
    .filter((x) => x.feature.length > 0);
}

function normalizeUsagePatterns(arr: unknown): UsagePattern[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(isObj)
    .map((r) => ({
      title: asString(r.title),
      suggestion: asString(r.suggestion),
      detail: asString(r.detail),
      copyable_prompt: asString(r.copyable_prompt),
    }))
    .filter((x) => x.title.length > 0 || x.suggestion.length > 0);
}

export function normalizeSuggestions(data: unknown): NormalizedSuggestions {
  if (!isObj(data)) {
    return { steering_additions: [], features_to_try: [], usage_patterns: [] };
  }
  return {
    steering_additions: normalizeSteeringAdditions(data.steering_additions),
    features_to_try: normalizeFeaturesToTry(data.features_to_try),
    usage_patterns: normalizeUsagePatterns(data.usage_patterns),
  };
}

// Badge config per KIRO FEATURES REFERENCE name. `__default__` covers any
// unknown names Opus emits (e.g. paraphrased references). Values are Tailwind
// color classes + emoji so the view can stay presentation-only.
export const FEATURE_BADGE: Record<
  string,
  { icon: string; color: string }
> = {
  'MCP Servers': { icon: '🔌', color: 'text-cyan-300 border-cyan-700/60 bg-cyan-950/40' },
  'Custom Skills': { icon: '📝', color: 'text-purple-300 border-purple-700/60 bg-purple-950/40' },
  'Hooks': { icon: '🪝', color: 'text-amber-300 border-amber-700/60 bg-amber-950/40' },
  'Headless Mode': { icon: '⚙️', color: 'text-slate-300 border-slate-700/60 bg-slate-950/40' },
  'Subagent': { icon: '🧑‍💻', color: 'text-green-300 border-green-700/60 bg-green-950/40' },
  'Task Agents': { icon: '🧑‍💻', color: 'text-green-300 border-green-700/60 bg-green-950/40' },
  'Power': { icon: '⚡', color: 'text-yellow-300 border-yellow-700/60 bg-yellow-950/40' },
  __default__: { icon: '✨', color: 'text-gray-300 border-gray-700/60 bg-gray-950/40' },
};

export function featureBadge(name: string): { icon: string; color: string } {
  return FEATURE_BADGE[name] ?? FEATURE_BADGE.__default__;
}
