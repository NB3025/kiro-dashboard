import { bundleCacheKey, INSIGHTS_PIPELINE_VERSION } from './bundle-cache';

describe('bundleCacheKey', () => {
  it('formats the S3 object key with userId and days scope', () => {
    expect(bundleCacheKey('d-abc.user-1', 30)).toBe(
      'insights/bundles/user=d-abc.user-1/days=30/bundle.json'
    );
  });

  it('produces distinct keys per days window for the same user', () => {
    const u = 'd-x.u1';
    expect(bundleCacheKey(u, 7)).not.toBe(bundleCacheKey(u, 30));
    expect(bundleCacheKey(u, 30)).not.toBe(bundleCacheKey(u, 90));
  });
});

describe('INSIGHTS_PIPELINE_VERSION', () => {
  // The pipeline version is stamped onto every saved bundle (for provenance
  // in export footers and future cache invalidation). It tracks the
  // DataContext schema_version — bump both together when the pipeline
  // output shape changes.
  it('is a semver string', () => {
    expect(INSIGHTS_PIPELINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches DataContext schema_version convention', () => {
    expect(INSIGHTS_PIPELINE_VERSION).toBe('1.0.0');
  });
});
