# Softevo Reels — 縦動画の枠組み (英語のみ・音ハメつき)

Softevo の生き物が「ゴールの旗に届くまで」を、Instagram のリール用の縦動画 (1080×1920 / 30fps / **16秒**) にする仕組みです。
**動画の中の文字はすべて英語**。曲と効果音もここで作ります (オリジナルのチップチューンなので著作権の心配がありません)。

```
reel/
├─ make-episode.mjs   エピソードをつくる (体のオーディション → 進化 → ゴールと見せる世代を選ぶ → 台本・投稿文)
├─ music.mjs          曲と効果音 (120 BPM・8小節 = 16秒。台本のコマに合わせて鳴らす)
├─ index.html         再生ページ (プレビュー・音つき再生・安全領域・表紙)
├─ reel.js            1コマを描く (Softevo のドット描画をそのまま使う。決定論なので何度描いても同じ画)
├─ capture.mjs        全コマを PNG に → 曲を作る → MP4 (音量 -14 LUFS) + 表紙・投稿文
└─ episodes/epNNN.json
```

## つくり方

```bash
# 0. 初回だけ
npm i -D playwright && npx playwright install chromium      # MP4 にするには ffmpeg も

# 1. エピソードをつくる (24体をオーディション → 上位4体を 300 世代 → 台本にいちばん合う体)
node reel/make-episode.mjs --ep 2
#    同じ体で作り直すとき (表示される「体の種」を使う)
node reel/make-episode.mjs --ep 1 --body-seed 230732 --goal 10

# 2. 確認する (音つき)
python3 -m http.server 8000
#    → http://localhost:8000/reel/?ep=episodes/ep002.json&audio=../out/ep002/music.wav
#      (音は 3. のあとにできる。先に node reel/music.mjs reel/episodes/ep002.json out/ep002/music.wav でも可)

# 3. 書き出す → out/ep002/ に ep002.mp4 / cover.png / caption.txt / music.wav / frame_*.png
node reel/capture.mjs reel/episodes/ep002.json
```

`make-episode.mjs` のオプション: `--seed N` (オーディションの種。同じ種なら同じ回) / `--cast 24` / `--cast-gens 30` / `--finalists 4` / `--gens 300` / `--goal 10` (m) / `--body-seed N`

## 台本「drop16」 (16秒 = 120 BPM × 8小節。1拍 = 15コマ)

| 小節 | 時間 | 場面 | 画面 | 音 |
|---|---|---|---|---|
| 1 | 0:00 | **つかみ** 第0世代 (ランダムな脳) | `AI LEARNS TO WALK #001` / `GEN 0 random brain` → 倒れた瞬間に `CAN'T EVEN STAND` | 1コマ目から鳴る。倒れて頭を打つ瞬間 = 2拍目に「ボコッ」 |
| 2 | 0:02 | 成長 (2つの世代) | `GEN 4` → `GEN 9` (拍の頭でカット) | カットごとに「ピッ」 |
| 3 | 0:04 | **惜しい!** 旗の数cm手前で時間切れ | 旗とのすき間に寄る / `SO CLOSE...` `7 cm short` | 3拍目で全部止まって「ワワワワ〜ン」 |
| 4 | 0:06 | 最後の挑戦 | `GEN 57`。4拍目はスロー + 画面の端が暗くなる | スネアの連打 + ライザー → **4拍目は無音** |
| 5 | 0:08 | **ゴール** = ドロップ | ゴール直後の着地で 白く光る・揺れ・紙吹雪 / `GOAL!` | 全部が鳴る |
| 6 | 0:10 | 勝利の走り | `nobody taught it how` | 1歩 = 1拍 (着地がキックと同時) |
| 7 | 0:12 | 結果 | `GEN 0 → GEN 57` / `0.3 m → 17.8 m` / `2,784 tries` | 数字が増えると「チチチ…チーン」 |
| 8 | 0:14 | 呼びかけ + 巻き戻し | `FOLLOW for the next creature` / `Name it ↓` | 巻き戻しの音 → フィルで 1小節目へ |

**視聴維持のしかけ**
- 0.5秒で笑える出来事 (第0世代が倒れる)。最初のコマから文字と動きがある
- 上のバーに「いまの距離 → 旗」が常に出ていて、届くかどうかを最後まで見たくなる (白い目盛 = それまでの最高記録)
- 「数cm足りない」→ 無音のスロー → ドロップでゴール、の緩急
- カット・文字・揺れ・効果音はすべて拍の頭。最後の挑戦は歩調ごと曲に合わせてある (`stride`)
- 最後のコマは巻き戻して最初のコマと同じ姿・同じ画角・同じ脳 (第0世代の重み) → Instagram で繰り返してもつなぎ目がない
- Reels の UI に隠れる所 (上 250px・下・右下のボタンの列) に大事な物を置かない (プレビューの「IG safe zones」)

**台本の選び方 (自動)**
- 距離は「鼻先」(いちばん前の節点) で測る → 旗に触れた見た目と数字が一致する
- ゴールは 5/6/8/10/12/15/20/25/30 m から、「ゴールのすぐ手前で止まった世代」がいちばん惜しくなる距離 (最終世代は 3〜9 秒で到達)
- 第0世代は 48 体のランダムな脳から、0.3〜1.2 秒で倒れる個体 (いなければ動けない個体)
- 歩き方が規則正しければ、ゴール直後の着地をドロップに、勝利の走りを 1拍 = 1歩 の速さに

## 手で直す
`episodes/epNNN.json` の `texts` (画面の文字) / `caption` / `hashtags` / `cover` を書き換えて、もう一度 `capture.mjs` を回すだけ。ゲノムは JSON に入っているので同じ動きが必ず再現されます (進化のやり直しは不要)。

## 投稿のしかた
1. `epNNN.mp4` をリールとして投稿 (音は動画に入っている。Instagram の音源は**付けない** — 曲と動きがずれるため)
2. 表紙は `cover.png` (プロフィールの一覧で 4:5 / 3:4 に切り取られても大事な所が残る)
3. 投稿文は `caption.txt` をそのまま (英語・ハッシュタグは少なめ)
4. コメントで集まった名前は次の回の投稿文や `texts` で使える

## シリーズの型

**プロフィール (bio) の例**
> Random bodies. Random brains. They learn to move by evolution alone — a new pixel creature every episode.

| 企画 | 中身 | 枠組みでの作り方 |
|---|---|---|
| Creature #NNN (毎回ちがう生き物) | 本編 | `--ep N` で毎回 |
| You name it | 前の回のコメントで決まった名前で登場 | `texts.title` やタグを書き換え |
| You design it | コメントで集めた体 (「脚5本」「しっぽ2本」) | アプリで体を作って書き出し → JSON の `blueprint` を差し替えて進化からやり直す |
| Race day | 過去回の生き物どうしのかけっこ | (次の段階: かけっこ用の台本を追加) |
