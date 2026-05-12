import {
  normalizeSuggestions,
  FEATURE_BADGE,
  type NormalizedSuggestions,
} from './suggestions-view';

describe('normalizeSuggestions', () => {
  it('returns empty buckets when input is null/undefined', () => {
    const a = normalizeSuggestions(null);
    const b = normalizeSuggestions(undefined);
    for (const n of [a, b]) {
      expect(n.steering_additions).toEqual([]);
      expect(n.features_to_try).toEqual([]);
      expect(n.usage_patterns).toEqual([]);
    }
  });

  it('passes through the 3 CC-faithful buckets unchanged', () => {
    const raw = {
      steering_additions: [
        { addition: '규칙 A', why: 'X', target_filename: '.kiro/steering/a.md', prompt_scaffold: 'Y' },
      ],
      features_to_try: [
        { feature: 'Custom Skills', one_liner: '한 줄', why_for_you: '이유', example_code: 'code' },
      ],
      usage_patterns: [
        { title: '제목', suggestion: '요약', detail: '상세', copyable_prompt: '프롬프트' },
      ],
    };
    const n: NormalizedSuggestions = normalizeSuggestions(raw);
    expect(n.steering_additions).toHaveLength(1);
    expect(n.features_to_try).toHaveLength(1);
    expect(n.usage_patterns).toHaveLength(1);
    expect(n.steering_additions[0].target_filename).toBe('.kiro/steering/a.md');
  });

  it('drops non-object or malformed entries but keeps well-formed ones', () => {
    const raw = {
      steering_additions: [
        null,
        { addition: 'OK', why: 'W', target_filename: '.kiro/steering/ok.md', prompt_scaffold: 'P' },
        'not-an-object',
      ],
      features_to_try: [
        { feature: 'MCP Servers', one_liner: '', why_for_you: '', example_code: '' },
      ],
      usage_patterns: [],
    };
    const n = normalizeSuggestions(raw);
    expect(n.steering_additions).toHaveLength(1);
    expect(n.steering_additions[0].addition).toBe('OK');
    expect(n.features_to_try).toHaveLength(1);
  });

  it('tolerates missing buckets (partial payloads)', () => {
    const n = normalizeSuggestions({ features_to_try: [] });
    expect(n.steering_additions).toEqual([]);
    expect(n.features_to_try).toEqual([]);
    expect(n.usage_patterns).toEqual([]);
  });
});

describe('FEATURE_BADGE', () => {
  it('has an entry for every CC-faithful feature reference name', () => {
    expect(FEATURE_BADGE['MCP Servers']).toBeDefined();
    expect(FEATURE_BADGE['Custom Skills']).toBeDefined();
    expect(FEATURE_BADGE['Hooks']).toBeDefined();
    expect(FEATURE_BADGE['Headless Mode']).toBeDefined();
    expect(FEATURE_BADGE['Subagent']).toBeDefined();
    expect(FEATURE_BADGE['Power']).toBeDefined();
  });

  it('falls back to a default badge for unknown feature names via the default entry', () => {
    expect(FEATURE_BADGE['__default__']).toBeDefined();
  });
});
