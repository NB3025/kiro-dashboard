jest.mock('../athena', () => ({
  executeQuery: jest.fn(),
  NORMALIZE_USERID: 'REGEXP_REPLACE(userid, \'^d-[a-z0-9]+\\.\', \'\')',
}));

import {
  isPromptLogsConfigured,
  buildNotConfiguredResponse,
  validateDaysParam,
  listUsersWithFacets,
  streamSseSections,
  extractViewerFromHeaders,
  buildAuditEvent,
} from './api-helpers';

const { executeQuery } = jest.requireMock('../athena') as {
  executeQuery: jest.Mock;
};

describe('isPromptLogsConfigured (EARS-S8-01~07)', () => {
  const orig = process.env.PROMPT_LOGS_BUCKET;

  afterEach(() => {
    if (orig === undefined) delete process.env.PROMPT_LOGS_BUCKET;
    else process.env.PROMPT_LOGS_BUCKET = orig;
  });

  it('returns false when PROMPT_LOGS_BUCKET is not set', () => {
    delete process.env.PROMPT_LOGS_BUCKET;
    expect(isPromptLogsConfigured()).toBe(false);
  });

  it('returns false when PROMPT_LOGS_BUCKET is empty string', () => {
    process.env.PROMPT_LOGS_BUCKET = '';
    expect(isPromptLogsConfigured()).toBe(false);
  });

  it('returns true when PROMPT_LOGS_BUCKET has a value', () => {
    process.env.PROMPT_LOGS_BUCKET = 'my-kiro-logging';
    expect(isPromptLogsConfigured()).toBe(true);
  });
});

describe('buildNotConfiguredResponse (Phase 11.1a)', () => {
  it('builds users-with-facets shape', () => {
    expect(buildNotConfiguredResponse('users-with-facets')).toEqual({
      data: [],
      not_configured: true,
    });
  });

  it('builds user shape', () => {
    expect(buildNotConfiguredResponse('user')).toEqual({
      bundle: null,
      not_configured: true,
    });
  });
});

describe('validateDaysParam (FR-INS-7)', () => {
  it.each([7, 30, 90])('accepts %i', (d) => {
    const out = validateDaysParam(String(d));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.days).toBe(d);
  });

  it('rejects 45', () => {
    const out = validateDaysParam('45');
    expect(out.ok).toBe(false);
  });

  it('rejects null or non-numeric', () => {
    expect(validateDaysParam(null).ok).toBe(false);
    expect(validateDaysParam('abc').ok).toBe(false);
  });
});

describe('listUsersWithFacets (11.1)', () => {
  beforeEach(() => executeQuery.mockReset());

  it('maps Athena rows to UserWithFacetsRow shape', async () => {
    executeQuery.mockResolvedValue([
      { userid: 'u1', session_count: '10', friction_total: '5', suggestion_count: '2' },
      { userid: 'u2', session_count: '3', friction_total: '0', suggestion_count: '1' },
    ]);
    const out = await listUsersWithFacets(30);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      userid: 'u1',
      session_count: 10,
      friction_total: 5,
      suggestion_count: 2,
    });
  });

  it('returns empty array when Athena has no rows', async () => {
    executeQuery.mockResolvedValue([]);
    expect(await listUsersWithFacets(30)).toEqual([]);
  });
});

describe('streamSseSections (11.3/11.4)', () => {
  async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const out: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(decoder.decode(value));
    }
    return out;
  }

  it('emits one SSE event per section in order', async () => {
    const stream = streamSseSections({
      sections: [
        { key: 'a', data: { v: 1 } },
        { key: 'b', data: { v: 2 } },
      ],
    });

    const chunks = await collect(stream);
    const joined = chunks.join('');
    expect(joined).toContain('event: section\n');
    expect(joined).toContain('"key":"a"');
    expect(joined).toContain('"key":"b"');
    expect(joined.indexOf('"key":"a"')).toBeLessThan(joined.indexOf('"key":"b"'));
  });

  it('ends with a done event', async () => {
    const stream = streamSseSections({ sections: [{ key: 'a', data: 1 }] });
    const joined = (await collect(stream)).join('');
    expect(joined).toMatch(/event: done\s*\ndata: {}\s*\n\n$/);
  });
});

describe('extractViewerFromHeaders (FR-SEC-5, 11.11+11.12)', () => {
  it('returns the X-User-Email value when present', () => {
    const h = new Headers({ 'x-user-email': 'admin@whchoi.net' });
    expect(extractViewerFromHeaders(h)).toBe('admin@whchoi.net');
  });

  it('falls back to "unknown_admin" when header is absent', () => {
    const h = new Headers();
    expect(extractViewerFromHeaders(h)).toBe('unknown_admin');
  });

  it('falls back when header is empty string', () => {
    const h = new Headers({ 'x-user-email': '' });
    expect(extractViewerFromHeaders(h)).toBe('unknown_admin');
  });
});

describe('buildAuditEvent (FR-SEC-5)', () => {
  it('produces a JSON-serializable audit record with required fields', () => {
    const evt = buildAuditEvent({
      viewer: 'admin@whchoi.net',
      action: 'view_user_bundle',
      targetUserId: 'u1',
    });
    expect(evt.viewer).toBe('admin@whchoi.net');
    expect(evt.action).toBe('view_user_bundle');
    expect(evt.target_user_id).toBe('u1');
    expect(typeof evt.ts).toBe('string');
    expect(() => JSON.stringify(evt)).not.toThrow();
  });
});
