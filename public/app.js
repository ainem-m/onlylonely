import { histogramGeometry } from './histogram.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const path = location.pathname;
const state = { game: null, participantId: null, participantName: null, participantToken: null, participantCardNumber: null, participantOrganization: null, sharedToken: null, sharedMode: false, registrationDraft: null, number: null, admin: null, adminDraft: null, adminUi: null, adminBusySince: null, lastAdminStatus: null, waitingKey: null, timer: null, presentationKey: null, newCardsFrom: null };

const escapeHtml = (s = '') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const parseStringArray = (value) => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []; } catch { return []; } };
const OTHER_ORGANIZATION = '__only_lonely_other__';
let toastTimer;
const showToast = (message, isError = false) => {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('toast-error', isError);
  toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 6000 : 3500);
};
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '通信に失敗しました。');
  return data;
}
const brand = '<h1 class="brand">ONLY<br><span>LONELY</span></h1>';
const roundBadge = (game = state.game) => game?.roundNumber ? `<div class="round-badge">第${Number(game.roundNumber)}回</div>` : '';
const button = (label, id, cls = '') => `<button type="button" class="btn ${cls}" id="${id}">${label}</button>`;
const flowStep = (step, label) => `<div class="flow-step"><span>ステップ ${step} / 3</span><strong>${label}</strong></div>`;
const rulesLink = '<a class="text-button rules-link" href="/rules" target="_blank" rel="noopener">30秒でルールを確認</a>';
const ruleHtml = () => `<div class="rule-box"><strong>選び方</strong><p>ほかの人とかぶらないと思う数字を1つ選びます。<br><b>1人だけが選んだ最小の数字</b>が勝ちです。相談は禁止です。</p>${rulesLink}</div>`;
const focusHeading = () => requestAnimationFrame(() => { const heading = app.querySelector('h2'); if (heading) { heading.tabIndex = -1; heading.focus(); } });

const ruleSlides = [
  { step:'1', title:'1〜18から数字を1つ選ぶ', text:'ほかの人とかぶらないと思う数字を、自分だけで決めます。相談は禁止です。', visual:'<div class="rule-number-choice"><span>1</span><span>2</span><span>3</span><i>…</i><span>18</span></div>' },
  { step:'2', title:'同じ数字が複数なら勝ち候補から外れる', text:'同じ数字を選んだ人が2人以上いる場合、その数字では勝てません。', visual:'<div class="rule-example"><span class="duplicate">2</span><span class="duplicate">2</span><span>3</span><span>5</span></div><p class="rule-caption">「2」は2人いるので重複</p>' },
  { step:'3', title:'1人だけが選んだ最小の数字が優勝', text:'例では「3」と「5」が1人だけ。より小さい「3」を選んだ人が優勝です。', visual:'<div class="rule-example"><span class="duplicate">2</span><span class="duplicate">2</span><span class="winner-number">3</span><span>5</span></div><p class="rule-result">3 が優勝！</p>' }
];

function rulesPage() {
  clearTimeout(state.timer);
  const presentationMode = new URLSearchParams(location.search).get('mode') === 'present';
  if (!presentationMode) {
    app.innerHTML = `<main class="shell rules-shell">${brand}<header class="rules-header"><div><p class="eyebrow">30秒でわかる</p><h2>ONLY LONELY のルール</h2><p class="lead">3つだけ覚えれば参加できます。</p></div><div class="rules-close"><button type="button" class="btn secondary" id="rules-close">説明を閉じて投票へ戻る</button><span class="helper">閉じない場合は、このブラウザタブを閉じてください。</span></div></header><section class="rules-grid">${ruleSlides.map(slide => `<article class="card rule-slide"><span class="rule-step">STEP ${slide.step}</span><h3>${slide.title}</h3><div class="rule-visual" aria-hidden="true">${slide.visual}</div><p>${slide.text}</p></article>`).join('')}</section><section class="card rule-summary center"><p class="eyebrow">勝利条件</p><h3>かぶらない、小さい数字を狙おう</h3><p>ただし、ほかの人との相談は禁止です。</p></section></main>`;
    document.querySelector('#rules-close').onclick = () => { window.close(); setTimeout(() => showToast('このタブを閉じると、元の投票画面に戻れます。'), 100); };
    focusHeading();
    return;
  }
  app.className = 'rules-present';
  let current = 0;
  const renderSlide = () => {
    const slide = ruleSlides[current];
    app.innerHTML = `<main class="rules-stage"><div class="rules-stage-brand">ONLY <span>LONELY</span></div><section class="rule-stage-card" aria-live="polite"><p class="rule-step">STEP ${slide.step} / ${ruleSlides.length}</p><h2>${slide.title}</h2><div class="rule-visual" aria-hidden="true">${slide.visual}</div><p class="rules-stage-text">${slide.text}</p></section><nav class="rules-controls" aria-label="ルール説明の操作"><button type="button" class="btn secondary" id="rule-prev" ${current===0?'disabled':''}>前へ</button><span>${current + 1} / ${ruleSlides.length}</span><button type="button" class="btn gold" id="rule-next">${current===ruleSlides.length-1?'説明を終了':'次へ'}</button></nav></main>`;
    document.querySelector('#rule-prev').onclick = () => { current -= 1; renderSlide(); };
    document.querySelector('#rule-next').onclick = () => {
      if (current < ruleSlides.length - 1) { current += 1; renderSlide(); }
      else { window.close(); setTimeout(() => showToast('説明は終了です。このタブを閉じてください。'), 100); }
    };
    focusHeading();
  };
  document.onkeydown = event => {
    if (event.key === 'ArrowRight' && current < ruleSlides.length - 1) { current += 1; renderSlide(); }
    if (event.key === 'ArrowLeft' && current > 0) { current -= 1; renderSlide(); }
  };
  renderSlide();
}

function scheduleParticipantRefresh(callback) {
  clearTimeout(state.timer);
  state.timer = setTimeout(callback, 2000);
}

function renderWaiting(title, message, retry, key) {
  if (state.waitingKey === key && document.querySelector('#check-status')) {
    scheduleParticipantRefresh(retry);
    return;
  }
  state.waitingKey = key;
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack center"><div class="waiting-mark" aria-hidden="true">…</div><h2>${title}</h2><p class="lead">${message}</p>${button('いまの状態を確認','check-status','secondary block')}${rulesLink}<p class="helper">投票が始まると、この画面は自動で切り替わります。</p></section></main>`;
  document.querySelector('#check-status').onclick = () => { state.waitingKey = null; retry(); };
  focusHeading();
  scheduleParticipantRefresh(retry);
}

async function participantApp() {
  const token = new URLSearchParams(location.search).get('p');
  if (token) return individualParticipantApp(token);
  const sharedToken = new URLSearchParams(location.search).get('s') || state.sharedToken || '';
  let data;
  try { data = await api(`/api/game${sharedToken ? `?s=${encodeURIComponent(sharedToken)}` : ''}`); } catch (e) { return renderError(e); }
  if (!data.game) return renderWaiting('ゲームの準備中です', 'この画面を開いたまま、司会者の案内をお待ちください。', participantApp, 'no-game');
  state.game = data.game;
  state.sharedMode = true;
  state.sharedToken = sharedToken || null;
  state.participantToken = null;
  if (data.game.status === 'setup') return renderWaiting('まもなく投票が始まります', `${escapeHtml(data.game.title)}<br>この画面を開いたまま、司会者の合図をお待ちください。`, participantApp, `shared-setup-${data.game.id}`);
  if (data.game.status !== 'voting') { app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<div class="card center"><h2>投票は締め切られました</h2><p class="lead">${escapeHtml(data.game.title)}<br>会場の発表画面をご覧ください。</p><a class="btn secondary" href="/present">発表画面を見る</a></div></main>`; focusHeading(); return; }
  state.waitingKey = null;
  if (data.game.registrationMode === 'self-registration') renderCardNumbers(data.participants);
  else renderName(data.participants);
}

async function individualParticipantApp(token) {
  let data;
  try { data = await api(`/api/participant?token=${encodeURIComponent(token)}`); } catch (e) { return renderError(e); }
  const p = data.participant;
  state.game = { id:Number(p.game_id), roundNumber:Number(p.current_round_number), title:p.title, min:p.min_number, max:p.max_number, status:p.status, registrationMode:p.registration_mode, organization:{ enabled:Boolean(p.organization_enabled), label:p.organization_label, required:Boolean(p.organization_required), showInResults:Boolean(p.show_organization_in_results), inputMode:p.organization_input_mode||'free', options:parseStringArray(p.organization_options_json), defaultValue:p.organization_default||'', allowOther:Boolean(p.organization_allow_other) } };
  state.participantId = Number(p.id); state.participantName = p.display_name; state.participantToken = token; state.participantCardNumber = p.card_number; state.participantOrganization = p.organization; state.sharedToken = null; state.sharedMode = false; state.number = null;
  if (p.has_voted) return startPersonalPresentationSync();
  if (p.registration_mode === 'self-registration' && !p.is_registered) { state.registrationDraft = null; renderRegistrationForm(); return; }
  if (p.status === 'setup') return renderWaiting('まもなく投票が始まります', `${escapeHtml(p.display_name)}さん、この画面を開いたまま司会者の合図をお待ちください。`, () => individualParticipantApp(token), `personal-setup-${p.id}`);
  if (p.status !== 'voting') { app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card center"><h2>投票は締め切られました</h2><p class="lead">${escapeHtml(p.title)}<br>会場の発表画面をご覧ください。</p></section></main>`; focusHeading(); return; }
  state.waitingKey = null;
  renderNumbers();
}

function cardLabel(number) { return `参加者${String(number).padStart(2, '0')}`; }

function organizationInputHtml(config, draft) {
  const value = draft.organization !== undefined ? draft.organization : (config.defaultValue || '');
  const requirement = config.required ? '<b class="required-mark">必須</b>' : '<small>任意</small>';
  if (config.inputMode === 'select') {
    const blank = config.required ? '選択してください' : '選択しない';
    const isOther = Boolean(config.allowOther && value && !config.options.includes(value));
    return `<label class="field"><span>${escapeHtml(config.label)} ${requirement}</span><select id="registration-organization" ${config.required?'required':''}><option value="">${blank}</option>${config.options.map((option, index) => `<option value="choice:${index}" ${option===value?'selected':''}>${escapeHtml(option)}</option>`).join('')}${config.allowOther?`<option value="${OTHER_ORGANIZATION}" ${isOther?'selected':''}>その他（候補にない所属を入力）</option>`:''}</select></label>${config.allowOther?`<label class="field ${isOther?'':'hidden'}" id="organization-other-field"><span>その他の${escapeHtml(config.label)}</span><input id="registration-organization-other" maxlength="80" value="${isOther?escapeHtml(value):''}"></label>`:''}`;
  }
  return `<label class="field"><span>${escapeHtml(config.label)} ${requirement}</span><input id="registration-organization" maxlength="80" value="${escapeHtml(value)}" ${config.required?'required':''}></label>`;
}

function renderCardNumbers(participants) {
  state.participantId = null; state.participantName = null; state.participantCardNumber = null; state.participantOrganization = null; state.registrationDraft = null; state.number = null;
  if (!participants.length) {
    app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack center"><div class="success-mark">✓</div><h2>全員の投票が終わりました</h2><p class="lead">この端末で次に投票する人はいません。<br>端末を司会者へ返してください。</p>${button('状態を更新','refresh-shared','secondary block')}</section></main>`;
    document.querySelector('#refresh-shared').onclick = participantApp;
    focusHeading();
    return;
  }
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack"><div>${flowStep(1,'カード番号を確認')}<h2>QRカードの番号を選んでください</h2><p class="lead">カードに印刷された番号と同じものを選びます。氏名一覧は表示されません。</p></div><div class="card-options" role="group" aria-label="参加者カード番号">${participants.map(p => `<button type="button" class="name-option card-option" data-card-id="${p.id}" data-card-number="${p.card_number}" data-registered="${p.is_registered}" aria-pressed="false"><strong>${String(p.card_number).padStart(2,'0')}</strong><span>${p.is_registered ? '登録済み' : '初回登録'}</span></button>`).join('')}</div><div class="identity hidden" id="selected-person" aria-live="polite"></div>${button('このカードで進む','to-card','block')}<p class="helper center">番号が見つからない場合は司会者へお知らせください。</p></section></main>`;
  const next = document.querySelector('#to-card'); next.disabled = true;
  document.querySelectorAll('[data-card-id]').forEach(el => el.onclick = () => {
    state.participantId = Number(el.dataset.cardId); state.participantCardNumber = Number(el.dataset.cardNumber);
    state.registrationDraft = { registered: el.dataset.registered === '1' };
    state.participantName = state.registrationDraft.registered ? '登録済み' : cardLabel(state.participantCardNumber);
    document.querySelectorAll('[data-card-id]').forEach(x => { const selected=x===el; x.classList.toggle('selected',selected); x.setAttribute('aria-pressed',String(selected)); });
    const selected = document.querySelector('#selected-person'); selected.textContent = `選択中：${cardLabel(state.participantCardNumber)}`; selected.classList.remove('hidden'); next.disabled = false;
  });
  next.onclick = () => {
    if (!state.participantId) return showToast('カード番号を選んでください。', true);
    if (!state.registrationDraft?.registered) { state.registrationDraft = null; renderRegistrationForm(); }
    else renderNumbers();
  };
  focusHeading();
}

function renderRegistrationForm() {
  const config = state.game.organization || { enabled:false, label:'所属', required:false };
  const draft = state.registrationDraft || {};
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<form class="card stack" id="registration-form"><div class="flow-step"><span>初回登録 1 / 2</span><strong>${cardLabel(state.participantCardNumber)}</strong></div><div><h2>投票で使う名前を登録</h2><p class="lead">司会者が結果発表で読み上げてよい名前を入力してください。</p></div><label class="field"><span>読み上げてよい名前 <b class="required-mark">必須</b></span><input id="registration-name" maxlength="80" autocomplete="name" value="${escapeHtml(draft.displayName||'')}" required></label>${config.enabled ? organizationInputHtml(config, draft) : ''}<p class="notice">登録後は自分では変更できません。入力を間違えた場合は司会者が修正します。</p><div class="action-row">${state.sharedMode?'<button type="button" class="btn secondary" id="back-card">番号を選び直す</button>':''}<button type="submit" class="btn gold">入力内容を確認する</button></div></form></main>`;
  document.querySelector('#back-card')?.addEventListener('click', participantApp);
  document.querySelector('#registration-organization')?.addEventListener('change', event => {
    const otherField = document.querySelector('#organization-other-field');
    if (!otherField) return;
    const show = event.currentTarget.value === OTHER_ORGANIZATION;
    otherField.classList.toggle('hidden', !show);
    if (show) document.querySelector('#registration-organization-other').focus();
  });
  document.querySelector('#registration-form').onsubmit = event => {
    event.preventDefault();
    const displayName = document.querySelector('#registration-name').value.trim();
    const selectedOrganization = document.querySelector('#registration-organization')?.value.trim() || '';
    const selectedIndex = selectedOrganization.startsWith('choice:') ? Number(selectedOrganization.slice(7)) : -1;
    const organization = selectedOrganization === OTHER_ORGANIZATION
      ? document.querySelector('#registration-organization-other')?.value.trim() || ''
      : selectedIndex >= 0 ? config.options[selectedIndex] || '' : selectedOrganization;
    if (!displayName) return showToast('読み上げてよい名前を入力してください。', true);
    if (config.enabled && config.required && !organization) return showToast(`${config.label}を入力してください。`, true);
    state.registrationDraft = { displayName, organization };
    renderRegistrationConfirm();
  };
  focusHeading();
}

function renderRegistrationConfirm() {
  const config = state.game.organization || { enabled:false, label:'所属' };
  const draft = state.registrationDraft;
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack center"><div class="flow-step"><span>初回登録 2 / 2</span><strong>${cardLabel(state.participantCardNumber)}</strong></div><h2>登録内容を確認してください</h2><div class="confirm-summary registration-confirm"><div><span>読み上げてよい名前</span><strong>${escapeHtml(draft.displayName)}</strong></div>${config.enabled?`<div><span>${escapeHtml(config.label)}</span><strong>${escapeHtml(draft.organization||'未入力')}</strong></div>`:''}</div><p class="notice"><b>確定後は自分では変更できません。</b><br>カード番号・名前${config.enabled?'・'+escapeHtml(config.label):''}を確認してください。</p><div class="action-row"><button type="button" class="btn secondary" id="back-registration">入力し直す</button>${button('この内容で登録する','submit-registration','gold')}</div><div class="notice error hidden" id="registration-error" role="alert"></div></section></main>`;
  document.querySelector('#back-registration').onclick = renderRegistrationForm;
  document.querySelector('#submit-registration').onclick = async event => {
    event.currentTarget.disabled = true; event.currentTarget.textContent = '登録中…';
    const payload = { displayName:draft.displayName, organization:draft.organization, ...(state.participantToken ? {token:state.participantToken} : {participantId:state.participantId,sharedToken:state.sharedToken}) };
    try {
      const result = await api('/api/register',{method:'POST',body:JSON.stringify(payload)});
      state.participantName = result.participant.display_name; state.participantOrganization = result.participant.organization; state.registrationDraft = { registered:true };
      if (state.game.status === 'setup') return renderWaiting('登録が完了しました', `${escapeHtml(state.participantName)}さん、この画面を開いたまま投票開始をお待ちください。`, () => individualParticipantApp(state.participantToken), `registered-${state.participantId}`);
      renderNumbers();
    } catch(e) {
      const error=document.querySelector('#registration-error'); error.textContent=e.message; error.classList.remove('hidden'); event.currentTarget.disabled=false; event.currentTarget.textContent='この内容で登録する';
    }
  };
  focusHeading();
}

function renderName(participants) {
  participants = participants.filter(p => !p.has_voted);
  state.participantId = null; state.participantName = null; state.number = null;
  if (!participants.length) {
    app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack center"><div class="success-mark">✓</div><h2>全員の投票が終わりました</h2><p class="lead">この端末で次に投票する人はいません。<br>端末を司会者へ返してください。</p>${button('状態を更新','refresh-shared','secondary block')}</section></main>`;
    document.querySelector('#refresh-shared').onclick = participantApp;
    focusHeading();
    return;
  }
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack">${flowStep(1,'本人を確認')}<div><h2>あなたの名前を選んでください</h2><p class="lead">投票した数字は、結果発表まで誰にも表示されません。</p>${rulesLink}</div><label class="field"><span>名前を絞り込む</span><input id="participant-search" type="search" autocomplete="off" placeholder="名前の一部を入力"></label><div><div class="row between"><strong>候補から自分の名前をタップ</strong><span class="helper" id="result-count"></span></div><div class="name-options" id="name-options"></div></div><div class="identity hidden" id="selected-person" aria-live="polite"></div>${button('数字を選ぶへ進む','to-numbers','block')}<p class="helper center">共用端末です。自分の名前がない場合は司会者へお知らせください。</p></section></main>`;
  const renderOptions = (items) => {
    document.querySelector('#result-count').textContent = `${items.length}名`;
    document.querySelector('#name-options').innerHTML = items.length ? items.map(p => `<button type="button" class="name-option" data-participant="${p.id}" aria-pressed="false">${escapeHtml(p.display_name)}</button>`).join('') : '<p class="notice">一致する名前がありません。検索文字を減らしてください。</p>';
    document.querySelectorAll('[data-participant]').forEach(el => el.onclick = () => {
      state.participantId = Number(el.dataset.participant);
      state.participantName = participants.find(p => Number(p.id) === state.participantId)?.display_name || null;
      document.querySelectorAll('[data-participant]').forEach(x => { const selected = x === el; x.classList.toggle('selected', selected); x.setAttribute('aria-pressed', String(selected)); });
      const selected = document.querySelector('#selected-person');
      selected.textContent = `選択中：${state.participantName}さん`;
      selected.classList.remove('hidden');
      document.querySelector('#to-numbers').disabled = false;
    });
  };
  renderOptions(participants);
  document.querySelector('#to-numbers').disabled = true;
  document.querySelector('#participant-search').oninput = (event) => {
    state.participantId = null; state.participantName = null;
    document.querySelector('#selected-person').classList.add('hidden');
    document.querySelector('#to-numbers').disabled = true;
    const q = event.target.value.trim().toLocaleLowerCase('ja');
    renderOptions(q ? participants.filter(p => p.display_name.toLocaleLowerCase('ja').includes(q)) : participants);
  };
  document.querySelector('#to-numbers').onclick = () => {
    if (!state.participantId) return showToast('自分の名前を選んでください。', true);
    renderNumbers();
  };
  focusHeading();
}

function renderNumbers() {
  const nums = Array.from({length: state.game.max - state.game.min + 1}, (_, i) => i + state.game.min);
  const identityLabel = state.participantCardNumber ? `${cardLabel(state.participantCardNumber)} / ${state.participantName}` : state.participantName;
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack">${flowStep(2,'数字を選ぶ')}<div class="identity"><span>投票する人</span><strong>${escapeHtml(identityLabel)}さん</strong></div><div><h2>数字をひとつ選んでください</h2>${ruleHtml()}</div><div class="number-grid" role="group" aria-label="投票する数字">${nums.map(n => `<button type="button" class="number" data-number="${n}" aria-label="数字 ${n}" aria-pressed="false">${n}</button>`).join('')}</div><div><p class="choice-label">選んだ数字</p><div class="selected-number" id="chosen" aria-live="polite">未選択</div></div><div class="action-row">${state.sharedMode ? `<button type="button" class="btn secondary" id="back">${state.game.registrationMode==='self-registration'?'番号':'名前'}を選び直す</button>` : ''}${button('投票内容を確認する','confirm','gold')}</div>${state.participantToken ? '<p class="notice">表示された名前が違う場合は投票せず、司会者へお知らせください。</p>' : ''}</section></main>`;
  const confirm = document.querySelector('#confirm');
  confirm.disabled = true;
  document.querySelectorAll('.number').forEach(el => el.onclick = () => {
    state.number = Number(el.dataset.number);
    document.querySelectorAll('.number').forEach(x => { const selected = x === el; x.classList.toggle('selected', selected); x.setAttribute('aria-pressed', String(selected)); });
    document.querySelector('#chosen').textContent = state.number;
    confirm.disabled = false;
  });
  document.querySelector('#back')?.addEventListener('click', participantApp);
  confirm.onclick = () => state.number ? renderConfirm() : showToast('数字を選んでください。', true);
  focusHeading();
}

function renderConfirm() {
  const person = state.participantCardNumber ? `${cardLabel(state.participantCardNumber)} / ${state.participantName}` : `${state.participantName}さん`;
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack center">${flowStep(3,'投票内容の確認')}<h2>名前と数字を確認してください</h2><div class="confirm-summary"><div><span>投票する人</span><strong>${escapeHtml(person)}</strong>${state.participantOrganization?`<small>${escapeHtml(state.participantOrganization)}</small>`:''}</div><div><span>選んだ数字</span><strong class="selected-number">${state.number}</strong></div></div><p class="notice"><b>投票後は自分では変更できません。</b><br>間違いがあれば「数字を選び直す」で戻ってください。</p><div class="action-row"><button type="button" class="btn secondary" id="back">数字を選び直す</button>${button(`${state.number}で投票を確定`,'submit','gold')}</div>${state.sharedMode ? `<button type="button" class="text-button" id="back-name">${state.game.registrationMode==='self-registration'?'番号':'名前'}も選び直す</button>` : ''}<div class="notice error hidden" id="vote-error" role="alert"></div><button type="button" class="btn secondary hidden" id="verify-vote">投票状況を確認する</button></section></main>`;
  document.querySelector('#back').onclick = renderNumbers;
  document.querySelector('#back-name')?.addEventListener('click', participantApp);
  document.querySelector('#submit').onclick = async (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = '送信中…';
    try { await api('/api/vote', { method:'POST', body: JSON.stringify({ participantId: state.participantId, token: state.participantToken, sharedToken: state.sharedToken, number: state.number }) }); renderComplete(); }
    catch (e) {
      const error = document.querySelector('#vote-error');
      error.textContent = `${e.message} 投票できたか不明な場合は、状況を確認してください。`;
      error.classList.remove('hidden');
      document.querySelector('#verify-vote').classList.remove('hidden');
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = `${state.number}で投票を確定`;
    }
  };
  document.querySelector('#verify-vote').onclick = verifyVoteStatus;
  focusHeading();
}

async function verifyVoteStatus() {
  const buttonEl = document.querySelector('#verify-vote');
  buttonEl.disabled = true;
  buttonEl.textContent = '確認中…';
  try {
    if (state.participantToken) {
      const data = await api(`/api/participant?token=${encodeURIComponent(state.participantToken)}`);
      if (data.participant.has_voted) return renderComplete();
    } else {
      const data = await api(`/api/game${state.sharedToken ? `?s=${encodeURIComponent(state.sharedToken)}` : ''}`);
      const stillAvailable = data.participants?.some(p => Number(p.id) === state.participantId);
      if (!stillAvailable) return renderComplete();
      if (data.game?.status !== 'voting') {
        const error = document.querySelector('#vote-error');
        error.textContent = '投票受付は終了しています。司会者へお知らせください。';
        error.classList.remove('hidden');
        buttonEl.disabled = false; buttonEl.textContent = '投票状況を確認する';
        return;
      }
    }
    const error = document.querySelector('#vote-error');
    error.textContent = 'まだ投票は完了していません。もう一度「投票を確定」を押してください。';
    error.classList.remove('hidden');
  } catch (e) { showToast(e.message, true); }
  buttonEl.disabled = false;
  buttonEl.textContent = '投票状況を確認する';
}

function renderComplete() {
  history.replaceState(null, '', state.sharedMode ? `/shared${state.sharedToken?`?s=${encodeURIComponent(state.sharedToken)}`:''}` : location.pathname + location.search);
  if (!state.sharedMode) return startPersonalPresentationSync();
  app.innerHTML = `<main class="shell participant">${brand}${roundBadge()}<section class="card stack center"><div class="success-mark">✓</div><h2>${escapeHtml(state.participantName)}さんの投票が完了しました</h2><p class="lead">選んだ数字は送信済みです。結果発表まで誰にも表示されません。</p>${state.sharedMode ? '<p class="notice"><b>「次の人へ」を押してから</b>、端末を次の人に渡してください。前の入力は消去されます。</p>' : '<p class="notice">この画面は閉じて構いません。会場の結果発表をお待ちください。</p>'}${state.sharedMode ? button('入力を消して次の人へ','next','cyan block') : ''}</section></main>`;
  if (state.sharedMode) document.querySelector('#next').onclick = () => { state.participantId = null; state.participantName = null; state.participantToken = null; state.participantCardNumber = null; state.participantOrganization = null; state.registrationDraft = null; state.number = null; participantApp(); };
  focusHeading();
}

function startPersonalPresentationSync() {
  clearTimeout(state.timer);
  state.presentationKey = null;
  renderPersonalPresentationWaiting();
  pollPersonalPresentation();
}

function renderPersonalPresentationWaiting() {
  app.innerHTML = `<main class="shell participant handheld-presentation">${brand}${roundBadge()}<section class="card stack center"><div class="success-mark">✓</div><p class="eyebrow">投票完了</p><h2>発表までこのままお待ちください</h2><p class="lead">選んだ数字は送信済みです。<br>会場の発表が始まると自動で切り替わります。</p><p class="sync-status" id="presentation-sync-status">会場画面の開始を待っています</p></section></main>`;
  focusHeading();
}

function handheldChampionHtml(champion, final = false, showOrganization = false) {
  if (!champion) return final ? '<div class="handheld-verdict">今回は優勝者なし</div>' : '';
  return `<section class="handheld-champion"><span>${final?'最終結果':'現在の暫定王者'}</span><strong>${champion.number} — ${escapeHtml(champion.name)}</strong>${showOrganization&&champion.organization?`<small>${escapeHtml(champion.organization)}</small>`:''}</section>`;
}

function finalPairHtml(data, venue = false) {
  const entries = data.finalPair || [{number:1},{number:2}];
  const showCount = ['pair_count','pair_person'].includes(data.stage);
  const showPerson = data.stage === 'pair_person';
  return `<div class="final-pair${venue?' venue-final-pair':''}">${entries.map(entry => `<section><span>NUMBER</span><strong>${entry.number}</strong>${showCount?`<b>${entry.count} ${venue?(entry.count===1?'PERSON':'PEOPLE'):'人'}</b>`:''}${showPerson?`<em>${entry.count===1&&entry.person?escapeHtml(entry.person.name):entry.count===0?'該当者なし':'重複'}</em>`:''}</section>`).join('')}</div>`;
}

function renderPersonalPresentation(data) {
  if (!data.game || Number(data.game.id) !== Number(state.game?.id) || data.stage === 'idle') return renderPersonalPresentationWaiting();
  const sync = '<p class="sync-status" id="presentation-sync-status">会場画面と同期中</p>';
  if (['pair','pair_count','pair_person'].includes(data.stage)) {
    const label = data.stage === 'pair' ? 'FINAL：1 & 2' : data.stage === 'pair_count' ? '1と2の人数を同時公開' : '1と2の該当者';
    app.innerHTML = `<main class="shell participant handheld-presentation">${brand}${roundBadge()}<section class="card stack center"><p class="eyebrow">最終局面</p><h2>${label}</h2>${finalPairHtml(data)}${sync}</section></main>`;
    focusHeading();
    return;
  }
  if (data.stage === 'final') {
    app.innerHTML = `<main class="shell participant handheld-presentation">${brand}${roundBadge()}<section class="card stack center"><p class="eyebrow">発表終了</p><h2>最終結果</h2>${data.champion?`<div class="handheld-result-number">${data.champion.number}</div><div class="handheld-person">${escapeHtml(data.champion.name)}</div>${data.champion.organization?`<div class="handheld-organization">${escapeHtml(data.champion.organization)}</div>`:''}<div class="handheld-verdict">ONLY LONELY</div>`:'<div class="handheld-verdict">今回は優勝者なし</div>'}${sync}</section></main>`;
    focusHeading();
    return;
  }
  let body = `<p class="eyebrow">発表中</p><h2>数字 ${data.current}</h2><div class="handheld-result-number">${data.current}</div>`;
  if (['count','only','person','champion'].includes(data.stage)) body += `<div class="handheld-count">${data.count}人</div>`;
  if (data.stage === 'only') body += '<div class="handheld-prompt">選んだ人は…</div>';
  if (data.stage === 'person' && data.person) body += `<div class="handheld-person">${escapeHtml(data.person.name)}</div>`;
  if (data.stage === 'champion') body += handheldChampionHtml(data.champion, false, true);
  else if (data.champion) body += handheldChampionHtml(data.champion);
  app.innerHTML = `<main class="shell participant handheld-presentation">${brand}${roundBadge()}<section class="card stack center">${body}${sync}</section></main>`;
  focusHeading();
}

async function pollPersonalPresentation() {
  try {
    const data = await api('/api/present');
    if (data.game && Number(data.game.id) === Number(state.game?.id) && Number(data.game.roundNumber) !== Number(state.game?.roundNumber)) {
      state.presentationKey = null;
      return individualParticipantApp(state.participantToken);
    }
    const key = `${data.game?.id||'none'}:${data.game?.roundNumber||'none'}:${data.revision??0}:${data.stage||'idle'}`;
    if (key !== state.presentationKey) { state.presentationKey = key; renderPersonalPresentation(data); }
    else {
      const status = document.querySelector('#presentation-sync-status');
      if (status) { status.textContent = data.stage === 'idle' ? '会場画面の開始を待っています' : '会場画面と同期中'; status.classList.remove('sync-warning'); }
    }
    state.timer = setTimeout(pollPersonalPresentation, data.stage === 'final' ? 2000 : 1000);
  } catch (e) {
    const status = document.querySelector('#presentation-sync-status');
    if (status) { status.textContent = '通信を再確認中です。この画面のままお待ちください'; status.classList.add('sync-warning'); }
    state.timer = setTimeout(pollPersonalPresentation, 2500);
  }
}

function adminPinSetup() {
  app.innerHTML = `<main class="shell participant">${brand}<form class="card stack" id="pin-setup"><p class="eyebrow">初回のみ</p><h2>司会者用の管理PINを設定</h2><p class="lead">司会者画面を守る4〜8桁の数字です。当日の司会担当者だけで共有してください。</p><label class="field"><span>管理PIN</span><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" placeholder="4〜8桁" required></label><label class="field"><span>管理PIN（確認）</span><input id="pin-confirm" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" required></label><button type="submit" class="btn gold block" id="setup-pin">PINを設定してゲーム準備へ</button><p class="helper center">この設定画面は初回認証時だけ表示されます。</p></form></main>`;
  document.querySelector('#pin-setup').onsubmit = async (event) => {
    event.preventDefault();
    const pin = document.querySelector('#pin').value;
    if (!/^\d{4,8}$/.test(pin)) return showToast('PINは4〜8桁の数字にしてください。', true);
    if (pin !== document.querySelector('#pin-confirm').value) return showToast('確認用PINが一致しません。', true);
    try { await api('/api/admin/setup-pin', { method:'POST', body: JSON.stringify({ pin }) }); await adminApp(); } catch(e) { showToast(e.message, true); }
  };
  focusHeading();
}

function adminLogin() {
  app.innerHTML = `<main class="shell participant">${brand}<form class="card stack" id="admin-login"><p class="eyebrow">司会者画面</p><h2>管理PINを入力</h2><p class="lead">初回に設定した4〜8桁の管理PINを入力してください。</p><label class="field"><span>管理PIN</span><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="current-password" placeholder="4〜8桁" required autofocus></label><button type="submit" class="btn block" id="login">司会者画面へログイン</button></form></main>`;
  document.querySelector('#admin-login').onsubmit = async (event) => {
    event.preventDefault();
    try { await api('/api/admin/login', { method:'POST', body: JSON.stringify({ pin: document.querySelector('#pin').value }) }); await adminApp(); } catch(e) { showToast(e.message, true); }
  };
  focusHeading();
}

async function adminEntry() {
  try {
    const auth = await api('/api/admin/auth-status');
    if (!auth.configured) return adminPinSetup();
    if (!auth.authenticated) return adminLogin();
    return adminApp();
  } catch (e) { return renderError(e); }
}

async function adminApp() {
  const proxyPerson = document.querySelector('#proxy-person');
  const proxyNumber = document.querySelector('#proxy-number');
  if (proxyPerson && proxyNumber) state.adminDraft = { person: proxyPerson.value, number: proxyNumber.value };
  state.adminUi = captureAdminUi();
  let data;
  try { data = await api('/api/admin/state'); } catch(e) { if (e.message.includes('ログイン')) return adminLogin(); return renderError(e); }
  state.admin = data;
  if (!data.game) return renderSetup();
  renderAdminDashboard(data);
}

function renderSetup() {
  clearTimeout(state.timer);
  state.lastAdminStatus = null;
  app.innerHTML = `<main class="shell participant">${brand}<form class="card stack" id="game-setup">
    <div><p class="eyebrow">ゲーム準備 1 / 2</p><h2>ゲームと参加者を登録</h2><p class="lead">名簿を登録する方法と、番号QRから本人が登録する方法を選べます。</p></div>
    <label class="field"><span>ゲーム名</span><input id="title" value="2026年懇親会 ONLY LONELY" maxlength="100" required></label>
    <div class="grid2"><label class="field"><span>最小の数字</span><input id="min" type="number" value="1" min="1" max="999" required></label><label class="field"><span>最大の数字</span><input id="max" type="number" value="18" min="1" max="999" required></label></div>
    <label class="field"><span>参加者の登録方法</span><select id="registration-mode"><option value="roster">名簿を事前登録</option><option value="self-registration">番号QRから本人が初回登録</option></select></label>
    <section id="roster-settings" class="setup-panel"><label class="field"><span>参加者（1行に1名）</span><textarea id="names" placeholder="山田 太郎&#10;佐藤 花子"></textarea></label><div class="name-summary notice" id="name-summary" aria-live="polite">参加者を1行に1名ずつ入力してください。</div></section>
    <section id="self-settings" class="setup-panel hidden">
      <label class="field"><span>参加人数</span><input id="participant-count" type="number" value="32" min="2" max="100"></label>
      <label class="check-field"><input id="organization-enabled" type="checkbox"><span>所属欄を表示する</span></label>
      <div id="organization-settings" class="stack hidden">
        <label class="field"><span>所属欄の表示名</span><input id="organization-label" maxlength="30" value="所属"></label>
        <label class="field"><span>入力方法</span><select id="organization-input-mode"><option value="free">自由入力</option><option value="select">選択肢から選ぶ</option></select></label>
        <div id="organization-select-settings" class="stack hidden">
          <label class="field"><span>所属の選択肢（1行に1件）</span><textarea id="organization-options" maxlength="4050" placeholder="営業部&#10;開発部&#10;管理部"></textarea></label>
          <label class="field"><span>初期選択</span><select id="organization-default"><option value="">未選択</option></select></label>
          <label class="check-field"><input id="organization-allow-other" type="checkbox"><span>「その他」を表示して自由入力を許可する</span></label>
          <p class="helper">初期選択を未選択にすると、参加者の選び間違いを防ぎやすくなります。</p>
        </div>
        <label class="check-field"><input id="organization-required" type="checkbox"><span>所属を必須入力にする</span></label>
        <label class="check-field"><input id="organization-results" type="checkbox"><span>結果発表で優勝者の所属を表示する</span></label>
      </div>
      <p class="notice">参加者名はQRを読み取った本人が登録します。QRには推測できないランダムな認証情報を使用します。</p>
    </section>
    <button type="submit" class="btn gold block" id="create">内容を確認してゲームを作成</button>
  </form></main>`;
  const namesInput = document.querySelector('#names');
  const modeInput = document.querySelector('#registration-mode');
  const organizationEnabled = document.querySelector('#organization-enabled');
  const organizationInputMode = document.querySelector('#organization-input-mode');
  const organizationOptionsInput = document.querySelector('#organization-options');
  const analyzeNames = () => {
    const raw = namesInput.value.split('\n').map(v => v.trim()).filter(Boolean);
    const counts = new Map(); raw.forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
    const duplicates = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
    document.querySelector('#name-summary').innerHTML = `<b>登録予定：${counts.size}名</b>${duplicates.length ? `<br><span class="error">重複している名前：${duplicates.map(escapeHtml).join('、')}</span>` : '<br>重複はありません。'}`;
    return { raw, unique: [...counts.keys()], duplicates };
  };
  namesInput.oninput = analyzeNames;
  const readOrganizationOptions = () => [...new Set(organizationOptionsInput.value.split('\n').map(value => value.trim()).filter(Boolean))];
  const syncOrganizationDefault = () => {
    const select = document.querySelector('#organization-default');
    const previous = select.value;
    const options = readOrganizationOptions();
    select.innerHTML = `<option value="">未選択</option>${options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}`;
    if (options.includes(previous)) select.value = previous;
  };
  const syncSetup = () => {
    const selfMode = modeInput.value === 'self-registration';
    document.querySelector('#roster-settings').classList.toggle('hidden', selfMode);
    document.querySelector('#self-settings').classList.toggle('hidden', !selfMode);
    document.querySelector('#organization-settings').classList.toggle('hidden', !selfMode || !organizationEnabled.checked);
    document.querySelector('#organization-select-settings').classList.toggle('hidden', !selfMode || !organizationEnabled.checked || organizationInputMode.value !== 'select');
  };
  modeInput.onchange = syncSetup; organizationEnabled.onchange = syncSetup; organizationInputMode.onchange = syncSetup;
  organizationOptionsInput.oninput = syncOrganizationDefault;
  syncOrganizationDefault(); syncSetup();
  document.querySelector('#game-setup').onsubmit = async (event) => {
    event.preventDefault();
    const selfMode = modeInput.value === 'self-registration';
    const names = analyzeNames();
    if (!selfMode && names.duplicates.length) return showToast('重複している参加者名を修正してください。', true);
    if (!selfMode && names.unique.length < 2) return showToast('参加者を2名以上入力してください。', true);
    const participantCount = Number(document.querySelector('#participant-count').value);
    if (selfMode && (!Number.isInteger(participantCount) || participantCount < 2 || participantCount > 100)) return showToast('参加人数は2〜100名で入力してください。', true);
    const min = Number(document.querySelector('#min').value); const max = Number(document.querySelector('#max').value);
    if (min >= max) return showToast('最大の数字は最小の数字より大きくしてください。', true);
    const organizationOptions = readOrganizationOptions();
    const selectOrganization = selfMode && organizationEnabled.checked && organizationInputMode.value === 'select';
    if (selectOrganization && organizationOptions.length < 1) return showToast('所属の選択肢を1件以上入力してください。', true);
    if (organizationOptions.length > 50) return showToast('所属の選択肢は50件以内にしてください。', true);
    const total = selfMode ? participantCount : names.unique.length;
    if (!confirm(`${total}名、数字は${min}〜${max}、${selfMode?'本人登録':'名簿登録'}でゲームを作成します。よろしいですか？`)) return;
    const submit = document.querySelector('#create'); submit.disabled = true; submit.textContent = '作成中…';
    const payload = { title:document.querySelector('#title').value,min,max,registrationMode:modeInput.value,names:names.unique,participantCount,organizationEnabled:selfMode&&organizationEnabled.checked,organizationLabel:document.querySelector('#organization-label').value,organizationInputMode:organizationInputMode.value,organizationOptions,organizationDefault:selectOrganization?document.querySelector('#organization-default').value:'',organizationAllowOther:selectOrganization&&document.querySelector('#organization-allow-other').checked,organizationRequired:selfMode&&document.querySelector('#organization-required').checked,showOrganizationInResults:selfMode&&document.querySelector('#organization-results').checked };
    try { await api('/api/admin/game', {method:'POST',body:JSON.stringify(payload)}); state.adminDraft = null; adminApp(); }
    catch(e) { showToast(e.message, true); submit.disabled = false; submit.textContent = '内容を確認してゲームを作成'; }
  };
  focusHeading();
}

function adminParticipantRowHtml(participant, game) {
  const selfMode = game.registrationMode === 'self-registration';
  const mutable = ['setup','voting','closed'].includes(game.status);
  const card = participant.card_number ? `<b class="card-number">${String(participant.card_number).padStart(2,'0')}</b>` : '';
  const name = participant.is_registered ? escapeHtml(participant.display_name) : '<em>未登録</em>';
  const organization = participant.organization ? `<small>${escapeHtml(participant.organization)}</small>` : '';
  const status = participant.has_voted ? '<span class="voted">投票済み</span>' : participant.is_registered ? '<span class="waiting">未投票</span>' : '<span class="unregistered">未登録</span>';
  const unlock = participant.has_voted && ['voting','closed'].includes(game.status) ? `<button type="button" class="small-danger" data-unlock="${participant.id}">票を解除</button>` : '';
  const registration = selfMode && mutable ? `<button type="button" class="text-button compact" data-edit-registration="${participant.id}">${participant.is_registered?'登録情報を修正':'代理登録'}</button>${participant.is_registered&&!participant.has_voted?`<button type="button" class="small-danger" data-unregister="${participant.id}">登録解除</button>`:''}` : '';
  return `<div class="person-row registration-row"><div class="participant-meta">${card}<span>${name}${organization}</span></div><div class="participant-state">${status}${unlock}${registration}</div></div>`;
}

function formatEventTime(value) {
  if (!value) return '—';
  const numeric = Number(value);
  const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function purgeCountdown(purgeAfter) {
  const seconds = Math.max(0, Number(purgeAfter) - Math.floor(Date.now() / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours > 0 ? `${hours}時間${minutes ? `${minutes}分` : ''}` : `${minutes}分`;
}

function roundHistoryHtml(data) {
  if (!data.roundHistory?.length) return '';
  return `<section class="card round-history"><p class="eyebrow">管理者だけに表示</p><h2>過去ラウンド履歴</h2><div class="history-list">${data.roundHistory.map(round => `<details><summary><strong>第${round.roundNumber}回</strong><span>${round.champion ? `優勝 ${round.champion.number} — ${escapeHtml(round.champion.name)}` : '優勝者なし'}</span></summary><div class="history-detail"><p>実施：${escapeHtml(formatEventTime(round.startedAt))}〜${escapeHtml(formatEventTime(round.finishedAt))}</p>${round.champion?.organization ? `<p>所属：${escapeHtml(round.champion.organization)}</p>` : ''}<div class="history-distribution" aria-label="第${round.roundNumber}回の回答分布">${round.distribution.map(item => `<span><b>${item.number}</b><small>${item.count}票</small></span>`).join('')}</div></div></details>`).join('')}</div></section>`;
}

function renderAdminDashboard(data) {
  const g = data.game; const voting = g.status === 'voting'; const closed = g.status === 'closed'; const presenting = g.status === 'presenting'; const finished = g.status === 'finished'; const ended = Boolean(g.endedAt);
  const stateKey = `${g.roundNumber}:${g.status}:${ended}`;
  const statusChanged = state.lastAdminStatus !== stateKey;
  state.lastAdminStatus = stateKey;
  const participantUrl = `${location.origin}/shared?s=${encodeURIComponent(g.sharedToken)}`;
  const pres = data.presentation;
  const utility = ended ? '' : `<details class="utility-panel"><summary>補助メニューを開く</summary><div class="toolbar"><a class="btn secondary" href="/rules?mode=present" target="_blank" rel="noopener">ルール説明を会場に表示 ↗</a><a class="btn secondary" href="/present" target="_blank">会場の発表画面 ↗</a><a class="btn secondary" href="/admin/print" target="_blank">参加者QRカード ↗</a><a class="btn secondary" href="${participantUrl}" target="_blank" rel="noopener">共用端末 ↗</a><button type="button" class="btn secondary" id="copy-link">共用端末URLをコピー</button></div></details>`;
  app.innerHTML = `<main class="shell"><div class="row between">${brand}<div class="pill"><b>第${g.roundNumber}回</b>　現在：${ended?'イベント終了':statusLabel(g.status)}</div></div>${adminGuideHtml(data)}${utility}<div class="admin-layout"><section class="card"><div class="statusbar"><div><p class="eyebrow">第${g.roundNumber}回・投票状況</p><h2>${escapeHtml(g.title)}</h2><p class="helper">${ended ? 'イベント終了後の確認画面です。新しい操作はできません。' : voting ? `残り ${data.total - data.voted}名。全員が投票すると自動で締め切ります。` : statusHelp(g.status)}</p></div><div class="count" aria-label="${data.total}人中${data.voted}人が投票済み">${data.voted}<small> / ${data.total}</small></div></div><div class="participant-list">${data.participants.map(p => adminParticipantRowHtml(p,g)).join('')}</div></section><aside class="stack">${!ended && voting ? proxyVoteHtml(data) : ''}${!ended && closed ? '<section class="card notice"><b>入力を直す場合</b><p>対象者の「票を解除」→「締切を取り消す」の順で操作してください。</p></section>' : ''}${pres ? presentationControlHtml(pres) : ''}</aside></div>${!ended && (voting || closed || g.status === 'setup') ? dangerActionsHtml(g.status, g.roundNumber) : ''}${finished ? distributionHtml(data) : ''}${roundHistoryHtml(data)}</main>`;
  if (state.adminDraft && voting) {
    const person = document.querySelector('#proxy-person'); const number = document.querySelector('#proxy-number');
    if ([...person.options].some(o => o.value === state.adminDraft.person)) person.value = state.adminDraft.person;
    if ([...number.options].some(o => o.value === state.adminDraft.number)) number.value = state.adminDraft.number;
  }
  restoreAdminUi(statusChanged);
  document.querySelector('#copy-link')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(participantUrl); showToast('共用端末URLをコピーしました。'); } catch { showToast('コピーできませんでした。共用端末を開いてURLをコピーしてください。', true); } });
  document.querySelector('#start')?.addEventListener('click', event => adminAction('/api/admin/start', {}, event.currentTarget));
  document.querySelector('#expand-setup')?.addEventListener('click', async event => {
    const addParticipants = Number(document.querySelector('#add-participants').value);
    const addNumbers = Number(document.querySelector('#add-numbers').value);
    if (!Number.isInteger(addParticipants) || addParticipants < 1 || !Number.isInteger(addNumbers) || addNumbers < 1) return showToast('追加人数と追加する数字を1以上で入力してください。', true);
    if (!confirm(`${data.total}人 → ${data.total + addParticipants}人、数字は1〜${g.max} → 1〜${g.max + addNumbers}へ増やします。既存QRは変わりません。よろしいですか？`)) return;
    event.currentTarget.disabled = true; event.currentTarget.textContent = '追加中…';
    try {
      const result = await api('/api/admin/expand-setup', {method:'POST',body:JSON.stringify({expectedTotal:data.total,expectedMax:g.max,addParticipants,addNumbers})});
      state.newCardsFrom = result.firstCardNumber;
      await adminApp();
      showToast(`${addParticipants}人と数字${addNumbers}個を追加しました。`);
    } catch(e) { showToast(e.message, true); event.currentTarget.disabled = false; event.currentTarget.textContent = '人数と数字を追加'; }
  });
  document.querySelector('#close')?.addEventListener('click', event => confirm('未投票者がいても投票を締め切ります。よろしいですか？') && adminAction('/api/admin/close', {}, event.currentTarget));
  document.querySelector('#reopen')?.addEventListener('click', event => adminAction('/api/admin/reopen', {}, event.currentTarget));
  document.querySelector('#reset-game')?.addEventListener('click', event => confirm('このゲーム設定と参加者QRを削除して、最初から作り直しますか？') && resetSetupGame(event.currentTarget));
  document.querySelector('#advance')?.addEventListener('click', event => (!closed || confirm('会場の発表画面に最初の数字を表示します。発表を開始しますか？')) && adminAction('/api/admin/advance', {}, event.currentTarget));
  document.querySelector('#next-round')?.addEventListener('click', event => adminAction('/api/admin/next-round', {expectedRoundNumber:g.roundNumber}, event.currentTarget));
  document.querySelector('#end-event')?.addEventListener('click', event => confirm('イベントを終了します。24時間後に氏名・所属・投票・履歴を完全削除します。よろしいですか？') && adminAction('/api/admin/end-event', {}, event.currentTarget));
  document.querySelector('#purge-now')?.addEventListener('click', async event => {
    if (!confirm('イベント一式を今すぐ完全削除します。氏名・所属・投票・履歴・QR・管理PINは復元できません。実行しますか？')) return;
    const typed = prompt('確認のため「完全削除」と入力してください。');
    if (typed !== '完全削除') return showToast('入力が一致しないため削除しませんでした。', true);
    event.currentTarget.disabled = true;
    try { await api('/api/admin/purge-now', {method:'POST',body:JSON.stringify({confirmation:typed})}); clearTimeout(state.timer); state.game = null; state.admin = null; state.lastAdminStatus = null; adminPinSetup(); }
    catch(e) { showToast(e.message, true); event.currentTarget.disabled = false; }
  });
  document.querySelectorAll('[data-unlock]').forEach(el => el.onclick = event => confirm(`${el.closest('.person-row').querySelector('span').textContent}さんの票を解除しますか？`) && adminAction('/api/admin/unlock', {participantId:Number(el.dataset.unlock)}, event.currentTarget));
  document.querySelectorAll('[data-edit-registration]').forEach(el => el.onclick = event => {
    const participant = data.participants.find(p => Number(p.id) === Number(el.dataset.editRegistration));
    const displayName = prompt('司会者が読み上げてよい名前', participant?.display_name || '');
    if (displayName === null) return;
    const organizationPrompt = g.organization.inputMode === 'select'
      ? `${g.organization.label}（選択肢：${g.organization.options.join(' / ')}${g.organization.allowOther?' / その他は自由入力':''}）`
      : g.organization.label;
    const organization = g.organization.enabled ? prompt(organizationPrompt, participant?.organization || g.organization.defaultValue || '') : '';
    if (organization === null) return;
    if (!displayName.trim()) return showToast('読み上げてよい名前を入力してください。', true);
    if (g.organization.enabled && g.organization.required && !organization.trim()) return showToast(`${g.organization.label}を入力してください。`, true);
    if (g.organization.enabled && g.organization.inputMode === 'select' && !g.organization.allowOther && organization.trim() && !g.organization.options.includes(organization.trim())) return showToast(`${g.organization.label}を選択肢から入力してください。`, true);
    if (confirm(`${String(participant.card_number).padStart(2,'0')}番を「${displayName.trim()}」で登録します。よろしいですか？`)) adminAction('/api/admin/registration', {participantId:participant.id,displayName:displayName.trim(),organization:organization.trim()}, event.currentTarget);
  });
  document.querySelectorAll('[data-unregister]').forEach(el => el.onclick = event => {
    const participant = data.participants.find(p => Number(p.id) === Number(el.dataset.unregister));
    if (confirm(`${String(participant.card_number).padStart(2,'0')}番の登録情報を消去しますか？QRトークンは変わらず、本人が再登録できます。`)) adminAction('/api/admin/unregister', {participantId:participant.id}, event.currentTarget);
  });
  document.querySelector('#proxy-submit')?.addEventListener('click', event => {
    const personSelect = document.querySelector('#proxy-person'); const numberSelect = document.querySelector('#proxy-number');
    const name = personSelect.options[personSelect.selectedIndex]?.textContent; const number = Number(numberSelect.value);
    if (!name) return showToast('代理入力する参加者がいません。', true);
    if (confirm(`${name}さんの数字を「${number}」で確定します。本人に確認しましたか？`)) adminAction('/api/admin/proxy-vote', {participantId:Number(personSelect.value),number}, event.currentTarget);
  });
  clearTimeout(state.timer);
  const refresh = () => {
    const active = document.activeElement;
    const userIsOperating = document.querySelector('details[open]') || (active && app.contains(active) && active.matches('button,a,input,select,textarea,summary'));
    if (userIsOperating && state.adminBusySince === null) state.adminBusySince = Date.now();
    if (userIsOperating && Date.now() - state.adminBusySince < 10_000) { state.timer = setTimeout(refresh, 1200); return; }
    state.adminBusySince = null;
    adminApp();
  };
  state.timer = setTimeout(refresh, presenting || voting ? 1200 : ended ? 30_000 : 5000);
  if (statusChanged) focusHeading();
}

function adminGuideHtml(data) {
  const g = data.game; const pres = data.presentation;
  const sharedUrl = `/shared?s=${encodeURIComponent(g.sharedToken)}`;
  if (g.endedAt) return `<section class="next-action stack retention-panel"><p class="eyebrow">イベント終了済み</p><h2>個人情報の削除まで残り ${escapeHtml(purgeCountdown(g.purgeAfter))}</h2><p class="lead">削除予定：${escapeHtml(formatEventTime(g.purgeAfter))}</p><p class="notice">予定時刻になると、氏名・所属・投票・全ラウンド履歴・QR認証情報・管理PINを削除します。それまでは下の履歴を確認できます。</p><details class="danger-zone"><summary>予定を待たずに削除する</summary><p>この操作は取り消せません。削除後は管理PINの初回設定から始まります。</p>${button('今すぐ完全削除','purge-now','danger')}</details></section>`;
  if (g.status === 'setup') {
    const expansion = g.registrationMode === 'self-registration' ? `<details class="setup-panel"><summary>参加人数と数字の上限を増やす</summary><p class="helper">既存QRはそのまま使えます。追加した参加者にだけ新しいQRを渡します。</p><div class="grid2"><label class="field"><span>追加人数</span><input id="add-participants" type="number" min="1" max="${100-data.total}" value="5"></label><label class="field"><span>数字をいくつ増やすか</span><input id="add-numbers" type="number" min="1" max="${999-g.max}" value="4"></label></div>${button('人数と数字を追加','expand-setup','secondary block')}</details>` : '';
    const addedPrint = state.newCardsFrom ? `<a class="btn gold block" href="/admin/print?from=${state.newCardsFrom}" target="_blank">追加したQRだけ印刷 ↗</a>` : '';
    return `<section class="next-action stack"><p class="eyebrow">第${g.roundNumber}回・次にすること</p><h2>${g.roundNumber === 1 ? '配布物と会場画面を準備する' : '同じQRで次の投票を準備する'}</h2><ol class="checklist"><li><a href="/rules?mode=present" target="_blank" rel="noopener">ルール説明</a>を会場スクリーンで確認する</li>${g.roundNumber === 1 ? '<li><a href="/admin/print" target="_blank">参加者QRカードを印刷</a>して本人へ配る</li>' : '<li>配布済みの個人QRをそのまま使う</li>'}<li><a href="/present" target="_blank">発表画面</a>を会場スクリーンに表示する</li><li>スマホを使えない人用に<a href="${sharedUrl}" target="_blank" rel="noopener">共用端末</a>を開く</li></ol>${addedPrint}${expansion}<p class="notice">準備ができたら第${g.roundNumber}回の投票受付を開始します。</p>${button(`第${g.roundNumber}回の投票受付を開始`,'start','cyan block') }</section>`;
  }
  if (g.status === 'voting') return `<section class="next-action stack"><p class="eyebrow">次にすること</p><h2>未投票者を確認する</h2><p class="lead">残り <b>${data.total - data.voted}名</b>です。全員の投票が終わると、自動で「発表準備完了」になります。</p></section>`;
  if (g.status === 'closed') return `<section class="next-action stack"><p class="eyebrow">次にすること</p><h2>会場画面を確認して、発表を始める</h2><p class="lead">投票内容や人数はまだ公開されていません。開始すると、最初の数字だけを会場に表示します。</p>${button('最初の数字を表示して発表開始','advance','gold block')}</section>`;
  if (g.status === 'presenting') return `<section class="next-action stack"><p class="eyebrow">次に会場へ公開する内容</p><h2>${escapeHtml(nextLabel(pres))}</h2><p class="lead">ボタンを1回押すと、会場画面が1段階だけ進みます。</p>${button(nextLabel(pres),'advance','gold block')}</section>`;
  return `<section class="next-action stack"><p class="eyebrow">第${g.roundNumber}回終了</p><h2>結果発表が完了しました</h2><p class="lead">同じ参加者・同じQRで続けるか、イベント全体を終了してください。</p><div class="action-row">${button(`同じ設定で第${g.roundNumber + 1}回を準備する`,'next-round','cyan')}${button('イベント終了（24時間後に全削除）','end-event','secondary')}</div></section>`;
}

function dangerActionsHtml(status, roundNumber = 1) {
  if (status === 'setup' && roundNumber === 1) return `<details class="danger-zone"><summary>設定をやり直す</summary><p>現在の参加者QRは使えなくなります。</p>${button('このゲームを削除して作り直す','reset-game','danger')}</details>`;
  if (status === 'voting') return `<details class="danger-zone"><summary>全員を待たずに締め切る</summary><p>通常は全員投票による自動締切を待ってください。</p>${button('投票を手動で締め切る','close','danger')}</details>`;
  if (status === 'closed') return `<details class="danger-zone"><summary>締切を取り消す</summary><p>未投票や修正が必要な場合だけ受付を再開します。</p>${button('投票受付を再開する','reopen','secondary')}</details>`;
  return '';
}

function statusHelp(status) { return ({setup:'投票受付はまだ始まっていません。',closed:'結果はまだ公開されていません。',presenting:'会場画面で段階的に発表中です。',finished:'発表は終了しました。'}[status] || ''); }

function captureAdminUi() {
  const main = app.querySelector('main');
  if (!main || !state.admin) return null;
  const active = document.activeElement;
  let focus = null;
  if (active && app.contains(active)) {
    if (active.id) focus = `#${active.id}`;
    else if (active.dataset?.unlock) focus = `[data-unlock="${active.dataset.unlock}"]`;
    else if (active.dataset?.editRegistration) focus = `[data-edit-registration="${active.dataset.editRegistration}"]`;
    else if (active.dataset?.unregister) focus = `[data-unregister="${active.dataset.unregister}"]`;
    else if (active.tagName === 'SUMMARY') focus = `.${active.parentElement.classList[0]} summary`;
    else if (active.tagName === 'A') focus = `a[href="${active.getAttribute('href')}"]`;
  }
  return { focus, utilityOpen: Boolean(document.querySelector('.utility-panel[open]')), dangerOpen: Boolean(document.querySelector('.danger-zone[open]')), scrollY: window.scrollY };
}

function restoreAdminUi(statusChanged) {
  const ui = state.adminUi;
  state.adminUi = null;
  if (!ui || statusChanged) return;
  if (ui.utilityOpen) document.querySelector('.utility-panel')?.setAttribute('open', '');
  if (ui.dangerOpen) document.querySelector('.danger-zone')?.setAttribute('open', '');
  if (ui.focus) document.querySelector(ui.focus)?.focus({ preventScroll: true });
  window.scrollTo({ top: ui.scrollY, behavior: 'auto' });
}

function proxyVoteHtml(data) {
  const available = data.participants.filter(p => p.is_registered && !p.has_voted);
  const nums = Array.from({length:data.game.max-data.game.min+1},(_,i)=>i+data.game.min);
  return `<section class="card stack proxy-card"><div><p class="eyebrow">スマホを使えない人の代理入力</p><h2>本人と一緒に入力</h2><p class="helper">${data.game.registrationMode==='self-registration'?'未登録の場合は、参加者一覧の「代理登録」を先に行います。':'氏名と数字を本人に読み上げ、確認してから確定してください。'}</p></div><label class="field"><span>参加者</span><select id="proxy-person">${available.map(p=>`<option value="${p.id}">${p.card_number?`${String(p.card_number).padStart(2,'0')} / `:''}${escapeHtml(p.display_name)}</option>`).join('')}</select></label><label class="field"><span>本人が選んだ数字</span><select id="proxy-number">${nums.map(n=>`<option>${n}</option>`).join('')}</select></label>${button('氏名と数字を確認して代理投票','proxy-submit','secondary block')}</section>`;
}
function presentationControlHtml(p) {
  if (['pair','pair_count','pair_person'].includes(p.stage)) {
    const detail = p.stage === 'pair'
      ? '両方の人数はまだ非公開です'
      : p.stage === 'pair_count'
        ? p.finalPair.map(entry => `${entry.number}：${entry.count}人`).join('　')
        : p.finalPair.map(entry => `${entry.number}：${entry.count === 1 && entry.person ? escapeHtml(entry.person.name) : entry.count === 0 ? '該当者なし' : '重複'}`).join('　');
    return `<section class="card"><p class="eyebrow">会場画面の現在表示</p><h2>1 & 2 / ${stageLabel(p.stage)}</h2><p class="lead">${detail}</p></section>`;
  }
  return `<section class="card"><p class="eyebrow">会場画面の現在表示</p><h2>${p.current ?? '—'} / ${stageLabel(p.stage)}</h2><p class="lead">${p.count === null ? '人数はまだ非公開です' : `${p.count} 人`}</p></section>`;
}
function distributionHtml(data) {
  const lookup = new Map((data.distribution||[]).map(x=>[Number(x.number),x])); const winner = data.presentation?.champion?.number;
  const maxCount = Math.max(1, ...(data.distribution || []).map(row => Number(row.count) || 0));
  const numbers = Array.from({length:data.game.max-data.game.min+1},(_,i)=>i+data.game.min);
  const chart = numbers.map(n=>{
    const d=lookup.get(n)||{count:0,names:''}; const count=Number(d.count)||0; const isWinner=n===winner;
    const { height: barHeight, y: barY } = histogramGeometry(count, maxCount);
    return `<div class="mini-column${isWinner?' winner':''}" role="img" aria-label="数字${n}は${count}票${isWinner?'、優勝':''}"><span class="mini-votes">${count}</span><div class="mini-bar-slot"><svg class="histogram-bar" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="${barY}" width="100" height="${barHeight}" fill="currentColor"></rect></svg></div><strong>${n}</strong></div>`;
  }).join('');
  const details = numbers.filter(n=>(Number(lookup.get(n)?.count)||0)>0).map(n=>{const d=lookup.get(n);return `<li><strong>${n}</strong><span>${Number(d.count)}票</span><span>${escapeHtml(d.names||'—')}</span></li>`}).join('');
  const champion = data.presentation?.champion;
  const winnerSummary = champion ? `<div class="winner-summary"><span>★ 優勝</span><strong>${winner}</strong><b>${escapeHtml(champion.name)}${champion.organization?`<small>${escapeHtml(champion.organization)}</small>`:''}</b></div>` : '<div class="winner-summary no-winner"><span>結果</span><b>今回は優勝者なし</b></div>';
  return `<section class="card distribution-card"><p class="eyebrow">全回答分布</p><h2>数字ごとの投票数</h2>${winnerSummary}<div class="compact-distribution${numbers.length>18?' many':''}" role="group" aria-label="数字ごとの投票数。棒の上が票数、下が数字です">${chart}</div><div class="chart-legend"><span>上：票数</span><span>下：数字</span></div><details class="distribution-details"><summary>回答者名を見る</summary><ul>${details}</ul></details></section>`;
}
async function adminAction(url, data={}, trigger=null) {
  const controls = [...document.querySelectorAll('#start,#close,#reopen,#advance,#reset-game,#next-round,#end-event,#proxy-submit,[data-unlock],[data-edit-registration],[data-unregister]')];
  controls.forEach(el => { el.disabled = true; });
  const original = trigger?.textContent;
  if (trigger) trigger.textContent = '処理中…';
  try { await api(url,{method:'POST',body:JSON.stringify(data)}); state.adminDraft = null; await adminApp(); }
  catch(e) {
    showToast(e.message, true);
    controls.forEach(el => { el.disabled = false; });
    if (trigger) trigger.textContent = original;
  }
}

async function resetSetupGame(trigger) {
  const original = trigger.textContent;
  trigger.disabled = true; trigger.textContent = '削除中…';
  try { await api('/api/admin/reset-game',{method:'POST',body:'{}'}); state.adminDraft = null; renderSetup(); }
  catch(e) { showToast(e.message, true); trigger.disabled = false; trigger.textContent = original; }
}

async function printApp() {
  let auth;
  try { auth = await api('/api/admin/auth-status'); } catch(e) { return renderError(e); }
  if (!auth.configured) return adminPinSetup();
  if (!auth.authenticated) return adminLogin();
  let data;
  try { data = await api('/api/admin/participant-links'); } catch(e) { return renderError(e); }
  const selfMode = data.game.registrationMode === 'self-registration';
  const from = Number(new URLSearchParams(location.search).get('from'));
  const participants = Number.isInteger(from) && from > 0 ? data.participants.filter(participant => Number(participant.cardNumber) >= from) : data.participants;
  const cards = participants.map(p => { const label=selfMode?cardLabel(p.cardNumber):p.name; return `<article class="qr-card"><p class="eyebrow">${selfMode?'番号QR・本人専用':'本人専用QR'}</p><h2>${escapeHtml(label)}</h2><img src="/api/qr?text=${encodeURIComponent(p.url)}" alt="${escapeHtml(label)}のQRコード"><p><b>${selfMode?'1. QRを読み取る<br>2. 名前を初回登録<br>3. 数字を選んで投票':'1. QRを読み取る<br>2. 数字を1つ選ぶ<br>3. 名前と数字を確認して投票'}</b></p><small>1人だけが選んだ最小の数字が勝ち。相談は禁止。</small></article>`; });
  const cardsPerPage = 6;
  const pageCount = Math.ceil(cards.length / cardsPerPage);
  const pages = Array.from({length:pageCount}, (_, pageIndex) => `<section class="qr-page"><header class="print-page-header"><strong>${escapeHtml(data.game.title)} — 参加者QRカード</strong><span>${pageIndex + 1} / ${pageCount}</span></header><div class="qr-cards">${cards.slice(pageIndex * cardsPerPage, (pageIndex + 1) * cardsPerPage).join('')}</div></section>`).join('');
  app.innerHTML = `<main class="print-shell"><header class="print-header"><div>${brand}<h2>${escapeHtml(data.game.title)} — ${from?'追加分 ':''}参加者QRカード</h2><p>A4縦・1ページ6枚（2列×3行）で印刷します。${selfMode?'カード番号が重ならないよう、参加者へ1枚ずつ渡してください。':'氏名を確認して、カードを本人へ1枚ずつ渡してください。'}</p></div><div class="row"><button class="btn gold" id="print-now">印刷する</button><a class="btn secondary" href="/admin">管理画面へ戻る</a></div></header><div class="qr-pages">${pages}</div></main>`;
  document.querySelector('#print-now').onclick = () => window.print();
}

function presentApp() {
  app.className = 'present';
  const poll = async () => { try { const data=await api('/api/present'); renderPresent(data); } catch(e){ renderError(e); } state.timer=setTimeout(poll,800); }; poll();
}
function renderPresent(data) {
  if (!data.game || data.stage === 'idle') return app.innerHTML=`<div class="present-inner">${brand}${data.game?.roundNumber?`<div class="venue-round">第${data.game.roundNumber}回</div>`:''}<div class="present-label">PLEASE WAIT</div><div class="people">まもなく発表</div></div>`;
  const champion = data.champion ? `<aside class="champion-box"><span>CURRENT CHAMPION</span><strong>${data.champion.number} — ${escapeHtml(data.champion.name)}</strong>${data.champion.organization?`<small>${escapeHtml(data.champion.organization)}</small>`:''}</aside>` : '';
  const head = `${brand}<div class="venue-round">第${data.game.roundNumber}回</div>${champion}`;
  if (['pair','pair_count','pair_person'].includes(data.stage)) {
    const title = data.stage === 'pair' ? 'FINAL 1 & 2' : data.stage === 'pair_count' ? '1 & 2 COUNT' : 'WHO CHOSE 1 & 2?';
    return app.innerHTML=`<div class="present-inner">${head}<div class="final-title">${title}</div>${finalPairHtml(data, true)}<div class="remaining">FINAL REVEAL</div></div>`;
  }
  if (data.stage === 'final') return app.innerHTML=`<div class="present-inner">${head}${data.champion?`<div class="final-title">FINAL CHAMPION</div><div class="hero-number">${data.champion.number}</div><div class="person-name">${escapeHtml(data.champion.name)}</div>${data.champion.organization?`<div class="person-organization">${escapeHtml(data.champion.organization)}</div>`:''}<div class="verdict">ONLY LONELY</div>`:`<div class="final-title">NO ONLY LONELY</div><div class="people">今回は該当者なし</div>`}</div>`;
  let body=`<div class="present-label">NEXT</div><div class="hero-number">${data.current}</div>`;
  if (['count','only','person','champion'].includes(data.stage)) body+=`<div class="people">${data.count} ${data.count===1?'PERSON':'PEOPLE'}</div><div class="verdict">${data.count===0?'NO ONE':data.count===1?'ONLY LONELY':'NOT LONELY'}</div>`;
  if (data.stage==='only') body+=`<div class="present-label reveal-prompt" style="margin-top:26px">選んだ人は…</div>${data.champion ? '<div class="verdict">CHALLENGER!</div>' : ''}`;
  if (['person','champion'].includes(data.stage) && data.person) body+=`<div class="person-name">${escapeHtml(data.person.name)}</div>`;
  if (data.stage==='champion') body+=`<div class="final-title" style="margin-top:22px">${data.champion?'NEW CHAMPION':'CHAMPION'}</div>`;
  app.innerHTML=`<div class="present-inner">${head}${body}<div class="remaining">${data.remaining} NUMBERS LEFT</div></div>`;
}

function nextLabel(p){
  if (p?.stage === 'pair') return '1と2の人数を同時公開';
  if (p?.stage === 'pair_count') return p.finalPair?.some(entry => entry.count === 1) ? '1と2の該当者名を同時公開' : '最終結果を公開';
  if (p?.stage === 'pair_person') return '最終結果を公開';
  if (p?.current === 3 && ((p.stage === 'count' && p.count !== 1) || p.stage === 'champion')) return '1と2の最終発表へ';
  return ({number:`数字 ${p?.current} を選んだ人数を公開`,count:p?.count===1?'「選んだ人は…」を表示':'次の数字を表示',only:`数字 ${p?.current} を選んだ人の名前を公開`,person:'この回答者を暫定王者にする',champion:'次の数字を表示'}[p?.stage]||'次の表示へ進む');
}
function statusLabel(s){return ({setup:'準備中',voting:'投票受付中',closed:'発表準備完了',presenting:'発表中',finished:'終了'}[s]||s);}
function stageLabel(s){return ({idle:'待機',number:'数字',count:'人数',only:'ONLY',person:'氏名',champion:'王者更新',pair:'最終1・2',pair_count:'1・2の人数',pair_person:'1・2の氏名',final:'最終結果'}[s]||s);}
function renderError(e){app.innerHTML=`<main class="shell participant">${brand}<div class="card"><h2 class="error">エラー</h2><p>${escapeHtml(e.message)}</p><button class="btn secondary" onclick="location.reload()">再読み込み</button></div></main>`;focusHeading();}

if(path === '/rules') rulesPage(); else if(path === '/admin/print') printApp(); else if(path.startsWith('/admin')) adminEntry(); else if(path.startsWith('/present')) presentApp(); else participantApp();
