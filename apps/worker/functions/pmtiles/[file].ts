import { isPMTilesKey, servePMTiles } from '../../src/pmtiles';

interface Env {
  BUCKET: R2Bucket;
}

// WHY: Same path the Vite dev middleware serves, so the frontend's tile URLs
// (pmtiles:///pmtiles/{file}) resolve same-origin in dev, preview and production.
// Non-PMTiles paths (e.g. /pmtiles/index.json) fall through to static assets.
export const onRequest: PagesFunction<Env, 'file'> = (context) => {
  const key = String(context.params.file);
  if (!isPMTilesKey(key)) return context.next();
  return servePMTiles(context.request, context.env.BUCKET, key);
};
