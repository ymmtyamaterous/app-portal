# Better T Stack + SQLite セキュリティ・ファイル管理仕様書

## 1. 適用範囲

本書は、認証、認可、セッション、アップロード、ファイル配信、アクセスログを対象とする。実装計画は [移行計画書](better-t-stack-sqlite-replacement-plan.md)、画面・API・データ契約は [機能・API・データ仕様書](better-t-stack-functional-api-spec.md) を参照する。

## 2. 認証・初期管理者

- Better Auth を Drizzle/SQLite adapter とともに使用する。
- サインアップを公開しない。初期管理者は、デプロイ時に 1 回だけ実行する CLI `seed-admin` で作成する。
- CLI は `INITIAL_ADMIN_EMAIL`、`INITIAL_ADMIN_PASSWORD` を必須とし、パスワードを標準出力・ログ・DB seed ファイルへ出力しない。
- 作成後は `INITIAL_ADMIN_PASSWORD` を運用環境から削除する。CLI は同じ email がある場合に失敗し、既存アカウントを上書きしない。
- 初期リリースの認可ロールは `admin` と `viewer`。管理者作成・ロール変更 UI は作らない。必要時は管理 CLI で変更する。
- パスワードポリシーは 12 文字以上、最大 128 文字とする。Better Auth の安全なパスワードハッシュ方式を使い、独自の平文照合・独自ハッシュを実装しない。

## 3. 認可マトリクス

| 操作 | 匿名 | viewer | admin |
| --- | --- | --- | --- |
| 公開リンクの一覧・閲覧 | 許可 | 許可 | 許可 |
| 公開リンクのクリック記録 | 許可 | 許可 | 許可 |
| 画像の公開配信 | 許可 | 許可 | 許可 |
| APK ダウンロード | D-01 の決定に従う | D-01 の決定に従う | 許可 |
| 管理用リンク一覧・詳細 | 拒否 | 拒否 | 許可 |
| リンクの作成・更新・削除 | 拒否 | 拒否 | 許可 |
| 分析・エクスポート | 拒否 | 拒否 | 許可 |
| 画像/APK の一覧・アップロード | 拒否 | 拒否 | 許可 |

- UI の経路制御は補助機能であり、必ずサーバーの tRPC procedure または HTTP handler で同じ認可を検証する。
- 無効・期限切れセッションは 401、ログイン済みで権限不足は 403 を返す。
- 管理ページ・管理 API・アップロード API は `Cache-Control: no-store` とする。

## 4. セッションと HTTP セキュリティ

- Better Auth が発行する HttpOnly Cookie を用いる。JavaScript からトークンを読める `localStorage`/`sessionStorage` ベースの認可は使用しない。
- 本番は HTTPS 必須とし、Cookie には `Secure`、`HttpOnly`、`SameSite=Lax` を設定する。別オリジン構成で Cookie を送る必要がある場合だけ `SameSite=None` と CSRF 対策を併用する。
- 認証失敗はアカウント列挙を避けるため、常に `メールアドレスまたはパスワードが正しくありません。` と表示する。
- ログインとアップロードには IP/アカウント単位の rate limit を設ける。初期値はログイン 5 回/15 分、アップロード 20 回/時とする。制限値は環境変数で変更できる。
- CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY` を設定する。CSP は利用する画像配信先・分析先だけを明示許可する。

## 5. アップロード仕様

### 5.1 共通ルール

- 受け付ける multipart field は画像 `image`、APK `apk` の各 1 ファイルだけである。余分なフィールド・複数ファイルは 400 で拒否する。
- 認可・サイズ上限・拡張子・実ファイルのマジックバイト・MIME をすべて検査してから保存する。
- 元のファイル名は表示用にサニタイズして保持するが、ファイルシステムのパスに使用しない。
- 保存名は UUID v4 と許可済み拡張子から生成する。例: `550e8400-e29b-41d4-a716-446655440000.webp`。
- 一時保存先へ書き込み、検証・DB レコード作成の成功後に永続保存先へ atomic rename する。失敗した一時ファイルは削除する。
- DB の `uploads.stored_name` からのみ配信先を解決する。URL で受け取った任意のファイルパスを結合・参照しない。
- アップロード失敗の内部情報、物理パス、スタックトレースを利用者へ返さない。

### 5.2 画像

| 項目 | 値 |
| --- | --- |
| 許可形式 | JPEG、PNG、GIF、WebP |
| 拡張子 | `.jpg`、`.jpeg`、`.png`、`.gif`、`.webp` |
| MIME | `image/jpeg`、`image/png`、`image/gif`、`image/webp` |
| 最大サイズ | 10 MiB |
| SVG | 拒否（スクリプト混入の余地を避ける） |
| 配信 | `Content-Disposition: inline`、記録済み MIME、`nosniff` |

### 5.3 APK

| 項目 | 値 |
| --- | --- |
| 許可拡張子 | `.apk` |
| 最大サイズ | 100 MiB |
| 検証 | ZIP/APK 形式であることを確認し、少なくとも `AndroidManifest.xml` の存在を確認する |
| 配信 MIME | `application/vnd.android.package-archive` |
| 配信 | `Content-Disposition: attachment; filename*=UTF-8''...`、`nosniff` |
| ウイルススキャン | 要決定。組織要件がある場合は永続保存前に ClamAV 等を必須化する |

## 6. 関連付けと削除

- `links.image_upload_id` は画像 upload だけを参照できる。APK は `links.url` にアプリ内ダウンロード URL を保存する。
- 画像を置換・解除・リンク削除しても upload 本体を即時削除しない。削除候補として扱い、他のリンクの `image_upload_id` が参照していないことを確認した後に削除する。
- APK はリンク URL から参照される可能性があるため、初期リリースでは管理画面から物理削除を提供しない。不要ファイルは管理 CLI の dry-run と参照確認を経て削除する。
- ファイル削除は DB レコードと実ファイルの整合を監査ログへ残す。DB 削除失敗時はファイルを削除しない。ファイル削除失敗時は DB レコードを残し、再試行可能とする。

## 7. 永続化とバックアップ

- 運用コンテナは `/data/portal.db` と `/data/uploads/{images,apk}` を同じ永続ボリュームにマウントする。アプリケーションイメージ内へデータを保存しない。
- 起動時に SQLite へ `PRAGMA foreign_keys = ON`、`PRAGMA journal_mode = WAL`、`PRAGMA busy_timeout = 5000` を設定する。
- アプリケーションは単一レプリカ、単一 writer で運用する。SQLite DB がネットワークファイルシステム上にある場合は WAL のサポート可否を確認し、未保証ならローカル block storage を使用する。
- 日次で DB の整合したバックアップと uploads のスナップショットを同一世代 ID で取得する。最低 30 世代を保持する。
- バックアップ前に `wal_checkpoint(TRUNCATE)` を実行するか、SQLite の backup API/VACUUM INTO を用いて整合した DB を出力する。
- 月 1 回、隔離環境へ DB と uploads を復元し、ログイン、公開リンク、画像、APK の取得まで確認する。

## 8. アクセスログと個人情報

- `user_agent`、`referer` は最大 2,000 文字で切り詰め、制御文字を除去する。
- 生 IP は保存しない。信頼済みリバースプロキシが付与したクライアント IP を、日替わり salt による SHA-256 ハッシュへ変換して保存する。salt はログや DB に保存しない。
- 信頼済みプロキシからの接続だけ `CF-Connecting-IP`、`X-Forwarded-For`、`X-Real-IP` を参照する。直接接続からのこれらのヘッダーは信用しない。
- `access_logs` は既定で 90 日後に日次ジョブで削除する。保持期間は `ACCESS_LOG_RETENTION_DAYS`（1〜365、既定 90）で設定する。
- アクセスログの閲覧は `admin` のみに限定し、エクスポート対象には含めない。

## 9. 必須監査・テスト

- 匿名利用者がすべての管理 query/mutation、アップロード、分析、エクスポートを実行できないこと。
- 改ざんした Cookie、期限切れセッション、viewer セッションが管理操作をできないこと。
- 拡張子偽装、SVG、超過サイズ、複数ファイル、パストラバーサル名、破損 APK を拒否すること。
- コンテナ再作成後も DB とファイルが保持され、バックアップから復元できること。
