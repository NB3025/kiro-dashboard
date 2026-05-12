import {
  normalizeProjectAreas,
  normalizeInteractionStyle,
  normalizeWhatWorks,
  normalizeFrictionAnalysis,
  normalizeFeatureAdoption,
  normalizeOnTheHorizon,
  normalizeFunEnding,
} from './section-views';

describe('normalizeProjectAreas', () => {
  it('returns [] when input lacks areas', () => {
    expect(normalizeProjectAreas(null)).toEqual([]);
    expect(normalizeProjectAreas({})).toEqual([]);
  });

  it('coerces session_count to number and keeps name/description as string', () => {
    const out = normalizeProjectAreas({
      areas: [
        { name: 'A', session_count: '12', description: 'd' },
        { name: 'B', session_count: 3, description: 'd2' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].session_count).toBe(12);
    expect(out[1].name).toBe('B');
  });

  it('drops entries without a name', () => {
    const out = normalizeProjectAreas({ areas: [{ description: 'x' }, { name: 'ok' }] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ok');
  });
});

describe('normalizeInteractionStyle', () => {
  it('returns summary + trait list', () => {
    const out = normalizeInteractionStyle({
      summary: 'S',
      traits: [{ label: 'T', evidence: 'E' }, null, { evidence: 'only-evidence' }],
    });
    expect(out.summary).toBe('S');
    expect(out.traits).toEqual([{ label: 'T', evidence: 'E' }]);
  });

  it('handles null and missing fields', () => {
    expect(normalizeInteractionStyle(null)).toEqual({ summary: '', traits: [] });
  });
});

describe('normalizeWhatWorks', () => {
  it('preserves summary and item list', () => {
    const out = normalizeWhatWorks({
      summary: 'ok',
      items: [{ title: 'T1', evidence: 'E1' }, 'bad'],
    });
    expect(out.summary).toBe('ok');
    expect(out.items).toEqual([{ title: 'T1', evidence: 'E1' }]);
  });
});

describe('normalizeFrictionAnalysis', () => {
  it('keeps intro + categories with examples', () => {
    const out = normalizeFrictionAnalysis({
      intro: 'I',
      categories: [
        { name: 'C1', examples: ['e1', 'e2'] },
        { name: 'C2', examples: [] },
        { examples: ['orphan'] },
      ],
    });
    expect(out.intro).toBe('I');
    expect(out.categories).toHaveLength(2);
    expect(out.categories[0].examples).toEqual(['e1', 'e2']);
  });
});

describe('normalizeFeatureAdoption', () => {
  it('extracts the 6 adoption fields and tolerates missing ones', () => {
    const out = normalizeFeatureAdoption({
      spec_usage: 'a',
      steering_usage: 'b',
      skill_usage: 'c',
      hook_usage: 'd',
      subagent_usage: 'e',
      power_usage: 'f',
    });
    expect(out).toEqual({
      spec_usage: 'a',
      steering_usage: 'b',
      skill_usage: 'c',
      hook_usage: 'd',
      subagent_usage: 'e',
      power_usage: 'f',
    });
  });

  it('defaults each missing field to empty string', () => {
    const out = normalizeFeatureAdoption({ spec_usage: 'only' });
    expect(out.spec_usage).toBe('only');
    expect(out.hook_usage).toBe('');
  });
});

describe('normalizeOnTheHorizon', () => {
  it('returns proposal list with title + why', () => {
    const out = normalizeOnTheHorizon({
      proposals: [{ title: 'P1', why: 'W1' }, { title: '' }, { why: 'W2' }],
    });
    expect(out).toEqual([{ title: 'P1', why: 'W1' }]);
  });
});

describe('normalizeFunEnding', () => {
  it('returns {headline, detail} with strings from CC schema', () => {
    expect(
      normalizeFunEnding({ headline: '엉뚱한 순간', detail: 'todo-app 세션 중' })
    ).toEqual({ headline: '엉뚱한 순간', detail: 'todo-app 세션 중' });
  });

  it('coerces missing fields to empty strings', () => {
    expect(normalizeFunEnding({})).toEqual({ headline: '', detail: '' });
    expect(normalizeFunEnding(null)).toEqual({ headline: '', detail: '' });
  });

  it('drops non-string values rather than stringifying them', () => {
    expect(normalizeFunEnding({ headline: 42, detail: { nested: 'x' } })).toEqual({
      headline: '',
      detail: '',
    });
  });
});
