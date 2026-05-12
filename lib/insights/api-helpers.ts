// API helpers shared by /api/insights/* route handlers. Keeping logic here
// (rather than inside route files) lets us unit-test without the Next.js
// runtime harness.

import { executeQuery, NORMALIZE_USERID } from '../athena';

export function isPromptLogsConfigured(): boolean {
  const v = process.env.PROMPT_LOGS_BUCKET;
  return typeof v === 'string' && v.length > 0;
}

export type NotConfiguredShape = 'users-with-facets' | 'user';

export function buildNotConfiguredResponse(shape: NotConfiguredShape):
  | { data: unknown[]; not_configured: true }
  | { bundle: null; not_configured: true } {
  switch (shape) {
    case 'users-with-facets':
      return { data: [], not_configured: true };
    case 'user':
      return { bundle: null, not_configured: true };
  }
}

export const ALLOWED_DAYS_VALUES = [7, 30, 90] as const;
export type AllowedDays = (typeof ALLOWED_DAYS_VALUES)[number];

export function validateDaysParam(
  raw: string | null | undefined
): { ok: true; days: AllowedDays } | { ok: false; error: string } {
  const n = Number(raw);
  if (!ALLOWED_DAYS_VALUES.includes(n as AllowedDays)) {
    return {
      ok: false,
      error: `days must be one of ${ALLOWED_DAYS_VALUES.join('/')} (got "${raw}")`,
    };
  }
  return { ok: true, days: n as AllowedDays };
}

export interface UserWithFacetsRow {
  userid: string;
  session_count: number;
  friction_total: number;
  suggestion_count: number;
}

export interface SseSection {
  key: string;
  data: unknown;
}

export function streamSseSections(opts: {
  sections: SseSection[] | AsyncIterable<SseSection>;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const iter =
          Symbol.asyncIterator in opts.sections
            ? (opts.sections as AsyncIterable<SseSection>)
            : (opts.sections as SseSection[]);
        for await (const s of iter as Iterable<SseSection>) {
          const payload = `event: section\ndata: ${JSON.stringify(s)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        }
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
}

export function extractViewerFromHeaders(h: Headers): string {
  const v = h.get('x-user-email');
  if (v && v.length > 0) return v;
  return 'unknown_admin';
}

export interface AuditEvent {
  ts: string;
  viewer: string;
  action: string;
  target_user_id?: string;
  extra?: Record<string, unknown>;
}

export function buildAuditEvent(input: {
  viewer: string;
  action: string;
  targetUserId?: string;
  extra?: Record<string, unknown>;
}): AuditEvent {
  return {
    ts: new Date().toISOString(),
    viewer: input.viewer,
    action: input.action,
    target_user_id: input.targetUserId,
    extra: input.extra,
  };
}

export async function listUsersWithFacets(days: AllowedDays): Promise<UserWithFacetsRow[]> {
  const sql = `
    SELECT
      ${NORMALIZE_USERID} AS userid,
      COUNT(DISTINCT session_id) AS session_count,
      SUM(CAST(friction_total AS INTEGER)) AS friction_total,
      SUM(CAST(suggestion_count AS INTEGER)) AS suggestion_count
    FROM prompt_events
    WHERE date >= CURRENT_DATE - INTERVAL '${days}' DAY
    GROUP BY ${NORMALIZE_USERID}
    ORDER BY friction_total DESC
  `;
  const rows = await executeQuery(sql);
  return rows.map((r) => ({
    userid: String(r.userid ?? ''),
    session_count: Number(r.session_count ?? 0),
    friction_total: Number(r.friction_total ?? 0),
    suggestion_count: Number(r.suggestion_count ?? 0),
  }));
}
