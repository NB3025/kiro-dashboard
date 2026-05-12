// Kiro prompt parser — pure functions (no I/O) for FR-ETL-3 / FR-FACET-2.
// All regexes are scoped to this module. Exported functions are independently
// testable and reused by the ETL pipeline and DataContext builder.

// ---------- Regexes ----------

const EXTRACT = {
  userRule: /<user-rule\s+id="([^"]+)">([\s\S]*?)<\/user-rule>/g,
  // Two published formats — attribute form (synthetic fixtures) and
  // nested-file form (real Kiro logs).
  activeEditorFile: /<ACTIVE-EDITOR-FILE(?:\s+path="([^"]+)"|>\s*<file\s+name="([^"]+)")/,
  workspace: /<EnvironmentContext>[\s\S]*?<workspace>([^<]+)<\/workspace>/,
  specPath: /\.kiro\/specs\/[^/\s]+\/([a-zA-Z0-9_-]+)\.md/,
};

const STRIP = {
  userRule: /<user-rule\s+id="[^"]+">[\s\S]*?<\/user-rule>/g,
  environmentContext: /<EnvironmentContext>[\s\S]*?<\/EnvironmentContext>/g,
  activeEditorFile: /<ACTIVE-EDITOR-FILE[^>]*>[\s\S]*?<\/ACTIVE-EDITOR-FILE>/g,
  cliMarker: /--- (?:USER MESSAGE|CONTEXT ENTRY) (?:BEGIN|END) ---/g,
};

// ---------- Types ----------

export interface SteeringRule {
  id: string;
  content: string;
}

export type ClientType = 'CLI' | 'IDE' | 'UNKNOWN';

export type SpecPhase = 'requirements' | 'design' | 'tasks' | 'implementation' | 'not_spec';

export interface SpecModeResult {
  is_spec_mode: boolean;
  active_spec_phase: SpecPhase;
}

export type PromotionTarget = 'steering' | 'hook' | 'subagent' | 'power';

// ---------- Extractors ----------

export function extractSteeringRules(prompt: string): SteeringRule[] {
  const rules: SteeringRule[] = [];
  if (!prompt) return rules;
  EXTRACT.userRule.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXTRACT.userRule.exec(prompt)) !== null) {
    rules.push({ id: match[1], content: match[2].trim() });
  }
  return rules;
}

export function extractActiveEditorFile(prompt: string): string | null {
  if (!prompt) return null;
  const match = prompt.match(EXTRACT.activeEditorFile);
  if (!match) return null;
  // Either alternative captured — attribute form (group 1) or nested-file form (group 2).
  return match[1] ?? match[2] ?? null;
}

export function extractWorkspacePath(prompt: string): string | null {
  if (!prompt) return null;
  const match = prompt.match(EXTRACT.workspace);
  return match ? match[1] : null;
}

// ---------- Detectors ----------

export function detectClientType(prompt: string): ClientType {
  if (!prompt) return 'UNKNOWN';
  if (prompt.includes('--- USER MESSAGE BEGIN ---')) return 'CLI';
  if (prompt.includes('--- CONTEXT ENTRY BEGIN ---')) return 'CLI';
  return 'IDE';
}

export function detectSpecMode(prompt: string): SpecModeResult {
  if (!prompt || !prompt.includes('.kiro/specs/')) {
    return { is_spec_mode: false, active_spec_phase: 'not_spec' };
  }
  const match = prompt.match(EXTRACT.specPath);
  if (match) {
    const name = match[1];
    if (name === 'requirements' || name === 'design' || name === 'tasks') {
      return { is_spec_mode: true, active_spec_phase: name };
    }
  }
  return { is_spec_mode: true, active_spec_phase: 'implementation' };
}

// ---------- Cleaners ----------

export function cleanPrompt(prompt: string): string {
  if (!prompt) return '';
  return prompt
    .replace(STRIP.userRule, '')
    .replace(STRIP.environmentContext, '')
    .replace(STRIP.activeEditorFile, '')
    .replace(STRIP.cliMarker, '')
    .trim();
}

// ---------- Feature type classifier (hint only; real classification is §6.5 LLM) ----------

const CLASSIFY = {
  steering: [/\balways\s+(?:use|run|prefer)\b/i, /\bnever\s+use\b/i],
  hook: [
    /\bon\s+(?:file\s+)?save\b/i,
    /\bbefore\s+commit\b/i,
    /\bafter\s+test\b/i,
    /\b(?:pre|post)-commit\b/i,
  ],
  subagent: [/\byou are a\b/i, /\bact as a\b/i],
  powerServices: [
    'stripe',
    'supabase',
    'figma',
    'datadog',
    'terraform',
    'postman',
    'snyk',
    'firebase',
    'neon',
    'netlify',
  ],
};

export function classifyFeatureTypeKeywords(text: string): PromotionTarget[] {
  if (!text) return [];
  const hits = new Set<PromotionTarget>();
  const lower = text.toLowerCase();

  if (CLASSIFY.steering.some((re) => re.test(text))) hits.add('steering');
  if (CLASSIFY.hook.some((re) => re.test(text))) hits.add('hook');
  if (CLASSIFY.subagent.some((re) => re.test(text))) hits.add('subagent');
  if (CLASSIFY.powerServices.some((svc) => lower.includes(svc))) hits.add('power');

  return Array.from(hits);
}
