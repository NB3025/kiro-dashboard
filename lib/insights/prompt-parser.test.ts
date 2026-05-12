import {
  extractSteeringRules,
  extractActiveEditorFile,
  extractWorkspacePath,
  detectClientType,
  detectSpecMode,
  cleanPrompt,
  classifyFeatureTypeKeywords,
} from './prompt-parser';

describe('extractSteeringRules', () => {
  it('returns empty array for empty string', () => {
    expect(extractSteeringRules('')).toEqual([]);
  });

  it('extracts a single <user-rule> block', () => {
    const result = extractSteeringRules('<user-rule id="use-uv">Always use uv</user-rule>');
    expect(result).toEqual([{ id: 'use-uv', content: 'Always use uv' }]);
  });

  it('extracts multiple <user-rule> blocks in order', () => {
    const input =
      '<user-rule id="r1">first</user-rule>\n' +
      'between\n' +
      '<user-rule id="r2">second</user-rule>';
    expect(extractSteeringRules(input)).toEqual([
      { id: 'r1', content: 'first' },
      { id: 'r2', content: 'second' },
    ]);
  });

  it('ignores unclosed <user-rule> tags', () => {
    expect(extractSteeringRules('<user-rule id="x">no-close')).toEqual([]);
  });
});

describe('extractActiveEditorFile', () => {
  it('returns path string when tag exists (attribute form)', () => {
    const input = '<ACTIVE-EDITOR-FILE path="src/app/page.tsx">...</ACTIVE-EDITOR-FILE>';
    expect(extractActiveEditorFile(input)).toBe('src/app/page.tsx');
  });

  it('returns path string for the real Kiro nested-file format', () => {
    const input =
      '<ACTIVE-EDITOR-FILE>\n<file name="/Users/me/.kiro/steering/fswrite.md" />\n</ACTIVE-EDITOR-FILE>';
    expect(extractActiveEditorFile(input)).toBe('/Users/me/.kiro/steering/fswrite.md');
  });

  it('returns null when tag is absent', () => {
    expect(extractActiveEditorFile('no tags here')).toBeNull();
  });
});

describe('extractWorkspacePath', () => {
  it('extracts workspace path from <EnvironmentContext>', () => {
    const input =
      '<EnvironmentContext><workspace>/Users/alice/projects/x</workspace></EnvironmentContext>';
    expect(extractWorkspacePath(input)).toBe('/Users/alice/projects/x');
  });

  it('returns null when <workspace> is absent', () => {
    expect(extractWorkspacePath('<EnvironmentContext></EnvironmentContext>')).toBeNull();
  });

  it('returns null when <EnvironmentContext> is absent', () => {
    expect(extractWorkspacePath('plain prompt')).toBeNull();
  });
});

describe('detectClientType', () => {
  it('returns "CLI" when USER MESSAGE BEGIN marker present', () => {
    expect(detectClientType('--- USER MESSAGE BEGIN ---\nhello')).toBe('CLI');
  });

  it('returns "CLI" when CONTEXT ENTRY BEGIN marker present', () => {
    expect(detectClientType('--- CONTEXT ENTRY BEGIN ---\nctx')).toBe('CLI');
  });

  it('returns "IDE" when no CLI markers present', () => {
    expect(detectClientType('<EnvironmentContext>...</EnvironmentContext>\nask')).toBe('IDE');
  });

  it('returns "UNKNOWN" for empty string', () => {
    expect(detectClientType('')).toBe('UNKNOWN');
  });
});

describe('detectSpecMode', () => {
  it('returns requirements phase for requirements.md path', () => {
    expect(detectSpecMode('.kiro/specs/foo/requirements.md edit')).toEqual({
      is_spec_mode: true,
      active_spec_phase: 'requirements',
    });
  });

  it('returns design phase for design.md path', () => {
    expect(detectSpecMode('.kiro/specs/foo/design.md')).toEqual({
      is_spec_mode: true,
      active_spec_phase: 'design',
    });
  });

  it('returns tasks phase for tasks.md path', () => {
    expect(detectSpecMode('.kiro/specs/foo/tasks.md')).toEqual({
      is_spec_mode: true,
      active_spec_phase: 'tasks',
    });
  });

  it('returns implementation phase for .kiro/specs/ path without requirements/design/tasks', () => {
    expect(detectSpecMode('touching .kiro/specs/bar/notes.md')).toEqual({
      is_spec_mode: true,
      active_spec_phase: 'implementation',
    });
  });

  it('returns not_spec when no .kiro/specs/ path', () => {
    expect(detectSpecMode('ordinary prompt about src/app/page.tsx')).toEqual({
      is_spec_mode: false,
      active_spec_phase: 'not_spec',
    });
  });
});

describe('cleanPrompt', () => {
  it('returns empty string unchanged', () => {
    expect(cleanPrompt('')).toBe('');
  });

  it('strips <user-rule> blocks', () => {
    const input = '<user-rule id="x">Always use uv</user-rule>\nImplement foo';
    expect(cleanPrompt(input)).toBe('Implement foo');
  });

  it('strips <EnvironmentContext>...</EnvironmentContext>', () => {
    const input =
      '<EnvironmentContext><workspace>/x</workspace></EnvironmentContext>\nAsk question';
    expect(cleanPrompt(input)).toBe('Ask question');
  });

  it('strips <ACTIVE-EDITOR-FILE>...</ACTIVE-EDITOR-FILE>', () => {
    const input = 'Before\n<ACTIVE-EDITOR-FILE path="x">body</ACTIVE-EDITOR-FILE>\nAfter';
    expect(cleanPrompt(input)).toBe('Before\n\nAfter');
  });

  it('strips CLI markers (USER/CONTEXT ENTRY BEGIN/END)', () => {
    const input =
      '--- USER MESSAGE BEGIN ---\nhi\n--- USER MESSAGE END ---\n' +
      '--- CONTEXT ENTRY BEGIN ---\nctx\n--- CONTEXT ENTRY END ---';
    const out = cleanPrompt(input);
    expect(out).not.toContain('USER MESSAGE BEGIN');
    expect(out).not.toContain('CONTEXT ENTRY BEGIN');
    expect(out).toContain('hi');
    expect(out).toContain('ctx');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanPrompt('   hello   ')).toBe('hello');
  });
});

describe('classifyFeatureTypeKeywords', () => {
  it('returns "steering" for "always use" rule-like instruction', () => {
    expect(classifyFeatureTypeKeywords('always use uv for python projects')).toContain('steering');
  });

  it('returns "hook" for event-trigger language', () => {
    expect(classifyFeatureTypeKeywords('on file save run lint')).toContain('hook');
    expect(classifyFeatureTypeKeywords('before commit check secrets')).toContain('hook');
    expect(classifyFeatureTypeKeywords('after test passes, deploy')).toContain('hook');
  });

  it('returns "subagent" for persona-setting language', () => {
    expect(classifyFeatureTypeKeywords('you are a senior code reviewer')).toContain('subagent');
  });

  it('returns "power" for external-service + action combo', () => {
    expect(classifyFeatureTypeKeywords('stripe webhook verification')).toContain('power');
    expect(classifyFeatureTypeKeywords('supabase auth check')).toContain('power');
  });

  it('returns empty array for non-matching text', () => {
    expect(classifyFeatureTypeKeywords('just a normal question')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(classifyFeatureTypeKeywords('')).toEqual([]);
  });

  it('can return multiple candidates when text matches multiple', () => {
    const result = classifyFeatureTypeKeywords(
      'always run stripe webhook check before commit'
    );
    expect(result).toEqual(expect.arrayContaining(['steering', 'hook', 'power']));
  });
});
