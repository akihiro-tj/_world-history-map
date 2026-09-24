const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

type ByteRange = { offset: number; length: number };

function parseRange(rangeHeader: string | null): ByteRange | undefined {
  if (!rangeHeader) return undefined;
  const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
  if (!match) return undefined;
  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : undefined;
  return {
    offset: start,
    length: end !== undefined ? end - start + 1 : 1,
  };
}

export function isPMTilesKey(key: string): boolean {
  return key.endsWith('.pmtiles') && !key.includes('/');
}

// Serves a PMTiles object from R2, bridging HTTP Range requests to R2 partial reads
// so the PMTiles protocol can fetch individual tiles.
export async function servePMTiles(
  request: Request,
  bucket: R2Bucket,
  key: string,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return new Response(undefined, { status: 405 });

  const rangeHeader = request.headers.get('Range');
  const range = parseRange(rangeHeader);

  const obj = await bucket.get(key, range ? { range } : undefined);
  if (!obj) {
    return new Response('File not found', {
      headers: { 'Cache-Control': NOT_FOUND_CACHE_CONTROL },
      status: 404,
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);

  if (rangeHeader && obj.range) {
    const byteRange = obj.range as ByteRange;
    headers.set(
      'Content-Range',
      `bytes ${byteRange.offset}-${byteRange.offset + byteRange.length - 1}/${obj.size}`,
    );
    headers.set('Content-Length', String(byteRange.length));
    return new Response(obj.body, { headers, status: 206 });
  }

  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers, status: 200 });
}
