import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

const METADATA_IPS = new Set(['169.254.169.254', 'fd00:ec2::254']);

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
};

export type SafeFetchResult = {
  finalUrl: string;
  contentType: string | null;
  text: string;
  fetchedAt: Date;
};

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (normalized.startsWith('fe80')) return true; // link-local
  return false;
}

export function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http/https URLs are allowed');
  }

  if (url.username || url.password) {
    throw new BadRequestException('URLs with credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new BadRequestException('URL host is not allowed');
  }
  if (BLOCKED_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    throw new BadRequestException('URL host is not allowed');
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    if (METADATA_IPS.has(hostname) || isPrivateIpv4(hostname)) {
      throw new BadRequestException('Private or metadata IP addresses are not allowed');
    }
  } else if (ipVersion === 6) {
    if (METADATA_IPS.has(hostname) || isPrivateIpv6(hostname)) {
      throw new BadRequestException('Private or metadata IP addresses are not allowed');
    }
  }

  return url;
}

async function assertResolvedAddressIsPublic(hostname: string): Promise<void> {
  if (isIP(hostname)) return;
  let records: { address: string; family: number }[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException('Unable to resolve URL host');
  }
  if (!records.length) {
    throw new BadRequestException('Unable to resolve URL host');
  }
  for (const record of records) {
    if (METADATA_IPS.has(record.address)) {
      throw new BadRequestException('Resolved host points to a metadata endpoint');
    }
    if (record.family === 4 && isPrivateIpv4(record.address)) {
      throw new BadRequestException('Resolved host points to a private network');
    }
    if (record.family === 6 && isPrivateIpv6(record.address)) {
      throw new BadRequestException('Resolved host points to a private network');
    }
  }
}

/**
 * SSRF-safe HTTP(S) fetch for Company Brain website/URL ingestion.
 * Rejects localhost, private RFC1918, link-local, cloud metadata, and non-http(s).
 */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 512_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const fetchImpl = options.fetchImpl ?? fetch;

  let current = assertSafeHttpUrl(rawUrl);
  await assertResolvedAddressIsPublic(current.hostname);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'User-Agent': 'ZEX-Platform-CompanyBrain/1.0',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error)?.name === 'AbortError') {
        throw new BadRequestException('URL fetch timed out');
      }
      throw new BadRequestException('URL fetch failed');
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new BadRequestException('Redirect missing location');
      if (redirectCount === maxRedirects) {
        throw new BadRequestException('Too many redirects');
      }
      current = assertSafeHttpUrl(new URL(location, current).toString());
      await assertResolvedAddressIsPublic(current.hostname);
      continue;
    }

    if (!response.ok) {
      throw new BadRequestException(`URL fetch returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (
      contentType &&
      !/text\/|application\/(json|xml|javascript|xhtml)/i.test(contentType) &&
      !/charset=/i.test(contentType)
    ) {
      throw new BadRequestException('Unsupported content type for Company Brain ingestion');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new BadRequestException('URL response exceeds size limit');
    }

    const text = buffer.toString('utf8');
    return {
      finalUrl: current.toString(),
      contentType,
      text,
      fetchedAt: new Date(),
    };
  }

  throw new BadRequestException('Too many redirects');
}
