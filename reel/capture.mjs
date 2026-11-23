#!/usr/bin/env node
/* =====================================================================
   SoftEvo Reels — コマを PNG 連番に書き出す (動画への変換は別の場所で)
   ---------------------------------------------------------------------
   準備 (初回だけ):  npm i -D playwright && npx playwright install chromium
   使い方:           node reel/capture.mjs reel/episodes/ep001.json [--out out/ep001] [--from 0] [--to 120]

   書き出すもの (out/ep001/):
     frame_00000.png …  1080×1920 / 30fps の全コマ
     cover.png          表紙 (プロフィールの一覧用)
     caption.txt        投稿文 + ハッシュタグ (英語)
     meta.json          fps・コマ数・長さ
   変換の例 (ffmpeg):
     ffmpeg -framerate 30 -i out/ep001/frame_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 16 -preset slow ep001.mp4
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const argv = process.argv.slice(2);
const epFile = argv.find(a => !a.startsWith('--'));
const opt = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
if (!epFile) { console.error('使い方: node reel/capture.mjs reel/episodes/ep001.json [--out out/ep001] [--from N] [--to N]'); process.exit(1); }
const epAbs = path.resolve(epFile);
const epRel = path.relative(path.join(root, 'reel'), epAbs).split(path.sep).join('/');
const out = path.resolve(opt('out') || path.join('out', path.basename(epFile, '.json')));
fs.mkdirSync(out, { recursive: true });

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright がありません: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

// リポジトリをそのまま配る小さなサーバー
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
await page.waitForFunction(() => window.REEL && window.REEL.ready, null, { timeout: 60000 });
const meta = await page.evaluate(() => ({ fps: REEL.fps, total: REEL.total, width: REEL.width, height: REEL.height, title: REEL.episode.title, caption: REEL.episode.caption }));
const from = +(opt('from') || 0), to = Math.min(meta.total - 1, +(opt('to') ?? meta.total - 1));
const png = async () => Buffer.from((await page.evaluate(() => REEL.canvas.toDataURL('image/png'))).split(',')[1], 'base64');

console.log(`${meta.title}: ${meta.total} コマ (${(meta.total / meta.fps).toFixed(1)} 秒) → ${path.relative(process.cwd(), out)}`);
const t0 = Date.now();
for (let i = from; i <= to; i++) {
  await page.evaluate(i => REEL.seek(i), i);
  fs.writeFileSync(path.join(out, `frame_${String(i).padStart(5, '0')}.png`), await png());
  if (i % 60 === 0 || i === to) process.stdout.write(`\r  ${i + 1}/${meta.total}  (${((Date.now() - t0) / 1000).toFixed(0)} 秒)`);
}
await page.evaluate(() => REEL.cover());
fs.writeFileSync(path.join(out, 'cover.png'), await png());
fs.writeFileSync(path.join(out, 'caption.txt'), meta.caption + '\n');
fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ fps: meta.fps, frames: meta.total, seconds: meta.total / meta.fps, width: meta.width, height: meta.height, pattern: 'frame_%05d.png' }, null, 2));
console.log(`\n書き出し完了。変換の例:\n  ffmpeg -framerate ${meta.fps} -i ${path.relative(process.cwd(), out)}/frame_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 16 -preset slow ${path.basename(out)}.mp4`);
await browser.close();
server.close();
