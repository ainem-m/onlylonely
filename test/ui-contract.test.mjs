import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { histogramGeometry } from '../public/histogram.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('every major screen identifies the unofficial inspiration and links to the original', () => {
  assert.match(app, /ほぼ日刊イトイ新聞「ONLYでLONELY」に着想を得た非公式・非公認の実装/);
  assert.match(app, /https:\/\/www\.1101\.com\/only_lonely\/2003-04\.html/);
  assert.match(app, /target="_blank" rel="noopener noreferrer">公式企画を見る/);
  assert.match(app, /const brand = `<div class="brand-block">.*\$\{attribution\}/);
  assert.match(app, /class="rules-stage-brand">ONLY .*\$\{attribution\}/);
  assert.match(css, /\.present \.attribution\{/);
});

test('shared-device privileges and handling are explicit to participants and administrators', () => {
  assert.match(index, /id="shared-device-guidance"[^>]*hidden/);
  assert.match(index, /司会者が管理する信頼端末/);
  assert.match(index, /共用URLは共有しない/);
  assert.match(index, /利用者は端末を持ち出さず/);
  assert.match(index, /ほかの参加者を選んで投票できる/);
  assert.match(app, /shared-device-guidance'\)\.hidden = Boolean\(token\) \|\| !path\.startsWith\('\/shared'\)/);
  assert.match(app, /shared-device-guidance'\)\.hidden = true/);
  assert.match(app, /共用URLは参加者へ共有せず、利用者に端末を持ち出させないでください/);
  assert.match(app, /参加者を選んで投票できる画面/);
  assert.match(css, /\.shared-device-notice\{/);
});

test('initial PIN setup requires the deployment setup secret separately', () => {
  assert.match(app, /<span>セットアップ秘密情報<\/span><input id="setup-secret" type="password"/);
  assert.match(app, /初回セットアップ専用の秘密情報です。これから作る管理PINとは別物です/);
  assert.match(app, /const setupSecret = document\.querySelector\('#setup-secret'\)\.value/);
  assert.match(app, /JSON\.stringify\(\{ pin, setupSecret \}\)/);
});

test('the default game title is neutral', () => {
  assert.match(app, /value="社内交流会 数字ゲーム"/);
  assert.doesNotMatch(app, /value="2026年懇親会 ONLY LONELY"/);
});

test('first-time participant gets a three-step path, rule, identity, and recovery', () => {
  assert.match(app, /ステップ \$\{step\} \/ 3/);
  assert.match(app, /1人だけが選んだ最小の数字/);
  assert.match(app, /投票する人/);
  assert.match(app, /投票状況を確認する/);
  assert.match(app, /入力を消して次の人へ/);
});

test('waiting screen refreshes and admin has one state-specific next action', () => {
  assert.match(app, /scheduleParticipantRefresh\(retry\)/);
  assert.match(app, /state\.waitingKey === key/);
  assert.match(app, /次にすること/);
  assert.match(app, /全員の投票が終わると、自動で/);
  assert.match(app, /最初の数字を表示して発表開始/);
});

test('proxy vote is voting-only, confirmed, and protected from refresh while focused', () => {
  assert.match(app, /\$\{!ended && voting \? proxyVoteHtml\(data\) : ''\}/);
  assert.match(app, /本人に確認しましたか/);
  assert.match(app, /details\[open\]/);
  assert.match(app, /active\.matches\('button,a,input,select,textarea,summary'\)/);
  assert.match(app, /Date\.now\(\) - state\.adminBusySince < 10_000/);
  assert.match(app, /restoreAdminUi\(statusChanged\)/);
});

test('every unique-vote reveal click produces a visible stage', () => {
  assert.match(app, /data\.stage==='only'.*選んだ人は…/);
  assert.match(app, /count:p\?\.count===1\?'「選んだ人は…」を表示'/);
});

test('number and name choices expose selection and keyboard focus', () => {
  assert.match(app, /aria-pressed="false"/);
  assert.match(app, /aria-live="polite"/);
  assert.match(css, /:focus-visible/);
});

test('rules page explains the game in three steps for mobile and venue presentation', () => {
  assert.match(app, /if\(path === '\/rules'\) rulesPage\(\)/);
  assert.match(app, /1〜18から数字を1つ選ぶ/);
  assert.match(app, /同じ数字が複数なら勝ち候補から外れる/);
  assert.match(app, /1人だけが選んだ最小の数字が優勝/);
  assert.match(app, /3 が優勝！/);
  assert.match(app, /href="\/rules" target="_blank" rel="noopener">30秒でルールを確認/);
  assert.match(app, /href="\/rules\?mode=present"[^>]*>ルール説明を会場に表示/);
  assert.match(app, /説明を閉じて投票へ戻る/);
  assert.match(app, /window\.close\(\)/);
  assert.doesNotMatch(app, /location\.assign\('\/admin'\)/);
  assert.match(app, /event\.key === 'ArrowRight'/);
  assert.match(app, /event\.key === 'ArrowLeft'/);
  assert.match(css, /\.rules-grid\{[^}]*grid-template-columns:repeat\(3/);
  assert.match(css, /@media\(max-width:760px\)[^{]*\{[^}]*\.rules-header/);
});

test('self-registration mode keeps number-card registration explicit and private', () => {
  assert.match(app, /value="self-registration">番号QRから本人が初回登録/);
  assert.match(app, /所属欄を表示する/);
  assert.match(app, /<option value="free">自由入力<\/option>/);
  assert.match(app, /<option value="select">選択肢から選ぶ<\/option>/);
  assert.match(app, /所属の選択肢（1行に1件）/);
  assert.match(app, /初期選択/);
  assert.match(app, /「その他」を表示して自由入力を許可する/);
  assert.match(app, /その他（候補にない所属を入力）/);
  assert.match(app, /value="choice:\$\{index\}"/);
  assert.match(app, /organization-other-field/);
  assert.match(app, /organizationInputHtml/);
  assert.match(app, /config\.inputMode === 'select'/);
  assert.match(app, /結果発表で優勝者の所属を表示する/);
  assert.match(app, /QRカードの番号を選んでください/);
  assert.match(app, /氏名一覧は表示されません/);
  assert.match(app, /初回登録 1 \/ 2/);
  assert.match(app, /初回登録 2 \/ 2/);
  assert.match(app, /司会者が結果発表で読み上げてよい名前/);
  assert.match(app, /この内容で登録する/);
  assert.match(app, /sharedToken: state\.sharedToken/);
  assert.match(app, /\/shared\$\{state\.sharedToken\?`\?s=\$\{encodeURIComponent\(state\.sharedToken\)\}`:''\}/);
  assert.match(app, /const sharedUrl = `\/shared\?s=\$\{encodeURIComponent\(g\.sharedToken\)\}`/);
  assert.match(app, /data-edit-registration/);
  assert.match(app, /data-unregister/);
  assert.match(app, /番号QR・本人専用/);
  assert.match(css, /\.card-options\{[^}]*grid-template-columns:repeat\(3/);
  assert.match(css, /@media\(max-width:760px\)\{\.card-options\{grid-template-columns:repeat\(2/);
});

test('finished distribution fits an 18-column histogram and hides names by default', () => {
  assert.match(app, /compact-distribution/);
  assert.match(app, /<details class="distribution-details">/);
  assert.match(app, /★ 優勝/);
  assert.match(app, /histogramGeometry\(count, maxCount\)/);
  assert.match(app, /<svg class="histogram-bar"[^>]*><rect[^>]*y="\$\{barY\}"[^>]*height="\$\{barHeight\}"[^>]*fill="currentColor"/);
  assert.doesNotMatch(app, /class="histogram-bar" style=/);
  assert.match(css, /\.mini-bar-slot\{[^}]*border-right:1px/);
  assert.match(css, /\.distribution-card\{padding:18px 10px\}/);
  assert.deepEqual(histogramGeometry(0, 0), { height: 0, y: 100 });
  assert.deepEqual(histogramGeometry(1, 2), { height: 50, y: 50 });
  assert.deepEqual(histogramGeometry(2, 2), { height: 100, y: 0 });
});

test('A4 QR printing uses explicit six-card page groups', () => {
  assert.match(app, /const cardsPerPage = 6/);
  assert.match(app, /class="qr-page"/);
  assert.match(app, /1ページ6枚（2列×3行）/);
  assert.match(css, /@page\{size:A4 portrait;margin:8mm\}/);
  assert.match(css, /html,body\{width:auto;background:white!important\}/);
  assert.doesNotMatch(css, /html,body\{width:210mm/);
  assert.match(css, /\.qr-page:not\(:last-child\)\{break-after:page;page-break-after:always\}/);
  assert.match(css, /grid-template-rows:repeat\(3,78mm\)/);
  assert.match(css, /\.qr-card\{height:78mm;min-height:0/);
  assert.match(app, /参加人数と数字の上限を増やす/);
  assert.match(app, /既存QRはそのまま使えます/);
  assert.match(app, /\/api\/admin\/expand-setup/);
  assert.match(app, /\/admin\/print\?from=\$\{state\.newCardsFrom\}/);
  assert.match(app, /data\.participants\.filter\(participant => Number\(participant\.cardNumber\) >= from\)/);
});

test('personal QR completion follows the public presentation while shared mode stays reusable', () => {
  assert.match(app, /if \(p\.has_voted\) return startPersonalPresentationSync\(\)/);
  assert.match(app, /if \(!state\.sharedMode\) return startPersonalPresentationSync\(\)/);
  assert.match(app, /発表までこのままお待ちください/);
  assert.match(app, /会場の発表が始まると自動で切り替わります/);
  assert.match(app, /const data = await api\('\/api\/present'\)/);
  assert.match(app, /Number\(data\.game\.id\) !== Number\(state\.game\?\.id\)/);
  assert.match(app, /\['count','only','person','champion'\]\.includes\(data\.stage\)/);
  assert.match(app, /data\.stage === 'person' && data\.person/);
  assert.match(app, /data\.stage === 'champion'.*handheldChampionHtml\(data\.champion, false, true\)/);
  assert.match(app, /showOrganization&&champion\.organization/);
  assert.match(app, /data\.stage === 'final'/);
  assert.match(app, /通信を再確認中です。この画面のままお待ちください/);
  assert.match(app, /status\.textContent = data\.stage === 'idle' \? '会場画面の開始を待っています' : '会場画面と同期中'/);
  assert.match(app, /setTimeout\(pollPersonalPresentation, 2500\)/);
  assert.match(app, /if \(state\.sharedMode\) document\.querySelector\('#next'\)/);
  assert.match(app, /入力を消して次の人へ/);
  assert.match(css, /\.handheld-presentation\{max-width:620px\}/);
});

test('round reuse and retention controls are explicit on every relevant surface', () => {
  assert.match(app, /roundNumber:Number\(p\.current_round_number\)/);
  assert.match(app, /同じ設定で第\$\{g\.roundNumber \+ 1\}回を準備する/);
  assert.match(app, /expectedRoundNumber:g\.roundNumber/);
  assert.match(app, /Number\(data\.game\.roundNumber\) !== Number\(state\.game\?\.roundNumber\)/);
  assert.match(app, /第\$\{data\.game\.roundNumber\}回/);
  assert.match(app, /過去ラウンド履歴/);
  assert.match(app, /個人情報の削除まで残り/);
  assert.match(app, /prompt\('確認のため「完全削除」と入力してください。'\)/);
  assert.match(app, /confirmation:typed/);
  assert.doesNotMatch(app, /次のゲームを作成/);
  assert.match(css, /\.round-badge\{/);
  assert.match(css, /\.venue-round\{/);
});

test('numbers one and two use a simultaneous final reveal on venue and handheld screens', () => {
  assert.match(app, /\['pair','pair_count','pair_person'\]\.includes\(data\.stage\)/);
  assert.match(app, /FINAL：1 & 2/);
  assert.match(app, /1と2の人数を同時公開/);
  assert.match(app, /1と2の該当者名を同時公開/);
  assert.match(app, /finalPairHtml\(data, true\)/);
  assert.match(app, /entry\.count===1&&entry\.person/);
  assert.match(app, /entry\.count === 1 && entry\.person \? escapeHtml\(entry\.person\.name\)/);
  assert.match(css, /\.final-pair\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /\.venue-final-pair\{/);
});
