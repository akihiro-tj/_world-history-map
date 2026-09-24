import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../functions/pmtiles/[file]';

const TILE_KEY = 'world_1600.abc123.pmtiles';
const TILE_BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

type Context = Parameters<typeof onRequest>[0];

function createContext(file: string, init?: RequestInit) {
  const bucket = {
    get: vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
      if (key !== TILE_KEY) return null;
      const range = options?.range;
      const body = range ? TILE_BYTES.slice(range.offset, range.offset + range.length) : TILE_BYTES;
      return { body, range, size: TILE_BYTES.length };
    }),
  };
  const next = vi.fn(async () => new Response('asset', { status: 200 }));
  const context = {
    request: new Request(`https://example.com/pmtiles/${file}`, init),
    env: { BUCKET: bucket },
    params: { file },
    next,
  } as unknown as Context;
  return { bucket, context, next };
}

describe('GET /pmtiles/:file', () => {
  it('serves a whole PMTiles file from R2', async () => {
    const { bucket, context } = createContext(TILE_KEY);
    const res = await onRequest(context);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Length')).toBe(String(TILE_BYTES.length));
    expect(bucket.get).toHaveBeenCalledWith(TILE_KEY, undefined);
  });

  it('serves a byte range with 206 Partial Content', async () => {
    const { context } = createContext(TILE_KEY, { headers: { Range: 'bytes=2-5' } });
    const res = await onRequest(context);

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
  });

  it('returns a short-lived 404 for a missing tile', async () => {
    const { context } = createContext('world_9999.missing.pmtiles');
    const res = await onRequest(context);

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('rejects non-GET requests', async () => {
    const { bucket, context } = createContext(TILE_KEY, { method: 'POST' });
    const res = await onRequest(context);

    expect(res.status).toBe(405);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it('falls through to static assets for non-PMTiles files such as index.json', async () => {
    const { bucket, context, next } = createContext('index.json');
    const res = await onRequest(context);

    expect(await res.text()).toBe('asset');
    expect(next).toHaveBeenCalledOnce();
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
