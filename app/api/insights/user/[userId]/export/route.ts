import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  isPromptLogsConfigured,
  buildNotConfiguredResponse,
  validateDaysParam,
} from '@/lib/insights/api-helpers';
import { resolveUserDetails } from '@/lib/identity';
import {
  buildInsightsFilename,
  buildInsightsMarkdown,
} from '@/lib/insights/markdown-export';
import { INSIGHTS_PIPELINE_VERSION } from '@/lib/insights/bundle-cache';

const ALLOWED_FORMATS = new Set(['markdown', 'pdf']);
const DEFAULT_INSIGHTS_MODEL_ID = 'global.anthropic.claude-opus-4-7';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

function bundleCacheKey(userId: string, days: number): string {
  return `insights/bundles/user=${userId}/days=${days}/bundle.json`;
}

async function loadBundle(
  userId: string,
  days: number
): Promise<{ sections: Record<string, unknown>; sessionCount?: number } | null> {
  const bucket = process.env.INSIGHTS_BUCKET;
  if (!bucket) return null;
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: bundleCacheKey(userId, days) })
    );
    const text = await resp.Body!.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveMaskedDisplay(userId: string): Promise<string> {
  try {
    const map = await resolveUserDetails([userId]);
    return map.get(userId)?.displayName ?? userId;
  } catch {
    return userId;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> } | { params: { userId: string } }
) {
  if (!isPromptLogsConfigured()) {
    return NextResponse.json(buildNotConfiguredResponse('user'));
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') ?? 'markdown';
  if (!ALLOWED_FORMATS.has(format)) {
    return NextResponse.json(
      { error: `format must be markdown|pdf (got "${format}")` },
      { status: 400 }
    );
  }

  const daysValidation = validateDaysParam(searchParams.get('days') ?? '30');
  if (!daysValidation.ok) {
    return NextResponse.json({ error: daysValidation.error }, { status: 400 });
  }
  const days = daysValidation.days;

  const params =
    'then' in (context.params as object)
      ? await (context.params as Promise<{ userId: string }>)
      : (context.params as { userId: string });

  const bundle = await loadBundle(params.userId, days);
  if (!bundle) {
    return NextResponse.json(
      {
        error: 'Bundle not found in cache; POST /api/insights/user/<id>/regenerate first',
      },
      { status: 404 }
    );
  }

  const maskedDisplayName = await resolveMaskedDisplay(params.userId);
  const exportDate = todayIso();
  const modelId = process.env.INSIGHTS_MODEL_ID ?? DEFAULT_INSIGHTS_MODEL_ID;
  const facetVersion = INSIGHTS_PIPELINE_VERSION;
  const commonOpts = {
    userId: params.userId,
    maskedDisplayName,
    bundle,
    facetVersion,
    modelId,
    startDate: daysAgoIso(days),
    endDate: exportDate,
    sessionCount: bundle.sessionCount ?? 0,
  };

  if (format === 'markdown') {
    const body = buildInsightsMarkdown(commonOpts);
    const filename = buildInsightsFilename({
      userId: params.userId,
      maskedDisplayName,
      date: exportDate,
      extension: 'md',
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  // format === 'pdf'
  const { renderInsightsPdfBuffer } = await import('@/lib/insights/pdf-renderer');
  const pdfBuffer = await renderInsightsPdfBuffer(commonOpts);
  const filename = buildInsightsFilename({
    userId: params.userId,
    maskedDisplayName,
    date: exportDate,
    extension: 'pdf',
  });
  // Cast through unknown to work around @types/node 25 + Next 14 dom.d.ts
  // variance mismatch for Buffer / Uint8Array<ArrayBufferLike>. Runtime accepts
  // both Buffer and Uint8Array directly in the Next 14 Node runtime.
  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
