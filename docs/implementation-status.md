# 実装・検証記録

確認日: 2026-09-22（JST）。実装先は`/Users/mocchalera/Dev/suizokukan`だけ。無関係プロジェクト、Cockpit設定、認証、許可リストは変更していません。

## 現在の区分

- 実装: ローカル・写真編集・泳ぎ・ずかん・家族ルーム・任意Jev fallbackを実装済み。
- 公開: `https://umi.mocchalera.app`へdeploy済み。本番の全E2Eはdesktop/mobile Chromium・mobile WebKitで22成功、2意図したskip。解析スクリプトの自動挿入も除去確認済みです。
- Jev: 所有者承認済みの鍵を`npx wrangler secret put JEV_API_KEY`で登録（値は記録しない）。`JEV_DAILY_LIMIT=50`（予算実装の上限50、同一IP10/UTC日）で有効化。プロバイダへのlive送信結果は下記「2026-09-24 Jev有効化」に記録。代替プロバイダなし。

## 事前確認

- 指定GitHub repoは空、default branch main。clone後ユーザー既存変更なし。通常のgh/Wrangler認証確認済み（アカウント詳細・鍵は記録しない）。
- 2026-09-22 10:41:32 UTC、10:58:08 UTCのCloudflare読み取りで、umi/suizokukanのexact DNS、zone wildcard DNSに該当なし。既存custom domainに対象なし、対象Worker名なし、zone routesなし。
- 公式TypeSafe llms.txt → api.md/models.md、Cloudflare Workers Static Assets/custom domains/SQLite DOの資料を参照。依存lockfile固定。プラン契約変更なし。

## 実装内容と境界

| 項目 | 実装・安全境界 |
| --- | --- |
| 入力 | getUserMedia/写真選択/capture、失敗救済、内蔵画像、簡易canvas。15MB/40Mpx header検証、1200px縮小、向き解釈 |
| 切り抜き | 四隅で矩形範囲調整。Workerの境界連結flood fill、内部白/RGB保持、threshold、残す/消す、4段undo、reset、紙切り絵fallback |
| 誕生 | 動くpreview、左右反転、名前/泳ぎ/絵付き性格、明示ボタン→IDB transaction成功後に誕生 |
| 海 | 3泳ぎ、12strip尾揺れ、奥行き、泡/おやつ/呼ぶ、20枚まで、hidden pause/dt clamp/cleanup/reduced-motion |
| 保存 | IndexedDB。破損/quota時は成功表示しない。削除確認。v1バックアップは追加のみ、URL/危険文字列/過大入力/不正PNG拒否 |
| 家族 | SQLite DO、256bit capability hash、fragment→sessionStorage、元画像不送信。one-use WebSocket ticket、画像decode後owner ACK、再接続/重複拒否/人数・bytes・TTL制限 |
| Jev | textのみ、160文字、列挙/有限score検証clamp、3.5秒timeout、日次予算、fallback。live未検証 |

## 実行したローカル確認

環境: macOS、Node 24.8.0、npm 11.19.1、Wrangler 4.136.1、Playwright 1.63.0。Chromium 153 / WebKit 26.6のheadless。Safari実機の証拠ではありません。

- `npm run typecheck`: frontend/shared/tests/workerのstrict TypeScriptチェック成功。
- `npm test`: **8ファイル43テスト成功**。背景透明/内部白/1200px/空・巨大・異常画素、PNG CRCとmetadata、import、IDB保存/破損/abort、行動dt/境界、room auth構文/TTL/bytes/dupe、Jev fallback/timeout/契約、bounded HTTP。
- `npm run build`: Viteビルド成功。生成commitとdirtyフラグをworker/source.jsonに注入。
- `npx wrangler dev --ip 127.0.0.1 --port 8788 --persist-to test-artifacts/runtime/qa-final-state --log-level error`: local Worker + 実SQLite DO + WebSocket。
- `BASE_URL=http://127.0.0.1:8788 PLAYWRIGHT_BROWSERS_PATH="$PWD/test-artifacts/runtime/browsers" npm run test:e2e`: **22成功、2意図したskip（31.3秒）**。同じAPI security試験はdesktopだけで行うためmobile/WebKitではskip。
- `npm run verify:release`: buildへの秘密名・key pattern・provider endpoint・source map非混入を検査。
- `BASE_URL=http://127.0.0.1:8788 npm run test:smoke`: health/5深いURL/asset/JSON API拒否/別Origin拒否/未接続Jev fallback/headers/source一致を確認。
- `npx wrangler deploy --dry-run --outdir test-artifacts/runtime/dry-run`: bundleとSQLite DO bindings検証成功。外部変更なし。

WebKitがCanvas PNGに付ける`eXIf`を発見。自前canvasの出力だけmetadataを除去し、外部import/APIは引き続きmetadataを拒否。画像pixel chunk不変のunitとWebKit全動線で修正確認しました。

カメラ拒否／遅延許可はgetUserMediaの**合成stub**です。WebKitのmediaDevices wrapper上のstubが失われた試験を、navigator上の固定stubへ修正。実カメラが動いたとは報告しません。一度のE2E失敗群はdev server停止によるconnection refusedで、8788再起動後に再実行しています。

## ブラウザ試験内容

- 内蔵写真→範囲→背景除去→名前/泳ぎ/向き→誕生→泡/おやつ→ずかん→reload→export→削除cancel/confirm→import→同じ子を探す→ブラウザ戻る。
- malformed PNG、合成JPEGのファイル選択、手動ブラシ/Undo/紙fallback/再切り抜き、reduced-motion。
- 20匹を連続表示し5回の画面往復、描画画像cacheが20以内、JS例外なし。正式な長時間heap/GPUリーク測定ではありません。
- カメラ拒否と閉じた後の遅延stream stop。不正/過大backupで既存データ保持。Jev503 stubでtext-onlyの1回呼出・誕生fallback。
- 別browser contextのPC/スマホ相当で作成→QRリンク参加→確認投稿→画像準備ACK→双方reload再接続→重複拒否→呼ぶ→共有コピー削除→終了。端末内の子は保持。
- APIの未認証/誤capability/誤role/別Origin拒否、巨大body413、その後正常201、外部URL拒否、同じpayload再送200/変更409、20匹容量、保護画像、終了後410。
- 通常動線はconsole error/JS例外/外部画像送信なし。テスト用リンク/秘密が映る招待パネルはスクリーンショットに入れません。trace/videoは無効です。

## 目視と成果物

`test-artifacts`の選択済みdesktop/mobile/WebKit/cutout/共有画面を目視。原画を主役に淡い青緑、水の光、紙、低コントラストの泡を使用。横スクロールなし、safe area、44px以上のボタン。試験fixtureは実装者作の合成画像です。

Cockpit browserでlocal画面openを試みましたがscreenshotが応答しなかったため、Playwrightで画面検証しました。新しいbrowser identityや権限は作成していません。

## 未検証・意図した制限

- 実際の子どもの絵、暗所/影/薄い鉛筆の多様な写真、実機iOS/Androidカメラ、実機性能、長時間メモリ計測は未実施。
- 自動紙検出・遠近補正なし。四隅つまみは矩形範囲調整です。斜め写真は撮り直し/手動修正/紙fallbackを使います。HEIC非対応。
- ルーム6時間の実時間待機/alarm物理削除のlive検証は未実施。期限判定はunit、終了による削除/410はDO経由で検証。
- Jev live/billing/実プロバイダtimeoutは未実施。stub/contract/fallbackの検証をliveと混同しません。
- 複数端末で永続ずかんを同期するサービスではありません。招待に漏洩時の個別失効機能はなく、作成者がルーム全体を終了します。
- 初版はログイン/自由チャット/3D/音/課金/解析/Service Workerを意図して持ちません。

## リリース証跡

- 初回tested source: `a4ea39593b55d5481c6fbaedc69ea8eb8d8b8289`。通常の`git push origin main`成功、remote main一致後に`npm run deploy`成功。
- 初回Cloudflare version: `27e2e230-3642-435e-a1b0-c723311d0cba`。新規Worker `suizokukan` / custom domain `umi.mocchalera.app`だけを作成。プラン・既存他DNS・権限変更なし。
- `BASE_URL=https://umi.mocchalera.app EXPECTED_COMMIT=HEAD npm run test:smoke`: 初回HTTPS/5深いURL/assets/health/API拒否/headers/source一致成功。dirty=false、Jev=fallback。
- 初回の全E2E: **19成功、3失敗、2意図したskip**。3失敗は通常動線末尾のconsole検査で、Cloudflareが自動挿入したWeb Analytics beaconがstrict CSPで拒否されたことによります。CSPを緩めたりエラーを無視したりせず、応答側を修正しました。
- 公式Web Analytics Get started/FAQ（2026-09-22確認）に従い、本プロジェクトの静的応答に`no-transform`を設定。zone設定は変更していません。smokeに`no-transform`・解析HTML非混入・first-party scriptの検査を追加。
- 修正source: `a486af465b8bceb1908c18916255d1d0e2813d8b`。Cloudflare version: `b76e3eeb-954e-4ee3-b016-1a5d7ab1f6b7`。GitHub mainへの通常push後にdeployし、health/source/HEAD一致とdirty=falseを確認。
- `BASE_URL=https://umi.mocchalera.app EXPECTED_COMMIT=HEAD npm run test:smoke`: **成功**。外部解析scriptなし、APIはJSON、静的深いURLはHTML、Jev=fallback。
- `BASE_URL=https://umi.mocchalera.app PLAYWRIGHT_BROWSERS_PATH="$PWD/test-artifacts/runtime/browsers" E2E_ARTIFACT_DIR=test-artifacts/runtime/production-fixed npm run test:e2e`: **22成功、2意図したskip（1.3分）**。3環境の写真→誕生→保存/復元、修正/安全試験、20匹、および別context間の共有→owner ACK→双方reload→終了を本番で確認しました。console検査も成功。
- 本番スクリーンショットは`test-artifacts/runtime/production-fixed`に保存。desktop共有画面とmobileホームを目視済み。秘密を表示するQR/招待パネルは撮影していません。
- キャッシュ追補: `_headers`の重複値を避けるため`/assets/*`で`! Cache-Control`後に1年immutableを設定。HTMLはno-cache/no-transformを維持。`npm run build`とlocal `npm run test:smoke`で、ハッシュ付きJS/CSSのCache-Controlが正確に`public, max-age=31536000, immutable, no-transform`となることを確認。アプリ・APIの動作コードは上記の全本番E2E成功sourceから変更なしです。
- 最終リリースの非秘密source/deployment情報は`/api/health`と`/source.json`にあります。追加の本番smoke・主要ブラウザ動線・二者ルーム確認の結果とremote main照合は`test-artifacts/runtime/final-release.json`へ記録します（Git自己参照を避けるため生成レシートは追跡対象外）。

## 2026-09-22 操作不具合の修正

- 対象: 魚が目的地の近くで左右反転を繰り返す問題と、背景除去の強さスライダーがドラッグ途中で止まる問題。既存のデータ形式・API・共有ルーム・Cloudflare設定・依存関係は変更していません。
- 修正前の本番source `716c25d27a93ba9d91c49631a7aa8a205ebc2741`で、実Canvas描画の60フレーム中58回の連続反転と、スライダーの連続ドラッグ中断を再現。新規ブラウザ回帰試験は2失敗、行動unitは5失敗・5成功でした。ログは`test-artifacts/runtime/interaction-browser-before.log`と`interaction-behavior-before.log`。
- 魚: 目的地直前での移動量を制限し、到着したら向きを維持。こわがりの泡との距離に安定した範囲を設け、画面端の反射との競合も防止。30/60/144fps・3泳ぎ・呼ぶ/泡/おやつ・画面端を検証。
- スライダー: 処理中もつまみと数値は即時操作可能。画素処理は80msのdebounce、同時実行1件＋最新待機1件に限定し、古い応答でプレビューを上書きしません。範囲へ戻る際の取消、Worker異常、unmount時の破棄も検証。プレビュー確定前は次へ進めません。
- `npm test`: **56成功 / 9ファイル**。`npm run typecheck`、`npm run build`、`npm run verify:release`: **成功**。
- `BASE_URL=http://127.0.0.1:8788 PLAYWRIGHT_BROWSERS_PATH="$PWD/test-artifacts/runtime/browsers" E2E_ARTIFACT_DIR=test-artifacts/runtime/interaction-local-full npm run test:e2e`: **28成功 / 2意図したskip（46.8秒）**。desktop Chromium・mobile Chromium・mobile WebKit。共有ルーム試験は独立したlocal SQLite DO上で全動線を確認。
- 新規ブラウザ試験は実Workerの応答を350ms遅らせた状態で連続往復ドラッグ、処理中の追加入力、最終値のPNG一致、同時Worker処理数1を確認。mobile ChromiumではCDPの合成タッチ操作も実施。これは実機タッチ/実機性能の検証ではありません。
- `test-artifacts/runtime/interaction-local`のdesktop/mobile切り抜きスクリーンショットを目視。Cockpit browserではlocal画面を開き、サンプル選択と切り抜き画面への操作を確認しましたが、screenshotは応答せず、画像証跡にはPlaywrightを使用。
- 本修正の本番確認ではHTTP smokeと共有以外の3環境E2Eを実施し、非秘密の結果・commit・Cloudflare versionを`test-artifacts/runtime/interaction-release.json`へ記録します。本番ルームの日次作成枠を不要に消費しないため、変更していないルーム試験は上記local全試験と既存本番証跡に分けます。
- 実際の子どもの写真、物理スマートフォンのタッチ/カメラは今回も未検証。Jevは引き続き未接続fallbackです。

## 2026-09-22 独立QAの共有ルーム4件の修正

- 対象sourceは `c32f673d69fec259d1c7c94b28ce8c9f01b38201`。独立QAが挙げたowner復帰、pending収束、ready ACK冪等、不正IDATの4件だけを修正。Jev設定・依存関係・ルーム作成予算・DNSは変更していません。
- 作成者の離脱は「いったん もどる」に統一し、同じタブのsessionStorageに管理権限を保持。同じ招待の貼り付け/再入場でもownerを上書きしません。違うjoin capabilityへ権限を引き継がず、招待リンク/QRにはjoinだけを含めます。guest離脱では従来どおり端末内の招待を消します。タブを閉じた後の管理権限復旧は非対象です。
- pendingは投稿から30秒。Durable Object alarmで失敗状態へ一回遷移し、画像と使用bytesを削除。alarmが遅延してもアクセス/ACK時に期限を判定し、期限後のreadyや再送による延長を拒否。同一IDの失敗記録はルーム終了/6時間TTL/owner削除まで保持し、20匹枠に数えます。端末の図鑑は削除しません。既存SQLite schemaをin-placeで追加移行し、capability hashとルーム期限を維持します。
- ready ACKは `ready = 0 AND pending_until > now` の条件付きUPDATEで一回だけ遷移。更新があった場合だけready通知を送ります。
- server側でPNGのCRC/構造に加え、native `node:zlib` の出力長上限付きinflateでIDATを検証。展開長・圧縮データ末尾・checksum・行filter・palette範囲を検査し、不正データを保存/画像配信しません。最大展開長は1,049,088 bytes。新規画像ライブラリや原画の再描画はありません。

### ローカル検証

- `npx wrangler dev --local --ip 127.0.0.1 --port 8787 --persist-to test-artifacts/runtime/qa-room-fixes-20260922`：隔離SQLite DO、実workerd、WebSocket/alarm。既存環境・本番counterは変更していません。
- `npm run typecheck`、`npm test`：**成功、12ファイル83テスト**。PNG破損/膨張/512px、owner保持/不正保存値、期限境界/遅延alarm/重複投稿/遅延ACK、冪等通知、終了、旧schema移行を追加。room-state unitはNode SQLite adapterと制御時計、下記E2Eは実workerdです。
- `BASE_URL=http://127.0.0.1:8787 PLAYWRIGHT_BROWSERS_PATH="$PWD/test-artifacts/runtime/browsers" E2E_ARTIFACT_DIR=test-artifacts/runtime/room-fixes-full npm run test:e2e`：**29成功、4意図したskip（1.4分）**。desktop Chromium・mobile Chromium・mobile WebKit。API securityと30秒待機試験はdesktopのみ実行し、他2projectで重複する4件をskip。
- 二つの独立browser contextでcreate→join→share→owner画像準備/ready→両者reload→delete→close、作成者が一度戻った後の再入場・招待貼り付け・owner維持を確認。guest側の元データ保持、招待へowner非混入も確認。
- host不在で実時間30秒待ち、HTTP pollingなしでalarmの失敗通知、画像GET 410、海から画像解放、reload後の失敗保持、再送で復活/重複しないことを確認。同じACKを5回送信して通知1回。CRC/IHDR/IENDが正常な7種類の壊れたIDATを実APIが400で拒否し、保存されないことを確認。
- 未認証401、別capability/guest管理操作/別Origin403、外部URL/不正形式400、過大payload413、20匹上限/競合409も実APIで確認。前回の魚反転/スライダー回帰、図鑑/backup、20匹、camera拒否stub、Jev fallbackも成功。
- `npm run build`、`npm run verify:release`、`npm run test:smoke`：成功。commit前のlocal healthはbase SHA + `dirty: true`であり、公開sourceの証拠とは区別します。
- 初回の対象E2E実行は標準Playwright cacheにbrowserがなくUI試験を開始できませんでした。既存のproject内cacheを `PLAYWRIGHT_BROWSERS_PATH` で指定して再実行し、対象3件および上記全suiteが成功。追加インストールなし。
- screenshotsは `test-artifacts/runtime/room-fixes-full`。招待/QRを閉じたdesktop owner画面とmobileサイズのpending失敗画面を目視し、Cockpit side panelでも表示。trace/video/失敗時自動screenshotは無効で、capabilityを成果物へ保存しません。

### リリース境界と残る制限

- 公開前read-only確認：`umi.mocchalera.app` は既存 `suizokukan` production Workerに所属。直前deploy sourceとGitHub mainは上記base SHAに一致。無関係なdomain/Workerは変更しません。
- 今回の非秘密commit・remote main・Cloudflare version・本番smoke結果は、自己参照を避けるため生成レシート `test-artifacts/runtime/room-fixes-release.json` に記録します。リリースscriptはclean main/remote HEAD一致を必須にし、buildへcommitを注入します。
- 本番共有試験は通常の作成枠が利用できる場合のみ実行。429なら停止し、日次上限の回避/リセットはしません。local二者E2E成功を本番成功とは扱いません。
- 6時間TTLは制御時計でのunit検証であり、6時間の実時間待機ではありません。実機camera・物理スマホ性能・実際の子どもの絵は未検証。Jevは未接続fallbackのままです。

## 2026-09-24 Jev有効化

- 所有者の明示承認のもと、Jevを有効化。鍵の値は記録しない。Cloudflare MCPは本セッションで未設定のため、Wrangler CLIで実施した。JEVはTypeSafe公式`https://api.typesafe.ai/v1/systemone`への外部HTTP呼出であり、Cloudflare側のBYOK設定は存在しない（`worker/jev.ts`がBearerで直接呼ぶ構成）。
- 手順: 所有者自身が`npx wrangler secret put JEV_API_KEY`で登録（`wrangler secret list`で`JEV_API_KEY`/secret_textを確認）。`wrangler.jsonc`の`JEV_DAILY_LIMIT`を`"0"`→`"50"`に変更し、`npm run types`で`worker-configuration.d.ts`のリテラル型を追従。承認が1000だったが、`worker/budget.ts`が`Math.min(50, limit)`で丸めるため実効上限は50回/UTC日・同一IP10回/UTC日。
- ローカル検証: `npm run typecheck`成功、`npm test`**88成功**、`npm run build`成功、`npm run verify:release`成功（release-boundary passed、tracked 76）。
- 公開: 通常の`git push origin main`（force不使用）で`73c9fdf`（共有海の全画面投影）と`3b5b78b`（Jev有効化）をpush。`npm run deploy`でsource `3b5b78b1e0daf83d83130dbd45eb300d5b78824b`、dirty=false、Cloudflare version `1b24b79a-9558-436c-a537-cc35471a8b1d`。
- 本番確認: `/api/health`で`"jev":"available"`。`BASE_URL=https://umi.mocchalera.app EXPECTED_COMMIT=HEAD npm run test:smoke`成功（http/headers/source一致、解析非混入）。
- **live送信**: 本番`POST /api/personality`へ設定文「あわが好き」を送信し、`mode: "jev"`、`notice: "Jevで設定文をせいかくにしました。"`、`energy`が0.37〜0.42と毎回変化する実プロバイダ応答を確認。fallback（未接続時）ではありません。予算は8/50を消費（下記の重複実行が起因）。
- 検証運用の自己起因トラブル: 並列ツール呼び出しの重複発行により、deployが8回・live送信が8回・smokeが8回実行された。deployは全員が同一commitで成約済み（build競合1回は失敗に終結、他7回成功、最終versionは成功分の同一source）。live消費8回は予算内。pushでは並列gitが`index.lock`競合を起こしたが、成功1回でremote main=HEADを確認。以降は単一発行に統制した。
- 未検証: 全画面投影の**本番**E2E（ルーム作成枠を消費するため未実施。ローカル隔離環境のheadless Chromium/WebKitでのみ検証済み）、GUI実画面/実機ブラウザ操作、誕生画面経由のUI→Jev動線（API levelのliveのみ）、実機でのJev応答表示。
