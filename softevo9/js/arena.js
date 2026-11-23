/* =====================================================================
   SoftEvo 9 — arena.js
   かけっこ: 育てた生物を同じ条件で横一列に並べて走らせる (最大6体)
   ・「共通の地形」か「それぞれの故郷 (進化した環境)」で
   ・出場者は「マイ生物」の好きな世代 (過去の自分とも競える)・道場の師範・オンラインの生物
   ・物理は決定論的: 同じ組み合わせは何度見ても同じ結果。変えたければ鍛える
   ===================================================================== */
import { PRESETS, DEFAULT_SETTINGS, TERRAINS, prepareFighter } from './sim.js';
import { Theater } from './theater.js';
import { drawThumb } from './world.js';
import { DOJO } from './dojo.js';
import * as store from './store.js';
import { onlineFighter } from './lobby.js';
import { $, $$, el, toast } from './ui.js';

const RACE_MAX = 6;
const RACE_HUES = [195, 330, 45, 140, 270, 20];
const MEDALS = ['🥇', '🥈', '🥉'];

export class Arena {
  constructor(hooks) {
    this.hooks = hooks;
    this.racers = [];
    this.raceEnv = 'common';
    this.terrain = 'flat';
    this.state = 'idle';
    this.online = [];   // オンラインの生物 (読み込み済みなら)
    this.theater = new Theater($('#arena-canvas'), { onFinish: () => this.onFinish() });
    this.bind();
  }

  bind() {
    $$('#arena-speed button').forEach(b => b.addEventListener('click', () => {
      this.theater.speed = +b.dataset.speed;
      $$('#arena-speed button').forEach(x => x.classList.toggle('active', x === b));
    }));
    $('#arena-ghosts').addEventListener('click', e => { this.theater.showGhosts = !this.theater.showGhosts; e.currentTarget.classList.toggle('active', this.theater.showGhosts); });
    $('#arena-start').addEventListener('click', () => (this.state === 'playing' ? this.stop() : this.start()));
    $('#arena-home').addEventListener('click', () => { this.stop(); this.hooks.onHome(); });
  }

  // ─── 出場者の候補 ───
  candidates() {
    const list = [];
    for (const meta of store.listRuns()) {
      const d = store.loadRun(meta.id);
      if (!d || !d.blueprint) continue;
      const snaps = [], seen = new Set();
      const add = (gen, g, tag) => { if (g && !seen.has(gen)) { seen.add(gen); snaps.push({ gen, g, tag }); } };
      const gs = (d.genomes || []).slice().sort((a, b) => b.gen - a.gen);
      if (d.best) add(d.best.gen, d.best.g, '🏆最高記録');
      if (gs.length) add(gs[0].gen, gs[0].g, '最新');
      for (const x of gs) add(x.gen, x.g, '');
      if (!snaps.length) continue;
      snaps.sort((a, b) => b.gen - a.gen);
      list.push({ kind: 'run', id: d.id, name: d.name, bp: d.blueprint, settings: { ...DEFAULT_SETTINGS, ...d.settings }, obj: d.settings.objective, snaps,
        note: `${TERRAINS[d.settings.terrain]?.icon || ''} ${TERRAINS[d.settings.terrain]?.name || ''}で進化` });
    }
    for (const x of DOJO) {
      list.push({ kind: 'dojo', id: `dojo:${x.id}`, name: x.name, icon: x.icon, bp: PRESETS[x.key].bp, settings: { ...DEFAULT_SETTINGS }, obj: x.obj, note: x.note, snaps: [{ gen: null, g: x.g, tag: '' }] });
    }
    return list;
  }

  fighter(c, si = 0) {
    const s = c.snaps[Math.min(si, c.snaps.length - 1)];
    return {
      cid: c.id, si, src: c.kind, baseName: c.name, gen: s.gen,
      name: s.gen != null ? `${c.name}·${s.gen}代` : c.name,
      bp: c.bp, hidden: c.settings.hidden, hidden2: c.settings.hidden2 || 0, obj: c.obj, g: store.b64ToF32(s.g),
      settings: c.settings, hue: 0,
    };
  }

  /** 画面に入る: 候補を読み直して、空いている枠を埋める */
  enter() {
    this.cands = this.candidates();
    const byId = new Map(this.cands.map(c => [c.id, c]));
    const refresh = f => (!f ? null : f.src === 'online' ? f : byId.has(f.cid) ? this.fighter(byId.get(f.cid), f.si) : null);
    this.racers = this.racers.map(refresh).filter(Boolean);
    this.fillDefaults();
    this.refresh();
  }

  /** 外から出場者を加えて入る (オンラインの「一緒に走る」) */
  setup({ racer }) {
    this.stop(false);
    if (racer && !this.racers.some(r => r.cid === racer.cid)) {
      if (this.racers.length >= RACE_MAX) this.racers.pop();
      this.racers.push(racer);
    }
  }

  fillDefaults() {
    const mine = this.cands.filter(c => c.kind === 'run');
    const dojo = id => this.cands.find(c => c.id === `dojo:${id}`);
    if (this.racers.length < 2) {
      const pool = [...mine.slice(0, 3), ...['quad', 'biped', 'inchworm', 'wheel'].map(dojo)].filter(c => c && !this.racers.some(r => r.cid === c.id));
      this.racers.push(...pool.slice(0, 4 - this.racers.length).map(c => this.fighter(c)));
    }
  }

  refresh() {
    this.stop(false);
    this.fillDefaults();
    $('#arena-start').textContent = '▶ スタート';
    this.renderEntrants();
    this.renderOptions();
    $('#arena-result').innerHTML = '';
    this.preview();
  }

  // ─── 出場者パネル ───
  renderEntrants() {
    const box = $('#arena-entrants');
    box.innerHTML = '';
    this.racers.forEach((f, i) => box.append(this.entrantCard(f, `${i + 1}`, `hsl(${RACE_HUES[i]},80%,65%)`,
      g => { this.racers[i] = g; this.changed(); }, () => { this.racers.splice(i, 1); this.changed(); })));
    if (this.racers.length < RACE_MAX) {
      box.append(el('button', { class: 'btn ghost add-entrant', onclick: () => this.pick(f => { this.racers.push(f); this.changed(); }) }, '＋ 出場者を追加'));
    }
  }

  entrantCard(f, side, color, onChange, onRemove) {
    const c = this.cands.find(x => x.id === f.cid);
    const cv = el('canvas', { class: 'ent-thumb' });
    const info = el('div', { class: 'ent-info' }, el('b', {}, c ? c.name : f.name));
    if (c && c.snaps.length > 1) {
      const sel = el('select', { class: 'ent-gen', 'aria-label': '世代' });
      c.snaps.forEach((s, i) => sel.append(el('option', { value: i, selected: i === f.si }, `第${s.gen}世代 ${s.tag}`)));
      sel.addEventListener('change', () => onChange(this.fighter(c, +sel.value)));
      info.append(sel);
    }
    info.append(el('small', {}, c ? c.note : f.note || ''));
    const card = el('div', { class: 'entrant', style: `--c:${color}` },
      el('span', { class: 'ent-side' }, side), cv, info,
      el('div', { class: 'ent-actions' },
        el('button', { class: 'btn ghost small', onclick: () => this.pick(onChange) }, '変更'),
        onRemove ? el('button', { class: 'x', title: '外す', onclick: onRemove }, '✕') : null));
    requestAnimationFrame(() => drawThumb(cv, f.bp));
    return card;
  }

  /** 出場者を選ぶダイアログ */
  pick(onPick) {
    const back = el('div', { class: 'modal-back' });
    const close = () => back.remove();
    const box = el('div', { class: 'modal wide' }, el('h3', {}, '出場者を選ぶ'));
    const section = (title, items) => {
      if (!items.length) return;
      box.append(el('h4', { class: 'pick-h' }, title));
      const grid = el('div', { class: 'pick-grid' });
      for (const c of items) {
        const cv = el('canvas', { class: 'pick-thumb' });
        grid.append(el('button', { class: 'pick-item', onclick: () => { close(); onPick(this.fighter(c)); } },
          cv, el('b', {}, `${c.icon ? c.icon + ' ' : ''}${c.name}`), el('small', {}, c.snaps[0].gen != null ? `第${c.snaps[0].gen}世代まで · ${c.note}` : c.note)));
        requestAnimationFrame(() => drawThumb(cv, c.bp));
      }
      box.append(grid);
    };
    const mine = this.cands.filter(c => c.kind === 'run');
    section('マイ生物 (世代はあとで選べます)', mine);
    if (!mine.length) box.append(el('p', { class: 'dim' }, 'まだ育てた生物がいません。ホームから生物をつくって進化させると、ここに出場できます。'));
    section('道場', this.cands.filter(c => c.kind === 'dojo'));
    const online = this.online;
    if (online.length) {
      box.append(el('h4', { class: 'pick-h' }, '🌐 オンラインの生物'));
      const grid = el('div', { class: 'pick-grid' });
      for (const c of online) {
        const cv = el('canvas', { class: 'pick-thumb' });
        grid.append(el('button', { class: 'pick-item', onclick: () => { close(); onPick(onlineFighter(c)); } },
          cv, el('b', {}, c.name), el('small', {}, `${c.owner} さん${c.msg ? `「${c.msg}」` : ''}`)));
        requestAnimationFrame(() => drawThumb(cv, c.bp));
      }
      box.append(grid);
    }
    box.append(el('div', { class: 'modal-actions' }, el('button', { class: 'btn ghost', onclick: close }, 'とじる')));
    back.append(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    document.body.append(back);
  }

  renderOptions() {
    const box = $('#arena-options');
    box.innerHTML = '';
    const seg = el('div', { class: 'seg small' });
    for (const [k, label] of [['common', '共通の地形'], ['home', 'それぞれの故郷']]) {
      seg.append(el('button', { class: k === this.raceEnv ? 'active' : '', onclick: () => { this.raceEnv = k; this.renderOptions(); this.preview(); } }, label));
    }
    box.append(el('div', { class: 'choice-row' }, el('span', {}, '走る場所'), seg));
    if (this.raceEnv === 'common') {
      const ts = el('div', { class: 'seg small' });
      for (const [k, t] of Object.entries(TERRAINS)) ts.append(el('button', { class: k === this.terrain ? 'active' : '', onclick: () => { this.terrain = k; this.renderOptions(); this.preview(); } }, `${t.icon} ${t.name}`));
      box.append(el('div', { class: 'choice-row' }, el('span', {}, '地形'), ts));
    } else {
      box.append(el('p', { class: 'pane-note dim' }, '各自が進化した地形・重力・摩擦で走ります。育った環境の違いがそのまま出ます。'));
    }
  }

  changed() {
    this.stop(false);
    this.renderEntrants();
    $('#arena-result').innerHTML = '';
    this.preview();
  }

  raceLanes() {
    return this.racers.map((f, i) => {
      const P = prepareFighter(f);
      const s = f.settings;
      const home = this.raceEnv === 'home';
      const env = {
        terrain: home ? s.terrain : this.terrain, objective: 'distance',
        gravity: home ? s.gravity : 1, friction: home ? s.friction : DEFAULT_SETTINGS.friction, evalSeconds: DEFAULT_SETTINGS.evalSeconds,
      };
      const where = this.raceEnv === 'home' ? ` (${TERRAINS[env.terrain].icon}${env.gravity !== 1 ? ` ${env.gravity.toFixed(1)}G` : ''})` : '';
      return { bp: P.bp, layout: P.layout, genome: P.genome, env, label: `${f.name}${where}`, hue: RACE_HUES[i], fighter: f };
    });
  }

  /** 始まる前の立ち姿 */
  preview() {
    if (!this.racers.length) { this.theater.main = null; return; }
    const lanes = this.raceLanes();
    this.theater.setRun(lanes[0].bp, lanes[0].layout);
    this.theater.play({ kind: 'lanes', lanes, main: 0, top: 0, map: true });
  }

  start() {
    if (this.racers.length < 2) return toast('2体以上を並べてください');
    this.results = [];
    $('#arena-result').innerHTML = '';
    this.preview();
    this.state = 'playing';
    $('#arena-start').textContent = '■ 中断';
  }

  stop(render = true) {
    if (this.state !== 'playing') return;
    this.state = 'idle';
    $('#arena-start').textContent = '▶ スタート';
    if (render) this.preview();
  }

  onFinish() {
    if (this.state !== 'playing') return;
    this.finishRace();
  }

  finishRace() {
    this.state = 'done';
    const units = this.theater.units;
    const order = units.map((u, i) => ({ i, d: u.broken ? -Infinity : u.distance() })).sort((a, b) => b.d - a.d);
    order.forEach((o, r) => { units[o.i].lane.rank = MEDALS[r] || `${r + 1}位`; });
    const box = $('#arena-result');
    box.innerHTML = '';
    box.append(el('h4', {}, '🏁 結果'));
    const ol = el('ol', { class: 'race-result' });
    for (const o of order) {
      const lane = units[o.i].lane;
      ol.append(el('li', {}, el('span', {}, lane.rank), el('b', {}, lane.label), el('span', { class: 'gold' }, isFinite(o.d) ? `${(o.d / 100).toFixed(2)} m` : '転倒')));
    }
    box.append(ol, el('div', { class: 'result-actions' }, el('button', { class: 'btn ghost small', onclick: () => this.start() }, '↺ もう一度')));
    $('#arena-start').textContent = '▶ スタート';
  }

  frame(dt, t) {
    const th = this.theater;
    if (this.state === 'playing') th.update(dt);
    th.render();
  }
}
