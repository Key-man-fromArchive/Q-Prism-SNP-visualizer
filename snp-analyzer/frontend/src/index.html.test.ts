import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// P6-S3-T1: the app shipped with no favicon at all. The brand kit already
// has favicon-32.png / apple-touch-icon-180.png in public/ (imported by
// P6-S1-T1); index.html just needs to reference them.

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

describe('index.html favicon links (P6-S3-T1)', () => {
  it('links the 32x32 favicon', () => {
    expect(html).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon-32\.png"/);
  });

  it('links the 180x180 apple touch icon', () => {
    expect(html).toMatch(/<link[^>]*rel="apple-touch-icon"[^>]*href="\/apple-touch-icon-180\.png"/);
  });
});
