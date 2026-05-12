import { NextRequest, NextResponse } from 'next/server';
import {
  isPromptLogsConfigured,
  buildNotConfiguredResponse,
  validateDaysParam,
  streamSseSections,
} from '@/lib/insights/api-helpers';
import { generatePerUserInsights, createBedrockInvoker } from '@/lib/insights/section-generator';
import { buildDataContext } from '@/lib/insights/data-context';
import { loadBundle, saveBundle, INSIGHTS_PIPELINE_VERSION } from '@/lib/insights/bundle-cache';

const DEFAULT_INSIGHTS_MODEL_ID = 'global.anthropic.claude-opus-4-7';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> } | { params: { userId: string } }
) {
  if (!isPromptLogsConfigured()) {
    return NextResponse.json(buildNotConfiguredResponse('user'));
  }

  const { searchParams } = new URL(req.url);
  const validation = validateDaysParam(searchParams.get('days') ?? '30');
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Next 14 / 15 compat: context.params can be a Promise.
  const params = 'then' in (context.params as object)
    ? await (context.params as Promise<{ userId: string }>)
    : (context.params as { userId: string });

  const userId = params.userId;
  const days = validation.days;
  const force = searchParams.get('force') === '1';

  // Cache-first per EARS-S6-06: when a precomputed bundle exists in S3 we
  // stream the cached sections immediately without calling Bedrock.
  if (!force) {
    const cached = await loadBundle(userId, days);
    if (cached) {
      async function* cachedIter() {
        for (const [key, data] of Object.entries(cached!.sections)) {
          yield { key, data };
        }
      }
      return new Response(streamSseSections({ sections: cachedIter() }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Insights-Cache': 'hit',
        },
      });
    }
  }

  // Cache miss — fall back to live generation and persist the result for
  // subsequent visits (EARS-S2-02).
  const dataContext = await buildDataContext({ userId, days });

  const invoker = createBedrockInvoker({
    modelId: process.env.INSIGHTS_MODEL_ID ?? DEFAULT_INSIGHTS_MODEL_ID,
  });

  // Build the full bundle first, persist to S3, THEN stream. This ensures the
  // cache is populated even if the client disconnects mid-stream (e.g.,
  // CloudFront buffering that closes the connection after the first flush).
  const bundle = await generatePerUserInsights({
    userId,
    dataContext,
    facets: [],
    invoker,
  });

  try {
    await saveBundle({
      userId,
      days,
      sections: bundle.sections as Record<string, unknown>,
      sessionCount:
        typeof (dataContext as { session_count?: number }).session_count === 'number'
          ? (dataContext as { session_count: number }).session_count
          : 0,
      generatedAt: new Date().toISOString(),
      modelId: process.env.INSIGHTS_MODEL_ID ?? DEFAULT_INSIGHTS_MODEL_ID,
      facetVersion: INSIGHTS_PIPELINE_VERSION,
    });
  } catch (err) {
    console.warn('[/api/insights/user] bundle save failed', err);
  }

  async function* iter() {
    for (const [key, data] of Object.entries(bundle.sections)) {
      yield { key, data };
    }
  }

  return new Response(streamSseSections({ sections: iter() }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Insights-Cache': 'miss',
    },
  });
}
