import {
  buildFacetNarrative,
  buildFacetAggregates,
  type FacetRecord,
} from './facet-loader';

describe('buildFacetNarrative', () => {
  it('returns empty-state strings when no facets present', () => {
    const out = buildFacetNarrative([]);
    expect(out.sessionSummaries).toBe('(no sessions analyzed)');
    expect(out.frictionDetails).toBe('(no friction captured)');
    expect(out.userInstructions).toBe('None captured');
  });

  it('renders up to 50 session summaries as bullet lines', () => {
    const facets: FacetRecord[] = Array.from({ length: 60 }, (_, i) => ({
      _session_id: `s${i}`,
      _tier: 'SPEC',
      _spec_name: `proj-${i}`,
      brief_summary: `요약 ${i}`,
      outcome: 'fully_achieved',
      kiro_helpfulness: 'very_helpful',
      friction_detail: '',
      user_instructions_to_kiro: [],
      underlying_goal: '',
      goal_categories: {},
      user_satisfaction_counts: {},
      friction_counts: {},
    }));
    const out = buildFacetNarrative(facets);
    const lines = out.sessionSummaries.split('\n').filter(l => l.startsWith('-'));
    expect(lines).toHaveLength(50);
    expect(lines[0]).toContain('요약 0');
  });

  it('renders up to 20 friction details, skipping empty ones', () => {
    const facets: FacetRecord[] = [
      { friction_detail: '마찰1' } as FacetRecord,
      { friction_detail: '' } as FacetRecord,
      { friction_detail: '마찰2' } as FacetRecord,
    ];
    const out = buildFacetNarrative(facets);
    expect(out.frictionDetails).toContain('마찰1');
    expect(out.frictionDetails).toContain('마찰2');
    expect(out.frictionDetails.split('\n').filter(l => l.startsWith('-'))).toHaveLength(2);
  });

  it('flattens and dedupes user_instructions_to_kiro across facets, capped at 15', () => {
    const facets: FacetRecord[] = [
      { user_instructions_to_kiro: ['테스트 먼저', 'TS strict'] } as FacetRecord,
      { user_instructions_to_kiro: ['테스트 먼저', 'uv 사용'] } as FacetRecord,
    ];
    const out = buildFacetNarrative(facets);
    const lines = out.userInstructions.split('\n').filter(l => l.startsWith('-'));
    expect(lines).toHaveLength(3);
    // dedup: "테스트 먼저" 한 번만
    expect(lines.filter(l => l.includes('테스트 먼저'))).toHaveLength(1);
  });

  it('caps user_instructions at 15 items', () => {
    const facets: FacetRecord[] = [{
      user_instructions_to_kiro: Array.from({ length: 30 }, (_, i) => `지시 ${i}`),
    } as FacetRecord];
    const out = buildFacetNarrative(facets);
    const lines = out.userInstructions.split('\n').filter(l => l.startsWith('-'));
    expect(lines).toHaveLength(15);
  });

  it('includes tier/spec hint in session summaries for spec sessions', () => {
    const facets: FacetRecord[] = [{
      _session_id: 'x',
      _tier: 'SPEC',
      _spec_name: 'my-project',
      brief_summary: '작업했음',
      outcome: 'mostly_achieved',
    } as FacetRecord];
    const out = buildFacetNarrative(facets);
    expect(out.sessionSummaries).toContain('my-project');
    expect(out.sessionSummaries).toContain('mostly_achieved');
  });
});

describe('buildFacetAggregates', () => {
  it('returns empty aggregates for empty facet list', () => {
    const agg = buildFacetAggregates([]);
    expect(agg.top_goals).toEqual([]);
    expect(agg.outcomes).toEqual({});
    expect(agg.satisfaction).toEqual({});
    expect(agg.friction).toEqual({});
    expect(agg.success).toEqual({});
  });

  it('sums goal_categories across facets and returns Top 8 sorted desc', () => {
    const facets: FacetRecord[] = [
      { goal_categories: { bug_fix: 2, refactor: 1, docs: 3 } } as FacetRecord,
      { goal_categories: { bug_fix: 1, refactor: 2, infra: 5 } } as FacetRecord,
      { goal_categories: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 } } as FacetRecord,
    ];
    const agg = buildFacetAggregates(facets);
    // Total categories: bug_fix=3, refactor=3, docs=3, infra=5, a/b/c/d/e/f=1 each = 10 keys
    // Top 8 by count desc (ties allowed)
    expect(agg.top_goals.length).toBe(8);
    expect(agg.top_goals[0]).toEqual(['infra', 5]);
    // Remaining order may vary for ties but all counts must be sorted desc.
    const counts = agg.top_goals.map(([, n]) => n);
    const sorted = [...counts].sort((a, b) => b - a);
    expect(counts).toEqual(sorted);
  });

  it('counts outcome strings one per facet', () => {
    const facets: FacetRecord[] = [
      { outcome: 'fully_achieved' } as FacetRecord,
      { outcome: 'fully_achieved' } as FacetRecord,
      { outcome: 'partially_achieved' } as FacetRecord,
      { outcome: '' } as FacetRecord,     // empty → skip
    ];
    const agg = buildFacetAggregates(facets);
    expect(agg.outcomes).toEqual({ fully_achieved: 2, partially_achieved: 1 });
  });

  it('sums user_satisfaction_counts across facets', () => {
    const facets: FacetRecord[] = [
      { user_satisfaction_counts: { happy: 1, satisfied: 2 } } as FacetRecord,
      { user_satisfaction_counts: { happy: 2, neutral: 1 } } as FacetRecord,
    ];
    const agg = buildFacetAggregates(facets);
    expect(agg.satisfaction).toEqual({ happy: 3, satisfied: 2, neutral: 1 });
  });

  it('sums friction_counts across facets', () => {
    const facets: FacetRecord[] = [
      { friction_counts: { misunderstood_request: 2 } } as FacetRecord,
      { friction_counts: { misunderstood_request: 1, wrong_approach: 1 } } as FacetRecord,
    ];
    const agg = buildFacetAggregates(facets);
    expect(agg.friction).toEqual({ misunderstood_request: 3, wrong_approach: 1 });
  });

  it('counts primary_success strings one per facet', () => {
    const facets: FacetRecord[] = [
      { primary_success: 'proactive_help' } as FacetRecord,
      { primary_success: 'proactive_help' } as FacetRecord,
      { primary_success: 'good_debugging' } as FacetRecord,
      { primary_success: 'none' } as FacetRecord,
    ];
    const agg = buildFacetAggregates(facets);
    expect(agg.success).toEqual({ proactive_help: 2, good_debugging: 1, none: 1 });
  });
});
