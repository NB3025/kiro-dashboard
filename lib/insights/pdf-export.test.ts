import {
  buildInsightsPdfComponentSpec,
  NOTO_SANS_CJK_FONT_URL,
  PDF_FONT_FAMILY,
} from './pdf-export';

describe('buildInsightsPdfComponentSpec — 13.2/13.3', () => {
  const baseOpts = {
    userId: 'u',
    maskedDisplayName: 'Bo________',
    bundle: {
      sections: {
        project_areas: { summary: 'worked on auth flow' },
        at_a_glance: { whats_working: '…' },
      },
    },
    facetVersion: '1.0.0',
    modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    startDate: '2026-04-04',
    endDate: '2026-05-03',
    sessionCount: 38,
  };

  it('produces a spec covering both sections', () => {
    const spec = buildInsightsPdfComponentSpec(baseOpts);
    expect(spec.sections.map((s) => s.key)).toEqual(['project_areas', 'at_a_glance']);
    expect(spec.title).toContain('Bo________');
    expect(spec.title).toContain('2026-04-04');
    expect(spec.title).toContain('2026-05-03');
  });

  it('includes the Kiro brand accent color #9046FF', () => {
    const spec = buildInsightsPdfComponentSpec(baseOpts);
    expect(spec.accentColor).toBe('#9046FF');
  });

  it('footer mirrors markdown: facet_version + model_id', () => {
    const spec = buildInsightsPdfComponentSpec(baseOpts);
    expect(spec.footer).toContain('facet_version=1.0.0');
    expect(spec.footer).toContain('model=anthropic.claude-sonnet-4-5-20250929-v1:0');
  });

  it('marks null sections with a failure notice', () => {
    const spec = buildInsightsPdfComponentSpec({
      ...baseOpts,
      bundle: { sections: { project_areas: null, at_a_glance: { x: 1 } } },
    });
    const nullSection = spec.sections.find((s) => s.key === 'project_areas');
    expect(nullSection?.isFailure).toBe(true);
    expect(nullSection?.failureMessage).toContain('⚠️');
  });
});

describe('NotoSansCJK font registration (FR-EXPORT-PDF-7)', () => {
  it('exposes a downloadable URL for NotoSansCJK', () => {
    expect(NOTO_SANS_CJK_FONT_URL).toMatch(/^https?:\/\/.+\.(otf|ttf|woff2?)$/i);
  });

  it('uses NotoSansCJK as the PDF font family', () => {
    expect(PDF_FONT_FAMILY).toBe('NotoSansCJK');
  });
});

describe('PDF spec composition performance — NF6 (13.5)', () => {
  it('buildInsightsPdfComponentSpec for a 10-section bundle completes under 100ms', () => {
    const tenSections = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((k) => [k, { v: 1 }])
    );
    const t0 = Date.now();
    buildInsightsPdfComponentSpec({
      userId: 'u',
      maskedDisplayName: 'Bo',
      bundle: { sections: tenSections },
      facetVersion: '1.0.0',
      modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      startDate: '2026-04-04',
      endDate: '2026-05-03',
      sessionCount: 0,
    });
    // Spec composition is pure JS; real Bedrock/react-pdf I/O happens elsewhere.
    // NF6 (P95 ≤ 10s) is measured end-to-end in Phase 17.5 perf script.
    expect(Date.now() - t0).toBeLessThan(100);
  });
});
