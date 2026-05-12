import {
  validatePromotionCandidate,
  filterFeaturesToTry,
  applyPowersHierarchyRule,
  shouldGenerateAtAGlance,
  AT_A_GLANCE_MIN_SUCCESS,
  detectPIIWarnings,
  buildEvidenceExcerpt,
} from './section-validator';

describe('validatePromotionCandidate', () => {
  const base = {
    target_feature: 'steering',
    target_filename: '.kiro/steering/use-uv.md',
    evidence_count: 3,
    rationale: 'repeated uv instruction',
    suggested_content: '# Use uv',
  };

  it('accepts a valid steering candidate', () => {
    expect(validatePromotionCandidate(base)).toBe(true);
  });

  it('rejects when target_feature is outside the 4 official types', () => {
    expect(validatePromotionCandidate({ ...base, target_feature: 'custom_agent' })).toBe(false);
    expect(validatePromotionCandidate({ ...base, target_feature: 'unknown' })).toBe(false);
  });

  it('rejects when evidence_count < 2', () => {
    expect(validatePromotionCandidate({ ...base, evidence_count: 1 })).toBe(false);
    expect(validatePromotionCandidate({ ...base, evidence_count: 0 })).toBe(false);
  });

  it('rejects when target_filename path does not match target_feature convention', () => {
    // steering must be .kiro/steering/<name>.md
    expect(
      validatePromotionCandidate({ ...base, target_filename: '.kiro/hooks/use-uv.kiro.hook' })
    ).toBe(false);
  });

  it('accepts hook candidate with .kiro/hooks/<name>.kiro.hook', () => {
    expect(
      validatePromotionCandidate({
        ...base,
        target_feature: 'hook',
        target_filename: '.kiro/hooks/pre-commit-lint.kiro.hook',
      })
    ).toBe(true);
  });

  it('accepts subagent candidate with ~/.kiro/agents/<name>.md OR workspace .kiro/agents/<name>.md', () => {
    expect(
      validatePromotionCandidate({
        ...base,
        target_feature: 'subagent',
        target_filename: '~/.kiro/agents/code-reviewer.md',
      })
    ).toBe(true);
    expect(
      validatePromotionCandidate({
        ...base,
        target_feature: 'subagent',
        target_filename: '.kiro/agents/code-reviewer.md',
      })
    ).toBe(true);
  });

  it('accepts power candidate with power-<name>/POWER.md', () => {
    expect(
      validatePromotionCandidate({
        ...base,
        target_feature: 'power',
        target_filename: 'power-stripe/POWER.md',
      })
    ).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(validatePromotionCandidate(null)).toBe(false);
    expect(validatePromotionCandidate('string')).toBe(false);
    expect(validatePromotionCandidate([])).toBe(false);
  });

  it('rejects when required string fields are missing', () => {
    const partial = { target_feature: 'steering', evidence_count: 3 };
    expect(validatePromotionCandidate(partial)).toBe(false);
  });
});

describe('filterFeaturesToTry', () => {
  const emptyCtx = {
    top_steering_rules: [],
    hook_active_count: 'unknown' as const,
    subagent_active_count: 'unknown' as const,
    power_active_list: 'unknown' as const,
  };

  it('excludes items whose feature_type is not in the 4 official types', () => {
    const items = [
      { feature_type: 'steering', name: 's1' },
      { feature_type: 'custom_agent', name: 'bad' },
      { feature_type: 'spec', name: 'bad2' },
    ];
    const out = filterFeaturesToTry(items, emptyCtx);
    expect(out.map((i) => i.name)).toEqual(['s1']);
  });

  it('excludes steering when top_steering_rules already has ≥2 rules', () => {
    const items = [{ feature_type: 'steering', name: 's1' }];
    const out = filterFeaturesToTry(items, {
      ...emptyCtx,
      top_steering_rules: [
        { id: 'r1', count: 5 },
        { id: 'r2', count: 3 },
      ],
    });
    expect(out).toEqual([]);
  });

  it('keeps steering when top_steering_rules has <2 rules', () => {
    const items = [{ feature_type: 'steering', name: 's1' }];
    const out = filterFeaturesToTry(items, {
      ...emptyCtx,
      top_steering_rules: [{ id: 'r1', count: 1 }],
    });
    expect(out).toHaveLength(1);
  });

  it('keeps hook when hook_active_count is "unknown"', () => {
    const items = [{ feature_type: 'hook', name: 'h1' }];
    const out = filterFeaturesToTry(items, emptyCtx);
    expect(out).toHaveLength(1);
  });

  it('excludes hook when hook_active_count ≥ 2', () => {
    const items = [{ feature_type: 'hook', name: 'h1' }];
    const out = filterFeaturesToTry(items, { ...emptyCtx, hook_active_count: 2 });
    expect(out).toEqual([]);
  });

  it('excludes subagent when subagent_active_count ≥ 2', () => {
    const items = [{ feature_type: 'subagent', name: 'a1' }];
    const out = filterFeaturesToTry(items, { ...emptyCtx, subagent_active_count: 3 });
    expect(out).toEqual([]);
  });

  it('excludes power when power_active_list has ≥ 2 entries', () => {
    const items = [{ feature_type: 'power', name: 'p1' }];
    const out = filterFeaturesToTry(items, {
      ...emptyCtx,
      power_active_list: ['power-stripe', 'power-supabase'],
    });
    expect(out).toEqual([]);
  });

  it('keeps power when power_active_list is "unknown"', () => {
    const items = [{ feature_type: 'power', name: 'p1' }];
    const out = filterFeaturesToTry(items, emptyCtx);
    expect(out).toHaveLength(1);
  });
});

describe('applyPowersHierarchyRule (SC18, design §6.5)', () => {
  it('passes through when no overlapping domain between steering and hook', () => {
    const items = [
      {
        target_feature: 'steering',
        target_filename: '.kiro/steering/use-uv.md',
        evidence_count: 3,
        rationale: 'repeat uv',
        suggested_content: '',
        domain_keywords: ['uv', 'python'],
      },
      {
        target_feature: 'hook',
        target_filename: '.kiro/hooks/lint.kiro.hook',
        evidence_count: 2,
        rationale: 'repeat lint',
        suggested_content: '',
        domain_keywords: ['eslint', 'lint'],
      },
    ];
    const out = applyPowersHierarchyRule(items);
    expect(out).toHaveLength(2);
  });

  it('merges same-domain steering+hook into a single power candidate', () => {
    const items = [
      {
        target_feature: 'steering',
        target_filename: '.kiro/steering/stripe.md',
        evidence_count: 5,
        rationale: 'stripe integration repeated',
        suggested_content: '# stripe rules',
        domain_keywords: ['stripe', 'webhook'],
      },
      {
        target_feature: 'hook',
        target_filename: '.kiro/hooks/stripe-verify.kiro.hook',
        evidence_count: 3,
        rationale: 'stripe webhook check repeated',
        suggested_content: '# stripe hook',
        domain_keywords: ['stripe'],
      },
    ];
    const out = applyPowersHierarchyRule(items);
    expect(out).toHaveLength(1);
    expect(out[0].target_feature).toBe('power');
    expect(out[0].target_filename).toMatch(/^power-[^/]+\/POWER\.md$/);
    // evidence is the max of the merged items
    expect(out[0].evidence_count).toBe(5);
  });

  it('leaves existing power candidates untouched', () => {
    const items = [
      {
        target_feature: 'power',
        target_filename: 'power-datadog/POWER.md',
        evidence_count: 4,
        rationale: 'datadog usage',
        suggested_content: '',
        domain_keywords: ['datadog'],
      },
    ];
    const out = applyPowersHierarchyRule(items);
    expect(out).toEqual(items);
  });
});

describe('shouldGenerateAtAGlance (FR-INS-9)', () => {
  it('exposes the quality gate threshold as a constant (≥4 successful core sections)', () => {
    expect(AT_A_GLANCE_MIN_SUCCESS).toBe(4);
  });

  it('returns true when 4 of 8 core sections succeeded', () => {
    const results = [
      {}, {}, {}, {}, // 4 successful objects
      null, null, null, null,
    ];
    expect(shouldGenerateAtAGlance(results)).toBe(true);
  });

  it('returns false when only 3 of 8 succeeded', () => {
    const results = [{}, {}, {}, null, null, null, null, null];
    expect(shouldGenerateAtAGlance(results)).toBe(false);
  });

  it('returns true when all 8 succeeded', () => {
    expect(shouldGenerateAtAGlance(Array(8).fill({}))).toBe(true);
  });

  it('returns false when 0 succeeded', () => {
    expect(shouldGenerateAtAGlance(Array(8).fill(null))).toBe(false);
  });

  it('ignores undefined the same as null', () => {
    const results = [{}, {}, {}, undefined, null, undefined, null, null];
    expect(shouldGenerateAtAGlance(results)).toBe(false);
  });
});

describe('detectPIIWarnings (SC17)', () => {
  it('flags email addresses', () => {
    const out = detectPIIWarnings('contact admin@whchoi.net for help');
    expect(out.types).toContain('email');
  });

  it('flags URLs', () => {
    expect(detectPIIWarnings('see https://example.com/private').types).toContain('url');
    expect(detectPIIWarnings('visit http://example.org').types).toContain('url');
  });

  it('flags <USER-...> prefix', () => {
    expect(detectPIIWarnings('hello <USER-abc123>').types).toContain('user_prefix');
  });

  it('flags <INTERNAL-...> prefix', () => {
    expect(detectPIIWarnings('see <INTERNAL-policy-42>').types).toContain('internal_prefix');
  });

  it('returns empty types array for clean text', () => {
    expect(detectPIIWarnings('just regular prose with no PII').types).toEqual([]);
  });

  it('can return multiple types at once', () => {
    const out = detectPIIWarnings('email: a@b.com URL: https://x.y');
    expect(out.types).toEqual(expect.arrayContaining(['email', 'url']));
  });

  it('handles empty / non-string input gracefully', () => {
    expect(detectPIIWarnings('').types).toEqual([]);
  });
});

describe('buildEvidenceExcerpt (FR-SEC-3)', () => {
  it('truncates to 50 characters', () => {
    const input = 'a'.repeat(100);
    const excerpt = buildEvidenceExcerpt(input);
    expect(excerpt.length).toBeLessThanOrEqual(50);
  });

  it('scrubs email addresses before truncating', () => {
    const input = 'contact admin@whchoi.net to review the PR changes';
    const excerpt = buildEvidenceExcerpt(input);
    expect(excerpt).not.toContain('admin@whchoi.net');
    expect(excerpt).toContain('[email]');
  });

  it('scrubs URLs', () => {
    const excerpt = buildEvidenceExcerpt('go to https://secret.internal/token for the code');
    expect(excerpt).not.toContain('https://');
    expect(excerpt).toContain('[url]');
  });

  it('preserves short clean text untouched', () => {
    expect(buildEvidenceExcerpt('short clean text')).toBe('short clean text');
  });

  it('returns empty string for empty input', () => {
    expect(buildEvidenceExcerpt('')).toBe('');
  });

  it('truncates with ellipsis mark when cut', () => {
    const input = 'This text is deliberately longer than fifty characters to trigger cut';
    const excerpt = buildEvidenceExcerpt(input);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});
