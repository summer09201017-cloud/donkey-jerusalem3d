import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";

// —— 騎驢進耶路撒冷(donkey-jerusalem3d)——聖經皮騎乘遊戲(棕枝主日,太21:1-11)。
// fork 自 equestrian3d(騎乘引擎的家);引擎判定原封不動,只換語意與皮。
// ★玩家=小驢駒,馱著主耶穌走進耶路撒冷——不操控耶穌,耶穌只是安坐。
// 玩法核心:驢駒沿土路自動前行(CatmullRom 閉環),玩家只管兩件事——
//   ①節奏控速(按住 W/↑ 或「快步」鈕=快步,放開=收步)②人群湧上來時抓綠區「穩步通過」。
// ★判定=畫面(鐵則4):按下當下就用時機誤差算出「穩穩通過/受驚」,再把步伐演出來;
//   棕枝在驢駒通過後歡快搖動——畫面說不通的罰分=bug。
// ★溫柔規則:不會摔、不會淘汰;沒按=驢駒自己撐一下(多半受驚),永遠走得完。

// ---------- 可調量值 ----------
// window=起跳時機窗(秒,skijump 綠區同款);boost=加速增量;timeAllowed=容許時間(超時每 4 秒+1 罰分)
export const DIFFICULTY_PRESETS = {
  // 07-15 使用者回報「太容易」→ 全檔收緊:窗更窄、馬更快、時間更緊(幼兒保持友善)
  kids: { baseSpeed: 7.0, boost: 2.5, window: 0.32, fences: 6, timeAllowed: 999, assist: 0.5 },
  child: { baseSpeed: 8.2, boost: 3.0, window: 0.21, fences: 7, timeAllowed: 105, assist: 0.3 },
  easy: { baseSpeed: 9.4, boost: 3.6, window: 0.15, fences: 8, timeAllowed: 82, assist: 0.12 },
  normal: { baseSpeed: 10.6, boost: 4.2, window: 0.105, fences: 9, timeAllowed: 66, assist: 0 },
  hard: { baseSpeed: 11.8, boost: 5.0, window: 0.075, fences: 11, timeAllowed: 56, assist: 0 },
};

export const DIFFICULTY_LABELS = {
  kids: "幼兒(超簡單)",
  child: "兒童(簡單)",
  easy: "入門",
  normal: "標準",
  hard: "職業",
};

export const GAME_MODES = {
  standard: {
    label: "進城之路",
    description: "馱著主耶穌走完全程=進耶路撒冷——受驚 +4 罰分、超時再加罰;零罰分=又忠心又良善!",
    goal: "穩步通過歡呼人群",
  },
  practice: {
    label: "練習小路",
    endless: true,
    description: "無限圈數自由練——熟悉節奏與綠區穩步的手感。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.standard;
}

// ---------- 驢駒的毛色(灰褐/深灰/淺棕三檔) ----------
export const HORSE_COATS = {
  greybrown: { label: "灰褐", coat: 0x8a7f72, mane: 0x4a4038 },
  darkgrey: { label: "深灰", coat: 0x5f5a54, mane: 0x2e2a26 },
  lightbrown: { label: "淺棕", coat: 0xa89070, mane: 0x5a4a36 },
};

// ---------- 場地常數 ----------
const TAKEOFF_D = 2.6; // 理想穩步點:人群站前 2.6m(判定用時間域 err=|distToFence-TAKEOFF_D|/speed)
const JUMP_SPAN = 4.4; // 一次穩步通過的路徑長(m)
const APPROACH_M = 14; // 進入「備妥」提示的距離
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 人物(照抄 archery3d makePerson:臉部鐵則+關節人物鐵則+長腿) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

function makePerson({ shirt = 0x2f6f4e, pants = 0x2a3550, skin = 0xf3cca6, hair = 0x2b2119, gender = "m", scale = 1 } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), shirtMat);
  chest.position.y = 1.42;
  rig.add(chest);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = 1.88;
  rig.add(neck);
  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), shirtMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  const beltLine = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.6 }));
  beltLine.position.y = -0.15;
  waist.add(beltLine);
  rig.add(waist);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = 2.12;
  rig.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, 2.11, 0);
  rig.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  rig.add(earR);

  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat);
  hairCap.position.y = 2.13;
  hairCap.rotation.x = -0.22;
  rig.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 16, 8, Math.PI, Math.PI, Math.PI * 0.35, Math.PI * (gender === "f" ? 0.38 : 0.22)),
    hairMat,
  );
  hairBack.position.y = 2.12;
  rig.add(hairBack);

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, 2.18, 0.21);
  rig.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  rig.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, 2.18, 0.25);
  rig.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  rig.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, 2.26, 0.22);
  browL.rotation.z = 0.16;
  rig.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  rig.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, 2.04, 0.21);
  smile.rotation.z = Math.PI;
  rig.add(smile);
  // smile 一併回傳:角色皮要換嘴(如金牙)時把原生嘴關掉,避免雙嘴

  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: shirtMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, 1.72, 0);
    arm.joint.rotation.x = -0.18;
    rig.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: shoeMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072,
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    leg.pivot.rotation.x = -0.05;
    leg.joint.rotation.x = 0.1;
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg, smile };
}

// ---------- 耶穌(引擎控 NPC:玩家操控的是驢駒,耶穌只是安坐) ----------
// 白袍+深紅外袍披肩(兩片 Box 從肩垂下)+褐髮+溫柔坐姿。
function makeJesusRider() {
  const rider = makePerson({
    shirt: 0xf2efe6, // 白袍
    pants: 0xf2efe6, // 同色(袍子蓋到腿)
    hair: 0x4a3120, // 褐髮
    gender: "f", // 借長髮版後腦髮(及肩長髮)
    scale: 0.95,
  });
  // 兩側垂髮(及肩)
  const hairSideMat = new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.85 });
  for (const x of [-0.21, 0.21]) {
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.14), hairSideMat);
    lock.position.set(x, 1.97, -0.03);
    rider.rig.add(lock);
  }
  // 深紅外袍披肩:兩片布從肩前垂下+後背一片,溫柔莊重
  const mantleMat = new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.85, side: THREE.DoubleSide });
  for (const x of [-0.19, 0.19]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.86, 0.05), mantleMat);
    strip.position.set(x, 1.4, 0.17);
    strip.rotation.x = -0.08;
    rider.rig.add(strip);
  }
  const mantleBack = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.05), mantleMat);
  mantleBack.position.set(0, 1.42, -0.19);
  rider.rig.add(mantleBack);
  // 肩上披肩環(蓋住肩線,讓前後片連起來)
  const shoulderWrap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.4), mantleMat);
  shoulderWrap.position.set(0, 1.76, 0);
  rider.rig.add(shoulderWrap);
  return rider;
}

// 溫柔坐姿(沿用騎乘引擎坐姿 rotation;鞍=鋪的衣服較低,group y 依新鞍高調整)
function poseJesusOnDonkey(rider) {
  rider.leftLeg.pivot.rotation.x = -1.25;
  rider.leftLeg.pivot.rotation.z = 0.5;
  rider.leftLeg.joint.rotation.x = 1.5;
  rider.rightLeg.pivot.rotation.x = -1.25;
  rider.rightLeg.pivot.rotation.z = -0.5;
  rider.rightLeg.joint.rotation.x = 1.5;
  rider.leftArm.pivot.rotation.x = -0.95;
  rider.leftArm.joint.rotation.x = -0.5;
  rider.rightArm.pivot.rotation.x = -0.95;
  rider.rightArm.joint.rotation.x = -0.5;
  rider.group.position.set(0, 0.62, 0.1); // 驢駒鞍高 1.42 → 騎者 group y≈0.62
  rider.group.scale.setScalar(0.95);
}

// ---------- 小驢駒(矩形身體鐵則的四足版,整體比馬小;介面與馬相同) ----------
// 驢特徵:大長耳往外撇、灰褐毛、白肚白鼻、短鬃、細尾末端一撮。
function makeDonkey({ coat = 0x8a7f72, mane = 0x4a4038 } = {}) {
  const group = new THREE.Group(); // 原點=地面、+z 朝前
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.7 });
  const maneMat = new THREE.MeshStandardMaterial({ color: mane, roughness: 0.85 });
  // 材質共用:setHorseCoat 只要改這兩個材質的 color,全身(含頸/頭/腿)一起換
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 }); // 白肚白鼻
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });

  const rig = new THREE.Group();
  group.add(rig);

  // 軀幹:矩形箱體(小驢駒,比馬小一號),不用圓筒
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.3), coatMat);
  body.position.set(0, 1.15, 0);
  rig.add(body);
  const chestCap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.32), coatMat);
  chestCap.position.set(0, 1.18, 0.72);
  rig.add(chestCap);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.34), coatMat);
  rump.position.set(0, 1.16, -0.72);
  rig.add(rump);
  // 白肚(驢特徵)
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 1.0), whiteMat);
  belly.position.set(0, 0.94, 0);
  rig.add(belly);

  // 頸(斜上)+頭(兩側眼睛=臉部鐵則動物版)+大長耳
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.35, 0.8);
  rig.add(neckPivot);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.52, 0.28), coatMat);
  neck.rotation.x = 0.7;
  neck.position.set(0, 0.18, 0.14);
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.44, 0.36);
  neckPivot.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.42), coatMat);
  skull.rotation.x = 0.35;
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.19, 0.26), whiteMat); // 白鼻(驢特徵)
  muzzle.position.set(0, -0.1, 0.28);
  muzzle.rotation.x = 0.35;
  head.add(muzzle);
  const faceWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const faceDarkMat = new THREE.MeshBasicMaterial({ color: 0x1c1712 });
  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), faceWhiteMat);
    eyeWhite.position.set(side * 0.12, 0.06, 0.12);
    head.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDarkMat);
    pupil.position.set(side * 0.142, 0.06, 0.13);
    head.add(pupil);
    // 大長耳(驢的招牌):細長圓錐往外撇
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 6), coatMat);
    ear.position.set(side * 0.11, 0.3, -0.04);
    ear.rotation.z = side * -0.42; // 往外撇
    ear.rotation.x = -0.15;
    head.add(ear);
    const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.2, 6), whiteMat);
    earInner.position.set(side * 0.115, 0.29, -0.01);
    earInner.rotation.z = side * -0.42;
    earInner.rotation.x = -0.15;
    head.add(earInner);
  }
  // 短鬃(驢的鬃毛短短一排立著,不像馬那樣長披)
  const maneCrest = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.56, 0.14), maneMat);
  maneCrest.rotation.x = 0.7;
  maneCrest.position.set(0, 0.26, -0.03);
  neckPivot.add(maneCrest);
  const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.1), maneMat);
  forelock.position.set(0, 0.2, 0.06);
  head.add(forelock);

  // 細尾+末端一撮(驢特徵)
  const tail = new THREE.Group();
  tail.position.set(0, 1.12, -0.92);
  tail.rotation.x = 0.55;
  const tailShaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), coatMat);
  tailShaft.position.y = -0.18;
  tail.add(tailShaft);
  const tailTuft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), maneMat);
  tailTuft.position.y = -0.44;
  tail.add(tailTuft);
  rig.add(tail);

  // 四腿(雙節+蹄):pivot=肩/髖(短腿=小驢駒)
  const mkLeg = (x, z) => {
    const leg = createLimb({
      upperMaterial: coatMat,
      lowerMaterial: coatMat,
      endMaterial: hoofMat,
      upperLen: 0.42, lowerLen: 0.4, upperRadius: 0.065, lowerRadius: 0.05,
      end: "foot",
    });
    leg.pivot.position.set(x, 0.95, z);
    rig.add(leg.pivot);
    return leg;
  };
  const legs = [
    mkLeg(-0.17, 0.54),
    mkLeg(0.17, 0.54),
    mkLeg(-0.17, -0.58),
    mkLeg(0.17, -0.58),
  ];

  // 鞍=門徒鋪上的衣服(太21:7):紅褐布兩層,沒有馬鞍
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.66), new THREE.MeshStandardMaterial({ color: 0x8a3b28, roughness: 0.9 }));
  saddle.position.set(0, 1.42, 0.05);
  rig.add(saddle);
  const cloth2 = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.04, 0.56), new THREE.MeshStandardMaterial({ color: 0xb06a3c, roughness: 0.9 }));
  cloth2.position.set(0, 1.39, 0.05);
  rig.add(cloth2);

  return { group, rig, body, neckPivot, head, tail, legs, saddle, coatMat, maneMat };
}

export class DonkeyJourneyGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "standard";
    this.mode = getModeConfig(this.modeId);
    this.coatId = HORSE_COATS[settings.horseCoat] ? settings.horseCoat : "greybrown";

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用(athletics this.running 撞名事故鐵則)
    this.time = 0;
    this.phase = "menu"; // menu | gate | riding | jumping | ended
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播 2 高空 3 驢背視角
    this.autoSaveTimer = 0;

    // 賽況
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.faults = 0;
    this.clears = 0;
    this.fenceIdx = 0;
    this.lastResult = null; // 'clear' | 'knock' | 'early' | null
    this.jumpAnim = null; // {t, dur, quality, height, fence}
    this.gallopT = 0;
    this.finishDist = 0;
    this.lap = 1;
    this.knockAnims = [];

    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc4e8);
    this.scene.fog = new THREE.Fog(0x9fd0ee, 60, 160);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 240);
    this.camPos = new THREE.Vector3(0, 6, -14);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.buildCourse();
    this.setupScene();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 賽道(閉環樣條)+障礙 ----------
  buildCourse() {
    const pts = [];
    const RX = 30, RZ = 21;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const w = i % 2 === 0 ? 1.0 : 1.14; // 交錯外凸=直線與彎道交替的有機環
      pts.push(new THREE.Vector3(Math.cos(a) * RX * w, 0, Math.sin(a) * RZ * w));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    this.courseLen = this.curve.getLength();
  }

  posAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getPointAt(u);
  }

  tangentAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getTangentAt(u);
  }

  // 歡呼人群站(原欄架,判定不動只換皮):兩側各 2-3 個群眾揮棕枝,地上鋪彩衣。
  rebuildFences() {
    if (this.fenceGroup) this.scene.remove(this.fenceGroup);
    this.fenceGroup = new THREE.Group();
    this.fences = [];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const n = preset.fences;
    const clothColors = [0xd8433c, 0x3f7be0, 0xf6d743, 0x4fae6a, 0xc890ff, 0xe07a3f];
    const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x4fae5a, roughness: 0.8, side: THREE.DoubleSide });
    const palmStemMat = new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 0.9 });
    for (let i = 0; i < n; i += 1) {
      const d = this.courseLen * ((i + 1) / (n + 1));
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const yaw = Math.atan2(t.x, t.z);
      const g = new THREE.Group();
      g.position.copy(p);
      g.rotation.y = yaw;
      const palms = [];
      // 兩側各 2-3 個歡呼群眾,舉手揮棕枝(面向路中央)
      for (const side of [-1, 1]) {
        const count = 2 + ((i + (side > 0 ? 1 : 0)) % 2);
        for (let j = 0; j < count; j += 1) {
          const person = makePerson({
            shirt: clothColors[(i * 2 + j + (side > 0 ? 3 : 0)) % clothColors.length],
            pants: 0x8a7a5c,
            hair: HAIR_COLORS[(i + j * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
            gender: (j + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
            scale: 0.82,
          });
          person.group.position.set(side * (2.0 + j * 0.9), 0, (j - (count - 1) / 2) * 1.2);
          person.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          // 靠路那隻手臂高舉揮棕枝
          const arm = side > 0 ? person.rightArm : person.leftArm;
          arm.pivot.rotation.x = -2.6;
          arm.joint.rotation.x = -0.2;
          const palm = new THREE.Group();
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.022, 0.66, 6), palmStemMat);
          stem.position.y = 0.33;
          palm.add(stem);
          for (let k = 0; k < 5; k += 1) {
            const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.44), palmLeafMat);
            leaf.position.set(0, 0.6 + (k % 2) * 0.05, 0);
            leaf.rotation.z = (k - 2) * 0.5;
            leaf.rotation.y = (k % 2) * 0.7;
            palm.add(leaf);
          }
          palm.position.set(0, -0.32, 0); // 掛在手末端
          palm.rotation.x = Math.PI; // 手臂舉起後局部 +y 朝下——翻轉讓棕枝沿手臂延伸方向(朝上)展開
          arm.joint.add(palm);
          palms.push(palm);
          g.add(person.group);
        }
      }
      // 地上鋪的衣服(太21:8「眾人多半把衣服鋪在路上」):彩色布片
      for (let c = 0; c < 4; c += 1) {
        const cloth = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 1.2),
          new THREE.MeshStandardMaterial({ color: clothColors[(i + c * 2) % clothColors.length], roughness: 1, side: THREE.DoubleSide }),
        );
        cloth.rotation.x = -Math.PI / 2;
        cloth.rotation.z = (c - 1.5) * 0.5;
        cloth.position.set((c % 2 === 0 ? -1 : 1) * 0.45, 0.02 + c * 0.004, (c - 1.5) * 1.15);
        g.add(cloth);
      }
      this.fenceGroup.add(g);
      this.fences.push({ dist: d, group: g, palms, knocked: false, resolved: false });
    }
    this.scene.add(this.fenceGroup);
    this.knockAnims = [];
  }

  // ---------- 場景 ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, 0x557040, 1.3);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff2d4, 1.9);
    key.position.set(30, 50, -20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    // 猶大地:乾草原+土路廣場
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshStandardMaterial({ color: 0x9c8f5e, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    this.scene.add(grass);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), new THREE.MeshStandardMaterial({ color: 0xc9b088, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    this.scene.add(sand);

    // 場邊矮石牆(猶大地田邊常見的乾砌石牆)
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xa89a80, roughness: 0.95 });
    const mkWall = (w, x, z, rot = 0) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, 0.5), stoneMat);
      r.position.set(x, 0.28, z);
      r.rotation.y = rot;
      this.scene.add(r);
    };
    mkWall(96, 0, 36);
    mkWall(96, 0, -36);
    mkWall(72, 48, 0, Math.PI / 2);
    mkWall(72, -48, 0, Math.PI / 2);

    // 土路帶(把路線畫在地上,孩子一眼看懂要走哪)
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xd8c49a });
    for (let i = 0; i < 120; i += 1) {
      const d = (i / 120) * this.courseLen;
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), laneMat);
      dot.rotation.order = "YXZ"; // 先繞 y 對齊路徑方向,再倒平到地面(XYZ 順序會變鋸齒)
      dot.rotation.y = Math.atan2(t.x, t.z);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(p.x, 0.012, p.z);
      this.scene.add(dot);
    }

    // 小驢駒+安坐的耶穌(玩家操控驢駒,不操控耶穌);毛色照設定
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.greybrown;
    this.horse = makeDonkey({ coat: coat.coat, mane: coat.mane });
    this.scene.add(this.horse.group);
    this.rider = makeJesusRider();
    poseJesusOnDonkey(this.rider);
    this.horse.rig.add(this.rider.group);

    this.buildCrowd();
    this.rebuildFences();

    // 城外群眾的土台(原觀眾席)
    const standMat = new THREE.MeshStandardMaterial({ color: 0xb0a084, roughness: 0.9 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(60, 3.2, 5), standMat);
      stand.position.set(0, 1.6, side * 41.5);
      this.scene.add(stand);
    }

    // 橄欖樹(灰綠樹冠+矮壯樹幹)
    const oliveMat = new THREE.MeshStandardMaterial({ color: 0x708a5a, roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b533a, roughness: 0.95 });
    for (const [x, z] of [[-62, 20], [-58, -18], [60, 24], [64, -10], [-30, 55], [25, 58], [0, -60], [40, -55]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.4, 8), trunkMat);
      trunk.position.set(x, 1.2, z);
      this.scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 10), oliveMat);
      crown.scale.set(1.15, 0.8, 1.15);
      crown.position.set(x, 3.6, z);
      this.scene.add(crown);
    }

    // 沿途棕櫚樹(棕枝的來源)
    const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7048, roughness: 0.95 });
    const palmLeafMat2 = new THREE.MeshStandardMaterial({ color: 0x4fae5a, roughness: 0.85, side: THREE.DoubleSide });
    for (const [x, z] of [[-42, 6], [40, -14], [-14, -42], [18, 42], [50, 12], [-50, -8]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 4.6, 8), palmTrunkMat);
      trunk.position.set(x, 2.3, z);
      this.scene.add(trunk);
      for (let k = 0; k < 6; k += 1) {
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.4), palmLeafMat2);
        const a = (k / 6) * Math.PI * 2;
        leaf.position.set(x + Math.cos(a) * 0.8, 4.7, z + Math.sin(a) * 0.8);
        leaf.rotation.order = "YXZ";
        leaf.rotation.y = -a + Math.PI / 2;
        leaf.rotation.x = -1.05;
        this.scene.add(leaf);
      }
    }

    // 遠處耶路撒冷城牆與城門(終點意象,霧裡遠望)
    this.buildJerusalem();

    this.placeHorse();
  }

  // 耶路撒冷城牆+城門(裝飾景,放在北面遠處)
  buildJerusalem() {
    const city = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd8c8a4, roughness: 0.95 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x5a4a34, roughness: 0.9 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(150, 9, 4), wallMat);
    wall.position.set(0, 4.5, 0);
    city.add(wall);
    // 城齒(雉堞)
    for (let i = 0; i < 25; i += 1) {
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 4.2), wallMat);
      merlon.position.set(-72 + i * 6, 9.7, 0);
      city.add(merlon);
    }
    // 城門雙塔+門洞(終點的門)
    for (const side of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 15, 7), wallMat);
      tower.position.set(side * 7.5, 7.5, 0.6);
      city.add(tower);
      const towerTop = new THREE.Mesh(new THREE.BoxGeometry(8, 1.6, 8), darkMat);
      towerTop.position.set(side * 7.5, 15.6, 0.6);
      city.add(towerTop);
    }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(8.5, 3.5, 4.4), wallMat);
    arch.position.set(0, 9.2, 0.4);
    city.add(arch);
    const gateway = new THREE.Mesh(new THREE.BoxGeometry(5.4, 7.5, 4.6), darkMat); // 敞開的門洞
    gateway.position.set(0, 3.75, 0.4);
    city.add(gateway);
    // 牆後幾座城內屋頂(剪影感)
    for (const [x, h, w] of [[-32, 6, 10], [-16, 8, 8], [24, 7, 12], [42, 5.5, 9], [8, 6.5, 7]]) {
      const house = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), wallMat);
      house.position.set(x, h / 2 + 2, -9);
      city.add(house);
    }
    city.position.set(0, 0, -78);
    this.scene.add(city);
  }

  buildCrowd() {
    // 城外群眾(原觀眾席人群):臉朝路中,男女各半(07-11 鐵則:觀眾要有臉)
    this.crowd = new THREE.Group();
    const shirts = [0xd98a3d, 0x3d78d9, 0xc94f8f, 0x4fae6a, 0xb0552f, 0x8a5ac0];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i += 1) {
        const p = makePerson({
          shirt: shirts[(i + (side > 0 ? 3 : 0)) % shirts.length],
          pants: 0x8a7a5c,
          hair: HAIR_COLORS[(i * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
          gender: (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
          scale: 0.92,
        });
        p.group.position.set(-27 + i * 9, 0, side * 38.2);
        p.group.rotation.y = side > 0 ? Math.PI : 0;
        this.crowd.add(p.group);
      }
    }
    this.scene.add(this.crowd);
  }

  placeHorse() {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    this.horse.group.position.set(p.x, this.jumpY(), p.z);
    this.horse.group.rotation.y = Math.atan2(t.x, t.z);
  }

  jumpY() {
    if (!this.jumpAnim) return 0;
    const k = clamp(this.jumpAnim.t, 0, 1);
    return Math.sin(Math.PI * k) * this.jumpAnim.height;
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.jump();
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId, horseCoat }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} · ${HORSE_COATS[this.coatId].label}驢駒 已設定。`;
    this.pushHud();
  }

  // 換毛色:全身共用 coatMat/maneMat,改材質色即可(不重建驢駒)
  setHorseCoat(coatId) {
    if (!HORSE_COATS[coatId]) return;
    this.coatId = coatId;
    if (this.horse) {
      this.horse.coatMat.color.setHex(HORSE_COATS[coatId].coat);
      this.horse.maneMat.color.setHex(HORSE_COATS[coatId].mane);
    }
  }

  openHomeMenu() {
    this.phase = "menu";
    if (this.confetti) {
      for (const c of this.confetti) this.scene.remove(c.mesh);
      this.confetti = [];
    }
    this.message = "在首頁選擇模式與難度後開始。";
    this.overlay.visible = false;
    this.pushHud();
  }

  startSelectedMatch() {
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.faults = 0;
    this.clears = 0;
    this.fenceIdx = 0;
    this.lastResult = null;
    this.jumpAnim = null;
    this.lap = 1;
    this.rebuildFences();
    this.finishDist = this.fences.length ? this.fences[this.fences.length - 1].dist + 22 : this.courseLen;
    this.knockSlowT = 9;
    this.placeHorse();
    // 出發鏡頭直接切到驢駒後方(joash 教訓:lerp 穿場=整幀糊掉)
    const t0 = this.tangentAt(0);
    const p0 = this.posAt(0);
    this.camPos.set(p0.x - t0.x * 9, 4.6, p0.z - t0.z * 9);
    this.camLook.set(p0.x, 1.4, p0.z);
    this.phase = "gate";
    this.message = "按「穩步鍵」出發!沿土路前行,人群湧上來時抓綠區穩住驢駒!";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  // 出發/穩步共用(空白鍵/點畫面/觸控穩步鍵)
  jump() {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.phase = "riding";
      this.speed = DIFFICULTY_PRESETS[this.difficulty].baseSpeed * 0.6;
      this.message = "出發!按住「快步」提速,放開收步穩節奏。";
      this.emitEvent("gate", {});
      this.pushHud();
      return;
    }
    if (this.phase !== "riding") return;
    const fence = this.fences[this.fenceIdx];
    if (!fence) return;
    const distToFence = fence.dist - this.dist;
    if (distToFence > APPROACH_M) {
      // 離人群還遠就按=小碎步一下,不罰但提示(溫柔)
      this.startJump(fence, 0.35, true);
      this.lastResult = "early";
      this.message = "太早了——等人群靠近、時機條進綠區再穩步!";
      this.emitEvent("fence-early", {});
      this.pushHud();
      return;
    }
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const err = Math.abs(distToFence - TAKEOFF_D) / Math.max(this.speed, 1);
    let quality = clamp(1 - err / (preset.window * 2.2), 0, 1); // skijump 綠區同款判定式
    quality = clamp(quality + preset.assist * (1 - quality), 0, 1); // 幼兒輔助:往綠區拉
    this.startJump(fence, quality, false);
  }

  startJump(fence, quality, hop) {
    const dur = (hop ? JUMP_SPAN * 0.6 : JUMP_SPAN) / Math.max(this.speed, 3);
    this.jumpAnim = {
      t: 0,
      dur,
      quality,
      height: hop ? 0.3 : 0.4 + quality * 0.25, // 驢駒=輕快穩步小跳,不是大騰躍
      fence: hop ? null : fence,
    };
    this.phase = "jumping";
    this.emitEvent("jump", { quality, hop });
  }

  resolveFence(fence, quality) {
    fence.resolved = true;
    const clean = quality >= 0.5; // 引擎判定不動:門檻 0.5
    if (clean) {
      this.clears += 1;
      this.lastResult = "clear";
      const perfect = quality >= 0.88;
      this.message = perfect ? "完美穩步!群眾揮棕枝高喊和散那!" : "穩穩通過!群眾歡呼揮棕枝!";
      this.knockAnims.push({ fence, t: 0, type: "cheer" }); // 判定=畫面:過標乾淨=棕枝歡快大幅揮舞
      this.emitEvent("fence-clear", { idx: this.fenceIdx + 1, perfect });
    } else {
      fence.knocked = true;
      this.faults += 4;
      this.lastResult = "knock";
      this.knockSlowT = 0; // 受驚=小踉蹌減速一下
      this.message = "驢駒受驚了!+4 罰分——輕輕安撫,下一站抓準綠區。";
      this.knockAnims.push({ fence, t: 0, type: "startle" }); // 判定=畫面:擦標=棕枝急促晃動(群眾不倒下)
      this.emitEvent("fence-knock", { idx: this.fenceIdx + 1, faults: this.faults });
    }
    this.fenceIdx += 1;
    // 練習小路:走完一輪重置人群站再來一圈(站點里程推進到下一圈)
    if (this.mode.endless && this.fenceIdx >= this.fences.length) {
      this.fenceIdx = 0;
      this.lap += 1;
      for (const f of this.fences) {
        f.resolved = false;
        f.knocked = false;
        f.dist += this.courseLen;
      }
      this.finishDist += this.courseLen;
    }
  }

  // 零罰分慶祝(07-15 使用者提議:天上掉彩花/花瓣/彩帶):
  // 尊重 prefers-reduced-motion;彩紙+花瓣+彩帶三種形狀,7 秒自然落完
  spawnConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!this.confetti) this.confetti = [];
    const colors = [0xffd24a, 0xff6b81, 0x7de08c, 0x6ec6ff, 0xc890ff, 0xffa050, 0xf5f0e0];
    const p = this.posAt(this.dist);
    for (let i = 0; i < 160; i += 1) {
      const kind = i % 3; // 0 彩紙方片 1 花瓣圓片 2 彩帶長條
      const geo = kind === 0
        ? new THREE.PlaneGeometry(0.16, 0.16)
        : kind === 1
          ? new THREE.CircleGeometry(0.1, 6)
          : new THREE.PlaneGeometry(0.06, 0.5);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(p.x + (Math.random() * 2 - 1) * 14, 8 + Math.random() * 7, p.z + (Math.random() * 2 - 1) * 14);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      this.confetti.push({
        mesh,
        vy: 1.2 + Math.random() * 1.6,
        swayA: Math.random() * Math.PI * 2,
        swayF: 1.5 + Math.random() * 2,
        spin: (Math.random() * 2 - 1) * 3,
        t: 0,
      });
    }
  }

  finishCourse() {
    this.phase = "ended";
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const overTime = Math.max(0, this.elapsed - preset.timeAllowed);
    const timeFaults = preset.timeAllowed >= 999 ? 0 : Math.ceil(overTime / 4);
    const total = this.faults + timeFaults;
    const timeText = `${this.elapsed.toFixed(1)} 秒`;
    const clearRound = total === 0;
    this.overlay = {
      visible: true,
      eyebrow: clearRound ? "又忠心又良善!" : "進城了",
      title: clearRound ? "溫柔的王進城了!" : `受驚罰分 ${total}`,
      text: clearRound
        ? `完美的一程!${timeText} 穩穩馱著主耶穌走進耶路撒冷。「看哪，你的王來到你這裡！他是公義的，並且施行拯救，謙謙和和地騎著驢，就是騎著驢的駒子。」(撒迦利亞書 9:9)`
        : `受驚 ${this.faults / 4} 次${timeFaults ? ` + 超時 ${timeFaults} 罰分` : ""},用時 ${timeText}。「和散那歸於大衛的子孫！奉主名來的是應當稱頌的！」(馬太福音 21:9)——再走一趟,朝零罰分前進!`,
      canResume: false,
    };
    if (clearRound) this.spawnConfetti();
    this.emitEvent("finish", { faults: total, elapsed: this.elapsed, clearRound });
    this.message = `進城了——罰分 ${total},${timeText}。`;
    this.saveGame(true);
    this.pushHud();
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "小驢駒也歇歇蹄,準備好再繼續。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 4;
    const names = ["跟隨視角", "側面視角", "高空俯瞰", "驢背視角"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;

    if (!paused && (this.phase === "riding" || this.phase === "jumping")) {
      this.elapsed += delta;
      const preset = DIFFICULTY_PRESETS[this.difficulty];
      const boosting = this.input.isDown("up") || this.input.isDown("sprint");
      const slowing = this.input.isDown("down");
      let target = preset.baseSpeed + (boosting ? preset.boost : 0) - (slowing ? 2.2 : 0);
      this.knockSlowT = (this.knockSlowT ?? 9) + delta;
      if (this.knockSlowT < 1.2) target *= 0.6; // 受驚=小踉蹌收步,馬上穩回來
      this.speed += (Math.max(3, target) - this.speed) * Math.min(1, delta * 1.8);
      this.dist += this.speed * delta;
      this.gallopT += delta * (this.speed / 8);

      if (this.phase === "jumping" && this.jumpAnim) {
        this.jumpAnim.t += delta / this.jumpAnim.dur;
        if (this.jumpAnim.t >= 1) {
          const jump = this.jumpAnim;
          this.jumpAnim = null;
          this.phase = "riding";
          if (jump.fence) this.resolveFence(jump.fence, jump.quality);
        }
      } else if (this.phase === "riding") {
        // 沒按穩步就衝進人群=驢駒自己撐一下(溫柔:不停不摔,但多半受驚)
        const fence = this.fences[this.fenceIdx];
        if (fence && fence.dist - this.dist <= 0.5 && !fence.resolved) {
          this.startJump(fence, 0.18, false);
          this.message = "來不及穩住——驢駒自己撐了一下!";
        }
      }

      if (!this.mode.endless && this.dist >= this.finishDist && this.phase !== "ended") {
        this.finishCourse();
      }
    }

    // 棕枝:平時輕輕搖曳;歡呼=大幅揮舞、受驚=急促晃動(群眾不倒下,判定=畫面)
    if (this.fences) {
      for (let i = 0; i < this.fences.length; i += 1) {
        const f = this.fences[i];
        for (let j = 0; j < f.palms.length; j += 1) {
          f.palms[j].rotation.z = Math.sin(this.time * 2.2 + i * 1.3 + j) * 0.14;
        }
      }
    }
    for (const k of this.knockAnims) {
      k.t += delta;
      const decay = Math.max(0, 1 - k.t / 1.4);
      const amp = k.type === "cheer" ? 0.55 : 0.35;
      const freq = k.type === "cheer" ? 7 : 16; // 歡呼=大幅揮舞;受驚=急促抖動
      for (const palm of k.fence.palms) {
        palm.rotation.z += Math.sin(k.t * freq) * amp * decay;
      }
    }
    this.knockAnims = this.knockAnims.filter((k) => k.t < 1.4);

    // 彩花飄落(零罰分慶祝):左右搖曳+自旋,7 秒淡出回收
    if (this.confetti && this.confetti.length) {
      for (const c of this.confetti) {
        c.t += delta;
        c.mesh.position.y -= c.vy * delta;
        c.mesh.position.x += Math.sin(c.swayA + c.t * c.swayF) * delta * 1.2;
        c.mesh.rotation.x += c.spin * delta;
        c.mesh.rotation.z += c.spin * 0.7 * delta;
        if (c.t > 5.5) c.mesh.material.opacity = Math.max(0, 0.95 * (1 - (c.t - 5.5) / 1.5));
      }
      this.confetti = this.confetti.filter((c) => {
        if (c.t >= 7 || c.mesh.position.y < -0.5) {
          this.scene.remove(c.mesh);
          return false;
        }
        return true;
      });
    }

    this.handleKeys();
    this.updateHorsePose();
    this.placeHorse();
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot")) this.jump();
  }

  updateHorsePose() {
    const h = this.horse;
    if (!h) return;
    if (this.phase === "jumping" && this.jumpAnim) {
      // 起跳:前腿收、後腿蹬、身體沿弧線俯仰;騎手前傾(two-point 跳姿)
      const k = clamp(this.jumpAnim.t, 0, 1);
      const pitch = Math.cos(Math.PI * k) * 0.35;
      h.rig.rotation.x = -pitch;
      h.rig.position.y = 0;
      const tuck = Math.sin(Math.PI * k);
      h.legs[0].pivot.rotation.x = -1.3 * tuck;
      h.legs[1].pivot.rotation.x = -1.3 * tuck;
      h.legs[0].joint.rotation.x = 1.8 * tuck;
      h.legs[1].joint.rotation.x = 1.8 * tuck;
      h.legs[2].pivot.rotation.x = 0.85 * tuck;
      h.legs[3].pivot.rotation.x = 0.85 * tuck;
      h.legs[2].joint.rotation.x = 0.5 * tuck;
      h.legs[3].joint.rotation.x = 0.5 * tuck;
      h.neckPivot.rotation.x = -0.25 + pitch * 0.4;
      if (this.rider) this.rider.rig.rotation.x = 0.4 * tuck;
      return;
    }
    // 奔跑循環:相位錯開的四腿擺動(簡化 canter)
    const sp = this.phase === "riding" ? this.speed : 0;
    const amp = clamp(sp / 14, 0, 0.62);
    const t = this.gallopT * Math.PI * 2;
    const phases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    h.legs.forEach((leg, i) => {
      leg.pivot.rotation.x = Math.sin(t + phases[i]) * amp;
      leg.joint.rotation.x = Math.max(0, Math.sin(t + phases[i] + 0.8)) * amp * 1.3;
    });
    h.rig.rotation.x = 0;
    h.rig.position.y = Math.abs(Math.sin(t)) * amp * 0.14;
    h.neckPivot.rotation.x = Math.sin(t) * amp * 0.12;
    h.tail.rotation.x = 0.55 + Math.sin(t * 0.9) * 0.15;
    if (this.rider) this.rider.rig.rotation.x = amp * 0.18;
  }

  updateCamera(delta) {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    const y = this.jumpY();
    let desiredPos;
    let desiredLook;
    if (this.phase === "menu") {
      // 選單:慢速繞場巡禮
      const a = this.time * 0.08;
      desiredPos = new THREE.Vector3(Math.cos(a) * 40, 12, Math.sin(a) * 40);
      desiredLook = new THREE.Vector3(0, 1, 0);
    } else if (this.cameraView === 0) {
      desiredPos = new THREE.Vector3(p.x - t.x * 8.6, 4.4 + y * 0.5, p.z - t.z * 8.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 7, 1.3 + y, p.z + t.z * 7);
    } else if (this.cameraView === 1) {
      const side = new THREE.Vector3(t.z, 0, -t.x);
      desiredPos = new THREE.Vector3(p.x + side.x * 13, 3.6, p.z + side.z * 13);
      desiredLook = new THREE.Vector3(p.x, 1.2 + y, p.z);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(p.x + 3, 26, p.z + 3);
      desiredLook = new THREE.Vector3(p.x + t.x * 6, 0.5, p.z + t.z * 6);
    } else {
      desiredPos = new THREE.Vector3(p.x - t.x * 0.6, 2.5 + y, p.z - t.z * 0.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 12, 1.2 + y, p.z + t.z * 12);
    }
    const k = 1 - Math.exp(-delta * 3.2);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const fence = this.fences && this.fences[this.fenceIdx];
    const distToFence = fence ? Math.max(0, fence.dist - this.dist) : null;
    // 穩步時機條:進 APPROACH_M 內開始充,到理想穩步點=滿;err<window=綠區
    let approach01 = 0;
    let inWindow = false;
    if ((this.phase === "riding" || this.phase === "jumping") && fence && distToFence !== null && distToFence <= APPROACH_M) {
      approach01 = clamp(1 - (distToFence - TAKEOFF_D) / (APPROACH_M - TAKEOFF_D), 0, 1);
      const err = Math.abs(distToFence - TAKEOFF_D) / Math.max(this.speed, 1);
      inWindow = err <= preset.window;
    }
    const phaseLabels = { menu: "主選單", gate: "出發點", riding: "前行", jumping: "穩步", ended: "進城" };
    const mins = Math.floor(this.elapsed / 60);
    const secs = (this.elapsed % 60).toFixed(1).padStart(4, "0");
    this.onHudUpdate({
      faults: this.faults,
      clears: this.clears,
      fenceIdx: this.fences && this.fences.length ? Math.min(this.fenceIdx + 1, this.fences.length) : 1,
      fenceCount: this.fences ? this.fences.length : 0,
      lap: this.lap,
      endless: !!this.mode.endless,
      timeText: `${mins}:${secs}`,
      timeAllowed: preset.timeAllowed >= 999 ? "不限時" : preset.timeAllowed + " 秒",
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.speed / (preset.baseSpeed + preset.boost), 0, 1),
      speedText: `${(this.speed * 3.6).toFixed(0)} km/h`,
      approach01,
      inWindow,
      nextFenceText: distToFence === null ? "—" : distToFence > 90 ? "進城門!" : `${distToFence.toFixed(0)} m`,
      lastResult: this.lastResult,
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(記最佳成績,不存賽中進度) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, bestFaults: prev.bestFaults, bestTime: prev.bestTime };
    if (this.phase === "ended" && !this.mode.endless) {
      const better =
        prev.bestFaults === undefined ||
        this.faults < prev.bestFaults ||
        (this.faults === prev.bestFaults && this.elapsed < (prev.bestTime ?? Infinity));
      if (better) {
        snapshot.bestFaults = this.faults;
        snapshot.bestTime = this.elapsed;
      }
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    this.openHomeMenu();
    this.message = snap.bestFaults !== undefined
      ? `最佳成績:罰分 ${snap.bestFaults}、${(snap.bestTime || 0).toFixed(1)} 秒——挑戰它!`
      : "尚無最佳成績,先跑一場吧!";
    this.pushHud();
    return true;
  }
}
