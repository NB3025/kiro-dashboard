// Regression tests for at_a_glance rendering. Fixes the recurring
// React #31 "Objects are not valid as a React child" crash that occurs when
// the LLM ignores the string-only schema and returns objects/arrays in
// quick_wins / ambitious_workflows / whats_working / whats_hindering.
import { renderGlanceField } from './glance-render';

describe('renderGlanceField', () => {
  it('returns strings unchanged', () => {
    expect(renderGlanceField('hello')).toBe('hello');
  });

  it('returns empty string for null/undefined', () => {
    expect(renderGlanceField(null)).toBe('');
    expect(renderGlanceField(undefined)).toBe('');
  });

  it('flattens an array of strings as newline-joined bullets', () => {
    expect(renderGlanceField(['첫째', '둘째'])).toBe('• 첫째\n• 둘째');
  });

  it('renders an object with title/rationale as a single line', () => {
    const o = { type: 'steering', title: '제목', rationale: '이유' };
    const out = renderGlanceField(o);
    expect(out).toContain('제목');
    expect(out).toContain('이유');
  });

  it('renders an array of title/rationale objects as bullets', () => {
    const arr = [
      { type: 'steering', title: 'a', rationale: 'ra' },
      { type: 'hook', title: 'b', rationale: 'rb' },
    ];
    const out = renderGlanceField(arr);
    expect(out.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(2);
    expect(out).toContain('a');
    expect(out).toContain('ra');
    expect(out).toContain('b');
  });

  it('falls back to JSON for objects without title/rationale', () => {
    const out = renderGlanceField({ foo: 'bar' });
    expect(out).toContain('foo');
    expect(out).toContain('bar');
  });

  it('never returns a value that is not a string', () => {
    const probes: unknown[] = [
      0, 1, true, false, {}, [], [1, 2], { a: 1 }, [{}], null, undefined,
    ];
    for (const p of probes) {
      expect(typeof renderGlanceField(p)).toBe('string');
    }
  });
});
