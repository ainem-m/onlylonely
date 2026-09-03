import { advancePresentation, type Stage } from './presentation';
import QRCode from 'qrcode';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  ADMIN_SETUP_SECRET: string;
}

type Game = {
  id: number;
  round_id: number;
  current_round_number: number;
  title: string;
  min_number: number;
  max_number: number;
  status: string;
  registration_mode: 'roster' | 'self-registration';
  organization_enabled: number;
  organization_label: string;
  organization_required: number;
  show_organization_in_results: number;
  organization_input_mode: 'free' | 'select';
  organization_options_json: string;
  organization_default: string | null;
  organization_allow_other: number;
  shared_access_token: string | null;
  ended_at: number | null;
  purge_after: number | null;
  last_activity_at: number | null;
};
type State = { current_number: number | null; reveal_stage: Stage; current_champion_participant_id: number | null; current_champion_number: number | null; history_json: string; revision: number };
type AdminAuth = { pin_salt: string; pin_hash: string; pin_iterations: number; failed_attempts: number; locked_until: number };
const PIN_ITERATIONS = 100_000;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
const fail = (message: string, status = 400) => json({ error: message }, status);
class InputError extends Error {}

async function body(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new InputError('JSONで送信してください。');
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    throw new InputError('JSONの形式が不正です。');
  }
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function hashPin(pin: string, salt: string, iterations = PIN_ITERATIONS) {
  if (iterations === 1) return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return bytesToHex(bits);
}

function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function isUsableSetupSecret(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 32 || new Set(trimmed).size < 8) return false;
  const normalized = trimmed.toLowerCase();
  return !['replace-with', 'change-me', 'changeme', 'placeholder', 'example', 'not-for-production', 'local-test']
    .some((marker) => normalized.includes(marker));
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function makeSession(env: Env) {
  const auth = await env.DB.prepare('SELECT session_version FROM admin_auth WHERE id=1').first<{ session_version: string }>();
  if (!auth?.session_version) throw new Error('管理認証が設定されていません。');
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  const value = `${expires}.${auth.session_version}`;
  return `${value}.${await hmac(value, env.SESSION_SECRET)}`;
}

async function isAdmin(request: Request, env: Env) {
  const cookie = request.headers.get('cookie') || '';
  const token = cookie.match(/(?:^|;\s*)ol_admin=([^;]+)/)?.[1];
  if (!token) return false;
  const [expires, version, signature] = token.split('.');
  if (!expires || !version || !signature || Number(expires) < Date.now() / 1000) return false;
  const auth = await env.DB.prepare('SELECT session_version FROM admin_auth WHERE id=1').first<{ session_version: string }>();
  if (!auth?.session_version || !safeEqual(version, auth.session_version)) return false;
  return safeEqual(signature, await hmac(`${expires}.${version}`, env.SESSION_SECRET));
}

async function activeGame(db: D1Database) {
  return db.prepare(`SELECT g.id,gr.id AS round_id,g.current_round_number,g.title,g.min_number,g.max_number,
    gr.status,g.registration_mode,g.organization_enabled,g.organization_label,g.organization_required,
    g.show_organization_in_results,g.organization_input_mode,g.organization_options_json,g.organization_default,g.organization_allow_other,
    g.shared_access_token,g.ended_at,g.purge_after,g.last_activity_at
    FROM games g JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=g.current_round_number
    ORDER BY g.id DESC LIMIT 1`).first<Game>();
}

function requireInt(value: unknown, name: string, min: number, max: number) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new InputError(`${name}が不正です。`);
  return Number(value);
}

function gamePayload(game: Game) {
  const options = organizationOptions(game);
  return {
    id: game.id,
    roundNumber: game.current_round_number,
    title: game.title,
    min: game.min_number,
    max: game.max_number,
    status: game.status,
    registrationMode: game.registration_mode,
    organization: {
      enabled: Boolean(game.organization_enabled),
      label: game.organization_label,
      required: Boolean(game.organization_required),
      showInResults: Boolean(game.show_organization_in_results),
      inputMode: game.organization_input_mode,
      options,
      defaultValue: game.organization_default || '',
      allowOther: Boolean(game.organization_allow_other),
    },
  };
}

function organizationOptions(game: Pick<Game, 'organization_options_json'>) {
  try {
    const parsed = JSON.parse(game.organization_options_json || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

async function touchEvent(db: D1Database, gameId: number, at = nowSeconds()) {
  return db.prepare('UPDATE games SET last_activity_at=? WHERE id=? AND ended_at IS NULL').bind(at, gameId).run();
}

async function purgeEvent(db: D1Database, gameId: number) {
  await db.batch([
    db.prepare('DELETE FROM round_votes WHERE game_id=?').bind(gameId),
    db.prepare('DELETE FROM votes WHERE game_id=?').bind(gameId),
    db.prepare('DELETE FROM round_presentation_state WHERE game_id=?').bind(gameId),
    db.prepare('DELETE FROM presentation_state WHERE game_id=?').bind(gameId),
    db.prepare('DELETE FROM game_rounds WHERE game_id=?').bind(gameId),
    db.prepare('DELETE FROM participant_registrations WHERE participant_id IN (SELECT id FROM participants WHERE game_id=?)').bind(gameId),
    db.prepare('DELETE FROM participants WHERE game_id=?').bind(gameId),
    db.prepare('DELETE FROM games WHERE id=?').bind(gameId),
  ]);
  const remains = await db.prepare('SELECT 1 AS found FROM games WHERE id=?').bind(gameId).first();
  if (remains) throw new Error('イベントを完全削除できませんでした。');
  await db.prepare(`DELETE FROM admin_auth WHERE game_id=?
    OR (game_id IS NULL AND NOT EXISTS(SELECT 1 FROM games))`).bind(gameId).run();
}

async function purgeExpiredEvents(env: Env, at = nowSeconds()) {
  const expired = await env.DB.prepare(`SELECT id FROM games
    WHERE (purge_after IS NOT NULL AND purge_after<=?)
      OR (ended_at IS NULL AND COALESCE(last_activity_at,unixepoch(created_at))<=?)`).bind(at, at - 7 * 24 * 60 * 60).all<{ id: number }>();
  for (const row of expired.results) await purgeEvent(env.DB, Number(row.id));
}

function registrationValues(data: Record<string, unknown>, game: Game) {
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 80) : '';
  const organization = typeof data.organization === 'string' ? data.organization.trim().slice(0, 80) : '';
  if (!displayName) throw new InputError('司会者が読み上げてよい名前を入力してください。');
  if (game.organization_enabled && game.organization_required && !organization) throw new InputError(`${game.organization_label}を入力してください。`);
  if (game.organization_enabled && game.organization_input_mode === 'select' && organization && !game.organization_allow_other && !organizationOptions(game).includes(organization)) {
    throw new InputError(`${game.organization_label}を選択肢から選んでください。`);
  }
  return { displayName, organization: game.organization_enabled ? organization || null : null };
}

async function publicGame(env: Env, sharedToken = '') {
  const game = await activeGame(env.DB);
  if (!game) return { game: null };
  if (game.ended_at) return { game: null };
  if (game.registration_mode === 'self-registration') {
    const rows = await env.DB.prepare(`SELECT p.id,p.card_number,CASE WHEN r.participant_id IS NULL THEN 0 ELSE 1 END AS is_registered,0 AS has_voted
      FROM participants p LEFT JOIN participant_registrations r ON r.participant_id=p.id
      LEFT JOIN round_votes v ON v.participant_id=p.id AND v.round_id=?
      WHERE p.game_id=? AND v.id IS NULL ORDER BY p.card_number`).bind(game.round_id, game.id).all();
    return { game: gamePayload(game), participants: rows.results };
  }
  const rows = await env.DB.prepare(`SELECT p.id,p.display_name,p.card_number,1 AS is_registered,0 AS has_voted
    FROM participants p LEFT JOIN round_votes v ON v.participant_id=p.id AND v.round_id=?
    WHERE p.game_id=? AND v.id IS NULL ORDER BY p.display_name COLLATE NOCASE`).bind(game.round_id, game.id).all();
  return { game: gamePayload(game), participants: rows.results };
}

async function finalPairPeople(db: D1Database, roundId: number) {
  const rows = await db.prepare(`SELECT n.number,COUNT(v.id) AS count,
    CASE WHEN COUNT(v.id)=1 THEN MAX(v.participant_id) ELSE NULL END AS participant_id,
    CASE WHEN COUNT(v.id)=1 THEN MAX(v.display_name_snapshot) ELSE NULL END AS name
    FROM (SELECT 1 AS number UNION ALL SELECT 2 AS number) n
    LEFT JOIN round_votes v ON v.round_id=? AND v.number=n.number
    GROUP BY n.number ORDER BY n.number`).bind(roundId).all();
  return rows.results.map((row) => ({
    number: Number(row.number) as 1 | 2,
    count: Number(row.count),
    participantId: row.participant_id === null ? null : Number(row.participant_id),
    participantName: row.name === null ? null : String(row.name),
  }));
}

async function presentationPayload(env: Env, admin = false) {
  const game = await activeGame(env.DB);
  if (!game) return { game: null };
  if (game.ended_at && !admin) return { game: null };
  const state = await env.DB.prepare('SELECT * FROM round_presentation_state WHERE round_id=?').bind(game.round_id).first<State>();
  if (!state) return { game: { title: game.title, status: game.status }, stage: 'idle', revision: 0 };
  const current = state.current_number;
  let count: number | null = null;
  let person: { id: number; name: string } | null = null;
  let finalPair: Array<Record<string, unknown>> | null = null;
  const pairStage = ['pair', 'pair_count', 'pair_person'].includes(state.reveal_stage);
  if (current !== null && ['count', 'only', 'person', 'champion', 'final'].includes(state.reveal_stage)) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM round_votes WHERE round_id=? AND number=?').bind(game.round_id, current).first<{ count: number }>();
    count = row?.count ?? 0;
  }
  if (current !== null && ['person', 'champion'].includes(state.reveal_stage)) {
    const row = await env.DB.prepare(`SELECT p.id,v.display_name_snapshot AS name
      FROM round_votes v JOIN participants p ON p.id=v.participant_id
      WHERE v.round_id=? AND v.number=? LIMIT 1`).bind(game.round_id, current).first<{ id: number; name: string }>();
    person = row ? { id: row.id, name: row.name } : null;
  }
  if (pairStage) {
    const pair = await finalPairPeople(env.DB, game.round_id);
    finalPair = pair.map((entry) => ({ number: entry.number,
      ...(['pair_count', 'pair_person'].includes(state.reveal_stage) ? { count: entry.count } : {}),
      ...(state.reveal_stage === 'pair_person' && entry.count === 1 ? { person: { id: entry.participantId, name: entry.participantName } } : {}),
    }));
  }
  const champion = !pairStage && state.current_champion_participant_id
    ? await env.DB.prepare(`SELECT participant_id AS id,display_name_snapshot AS name,organization_snapshot AS organization
        FROM round_votes WHERE round_id=? AND participant_id=?`)
      .bind(game.round_id, state.current_champion_participant_id).first<{ id: number; name: string; organization: string | null }>()
    : null;
  const payload: Record<string, unknown> = {
    game: gamePayload(game),
    current, stage: state.reveal_stage, count, person, ...(finalPair ? { finalPair } : {}),
    champion: champion ? { id: champion.id, name: champion.name, number: state.current_champion_number, ...(game.show_organization_in_results && champion.organization ? { organization: champion.organization } : {}) } : null,
    remaining: current === null ? null : current - game.min_number,
    revision: state.revision,
  };
  if (admin) payload.history = JSON.parse(state.history_json || '[]');
  return payload;
}

async function roundHistory(env: Env, game: Game) {
  const rounds = await env.DB.prepare(`SELECT id,round_number,started_at,finished_at,champion_number,
    champion_name,champion_organization FROM game_rounds WHERE game_id=? AND status='finished' ORDER BY round_number DESC`).bind(game.id).all();
  const distributions = await env.DB.prepare(`SELECT rv.round_id,rv.number,COUNT(*) AS count
    FROM round_votes rv JOIN game_rounds gr ON gr.id=rv.round_id
    WHERE gr.game_id=? AND gr.status='finished' GROUP BY rv.round_id,rv.number ORDER BY rv.number`).bind(game.id).all();
  const byRound = new Map<number, Array<{ number: number; count: number }>>();
  for (const row of distributions.results) {
    const roundId = Number(row.round_id);
    if (!byRound.has(roundId)) byRound.set(roundId, []);
    byRound.get(roundId)!.push({ number: Number(row.number), count: Number(row.count) });
  }
  return rounds.results.map((round) => ({
    roundNumber: Number(round.round_number), startedAt: round.started_at, finishedAt: round.finished_at,
    champion: round.champion_number === null ? null : {
      number: Number(round.champion_number), name: round.champion_name,
      ...(round.champion_organization ? { organization: round.champion_organization } : {}),
    },
    distribution: byRound.get(Number(round.id)) || [],
  }));
}

async function adminState(env: Env) {
  const game = await activeGame(env.DB);
  if (!game) return { game: null };
  const participants = await env.DB.prepare(`SELECT p.id,p.card_number,
    CASE WHEN g.registration_mode='self-registration' THEN r.display_name ELSE p.display_name END AS display_name,
    r.organization,CASE WHEN g.registration_mode='roster' OR r.participant_id IS NOT NULL THEN 1 ELSE 0 END AS is_registered,
    CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS has_voted
    FROM participants p JOIN games g ON g.id=p.game_id
    LEFT JOIN participant_registrations r ON r.participant_id=p.id
    LEFT JOIN round_votes v ON v.participant_id=p.id AND v.round_id=?
    WHERE p.game_id=? ORDER BY COALESCE(p.card_number,p.id)`).bind(game.round_id, game.id).all();
  const voted = participants.results.filter((p) => Number(p.has_voted) === 1).length;
  const result: Record<string, unknown> = { game: { ...gamePayload(game), sharedToken: game.shared_access_token,
    endedAt: game.ended_at, purgeAfter: game.purge_after, lastActivityAt: game.last_activity_at },
    participants: participants.results, voted, total: participants.results.length, roundHistory: await roundHistory(env, game) };
  if (game.status === 'presenting' || game.status === 'finished') result.presentation = await presentationPayload(env, true);
  if (game.status === 'finished') {
    const dist = await env.DB.prepare(`SELECT n.number,COUNT(v.id) AS count,
      GROUP_CONCAT(v.display_name_snapshot, ' / ') AS names
      FROM (SELECT number FROM round_votes WHERE round_id=? GROUP BY number) n
      LEFT JOIN round_votes v ON v.round_id=? AND v.number=n.number
      GROUP BY n.number ORDER BY n.number`).bind(game.round_id, game.round_id).all();
    result.distribution = dist.results;
  }
  return result;
}

async function castVote(env: Env, game: Game, data: Record<string, unknown>, allowAdminParticipantId = false) {
  let participantId: number;
  if (typeof data.token === 'string' && /^[a-f0-9]{32}$/.test(data.token)) {
    const participant = await env.DB.prepare('SELECT id FROM participants WHERE game_id=? AND access_token=?').bind(game.id, data.token).first<{ id: number }>();
    if (!participant) return fail('参加用QRコードが無効です。', 404);
    participantId = participant.id;
  } else {
    participantId = requireInt(data.participantId, '参加者', 1, 2_147_483_647);
    if (!allowAdminParticipantId) {
      const sharedToken = typeof data.sharedToken === 'string' ? data.sharedToken : '';
      if (!game.shared_access_token || !safeEqual(sharedToken, game.shared_access_token)) return fail('共用端末の認証情報が無効です。', 403);
    }
  }
  const number = requireInt(data.number, '数字', game.min_number, game.max_number);
  const inserted = await env.DB.prepare(`INSERT INTO round_votes(round_id,game_id,participant_id,number,display_name_snapshot,organization_snapshot)
      SELECT ?,?,?,?,CASE WHEN g.registration_mode='self-registration' THEN r.display_name ELSE p.display_name END,
        CASE WHEN g.registration_mode='self-registration' THEN r.organization ELSE NULL END
      FROM participants p JOIN games g ON g.id=p.game_id LEFT JOIN participant_registrations r ON r.participant_id=p.id
      JOIN game_rounds gr ON gr.game_id=g.id AND gr.id=?
      WHERE p.id=? AND p.game_id=? AND gr.status='voting' AND g.ended_at IS NULL
      AND (EXISTS(SELECT 1 FROM games WHERE id=? AND registration_mode='roster')
        OR EXISTS(SELECT 1 FROM participant_registrations WHERE participant_id=?))
      AND NOT EXISTS(SELECT 1 FROM round_votes WHERE round_id=? AND participant_id=?)
      RETURNING id`)
    .bind(game.round_id, game.id, participantId, number, game.round_id, participantId, game.id, game.id, participantId, game.round_id, participantId)
    .first<{ id: number }>();
  if (!inserted) return fail(game.registration_mode === 'self-registration' ? '未登録か、すでに投票済みです。' : 'この参加者はすでに投票済みです。', 409);
  const round = await env.DB.prepare('SELECT status FROM game_rounds WHERE id=?').bind(game.round_id).first<{ status: string }>();
  return json({ ok: true, autoClosed: round?.status === 'closed' }, 201);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/health') return json({ ok: true });
  if (path === '/api/qr' && request.method === 'GET') {
    const text = url.searchParams.get('text') || '';
    if (!text || text.length > 500) return fail('QRコードのURLが不正です。');
    const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#080914', light: '#ffffff' } });
    return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  }
  if (path === '/api/game' && request.method === 'GET') {
    const game = await activeGame(env.DB);
    const sharedToken = url.searchParams.get('s') || '';
    if (game && (!game.shared_access_token || !safeEqual(sharedToken, game.shared_access_token))) return fail('共用端末のURLが無効です。司会者に開き直してもらってください。', 403);
    return json(await publicGame(env, sharedToken));
  }
  if (path === '/api/participant' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (!/^[a-f0-9]{32}$/.test(token)) return fail('参加用QRコードが無効です。', 404);
    const participant = await env.DB.prepare(`SELECT p.id,g.id AS game_id,g.current_round_number,p.card_number,
      CASE WHEN g.registration_mode='self-registration' THEN r.display_name ELSE p.display_name END AS display_name,
      CASE WHEN g.registration_mode='roster' OR r.participant_id IS NOT NULL THEN 1 ELSE 0 END AS is_registered,
      r.organization,g.title,g.min_number,g.max_number,gr.status,g.registration_mode,g.organization_enabled,
      g.organization_label,g.organization_required,g.show_organization_in_results,g.organization_input_mode,
      g.organization_options_json,g.organization_default,g.organization_allow_other,
      CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS has_voted
      FROM participants p JOIN games g ON g.id=p.game_id
      LEFT JOIN participant_registrations r ON r.participant_id=p.id
      JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=g.current_round_number
      LEFT JOIN round_votes v ON v.round_id=gr.id AND v.participant_id=p.id
      WHERE p.access_token=? AND g.ended_at IS NULL ORDER BY g.id DESC LIMIT 1`).bind(token).first();
    if (!participant) return fail('参加用QRコードが無効です。', 404);
    return json({ participant });
  }
  if (path === '/api/register' && request.method === 'POST') {
    const data = await body(request);
    const game = await activeGame(env.DB);
    if (!game || game.registration_mode !== 'self-registration') return fail('本人登録を受け付けるゲームではありません。', 409);
    if (!['setup', 'voting'].includes(game.status)) return fail('本人登録の受付は終了しました。', 409);
    let participantId: number;
    if (typeof data.token === 'string' && /^[a-f0-9]{32}$/.test(data.token)) {
      const participant = await env.DB.prepare('SELECT id FROM participants WHERE game_id=? AND access_token=?').bind(game.id, data.token).first<{ id: number }>();
      if (!participant) return fail('参加用QRコードが無効です。', 404);
      participantId = participant.id;
    } else {
      participantId = requireInt(data.participantId, '参加者', 1, 2_147_483_647);
      const sharedToken = typeof data.sharedToken === 'string' ? data.sharedToken : '';
      if (!game.shared_access_token || !safeEqual(sharedToken, game.shared_access_token)) return fail('共用端末の認証情報が無効です。', 403);
    }
    const values = registrationValues(data, game);
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO participant_registrations(participant_id,display_name,organization)
      SELECT p.id,?,? FROM participants p JOIN games g ON g.id=p.game_id
      JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=g.current_round_number
      WHERE p.id=? AND p.game_id=? AND g.registration_mode='self-registration' AND g.ended_at IS NULL AND gr.status IN ('setup','voting')`)
      .bind(values.displayName, values.organization, participantId, game.id).run();
    if ((result.meta.changes ?? 0) !== 1) return fail('このカードはすでに登録済みです。登録内容を直す場合は司会者へお知らせください。', 409);
    await touchEvent(env.DB, game.id);
    return json({ ok: true, participant: { id: participantId, display_name: values.displayName, organization: values.organization } }, 201);
  }
  if (path === '/api/present' && request.method === 'GET') return json(await presentationPayload(env));

  if (path === '/api/vote' && request.method === 'POST') {
    const data = await body(request);
    const game = await activeGame(env.DB);
    if (!game || game.status !== 'voting') return fail('現在、投票を受け付けていません。', 409);
    return castVote(env, game, data);
  }

  if (path === '/api/admin/auth-status' && request.method === 'GET') {
    const configured = Boolean(await env.DB.prepare('SELECT 1 AS configured FROM admin_auth WHERE id=1').first());
    return json({ configured, authenticated: configured && await isAdmin(request, env) });
  }
  if (path === '/api/admin/setup-pin' && request.method === 'POST') {
    if (await env.DB.prepare('SELECT 1 AS configured FROM admin_auth WHERE id=1').first()) return fail('管理PINはすでに設定されています。', 409);
    const data = await body(request);
    const setupSecret = typeof data.setupSecret === 'string' ? data.setupSecret : '';
    if (!isUsableSetupSecret(env.ADMIN_SETUP_SECRET) || !safeEqual(setupSecret, env.ADMIN_SETUP_SECRET)) {
      return fail('初回設定の認証情報が無効です。', 403);
    }
    const pin = typeof data.pin === 'string' ? data.pin : '';
    if (!/^\d{4,8}$/.test(pin)) return fail('PINは4〜8桁の数字にしてください。');
    const salt = randomHex();
    const pinHash = await hashPin(pin, salt);
    const result = await env.DB.prepare(`INSERT INTO admin_auth(id,pin_salt,pin_hash,pin_iterations,session_version) SELECT 1,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM admin_auth WHERE id=1)`).bind(salt, pinHash, PIN_ITERATIONS, randomHex()).run();
    if ((result.meta.changes ?? 0) !== 1) return fail('管理PINはすでに設定されています。', 409);
    const token = await makeSession(env);
    return json({ ok: true }, 201, { 'set-cookie': `ol_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` });
  }
  if (path === '/api/admin/login' && request.method === 'POST') {
    const data = await body(request);
    const pin = typeof data.pin === 'string' ? data.pin : '';
    if (!/^\d{4,8}$/.test(pin)) return fail('PINが違います。', 401);
    const auth = await env.DB.prepare('SELECT pin_salt,pin_hash,pin_iterations,failed_attempts,locked_until FROM admin_auth WHERE id=1').first<AdminAuth>();
    if (!auth) return fail('最初に管理PINを設定してください。', 428);
    const now = Math.floor(Date.now() / 1000);
    if (auth.locked_until > now) return fail(`ログインを一時停止しています。${Math.ceil((auth.locked_until - now) / 60)}分後にお試しください。`, 429);
    const matches = safeEqual(await hashPin(pin, auth.pin_salt, auth.pin_iterations), auth.pin_hash);
    if (!matches) {
      const failure = await env.DB.prepare(`UPDATE admin_auth SET
        failed_attempts=CASE WHEN locked_until>0 AND locked_until<=? THEN 1 ELSE failed_attempts+1 END,
        locked_until=CASE WHEN (CASE WHEN locked_until>0 AND locked_until<=? THEN 1 ELSE failed_attempts+1 END)>=5 THEN ? ELSE 0 END,
        updated_at=CURRENT_TIMESTAMP WHERE id=1
        RETURNING failed_attempts,locked_until`).bind(now, now, now + 300).first<{ failed_attempts: number; locked_until: number }>();
      const locked = Boolean(failure && failure.locked_until > now);
      return fail(locked ? 'PINを5回間違えたため、5分間ログインできません。' : 'PINが違います。', locked ? 429 : 401);
    }
    if (auth.pin_iterations < PIN_ITERATIONS) {
      const upgradedSalt = randomHex();
      const upgradedHash = await hashPin(pin, upgradedSalt);
      await env.DB.prepare(`UPDATE admin_auth SET pin_salt=?,pin_hash=?,pin_iterations=?,failed_attempts=0,locked_until=0,updated_at=CURRENT_TIMESTAMP
        WHERE id=1 AND pin_hash=? AND pin_iterations=?`)
        .bind(upgradedSalt, upgradedHash, PIN_ITERATIONS, auth.pin_hash, auth.pin_iterations).run();
    } else {
      await env.DB.prepare("UPDATE admin_auth SET failed_attempts=0,locked_until=0,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
    }
    const token = await makeSession(env);
    return json({ ok: true }, 200, { 'set-cookie': `ol_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` });
  }
  if (path.startsWith('/api/admin/') && !(await isAdmin(request, env))) return fail('管理者ログインが必要です。', 401);
  if (path === '/api/admin/state' && request.method === 'GET') return json(await adminState(env));
  if (path === '/api/admin/participant-links' && request.method === 'GET') {
    const game = await activeGame(env.DB);
    if (!game) return fail('ゲームがありません。', 404);
    const rows = await env.DB.prepare('SELECT id,display_name,card_number,access_token FROM participants WHERE game_id=? ORDER BY COALESCE(card_number,id)').bind(game.id).all();
    const origin = url.origin;
    return json({ game: { ...gamePayload(game), sharedToken: game.shared_access_token }, participants: rows.results.map((row) => ({ id: row.id, name: row.display_name, cardNumber: row.card_number, url: `${origin}/?p=${row.access_token}` })) });
  }

  if (path === '/api/admin/game' && request.method === 'POST') {
    const data = await body(request);
    const title = typeof data.title === 'string' ? data.title.trim().slice(0, 100) : '';
    const min = requireInt(data.min, '最小値', 1, 999);
    const max = requireInt(data.max, '最大値', min, 999);
    if (data.registrationMode !== undefined && data.registrationMode !== 'roster' && data.registrationMode !== 'self-registration') return fail('登録方式が不正です。');
    const registrationMode = data.registrationMode === 'self-registration' ? 'self-registration' : 'roster';
    const names = Array.isArray(data.names) ? [...new Set(data.names.map(String).map((v) => v.trim()).filter(Boolean))].slice(0, 100) : [];
    const participantCount = registrationMode === 'self-registration' ? requireInt(data.participantCount, '参加人数', 2, 100) : names.length;
    const organizationEnabled = registrationMode === 'self-registration' && data.organizationEnabled === true;
    const organizationLabel = typeof data.organizationLabel === 'string' && data.organizationLabel.trim() ? data.organizationLabel.trim().slice(0, 30) : '所属';
    const organizationRequired = organizationEnabled && data.organizationRequired === true;
    const showOrganizationInResults = organizationEnabled && data.showOrganizationInResults === true;
    const organizationInputMode = data.organizationInputMode === 'select' ? 'select' : 'free';
    const organizationOptions = organizationEnabled && organizationInputMode === 'select' && Array.isArray(data.organizationOptions)
      ? [...new Set(data.organizationOptions.map(String).map((value) => value.trim().slice(0, 80)).filter(Boolean))].slice(0, 50)
      : [];
    const organizationDefault = organizationEnabled && typeof data.organizationDefault === 'string'
      ? data.organizationDefault.trim().slice(0, 80)
      : '';
    const organizationAllowOther = organizationEnabled && organizationInputMode === 'select' && data.organizationAllowOther === true;
    if (organizationEnabled && organizationInputMode === 'select' && organizationOptions.length < 1) return fail('所属の選択肢を1件以上入力してください。');
    if (organizationDefault && (organizationInputMode !== 'select' || !organizationOptions.includes(organizationDefault))) return fail('所属の初期選択が選択肢に含まれていません。');
    if (!title || participantCount < 2) return fail(registrationMode === 'roster' ? 'ゲーム名と2名以上の参加者が必要です。' : 'ゲーム名と2名以上の参加人数が必要です。');
    const existing = await activeGame(env.DB);
    if (existing) return fail('現在のイベントを終了・削除してから、新しいイベントを作成してください。', 409);
    const insert = await env.DB.prepare(`INSERT INTO games(title,min_number,max_number,status,registration_mode,organization_enabled,
      organization_label,organization_required,show_organization_in_results,organization_input_mode,organization_options_json,
      organization_default,organization_allow_other,shared_access_token)
      VALUES(?,?,?,'setup',?,?,?,?,?,?,?,?,?,?)`)
      .bind(title, min, max, registrationMode, Number(organizationEnabled), organizationLabel, Number(organizationRequired),
        Number(showOrganizationInResults), organizationInputMode, JSON.stringify(organizationOptions), organizationDefault || null,
        Number(organizationAllowOther), randomHex()).run();
    const gameId = Number(insert.meta.last_row_id);
    const participantNames = registrationMode === 'roster'
      ? names
      : Array.from({ length: participantCount }, (_, index) => `参加者${String(index + 1).padStart(2, '0')}`);
    await env.DB.batch(participantNames.map((name, index) => env.DB.prepare('INSERT INTO participants(game_id,display_name,access_token,card_number) VALUES(?,?,?,?)').bind(gameId, name, randomHex(), index + 1)));
    const roundInsert = await env.DB.prepare("INSERT INTO game_rounds(game_id,round_number,status) VALUES(?,1,'setup')").bind(gameId).run();
    const roundId = Number(roundInsert.meta.last_row_id);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO round_presentation_state(round_id,game_id,reveal_stage) VALUES(?,?,'idle')").bind(roundId, gameId),
      env.DB.prepare("INSERT INTO presentation_state(game_id,reveal_stage) VALUES(?,'idle')").bind(gameId),
      env.DB.prepare('UPDATE admin_auth SET game_id=? WHERE id=1').bind(gameId),
    ]);
    return json({ ok: true, gameId }, 201);
  }

  if (path === '/api/admin/expand-setup' && request.method === 'POST') {
    const data = await body(request);
    const expectedTotal = requireInt(data.expectedTotal, '現在の参加人数', 2, 100);
    const expectedMax = requireInt(data.expectedMax, '現在の数字上限', 1, 999);
    const addParticipants = requireInt(data.addParticipants, '追加人数', 1, 98);
    const addNumbers = requireInt(data.addNumbers, '追加する数字', 1, 998);
    const targetTotal = expectedTotal + addParticipants;
    const targetMax = expectedMax + addNumbers;
    if (targetTotal > 100) return fail('参加人数は100名までです。');
    if (targetMax > 999) return fail('数字の上限は999までです。');
    const game = await activeGame(env.DB);
    if (!game || game.ended_at || game.status !== 'setup' || game.registration_mode !== 'self-registration') {
      return fail('本人登録モードの準備中だけ人数と数字を増やせます。', 409);
    }
    const total = Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM participants WHERE game_id=?').bind(game.id).first<{ count: number }>())?.count ?? 0);
    if (total === targetTotal && game.max_number === targetMax) {
      return json({ ok: true, reused: true, participantCount: targetTotal, max: targetMax, firstCardNumber: expectedTotal + 1 });
    }
    if (total !== expectedTotal || game.max_number !== expectedMax) return fail('人数または数字の上限が更新されています。画面を更新してください。', 409);
    const inserts = Array.from({ length: addParticipants }, (_, index) => {
      const cardNumber = expectedTotal + index + 1;
      return env.DB.prepare(`INSERT INTO participants(game_id,display_name,access_token,card_number)
        SELECT g.id,?,?,? FROM games g JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=g.current_round_number
        WHERE g.id=? AND g.max_number=? AND g.ended_at IS NULL AND gr.status='setup'`)
        .bind(`参加者${String(cardNumber).padStart(2, '0')}`, randomHex(), cardNumber, game.id, expectedMax);
    });
    const at = nowSeconds();
    const results = await env.DB.batch([
      ...inserts,
      env.DB.prepare(`UPDATE games SET max_number=?,last_activity_at=?
        WHERE id=? AND max_number=? AND ended_at IS NULL
          AND EXISTS(SELECT 1 FROM game_rounds WHERE id=? AND status='setup')
          AND (SELECT COUNT(*) FROM participants WHERE game_id=?)=?`)
        .bind(targetMax, at, game.id, expectedMax, game.round_id, game.id, targetTotal),
    ]);
    const update = results.at(-1);
    if ((update?.meta.changes ?? 0) !== 1) {
      const current = await activeGame(env.DB);
      const currentTotal = current ? Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM participants WHERE game_id=?').bind(current.id).first<{ count: number }>())?.count ?? 0) : 0;
      if (current?.id === game.id && current.status === 'setup' && currentTotal === targetTotal && current.max_number === targetMax) {
        return json({ ok: true, reused: true, participantCount: targetTotal, max: targetMax, firstCardNumber: expectedTotal + 1 });
      }
      return fail('人数と数字を追加できませんでした。画面を更新してください。', 409);
    }
    return json({ ok: true, participantCount: targetTotal, max: targetMax, firstCardNumber: expectedTotal + 1 }, 201);
  }

  if (path === '/api/admin/reset-game' && request.method === 'POST') {
    const game = await activeGame(env.DB);
    if (!game || game.status !== 'setup' || game.current_round_number !== 1 || game.ended_at) return fail('第1回の投票開始前だけ作り直せます。', 409);
    await env.DB.prepare(`DELETE FROM games WHERE id=? AND current_round_number=1 AND ended_at IS NULL
      AND EXISTS(SELECT 1 FROM game_rounds WHERE id=? AND status='setup')`).bind(game.id, game.round_id).run();
    const remains = await env.DB.prepare('SELECT 1 AS found FROM games WHERE id=?').bind(game.id).first();
    if (remains) return fail('ゲーム設定を削除できませんでした。画面を更新してください。', 409);
    return json({ ok: true });
  }

  if (path === '/api/admin/start' && request.method === 'POST') {
    const game = await activeGame(env.DB);
    if (!game || game.status !== 'setup' || game.ended_at) return fail('準備中のラウンドがありません。', 409);
    const result = await env.DB.prepare(`UPDATE game_rounds SET status='voting',started_at=COALESCE(started_at,?)
      WHERE id=? AND status='setup' AND EXISTS(SELECT 1 FROM games WHERE id=? AND ended_at IS NULL)`)
      .bind(nowSeconds(), game.round_id, game.id).run();
    if ((result.meta.changes ?? 0) < 1) return fail('別の操作で投票受付が開始されました。', 409);
    await touchEvent(env.DB, game.id);
    return json({ ok: true });
  }

  if (path === '/api/admin/next-round' && request.method === 'POST') {
    const data = await body(request);
    const expected = requireInt(data.expectedRoundNumber, '現在の回', 1, 1_000_000);
    let game = await activeGame(env.DB);
    if (!game || game.ended_at) return fail('終了したイベントでは次のラウンドを作成できません。', 409);
    if (game.current_round_number === expected + 1 && game.status === 'setup') return json({ ok: true, roundNumber: game.current_round_number, reused: true });
    if (game.current_round_number !== expected || game.status !== 'finished') return fail('表示中の回が古いため、画面を更新してください。', 409);
    const eventId = game.id;
    const nextNumber = expected + 1;
    await env.DB.prepare(`INSERT OR IGNORE INTO game_rounds(game_id,round_number,status)
      SELECT g.id,?,'setup' FROM games g JOIN game_rounds current ON current.game_id=g.id AND current.round_number=g.current_round_number
      WHERE g.id=? AND g.current_round_number=? AND g.ended_at IS NULL AND current.status='finished'`)
      .bind(nextNumber, game.id, expected).run();
    const nextRound = await env.DB.prepare('SELECT id FROM game_rounds WHERE game_id=? AND round_number=?').bind(game.id, nextNumber).first<{ id: number }>();
    if (!nextRound) return fail('次のラウンドを準備できませんでした。', 409);
    const at = nowSeconds();
    const switched = await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO round_presentation_state(round_id,game_id,reveal_stage) VALUES(?,?,'idle')").bind(nextRound.id, game.id),
      env.DB.prepare(`UPDATE games SET current_round_number=?,status='setup',last_activity_at=?
        WHERE id=? AND current_round_number=? AND ended_at IS NULL
          AND EXISTS(SELECT 1 FROM game_rounds WHERE id=? AND status='setup')`)
        .bind(nextNumber, at, game.id, expected, nextRound.id),
      env.DB.prepare('UPDATE participants SET has_voted=0 WHERE game_id=?').bind(game.id),
    ]);
    if ((switched[1].meta.changes ?? 0) < 1) {
      game = await activeGame(env.DB);
      if (game?.id === eventId && game.current_round_number === nextNumber && game.status === 'setup') return json({ ok: true, roundNumber: nextNumber, reused: true });
      return fail('別の操作でラウンドが変更されました。画面を更新してください。', 409);
    }
    return json({ ok: true, roundNumber: nextNumber }, 201);
  }

  if (path === '/api/admin/end-event' && request.method === 'POST') {
    const game = await activeGame(env.DB);
    if (!game || game.status !== 'finished') return fail('最終発表が完了してからイベントを終了してください。', 409);
    if (game.ended_at) return json({ ok: true, endedAt: game.ended_at, purgeAfter: game.purge_after, reused: true });
    const at = nowSeconds();
    const ended = await env.DB.prepare(`UPDATE games SET ended_at=?,purge_after=?,last_activity_at=?
      WHERE id=? AND ended_at IS NULL AND EXISTS(SELECT 1 FROM game_rounds WHERE id=? AND status='finished')`)
      .bind(at, at + 24 * 60 * 60, at, game.id, game.round_id).run();
    if ((ended.meta.changes ?? 0) !== 1) return fail('別の操作でイベント状態が変わりました。', 409);
    return json({ ok: true, endedAt: at, purgeAfter: at + 24 * 60 * 60 });
  }

  if (path === '/api/admin/purge-now' && request.method === 'POST') {
    const data = await body(request);
    if (data.confirmation !== '完全削除') return fail('完全削除の確認が必要です。', 400);
    const game = await activeGame(env.DB);
    if (!game) return json({ ok: true, reused: true });
    await purgeEvent(env.DB, game.id);
    return json({ ok: true });
  }

  if (path === '/api/admin/proxy-vote' && request.method === 'POST') {
    const data = await body(request);
    const game = await activeGame(env.DB);
    if (!game || game.status !== 'voting') return fail('現在、投票を受け付けていません。', 409);
    return castVote(env, game, data, true);
  }

  if (path === '/api/admin/registration' && request.method === 'POST') {
    const data = await body(request);
    const game = await activeGame(env.DB);
    if (!game || game.ended_at || game.registration_mode !== 'self-registration' || !['setup', 'voting', 'closed'].includes(game.status)) return fail('現在は登録情報を変更できません。', 409);
    const participantId = requireInt(data.participantId, '参加者', 1, 2_147_483_647);
    const values = registrationValues(data, game);
    const result = await env.DB.prepare(`INSERT INTO participant_registrations(participant_id,display_name,organization)
      SELECT p.id,?,? FROM participants p JOIN games g ON g.id=p.game_id
      JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=g.current_round_number
      WHERE p.id=? AND p.game_id=? AND g.registration_mode='self-registration' AND g.ended_at IS NULL AND gr.status IN ('setup','voting','closed')
      ON CONFLICT(participant_id) DO UPDATE SET display_name=excluded.display_name,organization=excluded.organization,updated_at=CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM participants p2 JOIN games g2 ON g2.id=p2.game_id
        JOIN game_rounds gr2 ON gr2.game_id=g2.id AND gr2.round_number=g2.current_round_number
        WHERE p2.id=excluded.participant_id AND g2.registration_mode='self-registration' AND g2.ended_at IS NULL AND gr2.status IN ('setup','voting','closed'))`)
      .bind(values.displayName, values.organization, participantId, game.id).run();
    if ((result.meta.changes ?? 0) !== 1) return fail('参加者が見つかりません。', 404);
    await env.DB.batch([
      env.DB.prepare('UPDATE round_votes SET display_name_snapshot=?,organization_snapshot=? WHERE round_id=? AND participant_id=?')
        .bind(values.displayName, values.organization, game.round_id, participantId),
      env.DB.prepare('UPDATE games SET last_activity_at=? WHERE id=? AND ended_at IS NULL').bind(nowSeconds(), game.id),
    ]);
    return json({ ok: true });
  }

  if (path === '/api/admin/unregister' && request.method === 'POST') {
    const data = await body(request);
    const game = await activeGame(env.DB);
    if (!game || game.ended_at || game.registration_mode !== 'self-registration' || !['setup', 'voting', 'closed'].includes(game.status)) return fail('現在は登録を解除できません。', 409);
    const participantId = requireInt(data.participantId, '参加者', 1, 2_147_483_647);
    const result = await env.DB.prepare(`DELETE FROM participant_registrations WHERE participant_id=?
      AND EXISTS(SELECT 1 FROM participants WHERE id=? AND game_id=?)
      AND EXISTS(SELECT 1 FROM games g JOIN game_rounds gr ON gr.game_id=g.id AND gr.round_number=g.current_round_number
        WHERE g.id=? AND g.registration_mode='self-registration' AND g.ended_at IS NULL AND gr.status IN ('setup','voting','closed'))
      AND NOT EXISTS(SELECT 1 FROM round_votes WHERE round_id=? AND participant_id=?)`)
      .bind(participantId, participantId, game.id, game.id, game.round_id, participantId).run();
    if ((result.meta.changes ?? 0) !== 1) return fail('投票済みか、登録されていないため解除できません。先に票を解除してください。', 409);
    await touchEvent(env.DB, game.id);
    return json({ ok: true });
  }

  if (path === '/api/admin/unlock' && request.method === 'POST') {
    const data = await body(request);
    const game = await activeGame(env.DB);
    if (!game || game.ended_at || !['voting', 'closed'].includes(game.status)) return fail('発表開始後は解除できません。', 409);
    const participantId = requireInt(data.participantId, '参加者', 1, 2_147_483_647);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM round_votes WHERE round_id=? AND participant_id=?').bind(game.round_id, participantId),
      env.DB.prepare('UPDATE games SET last_activity_at=? WHERE id=? AND ended_at IS NULL').bind(nowSeconds(), game.id),
    ]);
    return json({ ok: true });
  }

  if (path === '/api/admin/close' && request.method === 'POST') {
    const game = await activeGame(env.DB);
    if (!game || game.ended_at || game.status !== 'voting') return fail('投票受付中ではありません。', 409);
    const changed = await env.DB.prepare("UPDATE game_rounds SET status='closed' WHERE id=? AND status='voting'").bind(game.round_id).run();
    if ((changed.meta.changes ?? 0) < 1) return fail('別の操作で投票状態が変わりました。', 409);
    await touchEvent(env.DB, game.id);
    return json({ ok: true });
  }
  if (path === '/api/admin/reopen' && request.method === 'POST') {
    const game = await activeGame(env.DB);
    if (!game || game.ended_at || game.status !== 'closed') return fail('締切済みではありません。', 409);
    const changed = await env.DB.prepare("UPDATE game_rounds SET status='voting' WHERE id=? AND status='closed'").bind(game.round_id).run();
    if ((changed.meta.changes ?? 0) < 1) return fail('別の操作で投票状態が変わりました。', 409);
    await touchEvent(env.DB, game.id);
    return json({ ok: true });
  }

  if (path === '/api/admin/advance' && request.method === 'POST') {
    const game = await activeGame(env.DB);
    if (!game || game.ended_at || !['closed', 'presenting'].includes(game.status)) return fail('発表を進められません。', 409);
    const state = await env.DB.prepare('SELECT * FROM round_presentation_state WHERE round_id=?').bind(game.round_id).first<State>();
    if (!state) return fail('発表状態がありません。', 500);
    let count = 0;
    let person: { id: number; name: string } | null = null;
    let finalPair: Awaited<ReturnType<typeof finalPairPeople>> | undefined;
    if (state.current_number !== null) {
      count = (await env.DB.prepare('SELECT COUNT(*) AS count FROM round_votes WHERE round_id=? AND number=?').bind(game.round_id, state.current_number).first<{ count: number }>())?.count ?? 0;
      if (count === 1) person = await env.DB.prepare(`SELECT participant_id AS id,display_name_snapshot AS name
        FROM round_votes WHERE round_id=? AND number=? LIMIT 1`).bind(game.round_id, state.current_number).first<{ id: number; name: string }>();
    }
    if (['pair', 'pair_count', 'pair_person'].includes(state.reveal_stage)) finalPair = await finalPairPeople(env.DB, game.round_id);
    const next = advancePresentation({ status: game.status as 'closed' | 'presenting', min: game.min_number, max: game.max_number, current: state.current_number, stage: state.reveal_stage, count, participantId: person?.id ?? null, participantName: person?.name ?? null, finalPair, championId: state.current_champion_participant_id, championNumber: state.current_champion_number, history: JSON.parse(state.history_json || '[]') });
    const winner = next.gameStatus === 'finished' && next.championId
      ? await env.DB.prepare('SELECT display_name_snapshot AS name,organization_snapshot AS organization FROM round_votes WHERE round_id=? AND participant_id=?')
        .bind(game.round_id, next.championId).first<{ name: string; organization: string | null }>()
      : null;
    const at = nowSeconds();
    const updated = await env.DB.batch([
      env.DB.prepare(`UPDATE round_presentation_state SET current_number=?,reveal_stage=?,current_champion_participant_id=?,current_champion_number=?,history_json=?,revision=revision+1 WHERE round_id=? AND revision=?`)
        .bind(next.current, next.stage, next.championId, next.championNumber, JSON.stringify(next.history), game.round_id, state.revision),
      env.DB.prepare(`UPDATE game_rounds SET status=?,finished_at=CASE WHEN ?='finished' THEN ? ELSE finished_at END,
        champion_participant_id=CASE WHEN ?='finished' THEN ? ELSE champion_participant_id END,
        champion_number=CASE WHEN ?='finished' THEN ? ELSE champion_number END,
        champion_name=CASE WHEN ?='finished' THEN ? ELSE champion_name END,
        champion_organization=CASE WHEN ?='finished' THEN ? ELSE champion_organization END
        WHERE id=? AND status IN ('closed','presenting')
          AND EXISTS(SELECT 1 FROM round_presentation_state WHERE round_id=? AND revision=?)`)
        .bind(next.gameStatus, next.gameStatus, at, next.gameStatus, next.championId, next.gameStatus, next.championNumber,
          next.gameStatus, winner?.name ?? null, next.gameStatus, game.show_organization_in_results ? winner?.organization ?? null : null,
          game.round_id, game.round_id, state.revision + 1),
      env.DB.prepare('UPDATE games SET last_activity_at=? WHERE id=? AND ended_at IS NULL').bind(at, game.id),
    ]);
    if ((updated[0].meta.changes ?? 0) !== 1 || (updated[1].meta.changes ?? 0) < 1) return fail('別の操作で発表が進みました。画面を更新してください。', 409);
    return json({ ok: true, presentation: await presentationPayload(env, true) });
  }

  return fail('Not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (new URL(request.url).pathname.startsWith('/api/')) {
        await purgeExpiredEvents(env);
        return await route(request, env);
      }
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('referrer-policy', 'no-referrer');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('x-frame-options', 'DENY');
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    } catch (error) {
      if (error instanceof InputError) return fail(error.message, 400);
      console.error('Unhandled request error');
      return fail('サーバーエラーが発生しました。', 500);
    }
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await purgeExpiredEvents(env, Math.floor(controller.scheduledTime / 1000));
  },
};
