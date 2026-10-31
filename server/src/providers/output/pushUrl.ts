const PUSH_PROTOCOLS = new Set(['rtmp:', 'rtmps:']);

export function buildPushUrl(serverUrl: string, streamKey: string): string {
  const base = serverUrl.trim();
  const key = streamKey.trim();
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('invalid_push_url');
  }
  if (!PUSH_PROTOCOLS.has(url.protocol)) throw new Error('invalid_push_url');
  if (!key) {
    if (url.pathname === '/' || url.pathname === '') throw new Error('invalid_push_url');
    return url.toString();
  }
  const path = url.pathname.replace(/\/$/, '');
  if (key.includes('?') || key.includes('/')) {
    const splitAt = key.indexOf('?');
    const pathPart = (splitAt === -1 ? key : key.slice(0, splitAt)).replace(/^\//, '');
    const query = splitAt === -1 ? '' : key.slice(splitAt + 1);
    url.pathname = `${path}/${pathPart}`;
    url.search = query ? `?${query}` : '';
    return url.toString();
  }
  url.pathname = `${path}/${encodeURIComponent(key)}`;
  url.search = '';
  return url.toString();
}

export function redactPushUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    if (parts.length > 1 && parts[parts.length - 1]) parts[parts.length - 1] = '***';
    parsed.pathname = parts.join('/');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return 'rtmp://***';
  }
}

export function safeDetail(text: string, secrets: string[]): string {
  let out = text.replace(/\s+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('***');
  }
  return out.slice(0, 180);
}
