#!/usr/bin/env node
/* =====================================================================
   Softevo Reels — コマを PNG 連番に書き出し、曲をつけて MP4 にする
   ---------------------------------------------------------------------
   準備 (初回だけ):  npm i -D playwright && npx playwright install chromium   (MP4 には ffmpeg も)
   使い方:           node reel/capture.mjs reel/episodes/ep001.json [--out out/ep001] [--from 0] [--to 120] [--no-mp4]

   書き出すもの (out/ep001/):
     frame_00000.png …  1080×1920 / 30fps の全コマ
     music.wav          曲と効果音 (reel/music.mjs。コマに合わせて作る)
     ep001.mp4          投稿用 (H.264 + AAC、音量は -14 LUFS にそろえる)。ffmpeg がなければ作らずにコマンドを表示
     cover.png          表紙 (プロフィールの一覧用)
     caption.txt        投稿文 + ハッシュタグ (英語)
     meta.json          fps・コマ数・長さ
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const argv = process.argv.slice(2);
const epFile = argv.find(a => !a.startsWith('--') && a.endsWith('.json'));
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
if (!epFile) { console.error('使い方: node reel/capture.mjs reel/episodes/ep001.json [--out out/ep001] [--from N] [--to N] [--no-mp4]'); process.exit(1); }
const epAbs = path.resolve(epFile);
const epRel = path.relative(path.join(root, 'reel'), epAbs).split(path.sep).join('/');
const name = path.basename(epFile, '.json');
const out = path.resolve(opt('out') || path.join('out', name));
fs.mkdirSync(out, { recursive: true });

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright がありません: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

// リポジトリをそのまま配る小さなサーバー
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`${base}/reel/index.html?capture&ep=${encodeURIComponent(epRel)}`);
await page.waitForFunction(() => window.REEL && window.REEL.ready, null, { timeout: 120000 });
const meta = await page.evaluate(() => ({ fps: REEL.fps, total: REEL.total, width: REEL.width, height: REEL.height, title: (REEL.episode.texts || {}).title || REEL.episode.title, tag: REEL.episode.tag, caption: REEL.episode.caption }));
const from = +(opt('from') || 0), to = Math.min(meta.total - 1, +(opt('to') ?? meta.total - 1));
const png = async () => Buffer.from((await page.evaluate(() => REEL.canvas.toDataURL('image/png'))).split(',')[1], 'base64');

console.log(`${meta.title} ${meta.tag}: ${meta.total} コマ (${(meta.total / meta.fps).toFixed(1)} 秒) → ${path.relative(process.cwd(), out)}`);
const t0 = Date.now();
for (let i = from; i <= to; i++) {
  await page.evaluate(i => REEL.seek(i), i);
  fs.writeFileSync(path.join(out, `frame_${String(i).padStart(5, '0')}.png`), await png());
  if (i % 30 === 0 || i === to) process.stdout.write(`\r  ${i + 1}/${meta.total}  (${((Date.now() - t0) / 1000).toFixed(0)} 秒)`);
}
await page.evaluate(() => REEL.cover());
fs.writeFileSync(path.join(out, 'cover.png'), await png());
fs.writeFileSync(path.join(out, 'caption.txt'), meta.caption + '\n');
fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ fps: meta.fps, frames: meta.total, seconds: meta.total / meta.fps, width: meta.width, height: meta.height, pattern: 'frame_%05d.png', audio: 'music.wav' }, null, 2));
await browser.close();
server.close();
console.log('');

// ─── 曲 (コマの台本から作るので、カット・転ぶ瞬間・ドロップがぴったり合う) ───
const wav = path.join(out, 'music.wav');
const mu = spawnSync(process.execPath, [path.join(here, 'music.mjs'), epAbs, wav], { stdio: 'inherit' });
if (mu.status !== 0) { console.error('曲が作れませんでした'); process.exit(1); }

// ─── MP4 (音量は 2 回測って -14 LUFS / ピーク -1.5 dB にそろえる) ───
const mp4 = path.join(out, `${name}.mp4`);
const LN = 'I=-14:TP=-1.5:LRA=11';
const videoArgs = ['-framerate', String(meta.fps), '-i', path.join(out, 'frame_%05d.png'), '-i', wav];
const enc = ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(meta.fps),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest'];
const hasFF = !argv.includes('--no-mp4') && from === 0 && to === meta.total - 1 && spawnSync('ffmpeg', ['-version']).status === 0;
if (hasFF) {
  const m1 = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', `loudnorm=${LN}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const js = JSON.parse(m1.stderr.slice(m1.stderr.lastIndexOf('{'), m1.stderr.lastIndexOf('}') + 1));
  const af = `loudnorm=${LN}:measured_I=${js.input_i}:measured_TP=${js.input_tp}:measured_LRA=${js.input_lra}:measured_thresh=${js.input_thresh}:offset=${js.target_offset}:linear=true`;
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...videoArgs, '-map', '0:v', '-map', '1:a', '-af', af, ...enc, mp4], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('ffmpeg が失敗しました'); process.exit(1); }
  console.log(`MP4: ${path.relative(process.cwd(), mp4)}  (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB・元の音量 ${js.input_i} LUFS → -14 LUFS)`);
} else {
  console.log(`書き出し完了。MP4 にするには (ffmpeg):\n  ffmpeg ${videoArgs.join(' ')} -af loudnorm=${LN} ${enc.join(' ')} ${path.relative(process.cwd(), mp4)}`);
}
