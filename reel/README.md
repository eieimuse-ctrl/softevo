# SoftEvo Reels — 縦動画の枠組み (英語のみ)

SoftEvo の生き物が「歩けるようになるまで」を、Instagram のリール用の縦動画 (1080×1920 / 30fps) にする仕組みです。
**動画の中の文字はすべて英語**。ここで作るのは「画」(PNG 連番) までで、動画への変換は別の場所で行います。

```
reel/
├─ make-episode.mjs   エピソードをつくる (体 → 進化 → 見せ場の世代を自動で選ぶ → 英語の台本・投稿文)
├─ index.html         再生ページ (プレビュー・シーク・安全領域・表紙)
├─ reel.js            1コマを描く (SoftEvo のドット描画をそのまま使う。決定論なので何度描いても同じ画)
├─ capture.mjs        全コマを PNG 連番に書き出す + 表紙・投稿文
└─ episodes/epNNN.json
```

## つくり方 (3ステップ)

```bash
# 0. 初回だけ (書き出しに使う)
npm i -D playwright && npx playwright install chromium

# 1. エピソードをつくる (6体をオーディションして、いちばん伸びそうな体で 200 世代)
node reel/make-episode.mjs --ep 2 --cast 6

# 2. 確認する (どちらか)
python3 -m http.server 8000      # → http://localhost:8000/reel/?ep=episodes/ep002.json
#   または push 後に https://eieimuse-ctrl.github.io/softevo/reel/?ep=episodes/ep002.json

# 3. 書き出す → out/ep002/ に frame_00000.png … / cover.png / caption.txt / meta.json
node reel/capture.mjs reel/episodes/ep002.json
#   変換の例 (別の場所で): ffmpeg -framerate 30 -i out/ep002/frame_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 16 -preset slow ep002.mp4
```

`make-episode.mjs` のオプション: `--seed N` (同じ種なら毎回同じ回) / `--gens 300` / `--body quad` (プリセットの体) / `--name "Wobbly Bob"` / `--cast 6` (オーディション) / `--cast-gens 40`

音は入れていません。投稿のときに Instagram の音源を付けてください (BGM は動画の外で)。

## 1本の構成 (約25秒)

| 時間 | 場面 | 画面の文字 (例) |
|---|---|---|
| 0–4.2 秒 | 第0世代 (でたらめな脳) + つかみをタイプライターで | `Nobody taught it to walk.` / `Watch.` |
| 4.2–15 秒 | 見せ場 3 つ × 3.6 秒 | `GEN 19  breaks 5 m` |
| 15–21 秒 | 最終世代を 2倍速 + 第0世代のゴースト | `GEN 82  14.4 m in 12 s` |
| 21–24.6 秒 | 結果と呼びかけ | `1.7 m → 14.4 m` / `in 82 generations` / `Evolve your own creature` / `link in bio ↓` / `Comment a body for #002` |

- 画面: 上に `CREATURE #001` と世代、まん中に世界 (生物・距離メーター)、その下に脳 (いま流れている信号)、世代のバー
- **Reels の UI に隠れる所を避けている**: 上 250px・下 640px・右下のボタンの列。プレビューの「IG safe zones」で確認できる
- 表紙 (`cover.png`): プロフィールの一覧で 4:5 / 3:4 に切り取られても `#001` と生物が残る

### 見せ場の選び方 (自動)
`first steps` (初めて前に進んだ) / `breakthrough` (1世代で一番伸びた) / `new way to move` (歩き方ががらりと変わった) / `breaks N m` (N m を突破) から3つ。足りなければ途中の世代 (`getting better`)。最後は最高記録の世代。

### 手で直す
`episodes/epNNN.json` の `title` `shots[].caption / sub / hook / sec / speed` `end` `cover` `caption` を書き換えて、もう一度 `capture.mjs` を回すだけ (進化のやり直しは不要)。ゲノムは JSON に入っているので、同じ動きが必ず再現されます。

## シリーズの型 (英語の決まり文句)

**プロフィール (bio)**
> Tiny creatures learn to walk. Neural networks shaped only by evolution — pixel by pixel. New creature every day. Evolve your own ↓

**つかみ (hook)** — `make-episode.mjs` が選ぶ。差し替え自由
- `This creature has never walked.` / `Watch it learn.`
- `Gen 0: a random brain.` / `Then evolution kicks in.`
- `Nobody taught it to walk.` / `Watch.`
- `It can't even stand up.` / `Give it a few generations.`

**投稿文 (caption.txt に自動で入る)**
```
Creature #001 learned to walk in 82 generations.
Gen 0: 1.7 m → Gen 82: 14.4 m (12 s)
Nothing here is animated by hand — a 29-neuron brain shaped only by evolution.

👇 Comment a body part and we'll build Creature #002.
🔗 Evolve your own creature: link in bio

#evolution #neuralnetwork #machinelearning #geneticalgorithm #artificiallife #simulation #ai #creativecoding #pixelart #indiedev
```

**続けやすい企画 (同じ枠組みで作れる)**
| 企画 | 中身 | 枠組みでの作り方 |
|---|---|---|
| Creature #NNN (毎回ちがう生き物) | 本編。第0世代 → 見せ場 → 結果 | `--cast 6` で毎回 |
| You design it | コメントで集めた体 (「脚5本」「しっぽ2本」) を作る | アプリで体を作って書き出し → `--body` の代わりに JSON の `blueprint` を差し替え |
| Race day | 過去回の生き物どうしのかけっこ。勝者予想をコメントで | (次の段階: かけっこ用の場面を追加) |
| Brain surgery | ニューロンを1本止めると歩けなくなる | (次の段階: 手術の場面を追加) |
