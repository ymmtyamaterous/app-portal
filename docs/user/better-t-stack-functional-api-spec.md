# Better T Stack + SQLite 機能・API・データ仕様書

## 1. 位置付け

本書は [移行計画書](better-t-stack-sqlite-replacement-plan.md) を実装可能な要件へ具体化する補助仕様書である。別環境で実装する際は、本書、移行計画書、セキュリティ・ファイル仕様書、移行・運用・受入仕様書を一組として使用する。

未決定事項は実装者の判断で確定してはならない。`要決定` とした項目を承認するまでは、該当機能を feature flag、設定値、または仮実装として分離する。

## 2. 利用者・画面・遷移

| 利用者 | 利用できる画面 | 権限 |
| --- | --- | --- |
| 匿名利用者 | `/` | 公開済みリンクの閲覧、検索、リンク遷移 |
| 管理者 | `/admin` | 匿名利用者の権限に加え、リンク、ファイル、分析、エクスポートの操作 |

- `/` は公開ポータルである。公開済み（`visible = true`）のリンクだけを表示する。
- `/admin` は未ログイン時にログイン画面へ遷移する。認証済みだが管理者権限を持たない場合は 403 画面を表示する。
- 管理画面は `管理` と `分析` の 2 タブを持つ。
- すべての日時は DB では UTC、画面では `ja-JP` ロケールで表示する。

## 3. 機能要件

### 3.1 公開ポータル

| 項目 | 仕様 |
| --- | --- |
| ヘッダー | `Yamaterous Portal` と管理画面への導線を表示する |
| 一覧 | カードに画像（あれば）、タイトル、説明、タグを表示する |
| 表示モード | グリッド表示とカテゴリ（タグ別）表示を切り替えられる |
| 検索 | タイトル、説明、タグを対象に大文字小文字を区別せず部分一致で絞り込む |
| タグ絞込み | 1 タグを選択して対象リンクを絞り込む。選択解除で全件へ戻る |
| 遷移 | カードのリンクを開く直前にクリック記録を非同期送信する。記録失敗は遷移を阻害しない |
| 状態表示 | 取得中は `読み込み中...`、取得失敗時は `エラーが発生しました: {詳細}`、0 件時は 0 件であることを示す表示を行う |

検索・タグ絞込みは、初期実装では取得済みの公開リンクをクライアント側で処理する。公開リンク数が 500 件を超える、または検索をサーバー側に移したい場合はページングと `query`/`tag` 入力を追加する。

### 3.2 管理: リンク

リンクの作成・編集フォームは次の項目を持つ。

| 項目 | 型 | 必須 | 規則 |
| --- | --- | --- | --- |
| タイトル | 文字列 | はい | トリム後 1〜120 文字 |
| URL | 文字列 | はい | `https:` または `http:` の絶対 URL、最大 2,048 文字 |
| 説明 | 文字列 | いいえ | 最大 2,000 文字 |
| タグ | カンマ区切り文字列 | いいえ | 各タグをトリムし、空要素を除外、1〜30 文字、最大 20 件 |
| 画像 | ファイルまたは既存画像選択 | いいえ | 画像仕様に従う |
| APK | ファイル | いいえ | APK 仕様に従う。アップロード後のダウンロード URL をリンク URL に設定する |
| 公開 | 真偽値 | はい | 作成時の既定値は true |

- `APK` を選択した場合、`URL` はアップロード成功後に得られる APK ダウンロード URL で上書きする。外部 URL と APK の同時指定はできない。
- 同じ正規化 URL の重複登録は**許可する**。業務上不要と確定した場合のみ、将来の migration で一意制約へ変更する。
- 編集では関連付け済み画像を維持、置換、解除できる。APK は URL を別の APK または外部 URL に置換できる。
- 削除は確認ダイアログを表示してから実行する。リンクを物理削除し、アクセスログとタグ中間レコードは DB の cascade で削除する。
- 管理一覧には ID、公開状態、画像、タイトル、URL、説明、タグ、編集、削除を表示する。非公開行は視覚的に区別する。

### 3.3 管理: 分析とエクスポート

- サマリーは総リンク数、総クリック数、本日、過去 7 日、過去 30 日、クリック済みユニークリンク数を表示する。
- 人気リンクは既定で過去 7 日、上位 10 件とし、`全期間`、`過去 7 日`、`過去 30 日` に切り替え可能とする。
- 各行は ID、タイトル、URL、選択期間のクリック数、最終アクセス日時（存在しない場合は `未アクセス`）を表示する。
- 更新操作はページ全体を再読み込みせず、関連 query を再取得する。
- エクスポートは管理者が実行できる。全リンク（公開・非公開）、関連タグ、作成・更新日時を JSON でダウンロードする。アクセスログとファイル本体は含めない。ファイル名は `portal-links-YYYYMMDDTHHMMSSZ.json` とする。

## 4. API 契約

アプリケーション内部 API は tRPC とする。REST 互換 API は外部利用が確認された場合だけ提供する。認証 API は Better Auth が提供する API を使い、以下の tRPC ルーターにはログイン ID/パスワードを実装しない。

### 4.1 共通規約

- 正常時は tRPC の型付き result を返す。
- 入力検証違反は `BAD_REQUEST`、未ログインは `UNAUTHORIZED`、権限不足は `FORBIDDEN`、対象なしは `NOT_FOUND`、競合は `CONFLICT`、予期しない障害は `INTERNAL_SERVER_ERROR` とする。
- 利用者向け文言と内部原因・スタックトレースを分離する。クライアントに DB エラーや保存パスを返さない。
- `createdAt`、`updatedAt`、`accessedAt` は ISO 8601 UTC 文字列として送受信する。

### 4.2 `links` ルーター

| 手続き | 種別 | 権限 | 入力 | 出力 |
| --- | --- | --- | --- | --- |
| `publicList` | query | 公開 | なし | `Link[]`。`visible=true` のみ |
| `byId` | query | 管理者 | `{ id: positive int }` | `Link` |
| `adminList` | query | 管理者 | なし | `Link[]`。公開・非公開を含む |
| `create` | mutation | 管理者 | `LinkInput` | 作成後の `Link` |
| `update` | mutation | 管理者 | `{ id, ...LinkInput }` | 更新後の `Link` |
| `remove` | mutation | 管理者 | `{ id }` | `{ id }` |

`LinkInput` は `{ title, url, description?: string, tagNames: string[], imageUploadId?: string | null, visible: boolean }` とする。`imageUploadId: null` は画像の解除、未指定は既存画像を維持する（create 時は画像なし）。

`Link` は `{ id, title, url, description: string | null, imageUrl: string | null, tags: string[], visible, createdAt, updatedAt }` とする。DB の内部保存名、絶対ファイルパス、認証情報を含めない。

### 4.3 `analytics` ルーター

| 手続き | 種別 | 権限 | 入力 | 出力 |
| --- | --- | --- | --- | --- |
| `recordAccess` | mutation | 公開 | `{ linkId: positive int }` | `{ recorded: true }` |
| `popular` | query | 管理者 | `{ period: 'all' | '7d' | '30d'; limit?: 1..100 }` | `LinkStats[]` |
| `summary` | query | 管理者 | なし | `StatsSummary` |

`recordAccess` は対象リンクが存在し、かつ公開中の場合だけ記録する。対象がない、または非公開の場合は情報を漏らさないため `{ recorded: false }` を返す。

`LinkStats` は `{ id, title, url, totalClicks, clicksLast7Days, clicksLast30Days, lastAccessed: string | null }`、`StatsSummary` は `{ totalLinks, totalClicks, clicksToday, clicksThisWeek, clicksThisMonth, uniqueLinksClicked }` とする。ランキングの並び順は選択期間のクリック数降順、同数時は `lastAccessed` 降順、さらに ID 昇順とする。

### 4.4 `uploads` ルーターと HTTP 配信

ファイル本体は multipart/form-data が適するため、アップロード・ダウンロードは HTTP ハンドラーとする。ファイルメタデータ一覧のみ tRPC query としてよい。

| HTTP エンドポイント | 権限 | 内容 |
| --- | --- | --- |
| `POST /api/uploads/images` | 管理者 | field 名 `image` の画像を 1 件アップロードし、`Upload` を返す |
| `POST /api/uploads/apks` | 管理者 | field 名 `apk` の APK を 1 件アップロードし、`Upload` を返す |
| `GET /media/images/{uploadId}` | 公開 | 関連リンクが公開中の画像だけを inline 配信する |
| `GET /downloads/apks/{uploadId}` | 要決定 | APK を attachment 配信する |

`Upload` は `{ id, kind: 'image' | 'apk', originalName, sizeBytes, mimeType, url, createdAt }` とする。アップロードのサイズ・形式・ヘッダーはセキュリティ・ファイル仕様書に従う。

## 5. データモデル

### 5.1 アプリケーション固有テーブル

| テーブル | カラム | 制約 |
| --- | --- | --- |
| `links` | `id`, `title`, `url`, `description`, `image_upload_id`, `visible`, `created_at`, `updated_at` | `id` は整数主キー。タイトルと URL は NOT NULL。`image_upload_id` は `uploads.id` への SET NULL 外部キー |
| `tags` | `id`, `name`, `normalized_name`, `created_at` | `normalized_name` は UNIQUE、NOT NULL |
| `link_tags` | `link_id`, `tag_id` | 複合主キー。両外部キーは ON DELETE CASCADE |
| `access_logs` | `id`, `link_id`, `accessed_at`, `user_agent`, `ip_address_hash`, `referer` | `link_id` は ON DELETE CASCADE。IP は生値を保存しない |
| `uploads` | `id`, `kind`, `stored_name`, `original_name`, `mime_type`, `size_bytes`, `created_by`, `created_at` | `kind` は image/apk。`stored_name` は UNIQUE。`created_by` は user への SET NULL 外部キー |

- Better Auth の `user`、`session`、`account`、`verification` は採用する adapter が要求する定義に従い、`user.role` は `admin` または `viewer` とする。初期リリースでは `editor` を作成しない。
- タグの `normalized_name` は Unicode NFC 正規化、前後空白削除、連続空白を 1 個へ圧縮、Unicode 小文字化した値とする。表示用 `name` は最初に登録された正規化済み表示を使用する。
- `links.updated_at` はアプリケーション側で更新する。SQLite 固有トリガーに依存しない。
- 日時は UTC の Unix epoch milliseconds を SQLite INTEGER に保存する。

### 5.2 インデックス

`links(visible, created_at)`、`tags(normalized_name)`、`link_tags(tag_id, link_id)`、`access_logs(link_id, accessed_at)`、`access_logs(accessed_at)`、`uploads(kind, created_at)` を作成する。

## 6. 未決定事項（承認が必要）

| ID | 項目 | 本書の仮定・提案 | 決定者 |
| --- | --- | --- | --- |
| D-01 | APK の公開範囲 | 既存動作に合わせ公開ダウンロード | プロダクト責任者 |
| D-02 | IP 情報 | 生 IP を保存せず、日替わり salt を用いた不可逆ハッシュを保存 | 運用・セキュリティ責任者 |
| D-03 | クリックログ保持 | 設定可能、既定 90 日 | 運用責任者 |
| D-04 | URL の許可範囲 | HTTP/HTTPS 絶対 URL のみ | プロダクト責任者 |
| D-05 | 既存 API 互換 | 外部利用がない場合は提供しない | システム管理者 |
| D-06 | 旧データのタグ統合 | 本書の正規化規則により統合する | プロダクト責任者 |

D-01〜D-06 と現行 PostgreSQL の `links` 完全 DDL が確定するまで、本番データ移行・本番切替は開始してはならない。
