# worker: Cloudflare Pages プロジェクト（Pages Functions）

> Last updated: 2026-09-24T00:00:00+09:00

## 役割

Cloudflare 上の配信設定をすべて git 管理下に置くデプロイ単位。`apps/worker/wrangler.toml` が Cloudflare Pages プロジェクト `world-history-map` を定義し、frontend のビルド成果物（`apps/frontend/dist`）を静的アセットとして、R2 バケットに置かれた PMTiles を Pages Function 経由で、**同一オリジン**から配信する。ブラウザに対して直接 R2 を晒さず、キャッシュヘッダをここで統制する。HTTP Range Request を素通しで R2 の部分読み取りに橋渡しし、PMTiles プロトコルの「タイル単位で範囲を取る」アクセスパターンを成立させる。

同一オリジン配信なので CORS 設定や frontend 側のタイル配信 URL 設定（`VITE_TILES_BASE_URL`）は不要。タイルの年 → ハッシュ付きファイル名マッピング（manifest）は frontend のビルド時に `@world-history-map/tiles` から静的 import される。

## エンドポイント

`/pmtiles/:file` — `functions/pmtiles/[file].ts`。

- `file` が `.pmtiles` で終わる場合、R2 のキーとして `BUCKET.get(file)` に渡す（R2 のキーはハッシュ付きファイル名そのもの）。`Range` ヘッダがあれば `bytes=start-end` をパースして `{ offset, length }` を R2 に渡し、206 Partial Content で応答する。範囲なしリクエストは 200 で全バイト。GET / HEAD 以外は 405
- それ以外（`/pmtiles/index.json` など）は `context.next()` で静的アセットにフォールスルーする

その他のパスはすべて Pages の静的アセット配信が担う。配信ロジック本体は `src/pmtiles.ts` にあり、`tests/` でユニットテストしている。

## キャッシュ戦略

- PMTiles ファイル — `Cache-Control: public, max-age=31536000, immutable`。ハッシュ付きファイル名が cache buster として機能するため、長期キャッシュして問題ない
- 404（ファイルなし） — `public, max-age=60`

## バインディングと環境

| 環境 | URL | R2 バケット |
|---|---|---|
| production（ブランチ `main`） | `https://world-history-map.pages.dev` | `world-history-map-tiles-prod` |
| preview（その他のブランチ） | `https://<branch>.world-history-map.pages.dev` | `world-history-map-tiles-dev` |

- `BUCKET` — R2 バインディング。トップレベル（preview / `wrangler pages dev`）が dev バケット、`[env.production]` が prod バケットを指す
- R2 バケット自体は `wrangler pages deploy` では作られない。既存のバケットを前提とする

## デプロイ

`tiles-deploy.yml` が CI で自動実行する: R2 への差分 upload → `pnpm build` → Pages プロジェクトが無ければ `wrangler pages project create` → `wrangler pages deploy --branch <branch>`。PR は preview、`main` への push は production に配信される。Pages は Direct Upload プロジェクトなので、ダッシュボードでのビルド設定・Git 連携・Deploy Hook は使わない。

CI に必要な GitHub Secrets:

- `CLOUDFLARE_API_TOKEN` — Account 権限 `Cloudflare Pages: Edit` と `Workers R2 Storage: Edit`
- `CLOUDFLARE_ACCOUNT_ID`

手動で配信する場合:

```bash
pnpm build
pnpm --filter @world-history-map/worker run project:create   # 初回のみ
pnpm --filter @world-history-map/worker exec wrangler pages deploy --branch main
```

ローカルで Cloudflare 上と同じ構成を確認する場合は `pnpm build` の後に `pnpm --filter @world-history-map/worker run dev`（`wrangler pages dev`、R2 はローカルエミュレーション）。
