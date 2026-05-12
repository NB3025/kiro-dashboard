// Pure normalization helpers for the per-user drilldown section views.
// Bedrock returns JSON that usually but not always matches the prompt schema —
// these helpers guard the UI from partial or malformed payloads so the views
// never crash and only render what they can render cleanly.

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

// project_areas: { areas: [{ name, session_count, description }] }
export interface ProjectArea {
  name: string;
  session_count: number;
  description: string;
}

export function normalizeProjectAreas(data: unknown): ProjectArea[] {
  if (!isObj(data) || !Array.isArray(data.areas)) return [];
  return data.areas
    .filter(isObj)
    .map((r) => ({
      name: asString(r.name),
      session_count: asNumber(r.session_count),
      description: asString(r.description),
    }))
    .filter((x) => x.name.length > 0);
}

// interaction_style: { summary, traits: [{ label, evidence }] }
export interface InteractionStyle {
  summary: string;
  traits: Array<{ label: string; evidence: string }>;
}

export function normalizeInteractionStyle(data: unknown): InteractionStyle {
  if (!isObj(data)) return { summary: '', traits: [] };
  const traits = Array.isArray(data.traits)
    ? data.traits
        .filter(isObj)
        .map((r) => ({ label: asString(r.label), evidence: asString(r.evidence) }))
        .filter((x) => x.label.length > 0)
    : [];
  return { summary: asString(data.summary), traits };
}

// what_works: { summary, items: [{ title, evidence }] }
export interface WhatWorks {
  summary: string;
  items: Array<{ title: string; evidence: string }>;
}

export function normalizeWhatWorks(data: unknown): WhatWorks {
  if (!isObj(data)) return { summary: '', items: [] };
  const items = Array.isArray(data.items)
    ? data.items
        .filter(isObj)
        .map((r) => ({ title: asString(r.title), evidence: asString(r.evidence) }))
        .filter((x) => x.title.length > 0)
    : [];
  return { summary: asString(data.summary), items };
}

// friction_analysis: { intro, categories: [{ name, examples: [] }] }
export interface FrictionAnalysis {
  intro: string;
  categories: Array<{ name: string; examples: string[] }>;
}

export function normalizeFrictionAnalysis(data: unknown): FrictionAnalysis {
  if (!isObj(data)) return { intro: '', categories: [] };
  const categories = Array.isArray(data.categories)
    ? data.categories
        .filter(isObj)
        .map((r) => ({ name: asString(r.name), examples: asStringArray(r.examples) }))
        .filter((x) => x.name.length > 0)
    : [];
  return { intro: asString(data.intro), categories };
}

// feature_adoption_audit: 6 string fields
export interface FeatureAdoption {
  spec_usage: string;
  steering_usage: string;
  skill_usage: string;
  hook_usage: string;
  subagent_usage: string;
  power_usage: string;
}

export function normalizeFeatureAdoption(data: unknown): FeatureAdoption {
  const d = isObj(data) ? data : {};
  return {
    spec_usage: asString(d.spec_usage),
    steering_usage: asString(d.steering_usage),
    skill_usage: asString(d.skill_usage),
    hook_usage: asString(d.hook_usage),
    subagent_usage: asString(d.subagent_usage),
    power_usage: asString(d.power_usage),
  };
}

// on_the_horizon: { proposals: [{ title, why }] }
export interface HorizonProposal {
  title: string;
  why: string;
}

export function normalizeOnTheHorizon(data: unknown): HorizonProposal[] {
  if (!isObj(data) || !Array.isArray(data.proposals)) return [];
  return data.proposals
    .filter(isObj)
    .map((r) => ({ title: asString(r.title), why: asString(r.why) }))
    .filter((x) => x.title.length > 0);
}

// fun_ending: { headline, detail } — CC §4.7 schema. Non-string values are
// coerced to "" rather than stringified so the UI never renders stray JSON.
export interface FunEnding {
  headline: string;
  detail: string;
}

export function normalizeFunEnding(data: unknown): FunEnding {
  if (!isObj(data)) return { headline: '', detail: '' };
  return { headline: asString(data.headline), detail: asString(data.detail) };
}
