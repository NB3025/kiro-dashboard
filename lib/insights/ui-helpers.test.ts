import {
  shouldShowFrictionWarning,
  formatKpiCards,
  PER_USER_DRILLDOWN_TABS,
} from './ui-helpers';

describe('shouldShowFrictionWarning', () => {
  it('returns true when friction_total ≥ 5', () => {
    expect(shouldShowFrictionWarning({ friction_total: 5 })).toBe(true);
    expect(shouldShowFrictionWarning({ friction_total: 8 })).toBe(true);
  });

  it('returns false when friction_total < 5', () => {
    expect(shouldShowFrictionWarning({ friction_total: 4 })).toBe(false);
    expect(shouldShowFrictionWarning({ friction_total: 0 })).toBe(false);
  });

  it('does NOT consider satisfaction (the satisfaction ≤6 condition was removed)', () => {
    // Even with low satisfaction, only friction ≥ 5 matters
    expect(shouldShowFrictionWarning({ friction_total: 2, satisfaction_avg: 3 })).toBe(false);
  });
});

describe('formatKpiCards — 14.3 (FR-UI-ORG-3)', () => {
  it('returns 4 KPI cards (Active users / Total sessions / Users ≥1 steering / Users ≥5 sessions)', () => {
    const cards = formatKpiCards({
      active_users_30d: 12,
      total_sessions: 417,
      users_with_steering_ge_1: 5,
      users_with_sessions_ge_5_4w: 8,
    });
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.titleKey)).toEqual([
      'insights.kpi.active_users',
      'insights.kpi.total_sessions',
      'insights.kpi.users_steering',
      'insights.kpi.users_sessions_ge_5',
    ]);
    expect(cards.map((c) => c.value)).toEqual([12, 417, 5, 8]);
  });
});

describe('PER_USER_DRILLDOWN_TABS', () => {
  it('has 8 tab keys (fun_ending restored with CC headline+detail schema)', () => {
    expect(PER_USER_DRILLDOWN_TABS).toHaveLength(8);
    expect(PER_USER_DRILLDOWN_TABS.map((t) => t.key)).toContain('fun_ending');
  });

  it('includes feature_adoption_audit and NOT the dropped feature_library_audit', () => {
    const keys = PER_USER_DRILLDOWN_TABS.map((t) => t.key);
    expect(keys).toContain('feature_adoption_audit');
    expect(keys).not.toContain('feature_library_audit'); // removed for CC parity
    expect(keys).not.toContain('spec_workflow_health'); // v4 name
    expect(keys).not.toContain('steering_library_audit'); // v4 name
  });
});

