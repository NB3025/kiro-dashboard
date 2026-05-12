import {
  generatePerUserInsights,
  computeUid8,
  createBedrockInvoker,
  validateModelId,
  BEDROCK_REGION,
  type BedrockInvoker,
} from './section-generator';

function makeMockInvoker(responseFor: (section: string) => string | Error): BedrockInvoker {
  return async ({ section }) => {
    const r = responseFor(section);
    if (r instanceof Error) throw r;
    return r;
  };
}

function validSectionJson(section: string): string {
  // A minimal object that extractJson can parse back.
  return `response for ${section} here → {"section":"${section}","ok":true}`;
}

describe('generatePerUserInsights — 9.1 skeleton', () => {
  it('returns 9 per-user sections (8 core + at_a_glance)', async () => {
    const invoker = makeMockInvoker(validSectionJson);

    const bundle = await generatePerUserInsights({
      userId: 'u1',
      dataContext: { schema_version: '1.0.0' } as unknown,
      facets: [],
      invoker,
    });

    const keys = Object.keys(bundle.sections);
    expect(keys).toHaveLength(9);
    expect(keys).toEqual(
      expect.arrayContaining([
        'project_areas',
        'interaction_style',
        'what_works',
        'friction_analysis',
        'suggestions',
        'feature_adoption_audit',
        'on_the_horizon',
        'fun_ending',
        'at_a_glance',
      ])
    );
  });

  it('each core section contains the parsed JSON', async () => {
    const invoker = makeMockInvoker(validSectionJson);
    const bundle = await generatePerUserInsights({
      userId: 'u1',
      dataContext: {} as unknown,
      facets: [],
      invoker,
    });
    expect(bundle.sections.project_areas).toEqual({ section: 'project_areas', ok: true });
  });
});

describe('generatePerUserInsights — 9.2 independent section failure (SC8)', () => {
  it('sets only the failing section to null; others succeed', async () => {
    const invoker: BedrockInvoker = async ({ section }) => {
      if (section === 'friction_analysis') {
        return 'broken response with no braces';
      }
      return `{"section":"${section}","ok":true}`;
    };

    const bundle = await generatePerUserInsights({
      userId: 'u1',
      dataContext: {},
      facets: [],
      invoker,
    });

    expect(bundle.sections.friction_analysis).toBeNull();
    expect(bundle.sections.project_areas).not.toBeNull();
    expect(bundle.sections.suggestions).not.toBeNull();
  });

  it('treats Bedrock throwing an error as that-section-null', async () => {
    const invoker: BedrockInvoker = async ({ section }) => {
      if (section === 'suggestions') {
        throw new Error('Bedrock throttled');
      }
      return `{"s":"${section}"}`;
    };

    const bundle = await generatePerUserInsights({
      userId: 'u1',
      dataContext: {},
      facets: [],
      invoker,
    });

    expect(bundle.sections.suggestions).toBeNull();
    expect(bundle.sections.project_areas).not.toBeNull();
  });
});

describe('generatePerUserInsights — 9.3 at_a_glance gate (FR-INS-9)', () => {
  function makeInvokerFailFirstN(n: number): BedrockInvoker {
    let remaining = n;
    return async ({ section }) => {
      if (remaining > 0 && section !== 'at_a_glance') {
        remaining -= 1;
        return 'no json here';
      }
      return `{"section":"${section}"}`;
    };
  }

  it('leaves at_a_glance null when <4 of 8 core sections succeeded', async () => {
    const bundle = await generatePerUserInsights({
      userId: 'u1',
      dataContext: {},
      facets: [],
      invoker: makeInvokerFailFirstN(5), // fail 5, succeed 3
    });
    expect(bundle.sections.at_a_glance).toBeNull();
  });

  it('produces at_a_glance when ≥4 of 8 core sections succeeded', async () => {
    const bundle = await generatePerUserInsights({
      userId: 'u1',
      dataContext: {},
      facets: [],
      invoker: makeInvokerFailFirstN(4), // fail 4, succeed 4
    });
    expect(bundle.sections.at_a_glance).not.toBeNull();
  });

  it('does not invoke Bedrock for at_a_glance when gate closes', async () => {
    let atAGlanceCalls = 0;
    const invoker: BedrockInvoker = async ({ section }) => {
      if (section === 'at_a_glance') {
        atAGlanceCalls += 1;
      }
      return 'no json';
    };
    await generatePerUserInsights({
      userId: 'u1',
      dataContext: {},
      facets: [],
      invoker,
    });
    expect(atAGlanceCalls).toBe(0);
  });
});

// CC §6 fidelity: at_a_glance is a SECOND-PASS synthesis over the already
// produced core sections, not a 9th parallel section re-reading the same
// Facet narrative. The invoker must receive coreResults (keyed by section
// name) only when section === 'at_a_glance', and core sections must see no
// such field so they don't accidentally read their siblings' drafts.
describe('generatePerUserInsights — at_a_glance consumes core section results', () => {
  it('passes coreResults to invoker only for at_a_glance', async () => {
    const seenCoreResultsPerSection: Record<string, unknown> = {};

    const invoker: BedrockInvoker = async (args) => {
      // Capture whether coreResults was passed, per section.
      seenCoreResultsPerSection[args.section] = (args as unknown as {
        coreResults?: unknown;
      }).coreResults;
      return `{"section":"${args.section}","ok":true}`;
    };

    await generatePerUserInsights({
      userId: 'u1',
      dataContext: {},
      facets: [],
      invoker,
    });

    // Every core section was called WITHOUT coreResults.
    for (const key of [
      'project_areas',
      'interaction_style',
      'what_works',
      'friction_analysis',
      'suggestions',
      'feature_adoption_audit',
      'on_the_horizon',
      'fun_ending',
    ]) {
      expect(seenCoreResultsPerSection[key]).toBeUndefined();
    }
    // at_a_glance received the 8 core results keyed by section name.
    const agCore = seenCoreResultsPerSection.at_a_glance as
      | Record<string, unknown>
      | undefined;
    expect(agCore).toBeDefined();
    expect(Object.keys(agCore!)).toEqual(
      expect.arrayContaining([
        'project_areas',
        'interaction_style',
        'what_works',
        'friction_analysis',
        'suggestions',
        'feature_adoption_audit',
        'on_the_horizon',
        'fun_ending',
      ]),
    );
    expect(agCore!.project_areas).toEqual({ section: 'project_areas', ok: true });
  });

  it('passes null entries for failed core sections to at_a_glance', async () => {
    let atGlanceCoreResults: Record<string, unknown> | undefined;

    const invoker: BedrockInvoker = async (args) => {
      if (args.section === 'at_a_glance') {
        atGlanceCoreResults = (args as unknown as {
          coreResults?: Record<string, unknown>;
        }).coreResults;
        return `{"section":"at_a_glance"}`;
      }
      // Fail 3 sections, 5 succeed → gate opens (≥4 succeed).
      if (['suggestions', 'friction_analysis', 'fun_ending'].includes(args.section)) {
        return 'no json';
      }
      return `{"section":"${args.section}"}`;
    };

    await generatePerUserInsights({
      userId: 'u1',
      dataContext: {},
      facets: [],
      invoker,
    });

    expect(atGlanceCoreResults).toBeDefined();
    expect(atGlanceCoreResults!.suggestions).toBeNull();
    expect(atGlanceCoreResults!.friction_analysis).toBeNull();
    expect(atGlanceCoreResults!.project_areas).not.toBeNull();
  });
});

describe('computeUid8 — 9.5 Hashed UserId (§0 Glossary)', () => {
  it('returns an 8-char lowercase hex string', () => {
    const uid8 = computeUid8('bob@whchoi.net');
    expect(uid8).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for the same userId', () => {
    expect(computeUid8('u1')).toBe(computeUid8('u1'));
  });

  it('differs between different userIds', () => {
    expect(computeUid8('A')).not.toBe(computeUid8('B'));
  });

  it('matches sha256(userId).hex()[:8]', () => {
    // Cross-check with Node's built-in crypto
    const crypto = require('crypto');
    const expected = crypto
      .createHash('sha256')
      .update('u1', 'utf8')
      .digest('hex')
      .slice(0, 8);
    expect(computeUid8('u1')).toBe(expected);
  });
});

describe('createBedrockInvoker — 9.6 region', () => {
  it('BEDROCK_REGION constant equals ap-northeast-2 (matches /api/analyze)', () => {
    expect(BEDROCK_REGION).toBe('ap-northeast-2');
  });

  it('builds a client configured with the correct region', () => {
    const invoker = createBedrockInvoker({ modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0' });
    // We can't peek at the underlying SDK config without an actual call; instead
    // assert the factory binds the region on the returned metadata.
    expect(invoker.region).toBe('ap-northeast-2');
  });
});

describe('validateModelId — 9.7 SC9', () => {
  it('accepts fully-qualified Bedrock model ids', () => {
    expect(validateModelId('anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
    expect(validateModelId('anthropic.claude-opus-4-5-20250929-v1:0')).toBe(true);
    expect(validateModelId('amazon.titan-embed-text-v2:0')).toBe(true);
  });

  it('accepts cross-region inference profile ids with global./us./apac. prefix', () => {
    expect(validateModelId('global.anthropic.claude-opus-4-7')).toBe(true);
    expect(validateModelId('global.anthropic.claude-opus-4-7[1m]')).toBe(true);
    expect(validateModelId('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
  });

  it('rejects aliases like "sonnet" / "opus" / "titan"', () => {
    expect(validateModelId('sonnet')).toBe(false);
    expect(validateModelId('opus')).toBe(false);
    expect(validateModelId('titan')).toBe(false);
  });

  it('rejects empty string or non-string inputs', () => {
    expect(validateModelId('')).toBe(false);
    expect(validateModelId(null as unknown as string)).toBe(false);
    expect(validateModelId(undefined as unknown as string)).toBe(false);
  });
});

describe('createBedrockInvoker — invalid modelId guard', () => {
  it('throws on aliases (SC9 early fail)', () => {
    expect(() => createBedrockInvoker({ modelId: 'sonnet' })).toThrow(/invalid modelId/);
  });
});
