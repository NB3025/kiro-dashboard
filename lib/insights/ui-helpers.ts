// Pure helpers for the Insights UI. Kept out of *Client.tsx so they can be
// unit-tested in node/jest without a DOM.

export const FRICTION_WARNING_THRESHOLD = 5;

export function shouldShowFrictionWarning(row: {
  friction_total?: number;
  satisfaction_avg?: number; // kept in signature for backward compat; NOT used
}): boolean {
  const n = row.friction_total ?? 0;
  return n >= FRICTION_WARNING_THRESHOLD;
}

export interface KpiCardSpec {
  titleKey: string;
  value: number;
}

export function formatKpiCards(m: {
  active_users_30d: number;
  total_sessions: number;
  users_with_steering_ge_1: number;
  users_with_sessions_ge_5_4w: number;
}): KpiCardSpec[] {
  return [
    { titleKey: 'insights.kpi.active_users', value: m.active_users_30d },
    { titleKey: 'insights.kpi.total_sessions', value: m.total_sessions },
    { titleKey: 'insights.kpi.users_steering', value: m.users_with_steering_ge_1 },
    { titleKey: 'insights.kpi.users_sessions_ge_5', value: m.users_with_sessions_ge_5_4w },
  ];
}

export const PER_USER_DRILLDOWN_TABS = [
  { key: 'project_areas', labelKey: 'insights.section.project_areas' },
  { key: 'interaction_style', labelKey: 'insights.section.interaction_style' },
  { key: 'what_works', labelKey: 'insights.section.what_works' },
  { key: 'friction_analysis', labelKey: 'insights.section.friction_analysis' },
  { key: 'suggestions', labelKey: 'insights.section.suggestions' },
  { key: 'feature_adoption_audit', labelKey: 'insights.section.feature_adoption_audit' },
  { key: 'on_the_horizon', labelKey: 'insights.section.on_the_horizon' },
  { key: 'fun_ending', labelKey: 'insights.section.fun_ending' },
] as const;

