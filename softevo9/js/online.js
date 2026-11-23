/* =====================================================================
   SoftEvo 9 — online.js
   オンラインのかけっこ (Firebase Realtime Database の REST API)
   ---------------------------------------------------------------------
   物理が決定論的なので、公開された生物 (体 + 脳) はだれの端末でも同じように走る。
   ・かけっこの記録は見る人の端末で計算し直すので、ごまかしようがない
   データ (softevo-leaderboard プロジェクトの softevo9/v1 の下):
     creatures/{id} … 公開された生物
     stats/{id}     … 拍手 (サーバー側で加算)
   ===================================================================== */
import { brainLayout, genomeLength, validateBlueprint, OBJECTIVES } from './sim.js';
import { b64ToF32, f32ToB64, uid } from './store.js';

const DEFAULT_DB = 'https://softevo-leaderboard-default-rtdb.asia-southeast1.firebasedatabase.app';
const ROOT = 'softevo9/v1';
const PROFILE_KEY = 'softevo9/profile';
export const MODES = ['race'];

export class OnlineError extends Error {
  constructor(kind, msg) { super(msg || kind); this.kind = kind; }
}

/** Firebase のルールに追加してもらう設定 (権限エラーの時に案内する) */
export const RULES_HINT = `"softevo9": { ".read": true, ".write": true }`;

function base() {
  try { return (localStorage.getItem('softevo9/dbURL') || DEFAULT_DB).replace(/\/$/, ''); } catch { return DEFAULT_DB; }
}

async function req(path, { method = 'GET', body, query } = {}) {
  const url = `${base()}/${ROOT}/${path}.json${query ? `?${query}` : ''}`;
  let res;
  try {
    // Content-Type を付けない (= プリフライトなし)。Firebase は本文を JSON として受け取る
    res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch (e) {
    throw new OnlineError('network', 'ネットワークにつながりません');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403 || /permission/i.test(t)) throw new OnlineError('permission', 'データベースへのアクセスが許可されていません');
    throw new OnlineError('http', `サーバーエラー (${res.status})`);
  }
  return res.json();
}
const latest = n => `orderBy=${encodeURIComponent('"$key"')}&limitToLast=${n}`;
const inc = n => ({ '.sv': { increment: n } });

// ─── プロフィール (ニックネーム + 端末ごとのID) ───
export function profile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { /* ignore */ }
  if (!p || !p.id) { p = { id: uid() + uid(), name: '' }; saveProfile(p); }
  return p;
}
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
export function setName(name) { const p = profile(); p.name = cleanText(name, 16) || p.name; saveProfile(p); return p; }

// ─── 受け取ったデータの検証 (だれでも書き込めるので、信用しない) ───
const cleanText = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function checkBlueprint(bp) {
  if (!bp || !Array.isArray(bp.nodes) || !Array.isArray(bp.edges)) return null;
  if (bp.nodes.length < 2 || bp.nodes.length > 60 || bp.edges.length > 240) return null;
  const nodes = [];
  for (const p of bp.nodes) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1500 || Math.abs(p.y) > 1500) return null;
    nodes.push({ x: p.x, y: p.y });
  }
  const edges = [];
  for (const e of bp.edges) {
    if (!e || !isInt(e.a, 0, nodes.length - 1) || !isInt(e.b, 0, nodes.length - 1) || e.a === e.b || (e.type !== 'bone' && e.type !== 'muscle')) return null;
    edges.push({ a: e.a, b: e.b, type: e.type });
  }
  const clean = { nodes, edges };
  return validateBlueprint(clean) ? null : clean;
}

/** 生物 (体・脳) を検証して、ゲームで使える形に */
export function checkFighter(x) {
  if (!x || typeof x !== 'object') return null;
  const bp = checkBlueprint(x.bp);
  if (!bp || !isInt(x.hidden, 1, 32) || !(x.hidden2 == null || isInt(x.hidden2, 0, 32))) return null;
  const obj = typeof x.obj === 'string' && OBJECTIVES[x.obj] ? x.obj : null;
  if (!obj || typeof x.g !== 'string' || x.g.length > 60000) return null;
  let g;
  try { g = b64ToF32(x.g); } catch { return null; }
  const want = genomeLength(brainLayout(bp, { hidden: x.hidden, hidden2: x.hidden2 || 0 }).sizes);
  if (g.length !== want || !g.every(Number.isFinite)) return null;
  return {
    name: cleanText(x.name, 24) || '名無し', owner: cleanText(x.owner, 16) || '名無し', ownerId: cleanText(x.ownerId, 40),
    bp, hidden: x.hidden, hidden2: x.hidden2 || 0, obj, g, gen: Number.isInteger(x.gen) ? x.gen : null,
  };
}

function checkCreature(id, x) {
  const f = checkFighter(x);
  if (!f || !MODES.includes(x.mode)) return null;
  return { ...f, id, mode: x.mode, msg: cleanText(x.msg, 80), created: Number(x.created) || 0 };
}

const pack = f => ({ name: f.baseName || f.name, bp: f.bp, hidden: f.hidden, hidden2: f.hidden2 || 0, obj: f.obj, g: f32ToB64(f.g), gen: f.gen ?? null });

// ─── API ───
/** 公開された生物と拍手をまとめて取得 */
export async function fetchAll() {
  const [cs, st] = await Promise.all([req('creatures', { query: latest(150) }), req('stats')]);
  const creatures = [];
  for (const [id, x] of Object.entries(cs || {})) { const c = checkCreature(id, x); if (c) creatures.push(c); }
  const stats = {};
  for (const [id, s] of Object.entries(st || {})) {
    if (!s || typeof s !== 'object') continue;
    stats[id] = { cheers: Number.isFinite(s.cheers) && s.cheers >= 0 ? Math.floor(s.cheers) : 0 };
  }
  return { creatures, stats };
}

/** 生物を公開する。f: { name, bp, hidden, hidden2, obj, g(Float32Array), gen } */
export async function publish(f, mode, msg) {
  const p = profile();
  const body = { v: 1, ...pack(f), mode, msg: cleanText(msg, 80), owner: p.name || '名無し', ownerId: p.id, created: Date.now() };
  const r = await req('creatures', { method: 'POST', body });
  return r && r.name;
}

export async function withdraw(id) {
  await req(`creatures/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await req(`stats/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}

export async function cheer(id) {
  await req(`stats/${encodeURIComponent(id)}`, { method: 'PATCH', body: { cheers: inc(1) } });
}
