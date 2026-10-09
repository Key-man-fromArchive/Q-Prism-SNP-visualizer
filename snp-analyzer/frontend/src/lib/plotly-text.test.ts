import { describe, expect, it } from 'vitest';
import { plotlyText } from './plotly-text';

describe('plotlyText', () => {
  it('leaves ordinary names unchanged', () => {
    for (const name of ['Sample 1', 'A01', 'FAM (WT)', 'Allele 1 / ≤ 3', '표본 가', 'x_y-z.1']) {
      expect(plotlyText(name)).toBe(name);
    }
  });

  it('shows angle brackets literally', () => {
    expect(plotlyText('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(plotlyText('a<br>b')).toBe('a&lt;br&gt;b');
  });

  it('shows template placeholders literally', () => {
    expect(plotlyText('%{y}')).toBe('&#37;{y}');
    expect(plotlyText('100%')).toBe('100&#37;');
  });

  it('escapes ampersands first so entities are not double decoded', () => {
    expect(plotlyText('&lt;')).toBe('&amp;lt;');
    expect(plotlyText('a & b')).toBe('a &amp; b');
  });

  it('handles an empty string', () => {
    expect(plotlyText('')).toBe('');
  });
});
