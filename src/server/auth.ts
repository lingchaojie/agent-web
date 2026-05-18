import { timingSafeEqual } from 'node:crypto';

export function getBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  const actualToken = getBearerToken(header);
  return isTokenMatch(actualToken, expectedToken);
}

export function getWebSocketProtocolToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return null;

  for (const protocol of raw.split(',')) {
    const trimmed = protocol.trim();
    if (!trimmed.startsWith('token.')) continue;

    try {
      const token = Buffer.from(trimmed.slice('token.'.length), 'base64url').toString('utf8');
      return token || null;
    } catch {
      return null;
    }
  }

  return null;
}

export function isWebSocketProtocolAuthorized(header: string | string[] | undefined, expectedToken: string): boolean {
  return isTokenMatch(getWebSocketProtocolToken(header), expectedToken);
}

function isTokenMatch(actualToken: string | null, expectedToken: string): boolean {
  if (!actualToken) return false;

  const actual = Buffer.from(actualToken);
  const expected = Buffer.from(expectedToken);
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}
