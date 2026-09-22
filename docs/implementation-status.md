# 実装・検証記録

確認日: 2026-09-22（JST）。実装先は`/Users/mocchalera/Dev/suizokukan`だけ。無関係プロジェクト、Cockpit設定、認証、許可リストは変更していません。

## 現在の区分

- 実装: ローカル・写真編集・泳ぎ・ずかん・家族ルーム・任意Jev fallbackを実装済み。
- 公開: `https://umi.mocchalera.app`へ初回deploy済み。HTTPSと本番家族同期は確認済み。最終QAで検出した解析スクリプト自動挿入への対策を再検証中です。
- Jev: 承認済み鍵経路を安全に確認できないため未接続。`JEV_DAILY_LIMIT=0`。プロバイダへのlive送信なし。代替プロバイダなし。

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
- 同URLへの全E2E: **19成功、3失敗、2意図したskip**。本番の写真編集/保存動線と全3環境の二者ルーム同期は動作。3失敗は通常動線末尾のconsole検査で、Cloudflareが自動挿入したWeb Analytics beaconがstrict CSPで拒否されたことによります。CSPを緩めたりエラーを無視したりせず修正します。
- 公式Web Analytics Get started/FAQ（2026-09-22確認）に従い、本プロジェクトの静的応答だけに`Cache-Control: public, no-cache, no-transform`を設定。zone設定は変更しません。smokeに`no-transform`と解析HTML非混入検査を追加。修正後の本番結果は次の記録で更新します。
