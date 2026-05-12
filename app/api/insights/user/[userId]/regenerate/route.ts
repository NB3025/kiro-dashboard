import { NextRequest, NextResponse } from 'next/server';
import {
  isPromptLogsConfigured,
  buildNotConfiguredResponse,
  validateDaysParam,
} from '@/lib/insights/api-helpers';
import { deleteBundle } from '@/lib/insights/bundle-cache';

export async function POST(
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

  const params =
    'then' in (context.params as object)
      ? await (context.params as Promise<{ userId: string }>)
      : (context.params as { userId: string });

  // Invalidate the S3 bundle cache for this user/days window. The UI is
  // expected to re-open the SSE connection with `?force=1` (or simply rely on
  // cache miss on the next visit) to trigger a fresh Bedrock generation.
  await deleteBundle(params.userId, validation.days);

  return NextResponse.json(
    { invalidated: true, userId: params.userId, days: validation.days },
    { status: 202 }
  );
}
