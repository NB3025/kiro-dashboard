import { SECTION_PROMPTS, PER_USER_CORE_SECTIONS } from './section-prompts';

describe('SECTION_PROMPTS', () => {
  it('has 9 keys total (8 per-user core + 1 synthesis)', () => {
    // Kiro rev (2026-05-12): dropped 3 org_* sections, restored fun_ending
    // with CC-original headline/detail schema (insights.ts:1484-1492).
    expect(Object.keys(SECTION_PROMPTS)).toHaveLength(9);
  });

  it('includes each expected per-user core section key', () => {
    const expected = [
      'project_areas',
      'interaction_style',
      'what_works',
      'friction_analysis',
      'suggestions',
      'feature_adoption_audit',
      'on_the_horizon',
      'fun_ending',
    ];
    for (const key of expected) {
      expect(SECTION_PROMPTS).toHaveProperty(key);
      expect(typeof SECTION_PROMPTS[key as keyof typeof SECTION_PROMPTS]).toBe('string');
      expect(
        (SECTION_PROMPTS[key as keyof typeof SECTION_PROMPTS] as string).length
      ).toBeGreaterThan(0);
    }
  });

  it('includes at_a_glance synthesis section', () => {
    expect(SECTION_PROMPTS).toHaveProperty('at_a_glance');
  });

  it('does not expose any org_* section', () => {
    expect(SECTION_PROMPTS).not.toHaveProperty('org_overview');
    expect(SECTION_PROMPTS).not.toHaveProperty('org_model_routing_audit');
    expect(SECTION_PROMPTS).not.toHaveProperty('org_platform_improvements');
  });

  it('exposes PER_USER_CORE_SECTIONS as an array of 8 keys', () => {
    expect(PER_USER_CORE_SECTIONS).toHaveLength(8);
    expect(PER_USER_CORE_SECTIONS).toContain('fun_ending' as never);
  });

  // CC §4.7 fun_ending schema: {headline, detail} — a memorable qualitative
  // moment, not a statistic. Our earlier one-liner {line} was a regression
  // against the CC reference. Re-align.
  it('fun_ending prompt carries CC-original schema (headline + detail)', () => {
    const p = SECTION_PROMPTS.fun_ending;
    expect(p).toMatch(/headline/);
    expect(p).toMatch(/detail/);
    // Guidance language — look for hints that LLM should find a qualitative
    // / non-statistical / memorable moment rather than a counter.
    expect(p).toMatch(/memorable|qualitative|moment|기억|순간/i);
  });

  it('every prompt ends with RESPOND WITH ONLY A VALID JSON OBJECT', () => {
    for (const key of Object.keys(SECTION_PROMPTS)) {
      const prompt = SECTION_PROMPTS[key as keyof typeof SECTION_PROMPTS];
      expect(prompt).toMatch(/RESPOND WITH ONLY A VALID JSON OBJECT/);
    }
  });

  // CC-faithful reference list: MCP, Skills, Hooks, Headless, Subagent, Power.
  // Pattern name comes from the original CC prompt — we preserve the header.
  it('suggestions prompt carries KIRO FEATURES REFERENCE with all 6 entries', () => {
    const p = SECTION_PROMPTS.suggestions;
    expect(p).toMatch(/KIRO FEATURES REFERENCE/);
    expect(p).toMatch(/MCP Servers/);
    expect(p).toMatch(/Custom Skills/);
    expect(p).toMatch(/Hooks/);
    expect(p).toMatch(/Headless Mode/);
    expect(p).toMatch(/Subagent|Task Agents/);
    expect(p).toMatch(/Power/);
  });

  it('suggestions prompt includes the concrete Kiro CLI + file paths', () => {
    const p = SECTION_PROMPTS.suggestions;
    expect(p).toMatch(/\.kiro\/skills\/<name>\/SKILL\.md/);
    expect(p).toMatch(/kiro-cli mcp add/);
    expect(p).toMatch(/kiro-cli chat --no-interactive/);
    expect(p).toMatch(/\.kiro\/hooks\//);
    expect(p).toMatch(/~\/?\.kiro\/agents\//);
  });

  it('suggestions prompt emits the CC 3-bucket output schema', () => {
    const p = SECTION_PROMPTS.suggestions;
    expect(p).toMatch(/steering_additions/);
    expect(p).toMatch(/features_to_try/);
    expect(p).toMatch(/usage_patterns/);
    expect(p).toMatch(/copyable_prompt/);
  });

  it('suggestions prompt includes POWERS HIERARCHY RULE', () => {
    expect(SECTION_PROMPTS.suggestions).toMatch(/POWERS HIERARCHY RULE/);
  });

  // Kiro Custom Skills are an extension point distinct from steering. Since we
  // kept feature_adoption_audit, skill_usage belongs in its schema alongside
  // the existing steering/hook/subagent/power signals.
  it('feature_adoption_audit reports skill_usage in addition to the other 5 signals', () => {
    const p = SECTION_PROMPTS.feature_adoption_audit;
    expect(p).toMatch(/spec_usage/);
    expect(p).toMatch(/steering_usage/);
    expect(p).toMatch(/skill_usage/);
    expect(p).toMatch(/hook_usage/);
    expect(p).toMatch(/subagent_usage/);
    expect(p).toMatch(/power_usage/);
  });

  // Repetition heuristic — ported from Claude Code insights pipeline
  // (originally `PRIORITIZE instructions that appear MULTIPLE TIMES`).
  // Without an embedding-based clustering job, recurrence must be detected
  // directly by Opus via the section prompt, so these prompts must carry
  // the guidance explicitly.
  it('suggestions prompt instructs Opus to prioritize patterns appearing multiple times', () => {
    expect(SECTION_PROMPTS.suggestions).toMatch(/MULTIPLE TIMES|repeat/i);
  });

  // Korean output directive — dashboard is Korean-primary (lib/i18n.tsx default
  // locale = 'ko'), so every section's narrative text must be produced in
  // Korean. JSON keys and enum values remain English for schema compatibility.
  it('every prompt carries a Korean output directive', () => {
    for (const key of Object.keys(SECTION_PROMPTS)) {
      const prompt = SECTION_PROMPTS[key as keyof typeof SECTION_PROMPTS];
      expect(prompt).toMatch(/한국어|Korean/);
    }
  });

  it('Korean directive explicitly preserves JSON keys and enum values in English', () => {
    for (const key of Object.keys(SECTION_PROMPTS)) {
      const prompt = SECTION_PROMPTS[key as keyof typeof SECTION_PROMPTS];
      expect(prompt).toMatch(/JSON keys.*English|keys.*remain.*English|enum.*English/i);
    }
  });
});
