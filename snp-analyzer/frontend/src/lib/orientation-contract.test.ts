import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';

function stubFetch() {
  const fetcher = vi.fn<(url: string) => Promise<Response>>().mockImplementation(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

describe('orientation query', () => {
  it('is sent to PDF, PPTX, PNG zip and XLSX only when given', async () => {
    const fetcher = stubFetch();
    await api.exportPdf('s', undefined, undefined, undefined, undefined, undefined, 'allele2_x');
    await api.exportPptx('s', undefined, undefined, undefined, undefined, undefined, undefined, 'allele2_x');
    await api.exportScatterZip('s', undefined, undefined, undefined, undefined, undefined, 'allele2_x');
    await api.exportXlsx('s', undefined, undefined, undefined, undefined, undefined, 'allele2_x');
    await api.exportPdf('s');
    const urls = fetcher.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/export/pdf?orientation=allele2_x');
    expect(urls[1]).toContain('/export/pptx?orientation=allele2_x');
    expect(urls[2]).toContain('/export/scatter-png.zip?orientation=allele2_x');
    expect(urls[3]).toContain('/export/xlsx?orientation=allele2_x');
    expect(urls[4]).not.toContain('orientation');
  });
});
