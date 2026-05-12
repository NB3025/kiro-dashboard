// Bundle cache — S3 get/put/delete helpers for per-user insights bundles.
// Used by the drilldown SSE route, the export route, and the regenerate
// endpoint so cache semantics stay consistent across all three.
//
// Key layout: `insights/bundles/user=<userId>/days=<N>/bundle.json`.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

// The insights bucket lives in the same region as InsightsStack (ap-northeast-2
// for this deployment), not where AWS_REGION points. Override via an explicit
// env var so the S3 client hits the correct endpoint.
const s3 = new S3Client({
  region: process.env.INSIGHTS_BUCKET_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-2',
});

// Stamped onto every saved bundle for provenance (export footers) and as
// the anchor for any future cache-invalidation policy. Tracks the
// DataContext `schema_version` — bump both together when the pipeline
// output shape changes.
export const INSIGHTS_PIPELINE_VERSION = '1.0.0';

export interface BundleEnvelope {
  userId: string;
  days: number;
  sections: Record<string, unknown>;
  sessionCount?: number;
  generatedAt: string;
  modelId?: string;
  facetVersion?: string;
}

export function bundleCacheKey(userId: string, days: number): string {
  return `insights/bundles/user=${userId}/days=${days}/bundle.json`;
}

export async function loadBundle(
  userId: string,
  days: number
): Promise<BundleEnvelope | null> {
  const bucket = process.env.INSIGHTS_BUCKET;
  if (!bucket) return null;
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: bundleCacheKey(userId, days) })
    );
    const text = await resp.Body!.transformToString();
    return JSON.parse(text) as BundleEnvelope;
  } catch {
    return null;
  }
}

export async function saveBundle(envelope: BundleEnvelope): Promise<void> {
  const bucket = process.env.INSIGHTS_BUCKET;
  if (!bucket) return;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: bundleCacheKey(envelope.userId, envelope.days),
      Body: JSON.stringify(envelope),
      ContentType: 'application/json',
    })
  );
}

export async function deleteBundle(userId: string, days: number): Promise<void> {
  const bucket = process.env.INSIGHTS_BUCKET;
  if (!bucket) return;
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: bundleCacheKey(userId, days),
      })
    );
  } catch {
    // Tolerate missing key — idempotent delete.
  }
}
