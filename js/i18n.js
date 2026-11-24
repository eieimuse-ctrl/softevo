/* =====================================================================
   Softevo — i18n.js  日本語 / English
   ---------------------------------------------------------------------
   ・言語はページを開いた時に決まる (設定で切り替えると読み込み直す)。
     そのため文言はその場で tr('日本語', 'English') と書くだけでよい
   ・決め方: ?lang=en|ja → 保存した設定 → 英語 (デフォルト)
   ・HTML の固定の文言は data-en / data-en-html / data-en-title / data-en-ph / data-en-aria に英語を書く
   ・Worker や Node から読み込まれても動く (localStorage・document が無くてもよい)
   ===================================================================== */
const KEY = 'softevo/lang';

function detect() {
  try {
    const q = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lang');
    if (q === 'ja' || q === 'en') { try { localStorage.setItem(KEY, q); } catch { /* 保存できなくてもよい */ } return q; }
  } catch { /* location が無い */ }
  try { const s = localStorage.getItem(KEY); if (s === 'ja' || s === 'en') return s; } catch { /* Worker など */ }
  return 'en'; // 何も選んでいなければ英語 (日本語は設定で選ぶ)
}

/** いまの言語 ('ja' | 'en')。ページを開いている間は変わらない */
export const LANG = detect();
export const isEn = LANG === 'en';
/** 日本語と英語を並べて書いて、いまの言語の方を使う: tr('こんにちは', 'Hello') */
export const tr = (ja, en) => (isEn ? en : ja);
export const L = tr;

/** 言語を切り替える (保存して読み込み直す) */
export function setLang(lang) {
  if (lang !== 'ja' && lang !== 'en') return;
  try { localStorage.setItem(KEY, lang); } catch { /* 保存できなくても URL で切り替わる */ }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  if (lang !== detectSaved()) u.searchParams.set('lang', lang); // 保存できない環境でも切り替わるように
  location.replace(u.toString());
}
function detectSaved() { try { return localStorage.getItem(KEY); } catch { return null; } }

/** HTML の固定の文言を英語に (data-en など)。日本語のときは何もしない */
export function applyStaticText(root = document) {
  document.documentElement.lang = LANG;
  if (!isEn) return;
  for (const e of root.querySelectorAll('[data-en]')) e.textContent = e.dataset.en;
  for (const e of root.querySelectorAll('[data-en-html]')) e.innerHTML = e.dataset.enHtml;
  for (const e of root.querySelectorAll('[data-en-title]')) e.title = e.dataset.enTitle;
  for (const e of root.querySelectorAll('[data-en-ph]')) e.placeholder = e.dataset.enPh;
  for (const e of root.querySelectorAll('[data-en-aria]')) e.setAttribute('aria-label', e.dataset.enAria);
  const t = document.querySelector('title[data-en]');
  if (t) document.title = t.dataset.en;
}

/** 「第3世代」/「Gen 3」 */
export const genLabel = g => tr(`第${g}世代`, `Gen ${g}`);
/** 順位「1位」/「1st」 */
export const rankLabel = n => tr(`${n}位`, `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`);
