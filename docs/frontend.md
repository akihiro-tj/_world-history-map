# frontend: React アプリケーション

> Last updated: 2026-09-24T00:00:00+09:00

## 役割

React + MapLibre GL JS の SPA。任意の歴史年を選ぶとその年の世界地図を PMTiles で描画し、領土をクリックすると Notion 由来の概況・年表を読めるパネルが開く。
静的ホスティング（Cloudflare Pages）で配信する単一ページアプリ。タイルの年 → ハッシュ付きファイル名マッピングは `@world-history-map/tiles` から **ビルド時に import** され、runtime fetch しない。タイル本体は dev 時は vite middleware（`packages/tiles/dist/`）から、prod / preview 時は同一オリジンの Pages Function（`/pmtiles/*`）経由で R2 から読む。

## 状態設計

```
 ┌────────────────────────────────────────────────────┐
 │ AppStateProvider                                   │
 │   state: selectedYear / selectedTerritory /        │
 │          isInfoPanelOpen / isSummaryPanelOpen /     │
 │          mapView                                   │
 │                                                    │
 │   ┌────────────────────────────────────────────┐   │
 │   │ ProjectionProvider                         │   │
 │   │   projection: 'mercator' | 'globe'         │   │
 │   │                                            │   │
 │   │   AppContent  ──>  MapView, YearSelector,  │   │
 │   │                    TerritoryInfoPanel,      │   │
 │   │                    EraSummaryPanel,         │   │
 │   │                    SummaryTrigger …        │   │
 │   └────────────────────────────────────────────┘   │
 └────────────────────────────────────────────────────┘

 MapView 内:
   useMapData(year)       → manifest / index / colorScheme / pmtilesUrl
   usePMTilesProtocol()   → maplibre に pmtiles:// を登録
   useProjection(ref)     → MapLibre.setProjection + flyTo 補助
   useMapHover/Keyboard   → 入力系の副作用
```

上層は React の Context が持つ UI 状態、中層はフェッチ結果を抱えるカスタム hook のローカル state、下層は MapLibre のインスタンス内部状態（投影・カメラ）。MapView は上層の `state.selectedYear` を見て下層のタイル読み込みを駆動する。

## Context と hooks

`AppStateContext` (`useAppState`) — `useReducer` ベースの UI 状態管理。アクションは `setSelectedYear` / `selectTerritory` / `clearSelection` / `setMapView` / `openSummary` / `closeSummary`。

**後勝ち排他状態機械**: `isSummaryPanelOpen` と `isInfoPanelOpen` は同時に `true` にならない不変条件を reducer が保証する。`openSummary` は `isInfoPanelOpen: false` + `selectedTerritory: null` を同時に設定し、`selectTerritory` は `isSummaryPanelOpen: false` を設定する。

```
none ─── OPEN_SUMMARY ──→ summaryOpen
none ─── SELECT_TERRITORY ──→ territoryOpen
summaryOpen ─── SELECT_TERRITORY ──→ territoryOpen  (後勝ち排他)
territoryOpen ─── OPEN_SUMMARY ──→ summaryOpen       (後勝ち排他)
summaryOpen ─── CLOSE_SUMMARY ──→ none
territoryOpen ─── CLEAR_SELECTION ──→ none
```

初期状態: デスクトップは `isSummaryPanelOpen: true`（`App` コンポーネントが `useIsMobile()` の結果を `initialState` に反映）、モバイルは `false`。

`ProjectionContext` (`useProjectionContext`) — `mercator` / `globe` のトグルを保持するだけの軽量 Context。MapLibre との橋渡しは `useProjection` が担う。

主要カスタム hook:
- `useYearIndex` — `index.json` を 1 度だけ fetch し、YearSelector の年リストを返す
- `useMapData(year)` — manifest / year index / color scheme の 3 つを `Promise.all` で読み、当該年の `pmtilesUrl` を組み立てて返す
- `usePMTilesProtocol` — `maplibregl.addProtocol('pmtiles', …)` のライフサイクルを React の effect に寄せる
- `useProjection(mapRef)` — Context の `projection` 変化を MapLibre の `setProjection` + `flyTo` に同期。globe → mercator は flyTo 後に setProjection（ズームアウト時に投影を切り替える）、mercator → globe はその逆
- `useMapHover` — ホバー中のカーソル形状と cursor を切替
- `useMapKeyboard(mapRef)` — 矢印・`+`/`-` キーでパン・ズームを補助
- `useTerritoryDescription(name, year)` — `description-loader` を介して `descriptions/{year}.json` から 1 領土分を解決
- `useEraSummary(year)` — `domain/era-summary/load.ts` を介して `era-summaries/{year}.json` を取得。404 は `null` 返却（準備中 fallback）、parse 失敗は throw

`lib/cached-fetcher.ts` の `CachedFetcher` がこれらの「1 回だけ fetch」パターンを抽象化している — color scheme / 年ごとの説明 JSON それぞれが単一インスタンスで保持される。

## MapLibre 統合

タイル URL の組み立ては `tiles-config.ts` に集約されている。`VITE_TILES_BASE_URL` 環境変数の有無で挙動が切り替わる:

- 未設定（既定。dev / preview / prod 共通） — `getTilesUrl(year, '')` が同一オリジンの `pmtiles:///pmtiles/world_{year}.{hash}.pmtiles` を返す。dev では `vite.config.ts` の dev middleware が `packages/tiles/dist/` を `/pmtiles/` で配信し（`*.pmtiles` バイナリと `index.json` の両方を含む）、Cloudflare Pages 上では `*.pmtiles` を Pages Function が R2 から、`index.json` を静的アセットとして配信する
- 設定あり（別オリジンからタイルを読む場合のみ） — `pmtiles://{VITE_TILES_BASE_URL}/world_{year}.{hash}.pmtiles` を返す。ハッシュは `@world-history-map/tiles` の `manifest.ts` からビルド時に解決される（runtime fetch なし）

`MapView` は `useMapData` から得た `pmtilesUrl` を `<Source type="vector">` に渡し、PMTiles プロトコルが HTTP Range Request でスパース読み込みする。主要レイヤー:
- `TerritoryLayer` — source-layer `territories` の fill / outline。`color-scheme.json` を参照した `match` expression で SUBJECTO または NAME ごとに色分け
- `TerritoryHighlightLayer` — 選択中領土の強調。`state.selectedTerritory` に追従
- `TerritoryLabel` — source-layer `labels`（Point）の `name_ja` プロパティを `text-field` として描画。`filter: ['has', 'name_ja']` により日本語名が焼き込まれていない領土はラベルを出さない（英語フォールバックは行わない）

投影は Context 切替から `useProjection` が MapLibre の `setProjection` を叩く。globe 側は最大ズーム 2 に抑え、mercator 側は最低 3 を保証して UX の破綻を避ける。

## 主要フロー

年を選んだとき:
- YearSelector のボタンクリックまたは矢印キー操作で `actions.setSelectedYear(year)` が発火
- `AppState.selectedYear` が更新される
- `App` の `useEffect` が発火して `prefetchYearDescriptions(year)` が次年の説明バンドルをバックグラウンド取得
- `MapView` 内の `useMapData(year)` が再評価され、新しい `pmtilesUrl` が生成される
- MapLibre の `<Source>` が URL 差し替えを検知して新年のタイルを読み込む

領土をクリックしたとき:
- MapLibre の `onClick` で `interactiveLayerIds: [territory-fill]` のフィーチャが取れる
- `resolveTerritoryName(properties)` が `NAME || SUBJECTO` を返す
- `actions.selectTerritory(name)` で `selectedTerritory` と `isInfoPanelOpen` が立つ
- `TerritoryInfoPanel` が開き、中の `useTerritoryDescription(name, year)` が `descriptions/{year}.json` を（キャッシュ経由で）取り、kebab-case 化した名前でバンドルを引く
- `TerritoryHighlightLayer` が同じ名前を使って強調描画
- `useCameraFitOnSelection` が `state.activePanel.selectedTerritory` と `state.selectedYear` の変化を検知してカメラを自動フィット（詳細は後述）

領土選択時のカメラ自動フィット:
- `MapView` 内で `useCameraFitOnSelection(mapRef)` を呼ぶ。選択経路（クリック / SummaryNavStrip などプログラム選択）を問わず `state.activePanel.selectedTerritory` の変化で起動する
- `mapRef.getMap().querySourceFeatures('territories', filter)` で対象フィーチャの `BBOX_W / BBOX_S / BBOX_E / BBOX_N / BBOX_AM` を取得し、`parseFeatureBounds` で `TerritoryBounds` に変換する
- `mapRef.getMap().fitBounds([[west, south], [east, north]], { padding, maxZoom: 5, duration })` でアニメーション付き移動。Desktop では左パネル（幅 384px + 余白 32px = 416px）を避けた padding、Mobile では BottomSheet half snap（40vh + 余白 16px）を避けた bottom padding を使う
- `prefers-reduced-motion: reduce` のとき `duration: 0`（即ジャンプ）
- タイル未読込時は `sourcedata` イベントで 1 度だけ再試行する
- 飛び地を持つ領土（アメリカ / ロシア / イギリスなど）は pipeline が最大面積ポリゴンの bbox を `BBOX_*` として格納しているため、フィット結果が地球規模にズームアウトしない
- パネルを閉じた際（`selectedTerritory → null`）はガード節でフィットを抑止し、カメラ位置は維持される（FR-007）
- 同一領土で年代が変化した場合は `selectedYear` の変化で再フィットが発火し、変化後の形状に追随する（FR-009）

投影法を切り替えたとき:
- ProjectionToggle が `setProjection(next)` を叩き、Context が更新
- `useProjection` が前回値と比較し、初回なら即 `setProjection`、以降は `flyTo` で滑らかにズームを調整してから切替
- globe 方向では `Math.min(currentZoom, 2)` までズームアウト、mercator 方向では `Math.max(currentZoom, 3)` までズームインしてから setProjection

領土説明の先読み:
- `App` が `selectedYear` 変化時に `prefetchYearDescriptions` を呼ぶ
- `CachedFetcher` が年別のシングルトンを持つため、領土クリック時には既にバンドルがメモリ上にあり即応する
- 404 の場合は null を返し、パネルは最小表示に落ちる

## 年代サマリーパネル

選択中の年代における世界全体の概況を地域別カードで俯瞰するパネル。

### コンポーネント構成

```
EraSummaryPanel          apps/frontend/src/components/era-summary-panel/
├── era-summary-panel.tsx        # ルート: Desktop <aside> / Mobile <BottomSheet> 分岐
├── region-card.tsx              # 1 地域カード (title + context / SummaryReferences)
├── summary-trigger.tsx          # サマリー閉時の起動 UI (Desktop タブ / Mobile FAB)
├── summary-references.tsx       # context 内テキストをリンクボタンに置換
└── hooks/
    └── use-era-summary.ts       # fetch + state 管理 hook

SummaryNavStrip          apps/frontend/src/components/territory-info/
└── summary-nav-strip.tsx        # 領土詳細パネル上端の遷移帯 ({year} 年の世界を見る)
```

### データフロー

```
Notion DB "Era Summary"
  ↓ pnpm pipeline era-summary-sync
apps/frontend/public/data/era-summaries/{year}.json
  ↓ loadEraSummary(year)
useEraSummary(year) → { summary, isLoading, error }
  ↓
EraSummaryPanel → RegionCard × N → SummaryReferences (リンク解決)
```

データパス: `apps/frontend/public/data/era-summaries/{year}.json`（静的同梱）。Pipeline サブコマンド `era-summary-sync` で Notion DB から生成。

### 参照リンク（SummaryReferences）

`RegionCard.references[]` の各エントリは `{ kind: 'territory' | 'year', target, text }` 形式。`SummaryReferences` が `context` 文字列内の `text` 出現位置を探し、最初のマッチをボタンに置換する。territory クリックで `selectTerritory(target)`、year クリックで `setSelectedYear(createHistoricalYear(parseInt(target, 10)))` を dispatch。
