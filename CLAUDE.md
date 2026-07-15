# CLAUDE.md — donkey-jerusalem3d(騎驢進耶路撒冷 3D,棕枝主日聖經皮)

> 2026-07-15/16 建成:**fork 自 equestrian3d**(騎乘引擎的家),照 mount-riding-kit 換皮。
> ★玩家=小驢駒(太21:1-11),馱著主耶穌進耶路撒冷——**不操控耶穌**,耶穌只是安坐(引擎控 NPC)。
> 經文已用 mcp cuv lookup 逐節查驗(和合本):亞9:9、太21:9,一字不改。

## 引擎核心(換皮時沒動的)

- `buildCourse/posAt/tangentAt`:CatmullRom 閉環賽道,一切以「里程 dist」為域。
- `jump()` 判定=畫面:`err=|distToFence-TAKEOFF_D|/speed`,`quality=1-err/(window*2.2)`
  (skijump 綠區同款);按下當下定「穩穩通過/受驚」,棕枝在驢駒過後才大幅搖動。
- 溫柔規則:沒按=auto weak jump(quality 0.18),永不淘汰。
- `this.running` 只給 RAF(athletics 撞名事故鐵則)。

## 這個皮的語意對照(判定不動,只換語意)

- 欄架 → **歡呼人群站**:兩側各 2-3 個 makePerson 揮棕枝(綠 PlaneGeometry 葉片)+地上鋪彩衣(太21:8)。
- 起跳 → 穩步;碰桿 → 驢駒受驚(+4 罰分,短暫踉蹌減速);Clear Round → 「溫柔的王進城了!」。
- 過標乾淨=棕枝歡快大幅揮舞(cheer);擦標=棕枝急促晃動(startle)——群眾不倒下。
- 模式只有兩個:`standard` 進城之路 / `practice` 練習小路(jumpoff/race/AI 對手整組已刪)。
- `makeDonkey`:介面與 makeHorse 相同(group/rig/body/neckPivot/head/tail/legs/saddle/coatMat/maneMat),
  比例小一號(body 0.5×0.5×1.3 @y1.15、腿 0.42/0.4 @y0.95、neckPivot y1.35 z0.8、鞍=紅褐衣服 y1.42);
  驢特徵:大長耳往外撇(Cone 0.06×0.34)、白肚白鼻、短鬃、細尾末端一撮;HORSE_COATS=灰褐/深灰/淺棕三檔。
- 耶穌=`makeJesusRider`(白袍+深紅外袍披肩+褐髮),坐姿 group y=0.62,掛 horse.rig。
- 場景:猶大地土路+橄欖樹+棕櫚樹+遠處耶路撒冷城牆城門(buildJerusalem,北面 z-78 裝飾景)。

## 語音(人聲鐵律:預烤 mp3,不用 Web Speech)

- `voicePhrases.js`:PHRASES 10 句(雲哲旁白)+SCRIPTURES 2 節(曉臻,亞9:9/太21:9,cuv 查驗原文)。
- 結算引經文:零罰分唸亞9:9、有罰分唸太21:9(main.js finish case)。
- 重烤:`node scripts/gen-voice.mjs`(需網路;產物進 git,離線可玩)。

## identity

package name `donkey-jerusalem3d`;SW cache `donkey-jerusalem3d-nf1`;storage 鍵 `donkey-jerusalem3d-*`;
dev hook `window.__donkeyJerusalem3d`(+通用 `window.__game`);icon=驢駒側影+棕枝(深藍底)。

## 本機地雷(承母體)

- vite preview 接 `| head` 會被 SIGPIPE 收掉——背景跑不要接管線。
- 地面貼片要轉向:`rotation.order="YXZ"` 先 yaw 再倒平(XYZ 會鋸齒)。
- `[hidden]` 面板修正已內建(styles.css 底部)。
- 溝通一律繁體中文;聖經皮經文必先 cuv 查驗。

## 驗證/部署

- `node scripts/verify-donkey.mjs <url> <outDir>`:完美驢駒(零罰分)/全程不按(受驚)/換毛色,0 pageerror。
- 尚未部署(2026-07-16):建 repo 名 `donkey-jerusalem3d`、Netlify 站名 `hfpc-donkey-jerusalem3d`(由主線統一 ship)。
