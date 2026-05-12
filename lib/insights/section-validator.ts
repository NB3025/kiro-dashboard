// Server-side validation for LLM section outputs (FR-INS-4/5/6, SC17).

import type { PromotionTarget } from './prompt-parser';

const PROMOTION_TARGETS: PromotionTarget[] = ['steering', 'hook', 'subagent', 'power'];

const FILENAME_PATTERNS: Record<PromotionTarget, RegExp> = {
  steering: /^\.kiro\/steering\/[^/]+\.md$/,
  hook: /^\.kiro\/hooks\/[^/]+\.kiro\.hook$/,
  subagent: /^(?:~\/)?\.kiro\/agents\/[^/]+\.md$/,
  power: /^power-[^/]+\/POWER\.md$/,
};

export interface PromotionCandidate {
  target_feature: PromotionTarget;
  target_filename: string;
  evidence_count: number;
  rationale: string;
  suggested_content: string;
}

export function validatePromotionCandidate(item: unknown): item is PromotionCandidate {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
  const rec = item as Record<string, unknown>;

  const feature = rec.target_feature;
  if (typeof feature !== 'string' || !PROMOTION_TARGETS.includes(feature as PromotionTarget)) {
    return false;
  }

  if (typeof rec.target_filename !== 'string') return false;
  if (typeof rec.rationale !== 'string') return false;
  if (typeof rec.suggested_content !== 'string') return false;

  const count = rec.evidence_count;
  if (typeof count !== 'number' || count < 2) return false;

  const pattern = FILENAME_PATTERNS[feature as PromotionTarget];
  if (!pattern.test(rec.target_filename)) return false;

  return true;
}

export interface FeaturesToTryContext {
  top_steering_rules: Array<{ id: string; count: number }>;
  hook_active_count: 'unknown' | number;
  subagent_active_count: 'unknown' | number;
  power_active_list: 'unknown' | string[];
}

interface FeatureToTryItem {
  feature_type: string;
  [key: string]: unknown;
}

function isCountAtLeast(count: 'unknown' | number, threshold: number): boolean {
  if (count === 'unknown') return false;
  return count >= threshold;
}

function isListAtLeast(list: 'unknown' | string[], threshold: number): boolean {
  if (list === 'unknown') return false;
  return list.length >= threshold;
}

const ADOPTION_THRESHOLD = 2;

interface PowerMergeableCandidate {
  target_feature: string;
  target_filename: string;
  evidence_count: number;
  rationale: string;
  suggested_content: string;
  domain_keywords?: string[];
}

function hasOverlap(a: string[] = [], b: string[] = []): boolean {
  const setA = new Set(a.map((k) => k.toLowerCase()));
  return b.some((k) => setA.has(k.toLowerCase()));
}

function primaryKeyword(keywords: string[] = []): string {
  return (keywords[0] ?? 'merged').toLowerCase();
}

export function applyPowersHierarchyRule<T extends PowerMergeableCandidate>(items: T[]): T[] {
  const result: T[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (consumed.has(i)) continue;
    const cur = items[i];

    if (cur.target_feature !== 'steering' && cur.target_feature !== 'hook') {
      result.push(cur);
      continue;
    }

    let mergedPartner = -1;
    for (let j = i + 1; j < items.length; j++) {
      if (consumed.has(j)) continue;
      const other = items[j];
      const pair =
        (cur.target_feature === 'steering' && other.target_feature === 'hook') ||
        (cur.target_feature === 'hook' && other.target_feature === 'steering');
      if (pair && hasOverlap(cur.domain_keywords, other.domain_keywords)) {
        mergedPartner = j;
        break;
      }
    }

    if (mergedPartner === -1) {
      result.push(cur);
      continue;
    }

    const other = items[mergedPartner];
    consumed.add(mergedPartner);
    const domain = primaryKeyword(cur.domain_keywords ?? other.domain_keywords);
    result.push({
      ...cur,
      target_feature: 'power',
      target_filename: `power-${domain}/POWER.md`,
      evidence_count: Math.max(cur.evidence_count, other.evidence_count),
      rationale: `[merged per Powers Hierarchy Rule] ${cur.rationale} | ${other.rationale}`,
    });
  }

  return result;
}

export const AT_A_GLANCE_MIN_SUCCESS = 4;

const PII_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { type: 'url', re: /https?:\/\/[^\s)>]+/ },
  { type: 'user_prefix', re: /<USER-[^>]+>/ },
  { type: 'internal_prefix', re: /<INTERNAL-[^>]+>/ },
];

export interface PIIWarning {
  types: string[];
}

export function detectPIIWarnings(text: string): PIIWarning {
  if (!text) return { types: [] };
  const types: string[] = [];
  for (const { type, re } of PII_PATTERNS) {
    if (re.test(text)) types.push(type);
  }
  return { types };
}

const EVIDENCE_EXCERPT_MAX = 50;

export function buildEvidenceExcerpt(text: string): string {
  if (!text) return '';
  const scrubbed = text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/https?:\/\/[^\s)>]+/g, '[url]')
    .replace(/<USER-[^>]+>/g, '[user]')
    .replace(/<INTERNAL-[^>]+>/g, '[internal]');
  if (scrubbed.length <= EVIDENCE_EXCERPT_MAX) return scrubbed;
  return scrubbed.slice(0, EVIDENCE_EXCERPT_MAX - 1) + '…';
}

export function shouldGenerateAtAGlance(
  coreSectionResults: Array<unknown>
): boolean {
  const successful = coreSectionResults.filter((r) => r !== null && r !== undefined).length;
  return successful >= AT_A_GLANCE_MIN_SUCCESS;
}

export function filterFeaturesToTry<T extends FeatureToTryItem>(
  items: T[],
  ctx: FeaturesToTryContext
): T[] {
  return items.filter((item) => {
    if (!PROMOTION_TARGETS.includes(item.feature_type as PromotionTarget)) return false;

    switch (item.feature_type) {
      case 'steering':
        return ctx.top_steering_rules.length < ADOPTION_THRESHOLD;
      case 'hook':
        return !isCountAtLeast(ctx.hook_active_count, ADOPTION_THRESHOLD);
      case 'subagent':
        return !isCountAtLeast(ctx.subagent_active_count, ADOPTION_THRESHOLD);
      case 'power':
        return !isListAtLeast(ctx.power_active_list, ADOPTION_THRESHOLD);
      default:
        return false;
    }
  });
}
