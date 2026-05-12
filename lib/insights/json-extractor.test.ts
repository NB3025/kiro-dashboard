import { extractJson } from './json-extractor';

describe('extractJson', () => {
  it('extracts JSON object from surrounding prose', () => {
    const text = 'Sure! Here is the result: { "foo": 1, "bar": "b" } Done.';
    expect(extractJson(text)).toEqual({ foo: 1, bar: 'b' });
  });

  it('extracts the outermost object greedily when multiple braces exist', () => {
    const text = 'prefix { "outer": { "inner": 42 } } suffix';
    expect(extractJson(text)).toEqual({ outer: { inner: 42 } });
  });

  it('returns null when no braces found', () => {
    expect(extractJson('plain text with no braces')).toBeNull();
  });

  it('returns null when JSON is structurally invalid', () => {
    expect(extractJson('{ not json }')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractJson('')).toBeNull();
  });
});
