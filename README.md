# ONLY LONELY

懇親会用の投票・段階発表Webアプリです。Cloudflare Workers Static Assets と D1 だけで動作します。

> [!IMPORTANT]
> 本プロジェクトは、ほぼ日刊イトイ新聞で実施された[「ONLYでLONELY」](https://www.1101.com/only_lonely/2003-04.html)に着想を得た非公式のWeb実装です。株式会社ほぼ日による公式・公認プロジェクトではありません。公式の文章、画像、ロゴ、デザイン等は使用していません。

## 自分のURLへ公開する

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ainem-m/onlylonely)

上のボタンからCloudflareへログインすると、このリポジトリのコピー、D1データベースの作成、マイグレーション、Workerの公開まで進められます。
設定画面では、`SESSION_SECRET`と`ADMIN_SETUP_SECRET`へ互いに異なる32文字以上のランダム値を入力してください。
公開後に表示されたURLの末尾へ`/admin`を付け、`ADMIN_SETUP_SECRET`と任意の4〜8桁の管理PINで初回設定を完了すると遊べます。

コーディングエージェントへ公開を依頼する場合は、リポジトリURLとともに[`DEPLOY.md`](DEPLOY.md)を読むよう伝えてください。
Cloudflareの認証、アカウント選択、秘密値の入力は利用者が行い、エージェントへ秘密値を貼り付けないでください。

## ローカル起動

Node.js 22以上が必要です。
依存関係は `package-lock.json` に固定されているため、clone後は `npm ci` で再現します。

```bash
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply only-lonely-db --local
npm run dev
```

- 参加者: `http://localhost:8787/`
- 司会者: `http://localhost:8787/admin`
- 会場表示: `http://localhost:8787/present`
- ルール説明: `http://localhost:8787/rules`

`.dev.vars` の `SESSION_SECRET` と `ADMIN_SETUP_SECRET` は、それぞれ別の十分長いランダム値へ変更してください。
`SESSION_SECRET` は管理セッションの保護に使い、`ADMIN_SETUP_SECRET` は初回の管理PIN設定フォームへ入力します。
初回設定が済んでも、`.dev.vars` を公開したりGitへ追加したりしないでください。

## 確認

静的検査と単体・契約テストは次のコマンドで実行します。

```bash
npm run check
npm test
npm run test:e2e
```

`npm test` は単体・契約テストを実行します。
`npm run test:e2e` は、まっさらな一時D1とローカルWorkerをシナリオごとに起動し、初回PIN設定、ゲーム作成、投票、発表、削除などのAPI導線を確認します。
実ブラウザでの見た目や印刷結果の確認は含みません。

## Cloudflareへ公開

この節は、Deploy to Cloudflareボタンを使わず、現在のcloneをWranglerから直接公開する場合の手順です。

```bash
npx wrangler login
npx wrangler d1 create only-lonely-db
```

表示された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id`（初期値はゼロのプレースホルダー）に設定します。
Git対象外の `.env.production` を作成し、別々に生成した32文字以上の値を設定します。

```bash
SESSION_SECRET="..."
ADMIN_SETUP_SECRET="..."
```

次の2操作はCloudflare側への書き込みです。対象アカウントとWorker名を確認して実行します。

```bash
npx wrangler d1 migrations apply only-lonely-db --remote
npx wrangler deploy --secrets-file .env.production
```

`--secrets-file` はコードと2つの秘密値を1つのWorkerバージョンとして公開します。
公開後に個別の値を [`wrangler secret put`](https://developers.cloudflare.com/workers/configuration/secrets/#adding-secrets-to-your-project) で変更すると、その操作自体が新しいバージョンを直ちにデプロイします。

デプロイ後、最初に `/admin` を開き、`ADMIN_SETUP_SECRET` と4〜8桁の管理PINを入力して初回設定を完了します。
管理画面は状態ごとに「次にすること」を1つ表示し、ゲーム作成、投票開始、未投票確認、代理入力、票の解除、締切・取消、発表進行、全回答分布を操作できます。
作成ミスは投票開始前に限り「設定をやり直す」から破棄できます。
投票受付中は管理APIにも票の数字を返しません。

## 参加者の登録方法

ゲーム作成時に2つのモードから選べます。

- **名簿を事前登録**: 従来どおり、司会者が参加者名を1行に1名ずつ登録します。
- **番号QRから本人が初回登録**: 司会者は参加人数だけを設定し、「参加者01〜N」の番号カードを印刷します。参加者は本人専用QRを読み取り、司会者が読み上げてよい名前を登録してから投票します。

本人登録モードでは、所属欄の表示、表示名、必須／任意、優勝者発表への表示可否を設定できます。入力方法は従来どおりの自由入力に加え、1行1件で候補を設定する選択式にも対応します。選択式では初期選択と「その他（自由入力）」の許可を設定でき、「その他」を許可しない場合は候補外の値をAPIでも拒否します。参加者一覧の氏名・所属は共用端末へ返さず、所属は許可したゲームの優勝者発表にだけ表示します。

番号はカードの照合用です。本人登録・投票の認証には、個人QRまたは管理画面から開いた共用端末URLに含まれる推測不能なランダムトークンを使用します。番号だけでは登録・投票できません。

## 当日の参加導線

ゲーム作成後、管理画面の「参加者QRカード」から個人名入りQRカードをA4で印刷します。参加者は自分のカードを読み取ると、氏名が確定した状態で「数字選択 → 氏名と数字の最終確認 → 投票完了」へ進みます。投票開始前に読み取った場合は待機画面が自動更新されます。カードには投票内容は含まれず、ゲームごとのランダムな参加トークンだけを使用します。

スマートフォンを使えない参加者には、管理画面の「共用端末」から `/shared` を表示した端末を渡します。参加者は氏名候補を直接タップして投票し、完了後に「入力を消して次の人へ」を押します。選択氏名、数字、画面状態はそこでリセットされます。

共用端末は、司会者が監督する信頼済み端末として使います。
共用端末URLを参加者へ配布・転送したり、端末を無人のまま置いたりしないでください。
この導線はURL内のランダムトークンで操作を許可する仕組みであり、投票者本人を強く認証するものではありません。

本人登録モードの共用端末では、氏名ではなくカード番号を選びます。未登録カードなら名前・所属を登録して確認した後に投票へ進みます。誤入力は、発表開始前に管理画面から修正または登録解除できます。投票済みの登録を解除する場合は、先に票を解除します。

## 発表進行

3以上の数字は、大きい数字から「数字 → 人数 → 1人だけなら氏名 → 暫定王者」の順に公開します。最後の1と2だけは片方の結果から票の内訳を推測できないよう、まず「FINAL 1 & 2」を表示し、次の操作で両方の人数を同時公開します。1または2が1票なら該当者名も同時公開し、その次の操作まで最終優勝者は表示しません。

## 複数ラウンド

発表完了後、管理画面の「同じ設定で第N回を準備する」を押すと、参加者、氏名・所属、個人QR、共用端末URLを保ったまま次のラウンドを準備できます。投票と発表状態だけがラウンドごとに初期化されます。個人QRを開いたままの参加者画面も、次ラウンドの準備・投票開始を自動検知します。

過去ラウンドの優勝者と回答分布は管理画面だけに表示されます。参加者APIと会場画面は現在のラウンドだけを返します。QRカードには回数を印刷しないため、イベント中は同じカードを再利用できます。

## 個人情報の保持と削除

氏名、所属、参加者QRトークン、投票、回答分布、ラウンド履歴はイベント開催中だけD1に保持します。最終発表後に管理画面で「イベント終了」を押すと、24時間後を削除予定時刻として記録します。終了操作がない場合も、最後の更新操作から7日後に安全網の定期削除対象になります。

イベント終了後は新しいラウンド、投票、登録修正を禁止します。管理画面では削除予定時刻まで履歴を確認でき、「今すぐ完全削除」も選べます。削除時はイベントに紐づく参加者、登録、全ラウンド、投票、発表状態、QR・共用端末トークン、管理認証をまとめて削除します。削除後は個人QR・共用端末URL・既存管理セッションが無効になり、次回は管理PINの初回設定から始まります。

期限切れデータは毎時17分（UTC）のCron Triggerと、APIリクエスト時の安全網で冪等に削除します。アプリ上の削除後も、Cloudflare D1のTime TravelではFreeプランは7日間、Paidプランは30日間の復元可能期間があるため、基盤のバックアップ相当領域に直ちに物理消去されることは保証できません。保持仕様はデプロイ前に [D1 Time Travel公式ドキュメント](https://developers.cloudflare.com/d1/reference/time-travel/) で再確認してください。

## ルール説明PDFの生成

参加者用PDFの生成には、Python 3、ReportLab、日本語を表示できるTrueTypeフォント3種類が必要です。
フォントはリポジトリへ同梱していません。
通常体、太字体、極太字体の各ファイルを環境変数で指定して生成します。

```bash
export ONLY_LONELY_FONT_REGULAR="/path/to/Japanese-Regular.ttf"
export ONLY_LONELY_FONT_BOLD="/path/to/Japanese-SemiBold.ttf"
export ONLY_LONELY_FONT_EXTRA_BOLD="/path/to/Japanese-Bold.ttf"
python3 scripts/generate_rules_pdf.py
```

同じ値は `--font-regular`、`--font-bold`、`--font-extra-bold` 引数でも指定できます。
指定がない場合やファイルを読み取れない場合、スクリプトはPDFを生成せず、該当する設定名を示して終了します。
生成物には、このプロジェクトが非公式Web実装である旨と公式企画のURLが入ります。
公式の文章、画像、ロゴ、デザイン等をPDFへ転載しないでください。

## 公開前チェック

- `npm ci`、`npm run check`、`npm test` を空のcloneから実行する。
- `npm run test:e2e` を実行する。
- `.dev.vars`、Cloudflareの秘密値、参加者データ、ローカルDB、生成PDFがGitの公開対象に含まれていないことを確認する。
- 公開者が、このリポジトリでMIT Licenseを適用するコードの権利を保有していることを確認する。
- 非公式表記と公式企画へのリンクをREADME、アプリ画面、配布PDFで確認する。

## ライセンス

このリポジトリで独自に作成したコードは [MIT License](LICENSE) で公開します。このライセンスは、第三者の名称、商標、コンテンツに関する権利を付与するものではありません。
