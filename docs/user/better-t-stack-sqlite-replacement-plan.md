# Better T Stack + SQLite リプレイス計画書

## 1. 目的

現在の React/Vite + Go/Gorilla Mux + PostgreSQL 構成を、TypeScript を中心とする Better T Stack と SQLite に置き換える。公開ポータル、管理、認証、画像/APK 配布、アクセス分析の利用者向け機能を維持しつつ、次を達成する。

- フロントエンドと API の型を共有し、実装・改修時の不整合を減らす。
- スキーマ、マイグレーション、認可をアプリケーションコードとして一元管理する。
- 小規模な単一ノード運用に適した SQLite の永続化・バックアップ方法を確立する。
- 現行の認証不備（クライアントの `sessionStorage` フラグだけで管理画面を通過できる状態）を解消する。

本書は実装前の合意用計画であり、既存アプリを停止せず並行構築して、データ照合後に切り替える方式を採用する。

## 2. 調査結果と移行対象

### 2.1 現行構成

| 層 | 現行技術 | 移行対象 |
| --- | --- | --- |
| UI | React 19、Vite、React Router、Context API | React/TanStack Router/TanStack Query を含む Better T Stack 構成へ移植 |
| API | Go 1.22、Gorilla Mux、CORS | TypeScript の型安全な RPC/API 層へ置換 |
| 認証 | 環境変数の ID/パスワード照合。ログイン結果のみをクライアント保持 | Better Auth によるサーバー側セッションとロール認可へ置換 |
| DB | PostgreSQL | SQLite + Drizzle ORM + Drizzle Kit マイグレーションへ置換 |
| ファイル | コンテナ内 `uploads/apk`、`uploads/images` | 永続ボリューム上のアップロード領域（将来的にオブジェクトストレージへ差替え可能） |
| 実行環境 | frontend/backend/db の 3 Compose サービス | 原則 web/app の 1 サービス + 永続ボリューム。開発時の DB は SQLite ファイル |

### 2.2 維持する機能

| 区分 | 機能 | 移行後の提供方法 |
| --- | --- | --- |
| 公開ポータル | リンクのグリッド/カテゴリ表示、全文検索、タグ絞込み | `links.publicList` クエリとクライアント側表示 |
| リンク管理 | 作成、参照、更新、削除、公開/非公開 | 管理者専用 `links` ルーター |
| 分析 | クリック記録、人気ランキング、全体サマリー | `analytics.recordAccess` と集計クエリ |
| 認証 | 管理画面ログイン、ログアウト、セッション維持 | Better Auth の email/password または username/password アダプタ |
| APK | 管理者アップロード、一覧、ダウンロード | アップロード処理、DB メタデータ、静的/保護ダウンロード |
| 画像 | 管理者アップロード、一覧、リンクへの関連付け、配信 | 同上。画像 URL はアプリ内の配信 URL を保存 |
| エクスポート | 管理画面でのリンク JSON 出力 | 管理者専用のエクスポート機能 |

### 2.3 現行 API と新 API の対応

外部公開済みの REST API 利用者がない前提では、新規実装は tRPC を標準とする。第三者・他アプリが現行 REST API を利用している場合だけ、切替期間中に Hono の REST 互換エンドポイントを追加する。

| 現行 REST API | 新しいプロシージャ/機能 |
| --- | --- |
| `POST /api/auth/login` | Better Auth のログイン API |
| `GET /api/links`、`GET /api/links/{id}` | `links.publicList`、`links.byId` |
| `POST/PUT/DELETE /api/links...` | `links.create`、`links.update`、`links.remove` |
| `POST /api/links/{id}/access` | `analytics.recordAccess` |
| `GET /api/stats/popular` | `analytics.popular` |
| `GET /api/stats/summary` | `analytics.summary` |
| APK/画像の upload/list/download | `uploads` ルーターと HTTP ダウンロード・画像配信ハンドラー |

## 3. 採用する目標アーキテクチャ

### 3.1 Better T Stack の選定

Better T Stack の CLI で、以下を選択して新規プロジェクトを作成する。CLI の選択肢・生成物はバージョンで変わるため、開始時点の公式 CLI を使用し、ロックファイルで確定する。

| 分類 | 採用 | 理由 |
| --- | --- | --- |
| Runtime/package manager | Bun | Better T Stack との親和性、開発・ビルドの高速化 |
| Web フレームワーク | TanStack Start | ルーティング、SSR を必要に応じて利用でき、React UI を段階移植しやすい |
| API | tRPC | UI とサーバーの入出力型を共有するため |
| ORM | Drizzle ORM + Drizzle Kit | SQLite スキーマを TypeScript で定義し、SQL を明示的に扱えるため |
| Database | SQLite（`better-sqlite3`） | 本要件の単一ノード・低〜中程度の書込み量に適するため |
| Auth | Better Auth | Cookie ベースのセッション、パスワードハッシュ、認可の土台を提供するため |
| Validation | Zod | tRPC 入力、フォーム、アップロードの検証を共通化するため |
| Styling | 既存 CSS を初期移植。新規分は Tailwind CSS | 画面差分を抑えつつ段階的に整備するため |
| Test | Vitest + Playwright | DB/認可の単体・結合テストと主要画面の E2E テストを分離するため |

### 3.2 構成方針

- TanStack Start のサーバー実行環境に、tRPC と Better Auth を統合する。
- API 専用の別コンテナと PostgreSQL コンテナは廃止する。SQLite DB と uploads は**必ずホストまたは Docker named volume** に置く。
- ローカル開発は `data/portal.db`、コンテナ運用は `/data/portal.db` を `DATABASE_URL` として指定する。
- SQLite は単一ファイルであるため、アプリケーションを複数レプリカで同時に書き込む構成にはしない。複数台・高頻度書込みが必要になった時点で libSQL/Turso または PostgreSQL を再評価する。
- DB 接続の初期化で `PRAGMA foreign_keys = ON`、`journal_mode = WAL`、`busy_timeout` を有効化する。WAL のチェックポイントとバックアップ手順を運用に含める。
- 画像/APK 本体は DB BLOB に保存せずファイルシステムへ置き、DB には安全な保存名、MIME 型、サイズ、作成者、作成日時を保存する。

### 3.3 想定ディレクトリ

実際の scaffold 名称に合わせて調整するが、責務は以下に固定する。

```text
apps/web/
  src/routes/                 # 公開ポータル、ログイン、管理、分析
  src/components/             # 現行 React コンポーネントの移植先
  src/lib/auth.ts             # Better Auth 設定
  src/lib/trpc.ts             # tRPC クライアント/プロバイダ
  src/server/routers/         # links, analytics, uploads
  src/server/services/        # 保存・集計・ファイル操作
  src/server/db/              # Drizzle client/schema
  public/uploads/             # 開発用のみ。運用時は /data/uploads をマウント
  drizzle/                    # 生成済み migration SQL
scripts/
  export-postgres.ts          # 現行 DB の正規化エクスポート
  import-sqlite.ts            # SQLite への検証付き投入
  verify-migration.ts         # 件数・サンプル・集計照合
data/                         # Git 管理外の SQLite DB（開発用）
```

## 4. SQLite スキーマ設計

### 4.1 基本方針

`tags` は JSON 文字列のまま保存せず、検索・一意性・将来のカテゴリ拡張を考慮して正規化する。日時は UTC の ISO 8601 文字列または SQLite の整数 epoch milliseconds に統一する。Drizzle のマイグレーションで定義し、手作業で本番 DB を変更しない。

### 4.2 テーブル

| テーブル | 主な列 | 備考 |
| --- | --- | --- |
| `user`、`session`、`account`、`verification` | Better Auth が必要とする認証データ | Better Auth の SQLite/Drizzle スキーマに従う |
| `links` | `id`, `title`, `url`, `image_path`, `description`, `visible`, `created_at`, `updated_at` | `url` は HTTP/HTTPS を検証。`visible` の既定値は true |
| `tags` | `id`, `name`, `normalized_name`, `created_at` | `normalized_name` にユニーク制約。大文字小文字・空白差異を排除 |
| `link_tags` | `link_id`, `tag_id` | 複合主キー、両方に外部キー、リンク削除時に cascade |
| `access_logs` | `id`, `link_id`, `accessed_at`, `user_agent`, `ip_address`, `referer` | `ip_address` は SQLite では TEXT。個人情報保護方針に従い短期保持またはハッシュ化を判断 |
| `uploads` | `id`, `kind`, `stored_name`, `original_name`, `mime_type`, `size_bytes`, `created_by`, `created_at` | `kind` は `image` / `apk`。パス・元ファイル名を信頼しない |

必要なインデックスは `links(visible, created_at)`、`tags(normalized_name)`、`link_tags(tag_id, link_id)`、`access_logs(link_id, accessed_at)`、`access_logs(accessed_at)` とする。人気ランキングは SQLite の `LEFT JOIN` と条件付き `COUNT` で集計し、既存の PostgreSQL 専用 `INTERVAL` と `INET` は使用しない。

### 4.3 データ保持

- APK/画像の実ファイルは先にコピーし、DB トランザクション完了後に公開状態にする。失敗時は一時ファイルを削除する。
- `access_logs` は初期方針として 90 日保持とし、日次ジョブで削除または集計済みデータへ退避する。保持期間はサービス要件・プライバシー方針で最終決定する。
- SQLite DB、アップロードファイル、環境変数は別々にバックアップする。DB は日次 `VACUUM INTO` または SQLite のオンラインバックアップ API で世代管理し、復元テストを月次で行う。

## 5. セキュリティ・認可設計

1. Better Auth の email/password を使い、初期管理者を安全なセットアップ手順で作成する。既存の平文 `ADMIN_PASSWORD` と既定値 `admin123` は廃止する。
2. `user.role` を `admin` / `editor` / `viewer` として管理する。リンク変更、アップロード、分析詳細、JSON エクスポートは `admin` のみ許可する（必要時に `editor` を個別付与）。
3. 認可はルート表示の制御だけではなく、各 tRPC mutation/管理 query のサーバー側ミドルウェアで検証する。
4. Better Auth の HttpOnly/Secure/SameSite Cookie を使う。クライアントの `sessionStorage` を認可根拠にしない。
5. アップロードは管理者限定、拡張子だけでなく MIME・マジックバイト・サイズで検証する。制限は画像 10 MB、APK 100 MB を現行互換の初期値とする。
6. 保存ファイル名は UUID 等で生成し、パス走査を拒否する。画像配信時は許可済みメタデータのみを参照し、`Content-Type`、`Content-Disposition`、`X-Content-Type-Options: nosniff` を設定する。
7. アクセス記録ではプロキシを信頼する構成を明文化する。信頼できるリバースプロキシ配下以外では任意の `X-Forwarded-For` を IP として採用しない。

## 6. 実施フェーズ

### Phase 0: 事前確定（0.5〜1 日）

- Better T Stack の scaffold バージョン、Bun のバージョン、Node 互換性、配備方式を固定する。
- `links` の完全な PostgreSQL DDL を実 DB から取得する。リポジトリには `access_logs` の DDL しかなく、`links` の初期定義が確認できないため必須である。
- 本番/検証 DB の `links`、`access_logs` 件数、最大 APK/画像サイズ、保存済みファイル総量、既存 REST API 利用者の有無を棚卸しする。
- 認証の移行方針（初期管理者、ユーザー招待の有無、既存パスワードを移行しないこと）とアクセスログ保持期間を承認する。

**完了条件:** 移行対象データ、停止時間、ロール、バックアップ保管先、ロールバック責任者を記録して承認済みである。

### Phase 1: 新基盤作成（1〜2 日）

- 別ディレクトリまたは別ブランチに Better T Stack を scaffold する。
- Drizzle、SQLite、Better Auth、tRPC、Zod、テスト基盤を組み込む。
- 環境変数テンプレート（`DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、アップロード先、初期管理者作成用値）を作成し、秘密情報を Git 管理から除外する。
- SQLite 初期化、マイグレーション適用、seed、Docker volume、ヘルスチェック、バックアップコマンドを整備する。

**完了条件:** 空の環境を起動し、マイグレーション、初期管理者の作成、ログイン/ログアウトが自動テストで成功する。

### Phase 2: ドメイン・API 実装（2〜3 日）

- Drizzle schema と migration を作成する。
- `links`、`analytics`、`uploads` ルーターを、公開 query・認証済み query・管理 mutation に分けて実装する。
- URL、タグ、ページサイズ、`period`（`all` / `7d` / `30d`）、アップロードの Zod スキーマを定義する。
- リンク削除時の `link_tags`、`access_logs`、関連画像の扱いを明示する。共有画像は削除しない等のポリシーをテストで固定する。
- 集計クエリに対する空データ、非公開リンク、期間境界、時刻 UTC のテストを実装する。

**完了条件:** 現行 API の機能をすべて新プロシージャで満たし、未認証・権限不足の書込みが拒否される。

### Phase 3: UI 移植（2〜4 日）

- ポータル画面を先に移植し、検索、タグ絞込み、グリッド/カテゴリ表示、クリック記録を接続する。
- 管理画面を移植し、リンク CRUD、公開切替、画像選択、APK 管理、JSON エクスポートを接続する。
- 分析画面を移植し、期間別ランキングとサマリーを接続する。
- 既存 CSS を優先して見た目を維持し、コンポーネント移植完了後に Tailwind 化を別タスクにする。

**完了条件:** 主要ブラウザで公開画面・管理画面の操作が現行と同等に行え、画面からの不正操作時もサーバーで拒否される。

### Phase 4: データ・ファイル移行（1〜2 日）

1. 現行 PostgreSQL を読み取り専用にして最終エクスポートを取得する。
2. `links` を正規化し、タグ文字列を `tags` / `link_tags` に変換する。URL、重複タグ、NULL、文字コードを検証する。
3. `access_logs` の `ip_address` を TEXT に変換する。保持期限外データは事前に除外する場合、その件数を記録する。
4. APK/画像をハッシュ比較しながら新しい永続アップロード先へコピーし、`uploads` レコードと `links.image_path` を生成する。
5. トランザクション単位で SQLite に投入し、失敗時に DB と一時ファイルを破棄して再実行できるスクリプトにする。
6. 件数、ID 対応表、タグ数、ファイル数・ハッシュ、統計サマリー、人気リンク上位 10 件を旧新で照合する。

**完了条件:** 未承認の差分がゼロであり、照合レポートと移行ログを保存済みである。

### Phase 5: 受入・切替・監視（1〜2 日）

- ステージングで E2E、アップロード、ダウンロード、復元、負荷の軽い並行クリック記録を実施する。
- 切替直前に書込みを停止し、最終差分を移行して新環境へトラフィックを切り替える。
- 旧環境は即時削除せず、読み取り専用で合意済みの保管期間維持する。
- 切替後はログイン、リンク作成、公開表示、クリック計上、ファイル配信、DB バックアップを監視する。

**完了条件:** 切替後 1 営業日以上、重大障害なく受入基準を満たす。ロールバック不要の承認を得る。

## 7. テスト・受入基準

| 領域 | 合格基準 |
| --- | --- |
| 型・ビルド | TypeScript の型検査、lint、production build が成功する |
| DB | migration を空 DB に適用でき、外部キー・cascade・インデックスが有効である |
| 認証/認可 | 未ログイン、`viewer`、`editor`、`admin` の各境界を自動テストする。管理 mutation は必ずサーバー側で拒否/許可される |
| リンク | 公開側は `visible=true` のみを返し、管理側は全件を操作できる。タグの作成、更新、削除、検索を確認する |
| 分析 | クリックを 1 件記録でき、全期間/7日/30日とサマリーが期待値に一致する |
| ファイル | 不正 MIME、超過サイズ、パストラバーサルを拒否し、正当な画像/APK は管理者だけがアップロードできる |
| データ移行 | テーブル件数、タグ関連、ファイルハッシュ、人気リンク上位、集計値の差分が承認済み範囲内である |
| 運用 | コンテナ再作成後も DB・uploads が残り、バックアップから別環境へ復元できる |

## 8. ロールバック方針

- 切替前に PostgreSQL ダンプ、SQLite DB、uploads のスナップショット、環境変数の安全なバックアップを取得する。
- DNS/リバースプロキシの向き先を旧環境へ戻せるよう、旧コンテナと DB volume を保持する。
- 新環境の書込みが発生した後にロールバックする場合は、新規リンク・アップロード・アクセスログを JSON/CSV とファイル一覧で退避し、データ欠損として記録する。SQLite から PostgreSQL への自動逆同期は本リプレイスの対象外とする。
- ロールバック判断は、ログイン不能、公開リンクの重大欠損、ファイル配信不能、データ照合不一致、またはバックアップ不能を発生条件とする。

## 9. 主要リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| `links` の現行完全 DDL が不明 | データ欠落・型変換失敗 | Phase 0 で実 DB の schema を取得し、移行マッピングをレビューする |
| SQLite を複数コンテナで書込み | ロック競合・破損リスク | 単一 writer/単一アプリ構成、WAL、`busy_timeout`、将来の DB 再評価条件を採用 |
| Docker volume 未設定の uploads | 再デプロイでファイル消失 | DB と uploads の永続 named volume、バックアップ/復元テストを必須化 |
| 現行認証が実質クライアント依存 | 管理機能の不正利用 | Better Auth とサーバー側 role middleware を全管理 API に適用 |
| アクセスログが無制限に増える | SQLite 容量・集計性能低下 | 保持期間、インデックス、日次クリーンアップ、必要に応じた日次集計を導入 |
| REST 利用者の見落とし | 他サービス連携が停止 | Phase 0 で利用者を確認。必要時のみ REST 互換層を期限付きで提供 |
| SQLite と画像/APK のバックアップ分離 | 復元時の整合性欠落 | 同一世代 ID で DB と uploads をバックアップし、月次復元演習を行う |

## 10. 実装開始前に決定する事項

1. 配備先は単一ホスト/単一コンテナでよいか。複数レプリカや高可用性が必要なら SQLite は再検討する。
2. 外部システムは既存 REST API を利用しているか。利用している場合、互換 API の期限はいつまでか。
3. 初期管理者の作成方法と、`admin` 以外のロールを運用するか。
4. IP アドレスを収集し続ける業務上の必要性、ログの保持期間、削除方針。
5. APK のダウンロードを公開のままにするか、ログイン済み利用者に限定するか。
6. 本番の永続ボリューム、暗号化、バックアップの保管先と保持世代。
7. 切替可能な停止時間と、移行後に旧環境を保持する期間。

これらが確定後、Phase 1 から実装を開始する。
