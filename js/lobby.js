/* =====================================================================
   SoftEvo — lobby.js
   🌐 オンラインのかけっこ
   ・公開された生物を、見る人の端末で走らせ直した記録で並べる (ごまかせない)
   ・気に入った生物とは「一緒に走る」、拍手を送る
   ===================================================================== */
import { DEFAULT_SETTINGS, evaluate, prepareFighter } from './sim.js';
import { drawThumb } from './world.js';
import * as online from './online.js';
import { $, el, toast, confirmDialog, askText } from './ui.js';
import { tr, genLabel } from './i18n.js';

const RACE_ENV = { terrain: 'flat', objective: 'distance', gravity: 1, friction: DEFAULT_SETTINGS.friction, evalSeconds: DEFAULT_SETTINGS.evalSeconds };
const when = t => new Date(t).toLocaleString(tr('ja-JP', 'en-US'), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 公開された生物 → 闘技場の出場者 */
export function onlineFighter(c) {
  return {
    cid: `online:${c.id}`, si: 0, src: 'online', onlineId: c.id, owner: c.owner, ownerId: c.ownerId,
    baseName: c.name, name: `${c.name}(${c.owner})`, bp: c.bp, hidden: c.hidden, hidden2: c.hidden2, obj: c.obj, g: c.g, gen: c.gen,
    settings: { ...DEFAULT_SETTINGS }, hue: 0, note: tr(`🌐 ${c.owner} さんの生物${c.msg ? ` 「${c.msg}」` : ''}`, `🌐 by ${c.owner}${c.msg ? ` "${c.msg}"` : ''}`),
  };
}

export class Lobby {
  constructor(hooks) {
    this.hooks = hooks;
    this.data = null;
    this.error = null;
    this.raceDist = new Map();
    $('#online-home').addEventListener('click', () => hooks.onHome());
    $('#online-refresh').addEventListener('click', () => this.load());
    $('#online-name').addEventListener('click', () => this.askName());
  }

  enter() {
    this.renderName();
    this.render();
    this.load();
  }

  renderName() {
    const p = online.profile();
    $('#online-name').textContent = p.name ? `👤 ${p.name}` : tr('👤 名前を決める', '👤 Pick a name');
  }

  async askName() {
    const v = await askText(tr('オンラインで表示する名前', 'Your name online'), { value: online.profile().name || '', placeholder: tr('16文字まで', 'Up to 16 characters'), note: tr('公開した生物の持ち主として表示されます。', 'Shown as the owner of the creatures you publish.') });
    if (v && v.trim()) { online.setName(v); this.renderName(); }
    return online.profile().name;
  }

  async load() {
    $('#online-body').innerHTML = `<p class="empty">${tr('読み込み中…', 'Loading…')}</p>`;
    try {
      this.data = await online.fetchAll();
      this.error = null;
      this.hooks.onData && this.hooks.onData(this.data);
    } catch (e) {
      this.error = e;
    }
    this.render();
  }

  render() {
    const body = $('#online-body');
    if (this.error) return this.renderError(body);
    if (!this.data) return;
    body.innerHTML = '';
    this.renderBoard(body);
  }

  renderError(body) {
    body.innerHTML = '';
    const e = this.error;
    const box = el('div', { class: 'on-error' }, el('h3', {}, e.kind === 'network' ? tr('📡 オフラインです', '📡 You are offline') : tr('🔒 オンラインに接続できません', "🔒 Can't connect online")));
    if (e.kind === 'permission') {
      box.append(el('p', {}, tr('データベース (softevo7 と同じ Firebase プロジェクト) が softevo9 の読み書きを許可していません。Firebase コンソール → Realtime Database → ルール に、次の1行を追加して「公開」してください。', 'The database (the same Firebase project as softevo7) does not allow reading and writing softevo9. In the Firebase console → Realtime Database → Rules, add the line below and press "Publish".')),
        el('pre', {}, `{\n  "rules": {\n    "leaderboard": { ".read": true, ".write": true },\n    ${online.RULES_HINT}\n  }\n}`));
    } else box.append(el('p', {}, tr(`${e.message}。電波の良いところで「↻」を押してください。`, `${e.message}. Press "↻" where the connection is better.`)));
    body.append(box);
  }

  // ─── かけっこ記録 ───
  renderBoard(body) {
    const me = online.profile().id;
    body.append(el('div', { class: 'on-intro' },
      el('p', {}, tr('🏃 公開された生物の「平地12秒」の記録。記録はあなたの端末で走らせ直して測っています。', '🏃 Records of published creatures on "flat ground, 12 s". Each record is re-run and measured on your device.')),
      el('button', { class: 'btn primary small', onclick: () => this.publishDialog() }, tr('＋ 自分の生物を出す', '+ Publish yours'))));
    let list = this.data.creatures;
    if (!list.length) { body.append(el('p', { class: 'empty' }, tr('まだ公開された生物はいません。最初の1体になろう。', 'No creatures published yet. Be the first!'))); return; }
    const S = this.data.stats;
    this.measureRace(list);
    list = list.slice().sort((a, b) => (this.raceDist.get(b.id) ?? -1e9) - (this.raceDist.get(a.id) ?? -1e9));
    const grid = el('div', { class: 'on-grid' });
    list.forEach((c, i) => {
      const s = S[c.id] || { cheers: 0 };
      const mine = c.ownerId === me;
      const cv = el('canvas', { class: 'on-thumb' });
      const rec = this.raceDist.has(c.id) ? `🏃 ${(this.raceDist.get(c.id) / 100).toFixed(2)} m` : tr('🏃 計測中…', '🏃 measuring…');
      const cheerBtn = el('button', { class: 'btn ghost small', title: tr('拍手を送る', 'Applaud'), onclick: async () => {
        try { await online.cheer(c.id); s.cheers++; cheerBtn.textContent = `👏 ${s.cheers}`; } catch (e) { toast(e.message); }
      } }, `👏 ${s.cheers}`);
      grid.append(el('article', { class: `on-card${mine ? ' mine' : ''}` },
        el('span', { class: 'on-rank' }, `${i + 1}`), cv,
        el('div', { class: 'on-info' },
          el('b', {}, c.name),
          el('small', {}, `${mine ? tr('あなた', 'you') : c.owner}${c.gen != null ? ` · ${genLabel(c.gen)}` : ''} · ${when(c.created)}`),
          c.msg ? el('p', { class: 'on-msg' }, `「${c.msg}」`) : null,
          el('div', { class: 'on-rec' }, rec)),
        el('div', { class: 'on-actions' },
          el('button', { class: 'btn primary small', onclick: () => this.hooks.onRace(onlineFighter(c)) }, tr('🏃 一緒に走る', '🏃 Race it')),
          cheerBtn,
          mine ? el('button', { class: 'btn ghost small danger-text', onclick: () => this.withdraw(c) }, tr('取り下げ', 'Withdraw')) : null)));
      requestAnimationFrame(() => drawThumb(cv, c.bp));
    });
    body.append(grid);
  }

  /** かけっこの記録を、この端末で走らせて測る (決定論なので誰が測っても同じ) */
  measureRace(list) {
    const todo = list.filter(c => !this.raceDist.has(c.id));
    if (!todo.length || this.measuring) return;
    this.measuring = true;
    const step = () => {
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 30) {
        const c = todo.shift();
        const f = prepareFighter(c);
        this.raceDist.set(c.id, evaluate(f.bp, f.layout, f.genome, RACE_ENV).distance);
      }
      if (todo.length) setTimeout(step, 0);
      else { this.measuring = false; this.render(); }
    };
    setTimeout(step, 0);
  }

  async withdraw(c) {
    if (!await confirmDialog(tr('取り下げますか？', 'Withdraw?'), tr(`「${c.name}」をオンラインから取り下げます。拍手の数も消えます。`, `"${c.name}" will be taken offline. Its applause count is lost too.`), tr('取り下げる', 'Withdraw'), true)) return;
    try { await online.withdraw(c.id); toast(tr('取り下げました', 'Withdrawn')); this.load(); } catch (e) { toast(e.message); }
  }

  /** 自分の生物を公開する */
  async publishDialog() {
    const mine = this.hooks.myCreatures();
    if (!mine.length) return toast(tr('まだ育てた生物がいません。まず生物をつくって進化させよう', 'No creatures of your own yet. Make one and evolve it first'));
    if (!online.profile().name && !(await this.askName())) return;
    const back = el('div', { class: 'modal-back' });
    const close = () => back.remove();
    const sel = el('select', { class: 'ent-gen' });
    mine.forEach((c, i) => sel.append(el('option', { value: i }, c.name)));
    const gen = el('select', { class: 'ent-gen' });
    const fillGen = () => {
      gen.innerHTML = '';
      mine[+sel.value].snaps.forEach((s, i) => gen.append(el('option', { value: i }, `${genLabel(s.gen)} ${s.tag}`)));
    };
    sel.addEventListener('change', fillGen); fillGen();
    const msg = el('input', { class: 'on-input', maxlength: 60, placeholder: tr('ひとこと (例: 一緒に走ろう！ / 後ずさりの達人です)', 'A short note (e.g. Race me! / Master of walking backwards)') });
    const ok = el('button', { class: 'btn primary', onclick: async () => {
      ok.disabled = true;
      const f = this.hooks.fighterOf(mine[+sel.value], +gen.value);
      try { await online.publish(f, 'race', msg.value); toast(tr('🌐 公開しました', '🌐 Published')); close(); this.load(); }
      catch (e) { toast(e.message); ok.disabled = false; }
    } }, tr('公開する', 'Publish'));
    back.append(el('div', { class: 'modal' },
      el('h3', {}, tr('🏃 かけっこに生物を出す', '🏃 Publish a creature to race')),
      el('label', { class: 'on-field' }, el('span', {}, tr('生物', 'Creature')), sel),
      el('label', { class: 'on-field' }, el('span', {}, tr('世代', 'Generation')), gen),
      el('label', { class: 'on-field' }, el('span', {}, tr('ひとこと', 'Note')), msg),
      el('p', { class: 'dim' }, tr(`公開すると、この生物の体と脳が「${online.profile().name}」の名前でだれでも見られるようになり、一緒に走れるようになります。`, `Once published, anyone can see this creature's body and brain under the name "${online.profile().name}" and race with it.`)),
      el('div', { class: 'modal-actions' }, el('button', { class: 'btn ghost', onclick: close }, tr('やめる', 'Cancel')), ok)));
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    document.body.append(back);
  }
}
