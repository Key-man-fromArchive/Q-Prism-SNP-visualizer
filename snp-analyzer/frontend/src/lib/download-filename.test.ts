import { describe, expect, it, vi, afterEach } from 'vitest';
import { filenameFromDisposition } from './download-filename';
import * as api from './api';

describe('filenameFromDisposition', () => {
  it('prefers the RFC 5987 filename* over filename=', () => {
    expect(filenameFromDisposition(`attachment; filename="fallback.pdf"; filename*=UTF-8''%EB%A7%88%EC%BB%A4_A.pdf`)).toBe('마커_A.pdf');
  });
  it('falls back to quoted and bare filename=', () => {
    expect(filenameFromDisposition('attachment; filename="rs123.xlsx"')).toBe('rs123.xlsx');
    expect(filenameFromDisposition('attachment; filename=rs123.zip')).toBe('rs123.zip');
  });
  it('strips path characters', () => {
    expect(filenameFromDisposition('attachment; filename="../etc/pass.pdf"')).toBe('pass.pdf');
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''..%2F..%2Fx%5Cy.pdf`)).toBe('y.pdf');
  });
  it('returns undefined for a missing, empty or unparsable header', () => {
    expect(filenameFromDisposition(null)).toBeUndefined();
    expect(filenameFromDisposition('attachment')).toBeUndefined();
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A`)).toBeUndefined();
    expect(filenameFromDisposition('attachment; filename=""')).toBeUndefined();
  });
});

describe('export api returns the server filename', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('pairs the blob with the Content-Disposition name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', {
      headers: { 'Content-Disposition': `attachment; filename*=UTF-8''rs1_report.pdf` },
    })));
    const file = await api.exportPdf('s');
    expect(file.filename).toBe('rs1_report.pdf');
    expect(file.blob.size).toBe(1);
  });
  it('leaves filename undefined without a header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x')));
    expect((await api.exportXlsx('s')).filename).toBeUndefined();
  });
});
