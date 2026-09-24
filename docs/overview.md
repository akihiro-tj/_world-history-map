# コードベース概要

> Last updated: 2026-09-24T00:00:00+09:00

## このアプリは何か

世界史学習者がブラウザ上で「任意の年の世界地図」を開き、領土を選ぶとその土地の概況・年表を読める、インタラクティブな世界史地図アプリ。教科書を縦（時代）と横（同時代の各地域）に跨いで読む負担を、単一のマップ UI に置き換える。

## アプリ構成

```
   aourednik/historical-basemaps (GitHub)
              │  GeoJSON (年別)
              ▼
         ┌──────────┐
         │ pipeline │  Notion DB (領土説明)
         └──────────┘       │
          │      │          ▼
          │      └──>  descriptions/{year}.json
          │                   (frontend/public/data)
          ▼
   packages/tiles/src/pmtiles/
   world_{year}.pmtiles  ←─ git 管理（raw binary）
          │  pnpm build
          ▼
   packages/tiles/src/manifest.ts  ←─ git 管理（ビルド時 import）
   packages/tiles/dist/world_{year}.{hash}.pmtiles
          │
          ├──[dev]──> vite dev middleware → frontend
          └──[CI]──> R2 bucket (dev/prod) ──> worker (Pages Function) ──> frontend
```

pipeline は上流 GeoJSON と Notion DB を取り込み、PMTiles タイルと JSON 説明文を生成する。
タイルは `packages/tiles` で SHA-256 ハッシュ付きに変換され、`manifest.ts` が年 → ファイル名のマッピングを保持する。
frontend はビルド時に `manifest.ts` を import し、開発時は vite middleware 経由でローカルの dist/ からタイルを読む。本番・preview は同一オリジンの Pages Function 経由で R2 から配信する。
領土説明 JSON は環境に関わらず `frontend/public/data/descriptions/` に常駐する静的ファイル。

## データの流れ

pipeline: `historical-basemaps` を git clone し、年ごとの GeoJSON を同名領土でマージ → tippecanoe で PMTiles に変換 → SHA-256 ハッシュ付きファイル名 (`world_{year}.{hash}.pmtiles`) で書き出し、R2 にアップロード。Notion から領土説明を同期して `descriptions/{year}.json` に落とす。詳細は [pipeline.md](./pipeline.md) を参照。

frontend: React + MapLibre GL JS (react-map-gl) で地図を描画。`@world-history-map/tiles` から `manifest`（年 → ハッシュ付きファイル名）をビルド時 import し、`index.json`・`color-scheme.json` をロードして選択年のタイル URL を組み立てて PMTiles プロトコルで読む。領土クリックで kebab-case 化した名前をキーに `descriptions/{year}.json` を引き、パネルに表示する。詳細は [frontend.md](./frontend.md) を参照。

worker: Cloudflare Pages プロジェクトの設定（`wrangler.toml`）と Pages Functions。frontend の静的アセットと同一オリジンで `/pmtiles/*.pmtiles` を R2 バインディング経由で配信する。Range Request に対応し、ハッシュ付き PMTiles は immutable キャッシュで返す。production / preview で R2 バケットを切り替える。詳細は [worker.md](./worker.md) を参照。

## 中核の型

pipeline と frontend で事実上共有される型。共有パッケージはなく、`public/data/` 配下の JSON が双方の契約。

`YearEntry` — year, filename, countries
`YearIndex` — years
`TerritoryDescription` — name, era, profile, context, keyEvents
`TerritoryProfile` — capital, regime, dynasty, leader, religion
`KeyEvent` — year, event

`YearEntry.year` は frontend 側で `HistoricalYear`（number の branded 型）として扱われる。
領土説明の辞書キーは GeoJSON の `NAME` プロパティを kebab-case 化したもの。

## データファイル（public/data/）

- `index.json` — 収録されている年と各年の領土一覧（`YearIndex`）。YearSelector の表示源
- `color-scheme.json` — 領土名 → HEX カラーのマッピング。地図の塗り分けに使う
- `descriptions/{year}.json` — 年単位の領土説明バンドル（`YearDescriptionBundle`）。Notion から同期
- `pmtiles/index.json` — `YearIndex` 形式の年リスト。`loader.ts` が `/pmtiles/index.json` として fetch する。`packages/tiles/src/pmtiles/index.json` が源泉で、tiles build 時に `dist/` へコピーされ、dev では vite middleware、prod では Vite build plugin 経由で配信される

## タイル配信とロールバック

タイルの年 → ハッシュ付きファイル名のマッピングは `packages/tiles/src/manifest.ts` に git 管理されており、frontend ビルド時に静的 import される（runtime fetch しない）。

**デプロイフロー**: `pnpm pipeline run` でタイルを生成 → `pnpm --filter @world-history-map/tiles run build` で manifest.ts を更新 → `git commit && git push` で PR → CI が R2 に差分 upload → CI が frontend をビルドして `wrangler pages deploy` で preview（PR）/ production（main マージ）に配信する。R2 upload の後に Pages deploy が走るのでfrontend と R2 は同一コミットで揃い、不整合ウィンドウが生じない。

**ロールバック**: `git revert <bad-commit>` で manifest.ts が戻る → CI が旧ハッシュの PMTiles を R2 に差分 upload → Pages が旧状態で再ビルドされる。旧ハッシュの PMTiles は直近 N=3 コミット分（manifest.ts が変化したコミット単位）が R2 に保持されているため、追加操作なしでロールバックが成立する。
