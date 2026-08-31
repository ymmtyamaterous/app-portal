# Better T Stack + SQLite 実装計画書

## 1. 目的と対象範囲

`docs/user` の以下 4 仕様書を統合し、現在の Better T Stack scaffold を、公開ポータル・管理画面・認証・ファイル配信・アクセス分析を備えた SQLite アプリケーションへ完成させるための実施計画を定義する。

- [機能・API・データ仕様書](../user/better-t-stack-functional-api-spec.md)
- [セキュリティ・ファイル管理仕様書](../user/better-t-stack-security-file-spec.md)
- [データ移行・運用・受入仕様書](../user/better-t-stack-migration-operations-acceptance-spec.md)
- [SQLite リプレイス計画書](../user/better-t-stack-sqlite-replacement-plan.md)

対象は `better-t-app` 配下の既存モノレポである。実装は PostgreSQL/Go の旧システムを停止せずに並行構築し、移行照合と受入完了後に切り替える。

> **現在のスコープ:** 稼働中の旧アプリケーションからのデータ移行、本番切替、旧環境との照合は保留とする。本計画では新規 Better T Stack アプリケーションの基盤、機能、セキュリティ、運用可能な永続化までを先行実装し、移行関連の Phase 0、5、6 は再開時に実施する。

## 2. 現状と設計上の決定

### 2.1 現状

| 領域 | 現在の状態 | 実装で行うこと |
| --- | --- | --- |
| Web | TanStack Router、React Query、ログイン・保護ルートの雛形がある | 公開ポータル、管理、分析画面を実装する |
| API | Hono と oRPC の `healthCheck` / `privateData` のみ | ドメイン別 API、管理者認可、HTTP ファイルハンドラーを追加する |
| DB | libSQL 用 Drizzle クライアントと Better Auth schema のみ | アプリ固有 schema、SQLite PRAGMA、migration を追加する |
| 認証 | Better Auth の email/password と Cookie 設定がある | 公開サインアップ停止、role、seed-admin、レート制限を実装する |
| 運用 | 開発用 Compose のみ | 本番用永続化、バックアップ、復元、監視・切替手順を追加する |

### 2.2 仕様との差異と採用方針

仕様書には tRPC/TanStack Start を前提とする記述がある一方、現在の scaffold は **Hono + oRPC + Vite** で構成されている。既存の `@orpc/server`・`@orpc/client`・Hono 統合を維持し、仕様中の「tRPC procedure」は同等の **oRPC procedure** として実装する。外部 REST 互換 API は D-05 の承認後にのみ追加する。

この方針により不要な API 基盤の置換を避け、型安全な RPC、OpenAPI 参照、既存の React Query 連携をそのまま利用する。TanStack Start への移行は本計画のスコープ外とする。

## 3. 実装開始・本番移行のゲート

### 3.1 実装開始前に確認する事項

以下は旧データ移行を再開する際の Phase 0 の成果物であり、現在の先行実装の開始条件には含めない。

1. 旧 PostgreSQL の `links` 完全 DDL、件数、NULL・制約・インデックス・トリガー。
2. 旧システムの REST API 利用者の有無。
3. APK の公開範囲（D-01）、IP の不可逆ハッシュ化（D-02）、ログ保持期間（D-03）、URL の許可範囲（D-04）、REST 互換の要否（D-05）、タグ統合規則（D-06）。
4. 本番が SQLite の単一レプリカ・単一 writer で運用可能であること。
5. `/data` の永続 block storage、バックアップ保管先、切替停止時間、ロールバック責任者。

### 3.2 本番移行を停止する条件

上記 D-01〜D-06、旧 `links` DDL、永続化・復元責任者のいずれかが未確定の場合、アプリ基盤の実装は進めてもデータ移行および本番切替は実施しない。現在は移行を保留しているため、この停止条件は先行実装には適用しない。

## 4. フェーズ別実装計画

### Phase 0: 要件確定と移行調査（保留）

**目的:** 旧データの変換不能・切替不能を実装前に検出する。

- 旧 DB の schema-only/data-only dump とデータプロファイルを取得する。
- 旧 uploads と APK の件数、容量、参照関係、最大ファイルサイズを棚卸しする。
- D-01〜D-06、ウイルススキャン要否、旧 REST の互換期限を承認する。
- SQLite 単一 writer、保管先、バックアップの世代数（最低 30）、旧環境の読み取り専用保持期間（30 日）を確定する。

**完了条件:** データマッピング、承認済み例外、停止時間、ロールバック担当を記録済みである。

### Phase 1: 基盤・環境設定・認証

**主な変更箇所:** `packages/env`、`packages/db`、`packages/auth`、`packages/api`、`apps/server`、root scripts。

1. `DATABASE_URL`、uploads ルート、アクセスログ保持日数、信頼済みプロキシ、レート制限値を環境変数として Zod で検証する。
2. DB 初期化時に `foreign_keys = ON`、`journal_mode = WAL`、`busy_timeout = 5000` を適用する。実 DB が libSQL/Turso の場合は SQLite PRAGMA のサポートを確認し、ローカル SQLite ファイルとの差異をテストで明示する。
3. Better Auth に `admin` / `viewer` role を追加し、公開サインアップを無効化する。パスワードは 12〜128 文字で検証する。
4. `seed-admin` CLI を実装する。同一メールアドレスでの再実行は失敗させ、秘密値を出力しない。
5. `adminProcedure` を追加し、未認証は 401、role 不足は 403 とする。UI の経路制御だけを認可根拠にしない。
6. 認証・管理 API に `Cache-Control: no-store`、全応答に CSP、`nosniff`、Referrer-Policy、DENY を設定する。Cookie は同一オリジンなら `SameSite=Lax`、HTTPS 本番では `Secure` とする。既存の `SameSite=None` は別オリジン構成を採用する場合だけ維持し、CSRF 対策を併用する。
7. ログインを 5 回/15 分、アップロードを 20 回/時で制限する（設定可能）。

**テスト:** seed-admin の一回性、ログイン/ログアウト、期限切れ・改ざん Cookie、匿名・viewer・admin の認可境界、セキュリティヘッダー。

### Phase 2: SQLite スキーマとドメイン API

**主な変更箇所:** `packages/db/src/schema`、`packages/db/src/migrations`、`packages/api/src/routers`、`packages/api/src/services`。

1. `links`、`tags`、`link_tags`、`access_logs`、`uploads` を Drizzle schema として追加する。日時は UTC epoch milliseconds、`links.updated_at` はアプリケーション側で更新する。
2. 外部キーと索引を追加する。必須索引は `links(visible, created_at)`、`tags(normalized_name)`、`link_tags(tag_id, link_id)`、`access_logs(link_id, accessed_at)`、`access_logs(accessed_at)`、`uploads(kind, created_at)` とする。
3. `links` oRPC router を追加する。`publicList` は公開リンクだけ、`byId` / `adminList` / `create` / `update` / `remove` は管理者限定とする。
4. URL、タイトル、説明、タグ、ページ期間を Zod で検証する。タグは NFC 正規化、前後トリム、連続空白圧縮、Unicode 小文字化を行い、正規化名の重複を統合する。
5. `analytics` router を追加する。`recordAccess` は公開中リンクだけを記録し、非公開または不存在時には `{ recorded: false }` を返す。IP は日替わり salt の SHA-256 ハッシュのみを保持する。
6. `popular` と `summary` は `all` / `7d` / `30d` を UTC 基準で集計する。ランキングは対象期間のクリック数降順、最終アクセス日時降順、ID 昇順とする。
7. JSON エクスポートを管理者限定で実装する。全リンク、タグ、作成・更新日時のみを `portal-links-YYYYMMDDTHHMMSSZ.json` として出力し、アクセスログとファイル本体は含めない。

**テスト:** migration の空 DB 適用、外部キー/CASCADE、URL・タグ検証、全 API の権限、非公開リンク秘匿、期間境界、0 件集計、ISO 8601 UTC 変換、JSON 出力。

### Phase 3: アップロード・配信・ライフサイクル

**主な変更箇所:** `apps/server/src/index.ts` と新規ファイルサービス、`packages/api`、`packages/db`。

1. Hono の HTTP handler として `POST /api/uploads/images` と `POST /api/uploads/apks` を追加する。oRPC はメタデータ一覧だけに使う。
2. 管理者認可、1 ファイル・固定 field 名、サイズ、拡張子、MIME、マジックバイトを検証する。画像は JPEG/PNG/GIF/WebP・10 MiB 以下、SVG は拒否する。APK は 100 MiB 以下、ZIP/APK と `AndroidManifest.xml` を検証する。
3. UUID 保存名と一時保存からの atomic rename を用い、DB 成功前の永続公開を防ぐ。物理パスは受信値から作らず `uploads.stored_name` だけで解決する。
4. `GET /media/images/{uploadId}` は公開リンクに関連する画像のみ inline で、`GET /downloads/apks/{uploadId}` は D-01 に従い attachment で配信する。両者に正しい `Content-Type` と `X-Content-Type-Options: nosniff` を設定する。
5. 画像の置換・解除・リンク削除では upload 本体を即時削除しない。APK の物理削除は初期リリースの UI に置かず、参照確認可能な管理 CLI で扱う。
6. `cleanup-access-logs` を日次実行可能にし、`ACCESS_LOG_RETENTION_DAYS`（1〜365、既定 90）より古いレコードを削除する。

**テスト:** 拡張子偽装、SVG、壊れた APK、超過サイズ、複数ファイル、パストラバーサル、非公開画像、Content-Disposition、失敗時の一時ファイル清掃。

### Phase 4: 公開ポータルと管理 UI

**主な変更箇所:** `apps/web/src/routes`、`apps/web/src/components`、`apps/web/src/utils/orpc.ts`。

1. `/` を公開ポータルに置き換える。画像、タイトル、説明、タグをカードとして表示し、グリッド/カテゴリ表示、部分一致検索、1 タグ絞込み、読み込み・エラー・0 件状態を実装する。
2. カード遷移直前に `analytics.recordAccess` を非同期送信し、送信失敗では遷移を止めない。
3. ログイン画面は既存デザインに合わせ、パスワード表示切替、統一した認証失敗文言を提供する。公開サインアップは表示しない。
4. `/admin` の保護ルートに、管理・分析の 2 タブを実装する。管理タブでは一覧、作成、編集、公開切替、確認付き削除、画像の維持/置換/解除、APK アップロードを提供する。
5. 分析タブでは総リンク数、総クリック数、本日/7 日/30 日、ユニークリンク数、期間切替可能な上位 10 件を表示する。切替時は query を再取得し、画面全体を再読み込みしない。
6. 管理者用 JSON エクスポートとログアウトを追加し、日時を `ja-JP` で表示する。

**テスト:** 公開リンクのみの表示、検索・タグ・表示モード、クリック記録、未ログインのリダイレクト、viewer の 403、CRUD、画像/APK、期間切替、エクスポート。

### Phase 5: 移行ツールと運用自動化（移行ツールは保留）

**主な変更箇所:** 新規 `scripts`、`infra`、デプロイ用構成。

1. **先行実装:** DB と uploads を同一世代 ID で保存するバックアップ・復元・integrity check を実装する。
2. **先行実装:** 本番構成では `/data/portal.db` と `/data/uploads/{images,apk}` を同一の永続ボリュームにマウントし、起動時に migration を適用して静的 Web ファイルを配信する。
3. **保留:** `export-postgres`、`migrate-uploads`、`import-sqlite`、`verify-migration` は、旧アプリのデータ移行を再開する時点で実装する。各ツールには dry-run、機械可読 JSON、秘密値非出力、明確な終了コードを備える。

**テスト:** 移行の件数/ID/タグ/hash 照合、無効 URL の例外化、保持期限外ログの除外、バックアップから隔離環境への復元、コンテナ再作成後の永続性。

### Phase 6: ステージング受入と本番切替（保留）

1. ステージングで E2E、ファイル配信、軽い並行アクセス、バックアップ復元を実施する。
2. メンテナンス開始後に旧環境の変更・アップロードを停止し、最終 dump と uploads snapshot を取得する。
3. 検証済みの同一バージョンで移行、照合、受入判定を実行する。
4. 承認後に DNS/リバースプロキシを切り替え、ログイン、CRUD、公開表示、画像/APK、集計、バックアップを確認する。
5. 旧環境は読み取り専用で 30 日間保持する。ログイン不能、重大な公開リンク欠損、ファイル配信不能、未承認差分、バックアップ失敗時は書込みを停止して旧環境へ戻す。

## 5. 実装順序と依存関係

```text
Phase 1（環境・認証）
  └─ Phase 2（schema・API）
       ├─ Phase 3（ファイル処理）
       │    └─ Phase 4（UI）
       └─ Phase 5（バックアップ・永続化）

保留: Phase 0（移行調査）→ 移行ツール → Phase 6（旧環境からの受入・切替）
```

Phase 4 は Phase 2 の公開/管理 API が安定してから開始する。Phase 5 のバックアップ・永続化は Phase 2 と Phase 3 のデータモデル・保存形式の確定後に実装する。保留中の移行ツールと Phase 6 は、移行再開後にすべての自動テストおよび移行照合が成功してから開始する。

## 6. 品質ゲート

各フェーズ完了時に、少なくとも次を満たす。

| 領域 | 判定基準 |
| --- | --- |
| 静的品質 | Biome、TypeScript 型検査、production build が成功する |
| DB | 空 DB への migration、外部キー、CASCADE、索引が検証済み |
| 認証・認可 | 匿名、viewer、admin のサーバー側権限境界を自動テスト済み |
| ファイル | 不正形式・サイズ・パス走査を拒否し、配信ヘッダーと公開範囲が正しい |
| UI | 主要公開導線と管理操作を E2E で確認済み |
| 移行 | 未承認のリンク・タグ・ログ・ファイル・集計差分がゼロ |
| 運用 | DB と uploads を同一世代で復元でき、health/integrity/容量を監視可能 |

## 7. 主要リスクと対策

| リスク | 対策 |
| --- | --- |
| 仕様の tRPC 前提と既存 oRPC の不整合 | oRPC を標準 RPC とする決定を維持し、契約・テストを oRPC procedure に対応付ける |
| SQLite の複数 writer 利用 | 本番を単一レプリカに固定し、水平スケール要件が出た時点で DB を再評価する |
| 旧 `links` DDL/データ品質が不明 | Phase 0 の承認なしで移行・切替を禁止する |
| ファイルと DB の不整合 | 一時保存、atomic rename、参照確認、同一世代バックアップ、hash 照合を行う |
| 管理機能のクライアント側迂回 | 全管理 RPC/HTTP handler で admin を検証する |
| アクセスログの個人情報・容量増加 | IP を日替わり salt hash 化し、90 日を既定とする削除ジョブを実装する |
| 現行 API 利用者の見落とし | D-05 で外部利用を棚卸しし、必要時だけ期限付き互換 API を追加する |

## 8. 完了の定義

以下をすべて満たした時点で本計画は完了とする。

- 公開ポータル、認証済み管理、リンク CRUD、分析、画像/APK、JSON エクスポートが仕様どおり動作する。
- 管理操作とアップロードがサーバー側で `admin` に限定され、セキュリティ仕様の検証を通過する。
- SQLite schema、migration、バックアップ、復元、ログ削除、初期管理者作成が再現可能である。
- 旧 PostgreSQL/ファイルからの検証移行で、承認済み例外以外の差分がない（データ移行を再開する場合）。
- ステージング受入、切替後確認、ロールバック手順が実施・記録済みである。
