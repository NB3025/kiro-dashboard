import { buildDataContext } from './data-context';

jest.mock('../athena', () => ({
  executeQuery: jest.fn(),
  NORMALIZE_USERID: 'REGEXP_REPLACE(userid, \'^d-[a-z0-9]+\\.\', \'\')',
}));

jest.mock('./facet-loader', () => {
  const actual = jest.requireActual('./facet-loader');
  return {
    ...actual,
    loadFacetsForUser: jest.fn(async () => []),
  };
});

const { executeQuery } = jest.requireMock('../athena') as {
  executeQuery: jest.Mock;
};
const { loadFacetsForUser } = jest.requireMock('./facet-loader') as {
  loadFacetsForUser: jest.Mock;
};

describe('buildDataContext — 5.1 empty results', () => {
  beforeEach(() => {
    executeQuery.mockReset();
  });

  it('returns defaults when every query returns an empty result set', async () => {
    executeQuery.mockResolvedValue([]);

    const ctx = await buildDataContext({ userId: 'u1', days: 30 });

    expect(ctx.model_mix).toEqual({});
    expect(ctx.top_steering_rules).toEqual([]);
    expect(ctx.spec_phases).toEqual({
      requirements: 0,
      design: 0,
      tasks: 0,
      implementation: 0,
      not_spec: 0,
    });
    expect(ctx.session_count).toBe(0);
  });
});

describe('buildDataContext — 5.2 model_mix', () => {
  beforeEach(() => executeQuery.mockReset());

  it('computes ratio per model_id from counts', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('model_id') && sql.includes('GROUP BY')) {
        return Promise.resolve([
          { model_id: 'claude-sonnet-4-5', count: '76' },
          { model_id: 'auto', count: '24' },
        ]);
      }
      return Promise.resolve([]);
    });

    const ctx = await buildDataContext({ userId: 'u1', days: 30 });

    expect(ctx.model_mix['claude-sonnet-4-5']).toBeCloseTo(0.76, 2);
    expect(ctx.model_mix['auto']).toBeCloseTo(0.24, 2);
    const total = Object.values(ctx.model_mix).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 3);
  });

  it('returns empty object when counts sum to zero', async () => {
    executeQuery.mockResolvedValue([]);
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.model_mix).toEqual({});
  });
});

describe('buildDataContext — 5.3 top_steering_rules', () => {
  beforeEach(() => executeQuery.mockReset());

  it('returns top 10 steering rules sorted desc by count', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('UNNEST(steering_rules)')) {
        // Unsorted, 12 entries → only top 10 should come back
        return Promise.resolve([
          { id: 'r1', count: '5' },
          { id: 'r2', count: '12' },
          { id: 'r3', count: '3' },
          { id: 'r4', count: '8' },
          { id: 'r5', count: '1' },
          { id: 'r6', count: '20' },
          { id: 'r7', count: '7' },
          { id: 'r8', count: '11' },
          { id: 'r9', count: '2' },
          { id: 'r10', count: '9' },
          { id: 'r11', count: '4' },
          { id: 'r12', count: '6' },
        ]);
      }
      return Promise.resolve([]);
    });

    const ctx = await buildDataContext({ userId: 'u1', days: 30 });

    expect(ctx.top_steering_rules).toHaveLength(10);
    // Check sorted desc
    const counts = ctx.top_steering_rules.map((r) => r.count);
    const sorted = [...counts].sort((a, b) => b - a);
    expect(counts).toEqual(sorted);
    expect(ctx.top_steering_rules[0].id).toBe('r6'); // count 20
  });
});

describe('buildDataContext — 5.4 spec_phases', () => {
  beforeEach(() => executeQuery.mockReset());

  it('aggregates counts per phase including zero-count phases', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('active_spec_phase')) {
        return Promise.resolve([
          { active_spec_phase: 'requirements', count: '3' },
          { active_spec_phase: 'tasks', count: '7' },
          { active_spec_phase: 'not_spec', count: '50' },
        ]);
      }
      return Promise.resolve([]);
    });

    const ctx = await buildDataContext({ userId: 'u1', days: 30 });

    expect(ctx.spec_phases).toEqual({
      requirements: 3,
      design: 0,
      tasks: 7,
      implementation: 0,
      not_spec: 50,
    });
  });
});

describe('buildDataContext — 5.5 session_count', () => {
  beforeEach(() => executeQuery.mockReset());

  it('returns distinct session count from sessions query', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(DISTINCT session_id)')) {
        return Promise.resolve([{ session_count: '38' }]);
      }
      return Promise.resolve([]);
    });

    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.session_count).toBe(38);
  });
});

describe('buildDataContext — drops unknown-sentinel fields', () => {
  beforeEach(() => executeQuery.mockReset());

  it('does not expose hook_active_count / subagent_active_count / power_active_list', async () => {
    executeQuery.mockResolvedValue([]);
    const ctx = await buildDataContext({ userId: 'u1', days: 30 }) as Record<string, unknown>;
    expect(ctx.hook_active_count).toBeUndefined();
    expect(ctx.subagent_active_count).toBeUndefined();
    expect(ctx.power_active_list).toBeUndefined();
  });
});

describe('buildDataContext — 5.8 schema_version', () => {
  beforeEach(() => executeQuery.mockReset());

  it('always includes schema_version: "1.0.0"', async () => {
    executeQuery.mockResolvedValue([]);
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.schema_version).toBe('1.0.0');
  });
});

describe('buildDataContext —date_range / messages / hours', () => {
  beforeEach(() => {
    executeQuery.mockReset();
    loadFacetsForUser.mockReset();
    loadFacetsForUser.mockResolvedValue([]);
  });

  it('returns date_range from MIN/MAX of prompt_events.date', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('MIN(date)') && sql.includes('MAX(date)')) {
        return Promise.resolve([{ start: '2026-04-12', end: '2026-05-11' }]);
      }
      return Promise.resolve([]);
    });
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.date_range).toEqual({ start: '2026-04-12', end: '2026-05-11' });
  });

  it('returns null date_range when no events', async () => {
    executeQuery.mockResolvedValue([]);
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.date_range).toEqual({ start: null, end: null });
  });

  it('returns messages = COUNT(*) from prompt_events', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)') && sql.includes('prompt_events') && !sql.includes('active_editor_file')) {
        return Promise.resolve([{ messages: '812' }]);
      }
      return Promise.resolve([]);
    });
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.messages).toBe(812);
  });

  it('returns hours = SUM(end_ts - start_ts)/3600 rounded to 1 decimal', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('SUM(end_ts - start_ts)')) {
        // 18.2 hours = 65520 seconds
        return Promise.resolve([{ seconds: '65520' }]);
      }
      return Promise.resolve([]);
    });
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.hours).toBeCloseTo(18.2, 1);
  });

  it('returns hours = 0 when sessions query returns empty', async () => {
    executeQuery.mockResolvedValue([]);
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.hours).toBe(0);
  });
});

describe('buildDataContext —spec_count / languages', () => {
  beforeEach(() => {
    executeQuery.mockReset();
    loadFacetsForUser.mockReset();
    loadFacetsForUser.mockResolvedValue([]);
  });

  it('returns spec_count = distinct active_spec_name', async () => {
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(DISTINCT active_spec_name)')) {
        return Promise.resolve([{ spec_count: '4' }]);
      }
      return Promise.resolve([]);
    });
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.spec_count).toBe(4);
  });

  it('aggregates languages from active_editor_file extensions', async () => {
    // Glue query returns pre-grouped rows: {ext, count}
    executeQuery.mockImplementation((sql: string) => {
      if (sql.includes('active_editor_file') && sql.includes('GROUP BY')) {
        return Promise.resolve([
          { ext: 'ts', count: '18' },
          { ext: 'py', count: '5' },
          { ext: 'md', count: '100' },   // must be filtered (docs noise)
          { ext: 'json', count: '200' }, // must be filtered
        ]);
      }
      return Promise.resolve([]);
    });
    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.languages).toEqual({ ts: 18, py: 5 });
  });
});

describe('buildDataContext —Facet aggregates integration', () => {
  beforeEach(() => {
    executeQuery.mockReset();
    executeQuery.mockResolvedValue([]);
    loadFacetsForUser.mockReset();
  });

  it('injects top_goals / outcomes / satisfaction / friction / success from facets', async () => {
    loadFacetsForUser.mockResolvedValue([
      {
        _user_id: 'u1',
        outcome: 'fully_achieved',
        goal_categories: { bug_fix: 2, refactor: 1 },
        user_satisfaction_counts: { happy: 1 },
        friction_counts: { misunderstood_request: 1 },
        primary_success: 'proactive_help',
      },
      {
        _user_id: 'u1',
        outcome: 'mostly_achieved',
        goal_categories: { bug_fix: 1 },
        user_satisfaction_counts: { happy: 1, satisfied: 1 },
        friction_counts: {},
        primary_success: 'good_explanations',
      },
    ]);

    const ctx = await buildDataContext({ userId: 'u1', days: 30 });
    expect(ctx.top_goals).toEqual([['bug_fix', 3], ['refactor', 1]]);
    expect(ctx.outcomes).toEqual({ fully_achieved: 1, mostly_achieved: 1 });
    expect(ctx.satisfaction).toEqual({ happy: 2, satisfied: 1 });
    expect(ctx.friction).toEqual({ misunderstood_request: 1 });
    expect(ctx.success).toEqual({ proactive_help: 1, good_explanations: 1 });
    expect(ctx.analyzed).toBe(2); // facet count replaces facet_count field name → still 2
  });
});
