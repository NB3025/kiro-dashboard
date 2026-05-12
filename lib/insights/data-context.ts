// DataContext builder — aggregates per-user Kiro activity for section prompts.
// Drops CC's commits/top_tools (unavailable in Kiro raw) and the three
// always-"unknown" sentinels (hook/subagent/power); adds Facet aggregates
// (top_goals/outcomes/satisfaction/friction/success) plus
// date_range/messages/hours/spec_count/languages.

import { executeQuery } from '../athena';
import {
  loadFacetsForUser,
  buildFacetNarrative,
  buildFacetAggregates,
  type FacetAggregates,
} from './facet-loader';

// All Insights tables (prompt_events, tool_events, sessions) use snake_case
// `user_id`. Strip the IdC prefix (`d-<hex>.`) before matching.
const NORMALIZE_USERID = `REGEXP_REPLACE(user_id, '^d-[a-z0-9]+\\.', '')`;

// Languages derived from active_editor_file extension. Docs / config noise is
// excluded so the "languages" block reads as what the user is actually coding.
const LANGUAGE_NOISE_EXTENSIONS = new Set([
  'md', 'mdx', 'json', 'yaml', 'yml', 'toml', 'txt',
  'lock', 'gitignore', 'env',
]);

export type SpecPhaseKey =
  | 'requirements'
  | 'design'
  | 'tasks'
  | 'implementation'
  | 'not_spec';

export interface DataContextDateRange {
  start: string | null;
  end: string | null;
}

export interface DataContext extends FacetAggregates {
  // Scope / scale
  date_range: DataContextDateRange;
  sessions: number;          // CC-parity name
  session_count: number;     // kept alongside `sessions` for backward compatibility with existing section prompts
  analyzed: number;          // facets successfully extracted
  messages: number;
  hours: number;

  // Kiro-observable stats
  model_mix: Record<string, number>;
  languages: Record<string, number>;
  top_steering_rules: Array<{ id: string; count: number }>;
  spec_phases: Record<SpecPhaseKey, number>;
  spec_count: number;

  // Narrative (pre-rendered from Facets)
  session_summaries: string;
  friction_details: string;
  user_instructions: string;

  schema_version: string;
}

export interface BuildDataContextOptions {
  userId: string;
  days: 7 | 30 | 90;
}

const EMPTY_SPEC_PHASES: Record<SpecPhaseKey, number> = {
  requirements: 0,
  design: 0,
  tasks: 0,
  implementation: 0,
  not_spec: 0,
};

const DATE_CLAUSE = (days: number) =>
  `date >= DATE_FORMAT(DATE_ADD('day', -${days}, CURRENT_DATE), '%Y-%m-%d')`;

async function queryModelMix(userId: string, days: number): Promise<Record<string, number>> {
  const sql = `
    SELECT model_id, COUNT(*) AS count
    FROM prompt_events
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND ${DATE_CLAUSE(days)}
    GROUP BY model_id
  `;
  const rows = await executeQuery(sql);
  if (!rows.length) return {};
  const counts = rows.map((r) => ({
    model: String(r.model_id ?? ''),
    n: Number(r.count ?? 0),
  }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  if (total === 0) return {};
  const mix: Record<string, number> = {};
  for (const { model, n } of counts) {
    if (model) mix[model] = n / total;
  }
  return mix;
}

async function querySessionCount(userId: string, days: number): Promise<number> {
  const sql = `
    SELECT COUNT(DISTINCT session_id) AS session_count
    FROM sessions
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND ${DATE_CLAUSE(days)}
  `;
  const rows = await executeQuery(sql);
  return Number(rows[0]?.session_count ?? 0);
}

async function querySpecPhases(
  userId: string,
  days: number
): Promise<Record<SpecPhaseKey, number>> {
  const sql = `
    SELECT active_spec_phase, COUNT(*) AS count
    FROM prompt_events
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND ${DATE_CLAUSE(days)}
    GROUP BY active_spec_phase
  `;
  const rows = await executeQuery(sql);
  const phases: Record<SpecPhaseKey, number> = { ...EMPTY_SPEC_PHASES };
  for (const row of rows) {
    const phase = String(row.active_spec_phase ?? '') as SpecPhaseKey;
    if (phase in phases) {
      phases[phase] = Number(row.count ?? 0);
    }
  }
  return phases;
}

async function queryTopSteeringRules(
  userId: string,
  days: number
): Promise<Array<{ id: string; count: number }>> {
  const sql = `
    SELECT rule.id AS id, COUNT(*) AS count
    FROM prompt_events
    CROSS JOIN UNNEST(steering_rules) AS t(rule)
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND ${DATE_CLAUSE(days)}
    GROUP BY rule.id
  `;
  let rows: Array<Record<string, string>> = [];
  try {
    rows = await executeQuery(sql);
  } catch (err) {
    console.warn('[data-context] top_steering_rules query failed, returning []', err);
    return [];
  }
  const ranked = rows
    .map((r) => ({ id: String(r.id ?? ''), count: Number(r.count ?? 0) }))
    .filter((r) => r.id)
    .sort((a, b) => b.count - a.count);
  return ranked.slice(0, 10);
}

async function queryDateRange(userId: string, days: number): Promise<DataContextDateRange> {
  const sql = `
    SELECT MIN(date) AS start, MAX(date) AS end
    FROM prompt_events
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND ${DATE_CLAUSE(days)}
  `;
  const rows = await executeQuery(sql);
  const row = rows[0];
  if (!row) return { start: null, end: null };
  const start = row.start ? String(row.start) : null;
  const end = row.end ? String(row.end) : null;
  return { start, end };
}

async function queryMessages(userId: string, days: number): Promise<number> {
  const sql = `
    SELECT COUNT(*) AS messages
    FROM prompt_events
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND ${DATE_CLAUSE(days)}
  `;
  const rows = await executeQuery(sql);
  return Number(rows[0]?.messages ?? 0);
}

async function queryHours(userId: string, days: number): Promise<number> {
  // sessions table carries start_ts / end_ts (Unix seconds). Sum of per-session
  // spans — spec sessions can stretch across days, so this reads as
  // "total active window across sessions" rather than wall-clock engaged time.
  const sql = `
    SELECT SUM(end_ts - start_ts) AS seconds
    FROM sessions
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND ${DATE_CLAUSE(days)}
  `;
  let rows: Array<Record<string, string>> = [];
  try {
    rows = await executeQuery(sql);
  } catch (err) {
    console.warn('[data-context] hours query failed, returning 0', err);
    return 0;
  }
  const seconds = Number(rows[0]?.seconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((seconds / 3600) * 10) / 10;
}

async function querySpecCount(userId: string, days: number): Promise<number> {
  const sql = `
    SELECT COUNT(DISTINCT active_spec_name) AS spec_count
    FROM prompt_events
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND active_spec_name IS NOT NULL
      AND active_spec_name <> ''
      AND ${DATE_CLAUSE(days)}
  `;
  const rows = await executeQuery(sql);
  return Number(rows[0]?.spec_count ?? 0);
}

async function queryLanguages(
  userId: string,
  days: number
): Promise<Record<string, number>> {
  // Extract extension from active_editor_file (last dot segment), lowercased.
  // Filter noise extensions (docs/config) so the block reads as actual code.
  const sql = `
    SELECT LOWER(
             REGEXP_EXTRACT(active_editor_file, '\\.([A-Za-z0-9]+)$', 1)
           ) AS ext,
           COUNT(*) AS count
    FROM prompt_events
    WHERE ${NORMALIZE_USERID} = '${userId}'
      AND active_editor_file IS NOT NULL
      AND active_editor_file <> ''
      AND ${DATE_CLAUSE(days)}
    GROUP BY 1
  `;
  let rows: Array<Record<string, string>> = [];
  try {
    rows = await executeQuery(sql);
  } catch (err) {
    console.warn('[data-context] languages query failed, returning {}', err);
    return {};
  }
  const out: Record<string, number> = {};
  for (const row of rows) {
    const ext = String(row.ext ?? '').toLowerCase();
    if (!ext || LANGUAGE_NOISE_EXTENSIONS.has(ext)) continue;
    const n = Number(row.count ?? 0);
    if (n > 0) out[ext] = n;
  }
  return out;
}

// The Insights SQL compares `REGEXP_REPLACE(user_id, '^d-<hex>.', '')` to the
// userId provided here, so the value must already have the IdC prefix stripped.
// Route handlers receive the raw URL param (with prefix) and pass it through —
// normalize here to keep callers simple.
function stripIdcPrefix(userId: string): string {
  return userId.replace(/^d-[a-z0-9]+\./, '');
}

export async function buildDataContext(
  opts: BuildDataContextOptions
): Promise<DataContext> {
  const normalizedUserId = stripIdcPrefix(opts.userId);
  const [
    model_mix,
    top_steering_rules,
    spec_phases,
    sessions,
    date_range,
    messages,
    hours,
    spec_count,
    languages,
    facets,
  ] = await Promise.all([
    queryModelMix(normalizedUserId, opts.days),
    queryTopSteeringRules(normalizedUserId, opts.days),
    querySpecPhases(normalizedUserId, opts.days),
    querySessionCount(normalizedUserId, opts.days),
    queryDateRange(normalizedUserId, opts.days),
    queryMessages(normalizedUserId, opts.days),
    queryHours(normalizedUserId, opts.days),
    querySpecCount(normalizedUserId, opts.days),
    queryLanguages(normalizedUserId, opts.days),
    // Facets carry the full IdC-prefixed userId.
    loadFacetsForUser(opts.userId).catch((err) => {
      console.warn('[data-context] loadFacetsForUser failed', err);
      return [];
    }),
  ]);

  const narrative = buildFacetNarrative(facets);
  const aggregates = buildFacetAggregates(facets);

  return {
    date_range,
    sessions,
    session_count: sessions,
    analyzed: facets.length,
    messages,
    hours,
    model_mix,
    languages,
    top_steering_rules,
    spec_phases,
    spec_count,
    ...aggregates,
    session_summaries: narrative.sessionSummaries,
    friction_details: narrative.frictionDetails,
    user_instructions: narrative.userInstructions,
    schema_version: '1.0.0',
  };
}
