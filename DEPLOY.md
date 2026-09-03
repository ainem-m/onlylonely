# コーディングエージェント向けデプロイ手順

この文書は、`https://github.com/ainem-m/onlylonely`から、利用者専用のCloudflare Workers URLを作る作業契約です。

## 完了条件

次の条件をすべて満たした時点で、デプロイ完了とします。

- 利用者のCloudflareアカウントへ、このリポジトリからWorkerとD1データベースを作成している。
- リポジトリ内のD1マイグレーションをすべて本番データベースへ適用している。
- `SESSION_SECRET`と`ADMIN_SETUP_SECRET`を秘密値として登録し、ソース、Git履歴、ログ、会話へ残していない。
- 公開URLの`/api/health`が、HTTP 200と`{"ok":true}`を返す。
- 公開URLの`/admin`が初回設定画面を表示する。
- 利用者へ公開URL、Worker名、D1名、確認結果、未確認事項を報告する。

管理PINの決定と初回設定は利用者が行います。
エージェントがPINを決めたり、会話へ入力させたりする必要はありません。

## 推奨する公開方法

Cloudflare公式のDeploy to Cloudflareフローを使います。

1. 次のURLを利用者に開いてもらいます。

   `https://deploy.workers.cloudflare.com/?url=https://github.com/ainem-m/onlylonely`

2. CloudflareとGitHubの認証、Cloudflareアカウントの選択は利用者に操作してもらいます。

3. `SESSION_SECRET`と`ADMIN_SETUP_SECRET`には、互いに異なる32文字以上のランダム値を利用者に入力してもらいます。

4. デプロイ設定のコマンドが次の内容になっていることを確認します。

   ```text
   npm run deploy
   ```

5. デプロイを実行します。
   `package.json`のdeploy処理がD1マイグレーションを適用してからWorkerを公開します。

6. 公開URLを取得し、`/api/health`と`/admin`を確認します。

Deploy to Cloudflareは、利用者のアカウントへリポジトリをコピーし、Wrangler設定からD1を自動作成します。
元の`ainem-m/onlylonely`へ変更をpushするフローではありません。

## CLIで直接公開する場合

Deploy to Cloudflareフローを使えない場合に限り、READMEの「Cloudflareへ公開」に従います。

エージェントは次の境界を守ります。

- `npx wrangler login`でブラウザ認証が必要になったら、利用者へ操作を依頼する。
- 複数のCloudflareアカウントを選べる場合は、対象を推測せず利用者へ確認する。
- `.env.production`はGit対象外のローカルファイルとして作り、権限を所有者だけの読み書きに制限する。
- 秘密値をコマンド引数、標準出力、コミット、報告文へ含めない。
- 同名のWorkerやD1が存在する場合は、上書きや再利用の前に利用者へ確認する。
- リモートマイグレーションとデプロイは外部状態を書き換えるため、対象を示してから実行する。

## エージェントへ渡す依頼文

次の文章をリポジトリURLと一緒に渡せます。

```text
このリポジトリのDEPLOY.mdに従い、私のCloudflareアカウントへデプロイして、遊べる公開URLを作ってください。
CloudflareやGitHubの認証、アカウント選択、秘密値入力が必要になったら作業を止め、私に操作を依頼してください。
秘密値を会話、ログ、ソース、Git履歴へ出さないでください。
同名のWorkerまたはD1がすでに存在する場合は、上書きせず確認してください。
デプロイ後は/api/healthと/adminを確認し、公開URL、作成したリソース、確認結果を報告してください。
```

## 失敗時の扱い

マイグレーションまたはデプロイが失敗した場合は、成功したものとして報告しません。
エージェントはエラーから秘密値を除いた要点、作成済みリソース、再実行するコマンドを報告します。
作成済みのWorker、D1、リポジトリを独断で削除せず、再試行か削除かを利用者へ確認します。

## Cloudflare公式資料

- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [WorkersのSecrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [D1のWranglerコマンド](https://developers.cloudflare.com/d1/wrangler-commands/)
