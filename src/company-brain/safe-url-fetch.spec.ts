import { BadRequestException } from '@nestjs/common';
import { assertSafeHttpUrl, safeFetchText } from './safe-url-fetch';

describe('safe-url-fetch', () => {
  it('rejects non-http schemes', () => {
    expect(() => assertSafeHttpUrl('file:///etc/passwd')).toThrow(BadRequestException);
    expect(() => assertSafeHttpUrl('ftp://example.com')).toThrow(BadRequestException);
  });

  it('rejects localhost and loopback', () => {
    expect(() => assertSafeHttpUrl('http://localhost/x')).toThrow(BadRequestException);
    expect(() => assertSafeHttpUrl('http://127.0.0.1/x')).toThrow(BadRequestException);
    expect(() => assertSafeHttpUrl('http://[::1]/')).toThrow(BadRequestException);
  });

  it('rejects private RFC1918 and link-local / metadata', () => {
    expect(() => assertSafeHttpUrl('http://10.0.0.5/')).toThrow(BadRequestException);
    expect(() => assertSafeHttpUrl('http://192.168.1.1/')).toThrow(BadRequestException);
    expect(() => assertSafeHttpUrl('http://172.16.0.1/')).toThrow(BadRequestException);
    expect(() => assertSafeHttpUrl('http://169.254.169.254/latest')).toThrow(BadRequestException);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(() => assertSafeHttpUrl('https://user:pass@example.com')).toThrow(BadRequestException);
  });

  it('allows public https URLs at parse time', () => {
    const url = assertSafeHttpUrl('https://example.com/about');
    expect(url.hostname).toBe('example.com');
  });

  it('enforces size limit via fetchImpl', async () => {
    const big = 'x'.repeat(600_000);
    await expect(
      safeFetchText('https://example.com/page', {
        maxBytes: 1000,
        fetchImpl: (async () =>
          new Response(big, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          })) as typeof fetch,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('follows limited redirects to safe hosts', async () => {
    let calls = 0;
    const result = await safeFetchText('https://example.com/start', {
      maxRedirects: 2,
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://example.com/final' },
          });
        }
        return new Response('hello brain', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }) as typeof fetch,
    });
    expect(result.text).toBe('hello brain');
    expect(result.finalUrl).toBe('https://example.com/final');
  });
});
