// facet-loader — load per-session Facet JSONs from S3 and render CC-style
// narrative strings to inject into the dataContext DATA block.
//
// Schema of each facet file (see infra/glue-jobs/facet_extractor.py):
//   _session_id, _tier, _spec_name, _user_id (metadata we added)
//   underlying_goal, outcome, brief_summary, goal_categories,
//   user_satisfaction_counts, kiro_helpfulness, session_type,
//   friction_counts, friction_detail, primary_success,
//   user_instructions_to_kiro

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

export interface FacetRecord {
  _session_id?: string;
  _tier?: string;
  _spec_name?: string | null;
  _user_id?: string;
  underlying_goal?: string;
  outcome?: string;
  brief_summary?: string;
  goal_categories?: Record<string, number>;
  user_satisfaction_counts?: Record<string, number>;
  kiro_helpfulness?: string;
  session_type?: string;
  friction_counts?: Record<string, number>;
  friction_detail?: string;
  primary_success?: string;
  user_instructions_to_kiro?: string[];
}

// CC reference §7 caps
const MAX_SESSION_SUMMARIES = 50;
const MAX_FRICTION_DETAILS = 20;
const MAX_USER_INSTRUCTIONS = 15;

export interface FacetNarrative {
  sessionSummaries: string;
  frictionDetails: string;
  userInstructions: string;
}

export interface FacetAggregates {
  top_goals: Array<[string, number]>;
  outcomes: Record<string, number>;
  satisfaction: Record<string, number>;
  friction: Record<string, number>;
  success: Record<string, number>;
}

const TOP_GOALS_LIMIT = 8;

function sumCountRecords(
  facets: FacetRecord[],
  pick: (f: FacetRecord) => Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of facets) {
    const rec = pick(f);
    if (!rec) continue;
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = (out[k] ?? 0) + v;
      }
    }
  }
  return out;
}

function countEnumStrings(
  facets: FacetRecord[],
  pick: (f: FacetRecord) => string | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of facets) {
    const s = pick(f);
    if (!s) continue;
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export function buildFacetAggregates(facets: FacetRecord[]): FacetAggregates {
  const goalTotals = sumCountRecords(facets, (f) => f.goal_categories);
  const top_goals: Array<[string, number]> = Object.entries(goalTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GOALS_LIMIT);

  return {
    top_goals,
    outcomes: countEnumStrings(facets, (f) => f.outcome),
    satisfaction: sumCountRecords(facets, (f) => f.user_satisfaction_counts),
    friction: sumCountRecords(facets, (f) => f.friction_counts),
    success: countEnumStrings(facets, (f) => f.primary_success),
  };
}

export function buildFacetNarrative(facets: FacetRecord[]): FacetNarrative {
  // SESSION SUMMARIES
  const summaries = facets.slice(0, MAX_SESSION_SUMMARIES).map((f) => {
    const label = f._tier === 'SPEC' && f._spec_name
      ? `[SPEC ${f._spec_name}]`
      : f._tier === 'DAY'
      ? '[DAY]'
      : '';
    const outcome = f.outcome ? ` (${f.outcome})` : '';
    const help = f.kiro_helpfulness ? `, ${f.kiro_helpfulness}` : '';
    const summary = f.brief_summary || '(no summary)';
    return `- ${label} ${summary}${outcome}${help}`.trim();
  });
  const sessionSummaries = summaries.length > 0
    ? summaries.join('\n')
    : '(no sessions analyzed)';

  // FRICTION DETAILS — non-empty friction_detail values
  const frictions = facets
    .map((f) => f.friction_detail || '')
    .filter((s) => s.trim().length > 0)
    .slice(0, MAX_FRICTION_DETAILS)
    .map((s) => `- ${s}`);
  const frictionDetails = frictions.length > 0
    ? frictions.join('\n')
    : '(no friction captured)';

  // USER INSTRUCTIONS — flatten, dedupe (preserve first occurrence), cap 15
  const seen = new Set<string>();
  const flat: string[] = [];
  for (const f of facets) {
    for (const raw of f.user_instructions_to_kiro ?? []) {
      const instr = raw.trim();
      if (!instr) continue;
      if (seen.has(instr)) continue;
      seen.add(instr);
      flat.push(instr);
      if (flat.length >= MAX_USER_INSTRUCTIONS) break;
    }
    if (flat.length >= MAX_USER_INSTRUCTIONS) break;
  }
  const userInstructions = flat.length > 0
    ? flat.map((s) => `- ${s}`).join('\n')
    : 'None captured';

  return { sessionSummaries, frictionDetails, userInstructions };
}

// The insights bucket lives in the same region as InsightsStack. Region is
// controlled by INSIGHTS_BUCKET_REGION (same env var bundle-cache uses).
const s3 = new S3Client({
  region: process.env.INSIGHTS_BUCKET_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-2',
});

export async function loadFacetsForUser(userId: string): Promise<FacetRecord[]> {
  const bucket = process.env.INSIGHTS_BUCKET;
  if (!bucket) return [];

  // Facets are stored flat under insights/facets/session=<sid>.json and the
  // file itself carries _user_id, so we list the prefix, fetch each object,
  // and filter by userId.
  const out: FacetRecord[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'insights/facets/session=',
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      try {
        const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
        const text = await get.Body!.transformToString();
        const record = JSON.parse(text) as FacetRecord;
        if (record._user_id === userId) out.push(record);
      } catch {
        // Skip unreadable facet files — never abort the whole load.
      }
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return out;
}
