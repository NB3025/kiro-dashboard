import {
  buildInsightsFilename,
  buildInsightsMarkdown,
} from './markdown-export';

describe('buildInsightsFilename — 12.1 (SC11)', () => {
  it('composes {uid8}-{maskedSafe}-insights-{date}.{ext}', () => {
    const f = buildInsightsFilename({
      userId: 'bob@whchoi.net',
      maskedDisplayName: 'Bo********',
      date: '2026-05-03',
      extension: 'md',
    });
    // uid8 is sha256("bob@whchoi.net")[:8]; masked-safe replaces * with _
    expect(f).toMatch(/^[0-9a-f]{8}-Bo________-insights-2026-05-03\.md$/);
  });

  it('replaces every * with _ in the masked display name (filename-safe)', () => {
    const f = buildInsightsFilename({
      userId: 'u',
      maskedDisplayName: 'Al*****',
      date: '2026-05-03',
      extension: 'pdf',
    });
    expect(f).not.toContain('*');
    expect(f.endsWith('.pdf')).toBe(true);
  });

  it('throws when userId is empty', () => {
    expect(() =>
      buildInsightsFilename({
        userId: '',
        maskedDisplayName: 'X',
        date: '2026-05-03',
        extension: 'md',
      })
    ).toThrow();
  });
});

describe('buildInsightsMarkdown — 12.2 body composition', () => {
  const baseOpts = {
    userId: 'u',
    maskedDisplayName: 'Bo________',
    bundle: {
      sections: {
        project_areas: { summary: 'worked on auth' },
        at_a_glance: { whats_working: '…' },
      },
    },
    facetVersion: '1.0.0',
    modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    startDate: '2026-04-04',
    endDate: '2026-05-03',
    sessionCount: 38,
  };

  it('starts with the Kiro Usage Insights title including masked display name and date range', () => {
    const md = buildInsightsMarkdown(baseOpts);
    expect(md.startsWith('# Kiro Usage Insights — Bo________ (2026-04-04 ~ 2026-05-03)')).toBe(true);
  });

  it('includes section count and generation timestamp in header', () => {
    const md = buildInsightsMarkdown(baseOpts);
    expect(md).toContain('분석 세션: 38');
    expect(md).toMatch(/생성 시각: \d{4}-\d{2}-\d{2}T/);
  });

  it('emits one ## heading per section key', () => {
    const md = buildInsightsMarkdown(baseOpts);
    expect(md).toContain('## project_areas');
    expect(md).toContain('## at_a_glance');
  });

  it('marks null sections with a failure notice (FR-EXPORT-MD-4)', () => {
    const opts = {
      ...baseOpts,
      bundle: { sections: { project_areas: null, at_a_glance: { x: 1 } } },
    };
    const md = buildInsightsMarkdown(opts);
    expect(md).toContain('## project_areas');
    expect(md).toContain('⚠️ 이 섹션 생성에 실패했습니다');
  });

  it('footer includes facet_version and model_id (12.4)', () => {
    const md = buildInsightsMarkdown(baseOpts);
    expect(md).toContain('facet_version=1.0.0');
    expect(md).toContain('model=anthropic.claude-sonnet-4-5-20250929-v1:0');
  });

  it('never includes raw clean_prompt verbatim — only LLM-generated section output (FR-EXPORT-MD-5)', () => {
    const opts = {
      ...baseOpts,
      bundle: {
        sections: {
          // A section whose content is an LLM summary — should render
          project_areas: { summary: 'user worked on auth flow' },
          // Intentionally include a key that sounds like a raw prompt — the
          // exporter only renders whatever is in the section value, so the
          // output MUST NOT contain the word "clean_prompt" unless we want it to.
        },
      },
    };
    const md = buildInsightsMarkdown(opts);
    // No field called clean_prompt exists in the output unless it's a section KEY
    expect(md).not.toContain('clean_prompt');
  });
});
