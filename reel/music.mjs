#!/usr/bin/env node
/* =====================================================================
   Softevo Reels — 曲と効果音 (オリジナルのチップチューン。外部の音源は使わない)
   ---------------------------------------------------------------------
   台本「drop16」用: 120 BPM・8小節 = ちょうど16秒 (1拍 = 15コマ @30fps)。
     小節1 Am  つかみ。1コマ目から鳴る / 倒れる瞬間に「ボコッ」
     小節2 F   成長のダイジェスト。カットごとに「ピッ」
     小節3 G   惜しい! 3拍目で全部止まって「ワワワワ〜ン」
     小節4 E   最後の挑戦。スネアの連打 + ライザー → 4拍目は無音 (画面はスロー)
     小節5 Am  ドロップ = ゴールの瞬間。同じリフを全員で
     小節6 F   勝利の走り
     小節7 C   結果。カウントアップに合わせて「チチチ…チーン」
     小節8 E   呼びかけ + 巻き戻しの音 → フィルで小節1へ (ループ)
   使い方: node reel/music.mjs reel/episodes/ep001.json out/ep001/music.wav
   出力: 48kHz 16bit ステレオ WAV (16.000 秒)。音量の調整 (ラウドネス) は動画にするときに ffmpeg で
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const [epPath, outPath = 'music.wav'] = process.argv.slice(2);
const ep = epPath ? JSON.parse(fs.readFileSync(epPath, 'utf8')) : { events: [], fps: 30 };

const SR = 48000, BPM = ep.bpm || 120;
const BEAT = SR * 60 / BPM, STEP = BEAT / 4, BAR = BEAT * 4; // 24000 / 6000 / 96000 サンプル
const BARS = 8, LEN = BAR * BARS, TAIL = SR * 3;
const FRAME = SR / (ep.fps || 30);
const at = (bar, step = 0) => Math.round(bar * BAR + step * STEP);

// ─── 音の部品 ───
const mk = () => ({ L: new Float32Array(LEN + TAIL), R: new Float32Array(LEN + TAIL) });
const MIX = mk(), FX = mk(); // FX = ディレイに送る (リード・アルペジオ)
let seed = 0x1234567;
const noise = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 2147483648 - 1; };
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const hz = n => { const m = /^([A-G]#?)(-?\d)$/.exec(n); if (!m) throw new Error(`音名がちがう: ${n}`); return 440 * 2 ** ((12 * (+m[2] + 1) + NOTE[m[1]] - 69) / 12); };
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// 帯域制限したパルス波 (エイリアスの耳ざわりを減らす)。直流分も消す
function pulse(ph, dt, duty) {
  let v = ph < duty ? 1 : -1;
  v += blep(ph, dt);
  let t2 = ph - duty; if (t2 < 0) t2 += 1;
  v -= blep(t2, dt);
  return v - (2 * duty - 1);
}
// 4ビットの三角波 (ファミコン風のベース)
const tri4 = ph => { const t = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; return Math.round((t + 1) * 7.5) / 7.5 - 1; };
const panG = p => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

/** 音符: 周波数のすべり・ビブラート・ADSR・ローパスつき */
function tone({ t0, len, f, f2 = null, glide = 0, wave = 'pulse', duty = 0.25, vol = 0.2, pan = 0, a = 0.004, d = 0.1, s = 0.75, r = 0.06, vib = 0, vibDelay = 0.16, vibRate = 6, lp = 7000, bus = MIX, send = 0 }) {
  const n = Math.round((len + r) * SR), [gl, gr] = panG(pan);
  const al = 1 - Math.exp(-2 * Math.PI * lp / SR);
  let ph = 0, y = 0;
  for (let k = 0; k < n; k++) {
    const i = t0 + k; if (i < 0 || i >= LEN + TAIL) continue;
    const t = k / SR;
    let fr = f2 != null && glide > 0 ? f * (f2 / f) ** Math.min(1, t / glide) : f;
    if (vib && t > vibDelay) fr *= 2 ** (vib * Math.sin(2 * Math.PI * vibRate * (t - vibDelay)) / 12);
    const dt = fr / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    let v = wave === 'pulse' ? pulse(ph, dt, duty) : wave === 'tri' ? tri4(ph) : Math.sin(2 * Math.PI * ph);
    let e = t < a ? t / a : t < a + d ? 1 - (1 - s) * (t - a) / d : s;
    if (t > len) e *= Math.max(0, 1 - (t - len) / r);
    y += al * (v * e - y);
    const out = y * vol;
    bus.L[i] += out * gl; bus.R[i] += out * gr;
    if (send) { FX.L[i] += out * gl * send; FX.R[i] += out * gr * send; }
  }
}
function noiseHit({ t0, dur, vol, decay, hp = 0.6, lp = 16000, pan = 0, wide = 0, attack = 0.001, bus = MIX }) {
  const n = Math.round(dur * SR), [gl, gr] = panG(pan), al = 1 - Math.exp(-2 * Math.PI * lp / SR);
  let pl = 0, pr = 0, yl = 0, yr = 0;
  for (let k = 0; k < n; k++) {
    const i = t0 + k; if (i < 0 || i >= LEN + TAIL) continue;
    const t = k / SR, e = Math.min(1, t / attack) * Math.exp(-t / decay);
    const xl = noise(), xr = wide ? noise() * wide + xl * (1 - wide) : xl;
    const hl = xl - hp * pl, hr = xr - hp * pr; pl = xl; pr = xr; // 高域を強める
    yl += al * (hl - yl); yr += al * (hr - yr);
    bus.L[i] += yl * e * vol * gl * 1.41; bus.R[i] += yr * e * vol * gr * 1.41;
  }
}

// ─── ドラム ───
function kick(t0, vol = 0.85) {
  const n = Math.round(0.32 * SR); let ph = 0;
  for (let k = 0; k < n; k++) {
    const i = t0 + k; if (i >= LEN + TAIL) break;
    const t = k / SR, f = 46 + 150 * Math.exp(-t / 0.028);
    ph += f / SR;
    const e = Math.min(1, t / 0.0015) * Math.exp(-t / 0.15);
    const v = Math.tanh(2.4 * Math.sin(2 * Math.PI * ph)) * e * vol + (t < 0.003 ? noise() * 0.25 * vol : 0);
    MIX.L[i] += v * 0.707; MIX.R[i] += v * 0.707;
  }
}
function snare(t0, vol = 0.42) {
  noiseHit({ t0, dur: 0.22, vol, decay: 0.07, hp: 0.35, lp: 9000 });
  tone({ t0, len: 0.06, f: 210, f2: 150, glide: 0.05, wave: 'tri', vol: vol * 0.8, a: 0.001, d: 0.05, s: 0, r: 0.02, lp: 3000 });
}
const hat = (t0, vol = 0.1, open = false) => noiseHit({ t0, dur: open ? 0.25 : 0.06, vol, decay: open ? 0.09 : 0.018, hp: 0.95, lp: 14000, pan: 0.2 });
const crash = (t0, vol = 0.26) => noiseHit({ t0, dur: 2.6, vol, decay: 0.75, hp: 0.9, lp: 12000, wide: 0.8, attack: 0.002 });
function riser(t0, dur, vol = 0.22) {
  const n = Math.round(dur * SR); let y = 0, ph = 0;
  for (let k = 0; k < n; k++) {
    const i = t0 + k, t = k / n;
    const fc = 300 * (30 ** t), al = 1 - Math.exp(-2 * Math.PI * fc / SR);
    y += al * (noise() - y);
    const fr = 180 * (8 ** t); ph += fr / SR; if (ph >= 1) ph -= 1;
    const v = (y * 0.9 + pulse(ph, fr / SR, 0.125) * 0.12) * vol * t * t;
    MIX.L[i] += v * 0.707; MIX.R[i] += v * 0.707;
  }
}

// ─── 曲 ───
const CH = { // コード: ベースの根音・アルペジオ
  Am: { root: 'A', bass: ['A2', 'A3'], arp: ['A4', 'C5', 'E5', 'A5'] },
  F: { root: 'F', bass: ['F2', 'F3'], arp: ['F4', 'A4', 'C5', 'F5'] },
  G: { root: 'G', bass: ['G2', 'G3'], arp: ['G4', 'B4', 'D5', 'G5'] },
  C: { root: 'C', bass: ['C3', 'C2'], arp: ['C5', 'E5', 'G5', 'C6'] },
  E: { root: 'E', bass: ['E2', 'E3'], arp: ['E4', 'G#4', 'B4', 'E5'] },
};
const PROG = ['Am', 'F', 'G', 'E', 'Am', 'F', 'C', 'E'];
// リード: "音:16分の数"。r = 休み
const LEAD = [
  'A4:3 E5:3 A5:2 G5:2 E5:2 D5:2 E5:2',
  'F4:3 C5:3 F5:2 E5:2 C5:2 A4:2 C5:2',
  'G4:3 D5:3 G5:2 r:8',
  'E5:4 G#5:4 B5:4 r:4',
  'A5:3 E6:3 C6:2 B5:2 A5:2 G5:2 A5:2',
  'A5:3 F5:3 C6:2 A5:2 G5:2 F5:2 E5:2',
  'G5:3 E5:3 G5:2 C6:4 B5:2 G5:2',
  'G#5:4 E5:4 B4:4 D5:1 C5:1 B4:1 G#4:1',
];
LEAD.forEach((line, b) => {
  let st = 0;
  for (const tok of line.split(' ')) {
    const [n, l] = tok.split(':'), len = +l;
    if (n !== 'r') {
      const big = b >= 4 && b <= 6, sec = len * STEP / SR;
      tone({ t0: at(b, st), len: sec * 0.92, f: hz(n), duty: big ? 0.25 : 0.25, vol: big ? 0.2 : 0.17, pan: -0.12, a: 0.004, d: 0.12, s: 0.7, r: 0.05, vib: len >= 3 ? 0.18 : 0, lp: 6000, send: 0.5 });
      // ドロップ以降は1オクターブ下を重ねて厚く
      if (big) tone({ t0: at(b, st), len: sec * 0.92, f: hz(n) / 2, duty: 0.5, vol: 0.07, pan: 0.18, a: 0.004, d: 0.1, s: 0.7, r: 0.05, lp: 3500, send: 0.2 });
    }
    st += len;
  }
});
// ベース (8分でオクターブを行き来。4小節目は16分で押す)
PROG.forEach((ch, b) => {
  const B = CH[ch].bass;
  if (b === 3) { for (let s = 0; s < 12; s++) tone({ t0: at(b, s), len: STEP / SR * 0.8, f: hz(B[0]), wave: 'tri', vol: 0.36, a: 0.002, d: 0.05, s: 0.8, r: 0.02, lp: 4000 }); return; }
  const last = b === 2 ? 8 : 16;
  for (let s = 0; s < last; s += 2) tone({ t0: at(b, s), len: STEP * 2 / SR * 0.85, f: hz(B[(s / 2) % 2]), wave: 'tri', vol: 0.38, a: 0.002, d: 0.08, s: 0.85, r: 0.03, lp: 4000 });
});
// アルペジオ (16分で和音を回す。小さめに右から)
for (const b of [0, 1, 4, 5, 6]) {
  const A = CH[PROG[b]].arp;
  for (let s = 0; s < 16; s++) tone({ t0: at(b, s), len: STEP / SR * 0.7, f: hz(A[s % 4]), duty: 0.125, vol: b >= 4 ? 0.06 : 0.045, pan: 0.35, a: 0.002, d: 0.04, s: 0.6, r: 0.02, lp: 7000, send: 0.4 });
}
// ドラム
const D = (b, steps, fn) => steps.forEach(s => fn(at(b, s), s));
const EIGHTS = [2, 6, 10, 14], ODD = [1, 3, 5, 7, 9, 11, 13, 15];
crash(at(0)); D(0, [0, 4, 8, 12], t => kick(t)); D(0, [4, 12], t => snare(t)); D(0, EIGHTS, t => hat(t));
D(1, [0, 4, 8, 12], t => kick(t)); D(1, [4, 12], t => snare(t)); D(1, EIGHTS, t => hat(t)); D(1, ODD, t => hat(t, 0.05));
D(2, [0, 4], t => kick(t)); D(2, [4], t => snare(t)); D(2, [2, 6], t => hat(t));
D(3, [0, 4, 8], t => kick(t, 0.8));
D(3, [0, 2, 4, 6, 8, 9, 10, 11], (t, s) => snare(t, 0.22 + 0.03 * s));
riser(at(3), 12 * STEP / SR, 0.24);
for (const b of [4, 5, 6]) {
  if (b !== 5) crash(at(b), b === 4 ? 0.34 : 0.24);
  D(b, [0, 4, 8, 12], t => kick(t, 0.9)); D(b, [4, 12], t => snare(t, 0.45)); D(b, EIGHTS, t => hat(t, 0.1, true)); D(b, ODD, t => hat(t, 0.055));
}
D(7, [0, 8, 12], t => kick(t, 0.8)); D(7, [2, 6, 10], t => hat(t, 0.08));
D(7, [12, 13, 14, 15], (t, s) => snare(t, 0.26 + 0.05 * (s - 12)));

// ─── 効果音 (台本のコマに合わせる) ───
const SFX = {
  bonk(t0) { // 倒れて頭を打つ
    tone({ t0, len: 0.14, f: 520, f2: 70, glide: 0.16, duty: 0.25, vol: 0.22, a: 0.001, d: 0.12, s: 0.2, r: 0.05, lp: 5000 });
    tone({ t0, len: 0.08, f: 140, f2: 40, glide: 0.08, wave: 'sine', vol: 0.5, a: 0.001, d: 0.08, s: 0, r: 0.03 });
    noiseHit({ t0, dur: 0.12, vol: 0.18, decay: 0.03, hp: 0.2, lp: 2500 });
  },
  cut(t0) { tone({ t0, len: 0.045, f: 1318.5, f2: 2637, glide: 0.04, duty: 0.5, vol: 0.075, pan: 0.1, a: 0.001, d: 0.03, s: 0.5, r: 0.02, lp: 9000 }); },
  fail(t0) { // 時間切れ → ワワワワ〜ン (G のコードの上で D → C# → C → B)
    const seq = [['D5', 2], ['C#5', 2], ['C5', 2], ['B4', 5]];
    let s = 0;
    for (const [n, l] of seq) {
      const long = l > 2;
      tone({ t0: t0 + Math.round(s * STEP), len: l * STEP / SR * 0.9, f: hz(n) * 1.03, f2: hz(n), glide: 0.05, duty: 0.5, vol: 0.34, pan: 0, a: 0.025, d: 0.15, s: 0.85, r: long ? 0.12 : 0.04, vib: long ? 0.5 : 0, vibDelay: 0.08, vibRate: 7, lp: 3200 });
      s += l;
    }
  },
  goal(t0) { // ゴール: 小さなアクセントだけ (主役は曲のドロップと、拍に合った歩調)
    tone({ t0, len: 0.3, f: 80, f2: 40, glide: 0.3, wave: 'sine', vol: 0.25, a: 0.002, d: 0.3, s: 0, r: 0.05 });
    ['A5', 'C#6', 'E6', 'A6'].forEach((n, k) => tone({ t0: t0 + Math.round(k * STEP / 2), len: 0.05, f: hz(n), duty: 0.125, vol: 0.06, pan: 0.3, a: 0.001, d: 0.04, s: 0.5, r: 0.04, lp: 9000, send: 0.6 }));
  },
  count(t0) { // カウントアップ (16分で8回) → 2拍後に「チーン」
    for (let k = 0; k < 8; k++) tone({ t0: t0 + Math.round(k * STEP), len: 0.012, f: 2093, duty: 0.5, vol: 0.05 + 0.006 * k, pan: 0.15, a: 0.0005, d: 0.01, s: 0.3, r: 0.01, lp: 10000 });
    const t1 = t0 + Math.round(8 * STEP);
    tone({ t0: t1, len: 0.07, f: hz('B5'), duty: 0.5, vol: 0.12, a: 0.001, d: 0.05, s: 0.6, r: 0.02, lp: 9000 });
    tone({ t0: t1 + Math.round(0.07 * SR), len: 0.35, f: hz('E6'), duty: 0.5, vol: 0.12, a: 0.001, d: 0.3, s: 0.3, r: 0.15, lp: 9000, send: 0.4 });
  },
  rewind(t0) { // 巻き戻し: キュルキュル (だんだん速く → 遅く)
    const dur = 1.75, n = Math.round(dur * SR); let ph = 0, ph2 = 0;
    for (let k = 0; k < n; k++) {
      const i = t0 + k, u = k / n, sp = Math.sin(Math.PI * u); // 巻き戻しの速さと同じ山なり
      const wob = 1 + 0.5 * Math.sin(2 * Math.PI * ph2); ph2 += (6 + 18 * sp) / SR;
      const fr = (300 + 1500 * sp) * wob; ph += fr / SR; if (ph >= 1) ph -= 1;
      const v = (pulse(ph, fr / SR, 0.25) * 0.5 + noise() * 0.25) * 0.075 * Math.min(1, u * 12) * Math.min(1, (1 - u) * 8);
      MIX.L[i] += v * 0.6; MIX.R[i] += v * 0.8;
    }
  },
};
for (const e of ep.events || []) if (SFX[e.type]) SFX[e.type](Math.round(e.f * FRAME));

// ─── 止める所 (惜しい! の後と、ドロップ前の1拍) ───
function gate(from, to, fade = 0.006) {
  const fr = Math.round(fade * SR);
  for (const bus of [MIX, FX]) for (const ch of [bus.L, bus.R]) for (let i = from - fr; i < to + fr; i++) {
    if (i < 0) continue;
    const g = i < from ? (from - i) / fr : i >= to ? (i - to) / fr : 0;
    ch[i] *= Math.min(1, g);
  }
}

// ─── ディレイ (付点8分・左右に跳ねる) ───
{
  const dl = Math.round(STEP * 3), fb = 0.32, wet = 0.22;
  const bl = new Float32Array(LEN + TAIL), br = new Float32Array(LEN + TAIL);
  for (let i = 0; i < LEN + TAIL; i++) {
    const j = i - dl;
    bl[i] = FX.L[i] + (j >= 0 ? br[j] * fb : 0); // ピンポン
    br[i] = FX.R[i] + (j >= 0 ? bl[j] * fb : 0);
    if (j >= 0) { MIX.L[i] += br[j] * wet; MIX.R[i] += bl[j] * wet; }
  }
}
gate(at(3, 12), at(4, 0));            // ドロップ前の無音 (画面はスロー)

// ─── ループ: 16秒を超えた余韻は頭に重ねる (Instagram で繰り返しても途切れない) ───
for (let i = 0; i < TAIL; i++) { MIX.L[i] += MIX.L[LEN + i]; MIX.R[i] += MIX.R[LEN + i]; }
// まとめ: やわらかく頭をおさえて -1 dBFS に
let peak = 0;
const sat = v => Math.tanh(v * 1.15) / Math.tanh(1.15);
for (let i = 0; i < LEN; i++) { MIX.L[i] = sat(MIX.L[i]); MIX.R[i] = sat(MIX.R[i]); peak = Math.max(peak, Math.abs(MIX.L[i]), Math.abs(MIX.R[i])); }
const norm = 10 ** (-1 / 20) / (peak || 1);
const buf = Buffer.alloc(44 + LEN * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + LEN * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(LEN * 4, 40);
for (let i = 0; i < LEN; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, MIX.L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, MIX.R[i] * norm)) * 32767), 46 + i * 4);
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, buf);
console.log(`曲: ${outPath}  (${(LEN / SR).toFixed(3)} 秒・${BPM} BPM・効果音 ${(ep.events || []).length} 個)`);
