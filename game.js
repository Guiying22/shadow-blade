(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const W = 480;
  const H = 270;
  const TAU = Math.PI * 2;
  const PIXEL_FONT = '"Courier New", "Lucida Console", monospace';

  const ARENA = { left: 34, right: 446, top: 118, bottom: 250 };
  const PLAYER_SPEED = 105;
  const DODGE_SPEED = 250;
  const DODGE_TIME = 0.26;
  const DODGE_CD = 0.8;
  const ATTACK_CD = 0.34;
  const ATTACK_REACH = 62;
  const PLAYER_DAMAGE = 14;
  const CRIT_MULT = 1.5;
  const BUFF_TIME = 5;

  const UI = {
    overlay: document.getElementById("overlay"),
    kicker: document.getElementById("ovKicker"),
    title: document.getElementById("ovTitle"),
    text: document.getElementById("ovText"),
    controls: document.getElementById("ovControls"),
    stats: document.getElementById("ovStats"),
    primaryBtn: document.getElementById("primaryBtn"),
    press: document.getElementById("ovPress"),
    callout: document.getElementById("callout"),
    calloutTitle: document.getElementById("calloutTitle"),
    calloutSub: document.getElementById("calloutSub"),
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[(Math.random() * list.length) | 0];
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, "0");
    return m + ":" + s;
  }

  // ---------------------------------------------------------------------------
  // Tiny procedural audio. Everything is synthesized, no external assets.
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  let masterGain = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      audioCtx = new AudioCtor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.22;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, duration, options = {}) {
    if (!audioCtx || !masterGain) return;
    const {
      type = "square",
      volume = 0.16,
      slide = 0,
      delay = 0,
    } = options;
    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), start);
    if (slide) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), start + duration);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  function sfx(name) {
    if (!audioCtx) return;
    switch (name) {
      case "swing":
        tone(310, 0.09, { type: "triangle", volume: 0.12, slide: 110 });
        break;
      case "hit":
        tone(150, 0.1, { type: "square", volume: 0.13, slide: 60 });
        tone(70, 0.13, { type: "triangle", volume: 0.16, slide: 42 });
        break;
      case "crit":
        tone(105, 0.22, { type: "sawtooth", volume: 0.15, slide: 42 });
        tone(740, 0.13, { type: "square", volume: 0.08, slide: 280, delay: 0.015 });
        tone(1100, 0.1, { type: "square", volume: 0.055, slide: 580, delay: 0.06 });
        break;
      case "stun":
        tone(980, 0.12, { type: "sine", volume: 0.13, slide: 1500 });
        tone(1260, 0.16, { type: "sine", volume: 0.09, slide: 560, delay: 0.07 });
        break;
      case "dodge":
        tone(420, 0.13, { type: "sine", volume: 0.11, slide: 920 });
        break;
      case "perfect":
        tone(620, 0.1, { type: "triangle", volume: 0.12, slide: 820 });
        tone(930, 0.15, { type: "sine", volume: 0.12, delay: 0.07, slide: 1180 });
        tone(1380, 0.22, { type: "sine", volume: 0.09, delay: 0.15, slide: 1660 });
        break;
      case "warn":
        tone(280, 0.1, { type: "square", volume: 0.075, slide: 210 });
        tone(340, 0.12, { type: "square", volume: 0.055, slide: 260, delay: 0.12 });
        break;
      case "enemySlash":
        tone(150, 0.13, { type: "sawtooth", volume: 0.08, slide: 70 });
        break;
      case "hurt":
        tone(210, 0.18, { type: "sawtooth", volume: 0.16, slide: 65 });
        tone(90, 0.2, { type: "triangle", volume: 0.13, slide: 38 });
        break;
      case "enrage":
        tone(90, 0.35, { type: "sawtooth", volume: 0.14, slide: 180 });
        tone(180, 0.32, { type: "square", volume: 0.08, slide: 120, delay: 0.05 });
        break;
      case "win":
        tone(392, 0.18, { type: "triangle", volume: 0.1 });
        tone(523, 0.18, { type: "triangle", volume: 0.1, delay: 0.13 });
        tone(784, 0.4, { type: "triangle", volume: 0.11, delay: 0.26 });
        break;
      case "lose":
        tone(220, 0.3, { type: "sawtooth", volume: 0.12, slide: 130 });
        tone(150, 0.5, { type: "triangle", volume: 0.1, slide: 55, delay: 0.2 });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  const game = {
    mode: "start",
    clock: 0,
    playTime: 0,
    shake: 0,
    freeze: 0,
    slowmo: 0,
    flash: 0,
    flashColor: "#ffffff",
    ending: null,
    endingTimer: 0,
    lowHpWarned: false,
  };

  const player = {
    x: 156,
    y: 190,
    r: 7,
    facing: 1,
    hp: 100,
    maxHp: 100,
    displayHp: 100,
    attackCd: 0,
    attackAnim: 0,
    dodgeCd: 0,
    dodgeTimer: 0,
    dodgeDirX: 1,
    dodgeDirY: 0,
    lastDirX: 1,
    lastDirY: 0,
    buffTimer: 0,
    hurtFlash: 0,
    walkPhase: 0,
    moving: false,
    ghostTimer: 0,
    dustTimer: 0,
    ghosts: [],
    deadTime: 0,
  };

  const enemy = {
    x: 336,
    y: 170,
    r: 13,
    facing: -1,
    hp: 126,
    maxHp: 126,
    displayHp: 126,
    attackCd: 1.2,
    state: "idle",
    timer: 0,
    windupDuration: 0.68,
    attackAngle: Math.PI,
    hurtFlash: 0,
    walkPhase: 0,
    deadTime: 0,
    deathFxTimer: 0,
    enraged: false,
  };

  const stats = {
    perfect: 0,
    crits: 0,
    stuns: 0,
    hits: 0,
    damageDealt: 0,
    damageTaken: 0,
  };

  const particles = [];
  const damageNumbers = [];
  const slashes = [];
  const rings = [];

  const keys = new Set();

  // ---------------------------------------------------------------------------
  // Deterministic ambient scenery
  // ---------------------------------------------------------------------------
  const stars = [];
  const petals = [];
  const fireflies = [];

  for (let i = 0; i < 44; i += 1) {
    stars.push({
      x: rand(8, W - 8),
      y: rand(46, 106),
      size: Math.random() < 0.2 ? 2 : 1,
      phase: rand(0, TAU),
      speed: rand(0.7, 1.8),
    });
  }

  for (let i = 0; i < 18; i += 1) {
    petals.push({
      x: rand(-20, W + 20),
      y: rand(60, H),
      vx: rand(-9, -2),
      vy: rand(5, 13),
      size: Math.random() < 0.3 ? 2 : 1,
      phase: rand(0, TAU),
      alpha: rand(0.18, 0.42),
    });
  }

  for (let i = 0; i < 13; i += 1) {
    fireflies.push({
      baseX: rand(30, W - 30),
      baseY: rand(118, 245),
      phase: rand(0, TAU),
      speed: rand(0.35, 0.75),
      drift: rand(7, 17),
      size: Math.random() < 0.25 ? 2 : 1,
    });
  }

  function updateAmbient(dt) {
    for (const s of stars) {
      s.phase += dt * s.speed;
    }
    for (const p of petals) {
      p.phase += dt * 1.4;
      p.x += (p.vx + Math.sin(p.phase) * 4) * dt;
      p.y += p.vy * dt;
      if (p.y > H + 10 || p.x < -30) {
        p.x = rand(W + 10, W + 70);
        p.y = rand(50, 150);
        p.vx = rand(-11, -3);
        p.vy = rand(5, 13);
      }
    }
    for (const f of fireflies) {
      f.phase += dt * f.speed;
    }
  }

  // ---------------------------------------------------------------------------
  // UI / overlay
  // ---------------------------------------------------------------------------
  let calloutTimeout = null;

  function hideCallout() {
    UI.callout.classList.remove("show", "crit", "stun", "perfect", "enrage");
    if (calloutTimeout) {
      clearTimeout(calloutTimeout);
      calloutTimeout = null;
    }
  }

  function showCallout(title, sub, tone = "", duration = 1200) {
    if (calloutTimeout) clearTimeout(calloutTimeout);
    UI.calloutTitle.textContent = title;
    UI.calloutSub.textContent = sub || "";
    UI.callout.className = "callout";
    void UI.callout.offsetWidth;
    UI.callout.className = "callout show" + (tone ? " " + tone : "");
    calloutTimeout = setTimeout(() => {
      UI.callout.classList.remove("show");
      calloutTimeout = null;
    }, duration);
  }

  function statsMarkup() {
    return [
      '<span>战斗时间 <b>' + formatTime(game.playTime) + "</b></span>",
      "<span>完美闪避 <b>" + stats.perfect + "</b></span>",
      "<span>暴击 <b>" + stats.crits + "</b></span>",
      "<span>眩晕 <b>" + stats.stuns + "</b></span>",
      '<span class="stat-wide">造成伤害 <b>' + stats.damageDealt + "</b></span>",
    ].join("");
  }

  function showOverlay(kind) {
    const content = {
      start: {
        kicker: "PIXEL DUEL / 像素决斗",
        title: "影刃",
        text: "在红刃落下前的一瞬闪开。<br>完美闪避会让你的下一刀，粉碎敌人的架势。",
        controls: true,
        stats: false,
        button: "开始战斗",
        press: "按 <kbd>ENTER</kbd> 开始",
      },
      paused: {
        kicker: "PAUSED / 战斗暂停",
        title: "暂停",
        text: "深呼吸。刀锋不会等你。",
        controls: false,
        stats: false,
        button: "继续战斗",
        press: "按 <kbd>P</kbd> 或 <kbd>ENTER</kbd> 继续",
      },
      won: {
        kicker: "VICTORY / 胜利",
        title: "斩鬼",
        text: "鬼武者倒下了。你的刀，比恐惧更快。",
        controls: false,
        stats: true,
        button: "再战一场",
        press: "按 <kbd>ENTER</kbd> 再战",
      },
      lost: {
        kicker: "DEFEATED / 败北",
        title: "败北",
        text: "红刃穿过了你的防线。再来一次，读准它的节奏。",
        controls: false,
        stats: true,
        button: "重新挑战",
        press: "按 <kbd>ENTER</kbd> 重新挑战",
      },
    }[kind];

    if (!content) return;
    UI.kicker.textContent = content.kicker;
    UI.title.textContent = content.title;
    UI.text.innerHTML = content.text;
    UI.controls.hidden = !content.controls;
    UI.stats.hidden = !content.stats;
    if (content.stats) UI.stats.innerHTML = statsMarkup();
    UI.primaryBtn.textContent = content.button;
    UI.press.innerHTML = content.press;
    UI.overlay.classList.remove("hidden");
    hideCallout();
  }

  function hideOverlay() {
    UI.overlay.classList.add("hidden");
    UI.primaryBtn.blur();
  }

  // ---------------------------------------------------------------------------
  // Reset / flow
  // ---------------------------------------------------------------------------
  function resetWorld() {
    Object.assign(player, {
      x: 156,
      y: 190,
      r: 7,
      facing: 1,
      hp: 100,
      maxHp: 100,
      displayHp: 100,
      attackCd: 0,
      attackAnim: 0,
      dodgeCd: 0,
      dodgeTimer: 0,
      dodgeDirX: 1,
      dodgeDirY: 0,
      lastDirX: 1,
      lastDirY: 0,
      buffTimer: 0,
      hurtFlash: 0,
      walkPhase: 0,
      moving: false,
      ghostTimer: 0,
      dustTimer: 0,
      ghosts: [],
      deadTime: 0,
    });

    Object.assign(enemy, {
      x: 336,
      y: 170,
      r: 13,
      facing: -1,
      hp: 126,
      maxHp: 126,
      displayHp: 126,
      attackCd: 1.15,
      state: "idle",
      timer: 0,
      windupDuration: 0.68,
      attackAngle: Math.PI,
      hurtFlash: 0,
      walkPhase: 0,
      deadTime: 0,
      deathFxTimer: 0,
      enraged: false,
    });

    Object.assign(stats, {
      perfect: 0,
      crits: 0,
      stuns: 0,
      hits: 0,
      damageDealt: 0,
      damageTaken: 0,
    });

    particles.length = 0;
    damageNumbers.length = 0;
    slashes.length = 0;
    rings.length = 0;

    game.playTime = 0;
    game.shake = 0;
    game.freeze = 0;
    game.slowmo = 0;
    game.flash = 0;
    game.flashColor = "#ffffff";
    game.ending = null;
    game.endingTimer = 0;
    game.lowHpWarned = false;

    keys.clear();
    hideCallout();
  }

  function startGame() {
    ensureAudio();
    resetWorld();
    game.mode = "playing";
    hideOverlay();
    lastFrame = performance.now();
    setTimeout(() => {
      if (game.mode === "playing") {
        showCallout("对决开始", "闪开红刃，反击制胜", "", 900);
      }
    }, 180);
  }

  function togglePause() {
    if (game.mode === "playing" && !game.ending) {
      game.mode = "paused";
      keys.clear();
      showOverlay("paused");
    } else if (game.mode === "paused") {
      resumeGame();
    }
  }

  function resumeGame() {
    if (game.mode !== "paused") return;
    ensureAudio();
    game.mode = "playing";
    hideOverlay();
    lastFrame = performance.now();
  }

  function finishGame(result) {
    game.mode = result;
    game.ending = null;
    showOverlay(result);
    if (result === "won") sfx("win");
    else sfx("lose");
  }

  function beginEnding(result) {
    if (game.ending) return;
    game.ending = result;
    game.endingTimer = result === "won" ? 1.55 : 1.35;
    game.slowmo = result === "won" ? 0.65 : 0.3;
    game.freeze = Math.max(game.freeze, 0.08);

    if (result === "won") {
      enemy.state = "dead";
      enemy.hp = 0;
      enemy.deadTime = 0;
      enemy.deathFxTimer = 0;
      addBurst(enemy.x, enemy.y - 20, {
        count: 34,
        colors: ["#ff4d6d", "#ffc857", "#ffffff", "#7a2738"],
        speed: 150,
        size: 3,
        life: [0.4, 1.1],
        gravity: 190,
      });
      addRing(enemy.x, enemy.y - 16, "#ffc857", 92, 0.65, 3);
      game.shake = 10;
      game.flash = 1;
      game.flashColor = "#ffd27a";
    } else {
      player.hp = 0;
      player.deadTime = 0;
      player.dodgeTimer = 0;
      addBurst(player.x, player.y - 16, {
        count: 22,
        colors: ["#ff4d6d", "#5ee7ef", "#74394b", "#ffffff"],
        speed: 125,
        size: 2,
        life: [0.3, 0.9],
        gravity: 190,
      });
      game.shake = 9;
      game.flash = 1;
      game.flashColor = "#ff294d";
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const blockedKeys = new Set([
    "Space",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ]);

  window.addEventListener("keydown", (event) => {
    if (blockedKeys.has(event.code)) event.preventDefault();

    if (event.code === "Enter") {
      event.preventDefault();
      ensureAudio();
      if (game.mode === "paused") resumeGame();
      else if (game.mode !== "playing") startGame();
      return;
    }

    if (event.code === "KeyP" || event.code === "Escape") {
      event.preventDefault();
      togglePause();
      return;
    }

    if (event.code === "KeyR") {
      if (!event.repeat) startGame();
      return;
    }

    if (game.mode !== "playing" || game.ending) return;

    if (event.code === "Space" || event.code === "KeyK") {
      if (!event.repeat) tryDodge();
      return;
    }

    if (event.code === "KeyJ") {
      if (!event.repeat) tryAttack();
      return;
    }

    if (
      event.code === "KeyW" ||
      event.code === "KeyA" ||
      event.code === "KeyS" ||
      event.code === "KeyD" ||
      event.code === "ArrowUp" ||
      event.code === "ArrowDown" ||
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight"
    ) {
      keys.add(event.code);
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  window.addEventListener("blur", () => {
    keys.clear();
    if (game.mode === "playing" && !game.ending) togglePause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game.mode === "playing" && !game.ending) togglePause();
  });

  UI.primaryBtn.addEventListener("click", () => {
    ensureAudio();
    if (game.mode === "paused") resumeGame();
    else startGame();
  });

  function getMoveInput() {
    let x = 0;
    let y = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
    return { x, y };
  }

  function clampPlayer() {
    player.x = clamp(player.x, ARENA.left, ARENA.right);
    player.y = clamp(player.y, ARENA.top, ARENA.bottom);
  }

  function clampEnemy() {
    enemy.x = clamp(enemy.x, ARENA.left + 6, ARENA.right - 6);
    enemy.y = clamp(enemy.y, ARENA.top - 2, ARENA.bottom);
  }

  // ---------------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------------
  function tryDodge() {
    if (game.mode !== "playing" || game.ending) return;
    if (player.dodgeCd > 0 || player.dodgeTimer > 0) return;

    let input = getMoveInput();
    let dx = input.x;
    let dy = input.y;

    if (dx === 0 && dy === 0) {
      if (player.lastDirX !== 0 || player.lastDirY !== 0) {
        dx = player.lastDirX;
        dy = player.lastDirY;
      } else {
        dx = player.x < enemy.x ? -1 : 1;
        dy = 0;
      }
    }

    const mag = Math.hypot(dx, dy) || 1;
    player.dodgeDirX = dx / mag;
    player.dodgeDirY = dy / mag;
    player.lastDirX = player.dodgeDirX;
    player.lastDirY = player.dodgeDirY;
    player.dodgeTimer = DODGE_TIME;
    player.dodgeCd = DODGE_CD;
    player.ghostTimer = 0;
    player.dustTimer = 0;
    player.attackAnim = 0;

    addBurst(player.x, player.y - 2, {
      count: 7,
      colors: ["#8190a8", "#4e5c73", "#c6f5f9"],
      speed: 48,
      size: 2,
      life: [0.18, 0.4],
      gravity: -8,
    });
    addRing(player.x, player.y - 4, "#77dce6", 20, 0.22, 1);
    sfx("dodge");
  }

  function tryAttack() {
    if (game.mode !== "playing" || game.ending) return;
    if (player.attackCd > 0) return;

    player.attackCd = ATTACK_CD;
    player.attackAnim = 0.18;

    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const baseAngle = Math.atan2(dy, dx);
    player.facing = dx >= 0 ? 1 : -1;

    const length = Math.hypot(dx, dy) || 1;
    player.x += (dx / length) * 5;
    player.y += (dy / length) * 4;
    clampPlayer();

    addSlash(
      player.x,
      player.y - 14,
      baseAngle,
      32,
      1.5,
      0.16,
      "#d9fbff",
      3
    );
    addSlash(
      player.x,
      player.y - 14,
      baseAngle,
      38,
      1.2,
      0.13,
      "#5ee7ef",
      1
    );
    addBurst(player.x + Math.cos(baseAngle) * 16, player.y - 14 + Math.sin(baseAngle) * 16, {
      count: 4,
      colors: ["#c9f7ff", "#5ee7ef"],
      speed: 55,
      size: 1,
      life: [0.1, 0.25],
      gravity: 30,
      angle: baseAngle,
      spread: 1.4,
    });

    sfx("swing");

    if (enemy.hp <= 0) return;
    if (dist(player.x, player.y, enemy.x, enemy.y) > ATTACK_REACH) return;

    let critical = false;
    let stun = false;
    if (player.buffTimer > 0) {
      player.buffTimer = 0;
      if (Math.random() < 0.5) critical = true;
      else stun = true;
      addRing(player.x, player.y - 14, critical ? "#ffc857" : "#74eaff", 34, 0.34, 2);
      addBurst(player.x, player.y - 14, {
        count: 12,
        colors: critical
          ? ["#ffc857", "#fff1b8", "#ff8a3d"]
          : ["#74eaff", "#e9feff", "#4a92ff"],
        speed: 85,
        size: 2,
        life: [0.2, 0.45],
        gravity: -25,
      });
    }

    const damage = Math.round(PLAYER_DAMAGE * (critical ? CRIT_MULT : 1));
    applyEnemyDamage(damage, { critical, stun });
  }

  function applyEnemyDamage(damage, options = {}) {
    const { critical = false, stun = false } = options;
    const e = enemy;

    const hpBeforeHit = e.hp;
    e.hp = Math.max(0, e.hp - damage);
    e.hurtFlash = 0.16;
    stats.hits += 1;
    stats.damageDealt += hpBeforeHit - e.hp;

    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const length = Math.hypot(dx, dy) || 1;
    const knockback = critical ? 13 : 6;
    e.x += (dx / length) * knockback;
    e.y += (dy / length) * knockback;
    clampEnemy();

    addDamageNumber(
      e.x + rand(-4, 4),
      e.y - 39,
      String(damage),
      critical ? "#ffd36a" : "#f4fbff",
      critical ? 13 : 9,
      critical
    );
    addBurst(e.x, e.y - 22, {
      count: critical ? 20 : 10,
      colors: critical
        ? ["#ffc857", "#ff6c6c", "#fff2c5", "#ffffff"]
        : ["#ffb3ba", "#f4fbff", "#ff5d76", "#7b2b3c"],
      speed: critical ? 150 : 95,
      size: critical ? 3 : 2,
      life: [0.16, 0.55],
      gravity: 180,
    });

    game.shake = Math.max(game.shake, critical ? 7.5 : 3.4);
    game.freeze = Math.max(game.freeze, critical ? 0.075 : 0.035);
    game.flash = Math.max(game.flash, critical ? 0.55 : 0.16);
    game.flashColor = critical ? "#ffc857" : "#ffffff";

    if (critical) {
      stats.crits += 1;
      showCallout("暴击！", "1.5× 伤害 · " + damage, "crit", 1250);
      sfx("crit");
    }

    if (stun && e.hp > 0) {
      stats.stuns += 1;
      e.state = "stunned";
      e.timer = 1.6;
      e.attackAngle = Math.atan2(player.y - e.y, player.x - e.x);
      showCallout("眩晕！", "敌人失去行动能力 · 1.6 秒", "stun", 1250);
      addRing(e.x, e.y - 25, "#8df4ff", 36, 0.42, 2);
      addBurst(e.x, e.y - 32, {
        count: 16,
        colors: ["#8df4ff", "#ffffff", "#ffc857"],
        speed: 70,
        size: 2,
        life: [0.35, 0.8],
        gravity: -12,
      });
      game.shake = Math.max(game.shake, 4.5);
      sfx("stun");
    } else if (!critical) {
      sfx("hit");
    }

    if (e.hp <= 0) {
      player.buffTimer = 0;
      beginEnding("won");
      return;
    }
  }

  function perfectDodge() {
    stats.perfect += 1;
    player.buffTimer = BUFF_TIME;

    game.freeze = Math.max(game.freeze, 0.11);
    game.slowmo = Math.max(game.slowmo, 0.45);
    game.shake = Math.max(game.shake, 4.2);
    game.flash = Math.max(game.flash, 0.32);
    game.flashColor = "#86f7ff";

    addRing(player.x, player.y - 12, "#8df4ff", 66, 0.52, 3);
    addRing(player.x, player.y - 12, "#ffffff", 38, 0.34, 1);
    addBurst(player.x, player.y - 15, {
      count: 24,
      colors: ["#8df4ff", "#ffffff", "#58b8ff", "#ffc857"],
      speed: 110,
      size: 2,
      life: [0.25, 0.7],
      gravity: 20,
    });
    addDamageNumber(player.x, player.y - 43, "PERFECT", "#bffcff", 9, false);
    showCallout(
      "完美闪避",
      "下一击 · 随机触发暴击或眩晕",
      "perfect",
      1450
    );
    sfx("perfect");
  }

  function hurtPlayer(damage) {
    if (player.hp <= 0) return;

    player.hp = Math.max(0, player.hp - damage);
    player.hurtFlash = 0.25;
    stats.damageTaken += damage;

    let dx = player.x - enemy.x;
    let dy = player.y - enemy.y;
    const length = Math.hypot(dx, dy) || 1;
    player.x += (dx / length) * 19;
    player.y += (dy / length) * 15;
    clampPlayer();

    addDamageNumber(
      player.x + rand(-3, 3),
      player.y - 35,
      "-" + damage,
      "#ff6f86",
      11,
      false
    );
    addBurst(player.x, player.y - 16, {
      count: 16,
      colors: ["#ff4d6d", "#ff9f8e", "#ffffff", "#6e1e2f"],
      speed: 125,
      size: 2,
      life: [0.2, 0.6],
      gravity: 200,
    });

    game.shake = Math.max(game.shake, 8);
    game.freeze = Math.max(game.freeze, 0.07);
    game.flash = 1;
    game.flashColor = "#ff294d";
    sfx("hurt");

    if (player.hp > 0 && player.hp / player.maxHp <= 0.3 && !game.lowHpWarned) {
      game.lowHpWarned = true;
      showCallout("危险", "生命值低于 30% · 稳住节奏", "enrage", 1200);
    }

    if (player.hp <= 0) beginEnding("lost");
  }

  // ---------------------------------------------------------------------------
  // Enemy AI
  // ---------------------------------------------------------------------------
  function beginEnemyWindup() {
    const e = enemy;
    e.state = "windup";
    e.windupDuration = e.enraged ? 0.49 : 0.68;
    e.timer = e.windupDuration;
    e.attackAngle = Math.atan2(player.y - e.y, player.x - e.x);
    addBurst(e.x, e.y - 30, {
      count: 8,
      colors: ["#ff4d6d", "#ffb199", "#511725"],
      speed: 48,
      size: 2,
      life: [0.25, 0.55],
      gravity: -30,
      angle: -Math.PI / 2,
      spread: 1.2,
    });
    sfx("warn");
  }

  function performEnemyStrike() {
    const e = enemy;
    e.state = "strike";
    e.timer = 0.2;
    e.facing = Math.cos(e.attackAngle) >= 0 ? 1 : -1;

    e.x += Math.cos(e.attackAngle) * 10;
    e.y += Math.sin(e.attackAngle) * 8;
    clampEnemy();

    addSlash(
      e.x,
      e.y - 17,
      e.attackAngle,
      57,
      1.85,
      0.23,
      "#ff4d6d",
      5
    );
    addSlash(
      e.x,
      e.y - 17,
      e.attackAngle,
      46,
      1.45,
      0.18,
      "#ffd8bf",
      2
    );
    addBurst(e.x + Math.cos(e.attackAngle) * 28, e.y - 16 + Math.sin(e.attackAngle) * 28, {
      count: 13,
      colors: ["#ff4d6d", "#ffc1a8", "#ffffff"],
      speed: 120,
      size: 2,
      life: [0.18, 0.45],
      gravity: 140,
      angle: e.attackAngle,
      spread: 1.6,
    });

    game.shake = Math.max(game.shake, 4.5);
    sfx("enemySlash");

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const distance = Math.hypot(dx, dy);
    const angleToPlayer = Math.atan2(dy, dx);
    const inCone =
      distance <= 70 && Math.abs(normAngle(angleToPlayer - e.attackAngle)) <= 1.28;
    const dodging = player.dodgeTimer > 0;

    if (dodging && distance <= 94) {
      perfectDodge();
    } else if (!dodging && inCone) {
      hurtPlayer(e.enraged ? 16 : 14);
    } else {
      addBurst(
        e.x + Math.cos(e.attackAngle) * 48,
        e.y - 10 + Math.sin(e.attackAngle) * 32,
        {
          count: 5,
          colors: ["#59606f", "#343a46"],
          speed: 40,
          size: 2,
          life: [0.2, 0.45],
          gravity: 120,
          angle: e.attackAngle,
          spread: 0.8,
        }
      );
    }

    e.attackCd = e.enraged ? rand(0.78, 1.12) : rand(1.02, 1.5);
  }

  function updateEnemy(dt) {
    const e = enemy;

    e.hurtFlash = Math.max(0, e.hurtFlash - dt);
    e.displayHp += (e.hp - e.displayHp) * Math.min(1, dt * 7);

    if (e.hp <= 0) return;
    e.attackCd = Math.max(0, e.attackCd - dt);

    if (!e.enraged && e.hp <= e.maxHp * 0.45) {
      e.enraged = true;
      addRing(e.x, e.y - 18, "#ff4d6d", 84, 0.6, 3);
      addBurst(e.x, e.y - 24, {
        count: 26,
        colors: ["#ff4d6d", "#ff8e58", "#ffc857", "#6d1729"],
        speed: 130,
        size: 3,
        life: [0.35, 0.85],
        gravity: -20,
      });
      game.shake = Math.max(game.shake, 6);
      game.flash = Math.max(game.flash, 0.5);
      game.flashColor = "#ff294d";
      showCallout("鬼武者 · 激怒", "红光更急，攻击更快", "enrage", 1450);
      sfx("enrage");
    }

    if (e.state !== "strike") {
      e.facing = player.x >= e.x ? 1 : -1;
    }

    if (e.state === "stunned") {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = "idle";
        e.attackCd = Math.max(e.attackCd, 0.38);
      }
      return;
    }

    if (e.state === "windup") {
      e.timer -= dt;
      if (e.timer > 0.16) {
        e.attackAngle = Math.atan2(player.y - e.y, player.x - e.x);
      }
      if (e.timer <= 0) performEnemyStrike();
      return;
    }

    if (e.state === "strike") {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = "recover";
        e.timer = e.enraged ? 0.4 : 0.52;
      }
      return;
    }

    if (e.state === "recover") {
      e.timer -= dt;
      if (e.timer <= 0) e.state = "idle";
      return;
    }

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const distance = Math.hypot(dx, dy) || 1;
    const speed = e.enraged ? 77 : 58;

    if (distance > 47) {
      e.x += (dx / distance) * speed * dt;
      e.y += (dy / distance) * speed * dt;
      e.walkPhase += speed * dt * 0.13;
    } else if (distance < 29) {
      e.x -= (dx / distance) * speed * 0.45 * dt;
      e.y -= (dy / distance) * speed * 0.45 * dt;
      e.walkPhase += speed * dt * 0.06;
    }
    clampEnemy();

    if (e.attackCd <= 0 && distance <= 58) {
      beginEnemyWindup();
    }
  }

  function separateEntities() {
    let dx = player.x - enemy.x;
    let dy = player.y - enemy.y;
    let distance = Math.hypot(dx, dy);
    if (distance === 0) {
      dx = -1;
      dy = 0;
      distance = 1;
    }
    const minDistance = player.r + enemy.r;
    if (distance < minDistance) {
      const overlap = minDistance - distance;
      player.x += (dx / distance) * overlap * 0.85;
      player.y += (dy / distance) * overlap * 0.85;
      enemy.x -= (dx / distance) * overlap * 0.2;
      enemy.y -= (dy / distance) * overlap * 0.2;
      clampPlayer();
      clampEnemy();
    }
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------
  function updatePlayer(dt) {
    const p = player;

    p.attackCd = Math.max(0, p.attackCd - dt);
    p.attackAnim = Math.max(0, p.attackAnim - dt);
    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    p.displayHp += (p.hp - p.displayHp) * Math.min(1, dt * 7);

    if (p.buffTimer > 0) {
      p.buffTimer = Math.max(0, p.buffTimer - dt);
      if (p.buffTimer === 0) {
        addBurst(p.x, p.y - 16, {
          count: 6,
          colors: ["#5ee7ef", "#d6fbff"],
          speed: 32,
          size: 1,
          life: [0.2, 0.4],
          gravity: -10,
        });
      }
    }

    for (let i = p.ghosts.length - 1; i >= 0; i -= 1) {
      p.ghosts[i].life -= dt;
      if (p.ghosts[i].life <= 0) p.ghosts.splice(i, 1);
    }

    p.moving = false;

    if (p.dodgeTimer > 0) {
      p.dodgeTimer = Math.max(0, p.dodgeTimer - dt);
      p.x += p.dodgeDirX * DODGE_SPEED * dt;
      p.y += p.dodgeDirY * DODGE_SPEED * dt;
      p.walkPhase += DODGE_SPEED * dt * 0.1;
      p.moving = true;

      p.ghostTimer -= dt;
      if (p.ghostTimer <= 0) {
        p.ghostTimer = 0.035;
        p.ghosts.push({
          x: p.x,
          y: p.y,
          facing: p.facing,
          life: 0.22,
          maxLife: 0.22,
        });
      }

      p.dustTimer -= dt;
      if (p.dustTimer <= 0) {
        p.dustTimer = 0.055;
        addBurst(p.x - p.dodgeDirX * 4, p.y, {
          count: 2,
          colors: ["#536078", "#8796ad", "#a8f8ff"],
          speed: 25,
          size: 1,
          life: [0.15, 0.3],
          gravity: -2,
        });
      }

      p.facing = p.dodgeDirX >= 0 ? 1 : -1;
    } else {
      const input = getMoveInput();
      const mag = Math.hypot(input.x, input.y);

      if (mag > 0) {
        const nx = input.x / mag;
        const ny = input.y / mag;
        const speed = p.attackAnim > 0 ? PLAYER_SPEED * 0.48 : PLAYER_SPEED;
        p.x += nx * speed * dt;
        p.y += ny * speed * dt;
        p.lastDirX = nx;
        p.lastDirY = ny;
        p.walkPhase += speed * dt * 0.14;
        p.moving = true;
      }

      p.facing = enemy.x >= p.x ? 1 : -1;
    }

    clampPlayer();
    separateEntities();
  }

  function updateEnding(dt) {
    game.endingTimer -= dt;

    const e = enemy;
    e.displayHp += (e.hp - e.displayHp) * Math.min(1, dt * 6);
    player.displayHp += (player.hp - player.displayHp) * Math.min(1, dt * 6);
    player.attackAnim = Math.max(0, player.attackAnim - dt);
    player.hurtFlash = Math.max(0, player.hurtFlash - dt);
    player.buffTimer = 0;

    if (game.ending === "won") {
      e.deadTime += dt;
      e.deathFxTimer -= dt;
      if (e.deathFxTimer <= 0) {
        e.deathFxTimer = 0.09;
        addBurst(e.x + rand(-10, 10), e.y - rand(5, 36), {
          count: 3,
          colors: pick([
            ["#ff4d6d", "#ffc857"],
            ["#ff8a5c", "#ffffff"],
            ["#7d2033", "#ff6c8e"],
          ]),
          speed: 45,
          size: 2,
          life: [0.3, 0.8],
          gravity: -20,
        });
      }
    } else {
      player.deadTime += dt;
    }

    if (game.endingTimer <= 0) {
      finishGame(game.ending);
    }
  }

  function updateWorld(dt) {
    updatePlayer(dt);
    updateEnemy(dt);
  }

  // ---------------------------------------------------------------------------
  // FX
  // ---------------------------------------------------------------------------
  function addBurst(x, y, options = {}) {
    const {
      count = 8,
      colors = ["#ffffff"],
      speed = 80,
      size = 2,
      life = [0.2, 0.5],
      gravity = 160,
      angle = null,
      spread = TAU,
    } = options;

    const amount = Math.min(count, 60);
    for (let i = 0; i < amount; i += 1) {
      const a =
        angle === null ? rand(0, TAU) : angle + rand(-spread / 2, spread / 2);
      const velocity = rand(speed * 0.35, speed);
      const particleLife = rand(life[0], life[1]);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * velocity,
        vy: Math.sin(a) * velocity,
        gravity,
        drag: 0.9,
        size: rand(1, size + 0.5),
        color: pick(colors),
        life: particleLife,
        maxLife: particleLife,
      });
    }
    if (particles.length > 420) particles.splice(0, particles.length - 420);
  }

  function addDamageNumber(x, y, text, color, size, critical) {
    damageNumbers.push({
      x,
      y,
      text,
      color,
      size,
      critical,
      vy: critical ? -23 : -18,
      life: critical ? 1.05 : 0.8,
      maxLife: critical ? 1.05 : 0.8,
      drift: rand(-5, 5),
    });
  }

  function addSlash(x, y, angle, radius, spread, life, color, width) {
    slashes.push({
      x,
      y,
      angle,
      radius,
      spread,
      life,
      maxLife: life,
      color,
      width,
    });
  }

  function addRing(x, y, color, maxRadius, life, width) {
    rings.push({
      x,
      y,
      color,
      maxRadius,
      life,
      maxLife: life,
      width,
    });
  }

  function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 30);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = damageNumbers.length - 1; i >= 0; i -= 1) {
      const n = damageNumbers[i];
      n.life -= dt;
      if (n.life <= 0) {
        damageNumbers.splice(i, 1);
        continue;
      }
      n.y += n.vy * dt;
      n.x += n.drift * dt;
      n.vy += 27 * dt;
    }

    for (let i = slashes.length - 1; i >= 0; i -= 1) {
      slashes[i].life -= dt;
      if (slashes[i].life <= 0) slashes.splice(i, 1);
    }

    for (let i = rings.length - 1; i >= 0; i -= 1) {
      rings[i].life -= dt;
      if (rings[i].life <= 0) rings.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function pixelLine(x1, y1, x2, y2, size, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    ctx.fillStyle = color;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      ctx.fillRect(
        Math.round(x1 + dx * t - size / 2),
        Math.round(y1 + dy * t - size / 2),
        size,
        size
      );
    }
  }

  function pixelEllipse(cx, cy, rx, ry, color) {
    ctx.fillStyle = color;
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y += 1) {
      const ratio = 1 - (y * y) / (ry * ry);
      if (ratio < 0) continue;
      const width = Math.sqrt(ratio) * rx;
      ctx.fillRect(
        Math.round(cx - width),
        Math.round(cy + y),
        Math.max(1, Math.round(width * 2)),
        1
      );
    }
  }

  function pixelCircle(cx, cy, radius, color) {
    ctx.fillStyle = color;
    for (let y = -Math.ceil(radius); y <= Math.ceil(radius); y += 1) {
      const ratio = 1 - (y * y) / (radius * radius);
      if (ratio < 0) continue;
      const width = Math.sqrt(ratio) * radius;
      ctx.fillRect(
        Math.round(cx - width),
        Math.round(cy + y),
        Math.max(1, Math.round(width * 2)),
        1
      );
    }
  }

  function text(str, x, y, options = {}) {
    const {
      size = 8,
      color = "#f3f7ff",
      align = "left",
      weight = "bold",
      shadow = "#04060b",
      alpha = 1,
    } = options;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = weight + " " + size + 'px ' + PIXEL_FONT;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.fillText(str, Math.round(x) + 1, Math.round(y) + 1);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, Math.round(x), Math.round(y));
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------
  function drawBackground() {
    const t = game.clock;

    const sky = ctx.createLinearGradient(0, 0, 0, 160);
    sky.addColorStop(0, "#070a15");
    sky.addColorStop(0.55, "#101329");
    sky.addColorStop(1, "#27182e");
    ctx.fillStyle = sky;
    ctx.fillRect(-8, -8, W + 16, H + 16);

    // Stars
    for (const s of stars) {
      const alpha = 0.22 + (Math.sin(s.phase) * 0.5 + 0.5) * 0.55;
      rect(s.x, s.y, s.size, s.size, "rgba(208,225,255," + alpha.toFixed(3) + ")");
    }

    // Moon glow + pixel moon
    const moonGlow = ctx.createRadialGradient(383, 72, 5, 383, 72, 52);
    moonGlow.addColorStop(0, "rgba(200,220,255,0.2)");
    moonGlow.addColorStop(0.4, "rgba(140,170,220,0.07)");
    moonGlow.addColorStop(1, "rgba(120,150,210,0)");
    ctx.fillStyle = moonGlow;
    ctx.fillRect(320, 12, 126, 126);
    pixelCircle(383, 70, 18, "#cbd7e9");
    pixelCircle(378, 65, 15, "#0f1226");
    rect(390, 77, 3, 2, "rgba(126,142,168,0.5)");
    rect(372, 81, 2, 2, "rgba(126,142,168,0.34)");

    // Distant mountain silhouettes
    ctx.fillStyle = "#0a0b19";
    ctx.beginPath();
    ctx.moveTo(-10, 117);
    ctx.lineTo(34, 86);
    ctx.lineTo(65, 106);
    ctx.lineTo(102, 74);
    ctx.lineTo(138, 112);
    ctx.lineTo(184, 84);
    ctx.lineTo(218, 111);
    ctx.lineTo(270, 78);
    ctx.lineTo(312, 108);
    ctx.lineTo(352, 88);
    ctx.lineTo(402, 112);
    ctx.lineTo(448, 83);
    ctx.lineTo(490, 111);
    ctx.lineTo(490, 145);
    ctx.lineTo(-10, 145);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#111225";
    ctx.beginPath();
    ctx.moveTo(-10, 122);
    ctx.lineTo(52, 104);
    ctx.lineTo(92, 121);
    ctx.lineTo(145, 101);
    ctx.lineTo(202, 123);
    ctx.lineTo(252, 104);
    ctx.lineTo(317, 125);
    ctx.lineTo(362, 106);
    ctx.lineTo(430, 124);
    ctx.lineTo(490, 108);
    ctx.lineTo(490, 154);
    ctx.lineTo(-10, 154);
    ctx.closePath();
    ctx.fill();

    // Distant shrine wall
    ctx.fillStyle = "#171423";
    ctx.fillRect(-8, 108, W + 16, 34);
    ctx.fillStyle = "#211b2e";
    ctx.fillRect(-8, 108, W + 16, 3);
    for (let x = -8; x < W + 8; x += 36) {
      ctx.fillStyle = "#1e192a";
      ctx.fillRect(x, 112, 2, 28);
      ctx.fillStyle = "#252033";
      ctx.fillRect(x + 4, 115, 28, 1);
    }

    // Ground
    const ground = ctx.createLinearGradient(0, 126, 0, H);
    ground.addColorStop(0, "#1e1927");
    ground.addColorStop(0.5, "#16131f");
    ground.addColorStop(1, "#0d0b13");
    ctx.fillStyle = ground;
    ctx.fillRect(-8, 126, W + 16, H - 110);

    // Arena platform ring
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(240, 188, 201, 87, 0, 0, TAU);
    ctx.fillStyle = "rgba(6, 8, 14, 0.25)";
    ctx.fill();
    ctx.strokeStyle = "rgba(121, 164, 178, 0.13)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.ellipse(240, 188, 176, 73, 0, 0, TAU);
    ctx.strokeStyle = "rgba(173, 93, 104, 0.09)";
    ctx.stroke();
    ctx.restore();

    // Tile floor lines
    ctx.strokeStyle = "rgba(205, 220, 255, 0.035)";
    ctx.lineWidth = 1;
    for (let y = 138; y < H; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
    for (let row = 0; row < 7; row += 1) {
      const y = 138 + row * 22;
      const offset = row % 2 === 0 ? 0 : 28;
      for (let x = -24 + offset; x < W + 28; x += 56) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + 22);
        ctx.stroke();
      }
    }

    drawTorch(45, 130, t, 1);
    drawTorch(435, 130, t, -1);

    // Petals
    for (const p of petals) {
      const alpha = p.alpha * (0.7 + Math.sin(p.phase * 2) * 0.3);
      rect(
        p.x,
        p.y,
        p.size + 1,
        1,
        "rgba(226, 142, 178," + alpha.toFixed(3) + ")"
      );
    }

    // Mist near floor
    const mist = ctx.createLinearGradient(0, 210, 0, 260);
    mist.addColorStop(0, "rgba(140, 166, 190, 0)");
    mist.addColorStop(0.55, "rgba(140, 166, 190, 0.035)");
    mist.addColorStop(1, "rgba(6, 8, 14, 0.2)");
    ctx.fillStyle = mist;
    ctx.fillRect(-8, 205, W + 16, 70);

    // Fireflies
    for (const f of fireflies) {
      const x = f.baseX + Math.sin(f.phase * 2.2) * f.drift;
      const y = f.baseY + Math.cos(f.phase * 1.6) * f.drift * 0.55;
      const alpha = 0.25 + (Math.sin(f.phase * 3.1) * 0.5 + 0.5) * 0.6;
      rect(x, y, f.size, f.size, "rgba(140, 240, 224," + alpha.toFixed(3) + ")");
    }
  }

  function drawTorch(x, y, t, side) {
    const flicker = Math.sin(t * 8.7 + x) * 1.6 + Math.sin(t * 13.1 + x) * 1.2;
    const glow = ctx.createRadialGradient(x, y - 19, 2, x, y - 19, 36 + flicker);
    glow.addColorStop(0, "rgba(255, 139, 68, 0.18)");
    glow.addColorStop(0.5, "rgba(255, 92, 52, 0.06)");
    glow.addColorStop(1, "rgba(255, 92, 52, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 42, y - 62, 84, 90);

    rect(x - 2, y - 11, 4, 16, "#3a2930");
    rect(x - 5, y + 3, 10, 3, "#1a141d");
    rect(x - 5, y - 14, 10, 3, "#4c3539");
    rect(x - 3 + flicker * 0.2, y - 22, 6, 8, "#ff6b35");
    rect(x - 2, y - 26 - Math.abs(flicker) * 0.4, 4, 7, "#ffb648");
    rect(x - 1, y - 28 - Math.abs(flicker) * 0.7, 2, 5, "#fff0aa");
    rect(x - 1, y - 17, 2, 2, "#ffdca3");

    // Hanging cords
    rect(x, y - 32, 1, 18, "rgba(0,0,0,0.35)");
    if (side > 0) {
      rect(x + 11, y - 36, 3, 5, "#54363a");
      rect(x + 12, y - 31, 1, 10, "#2b1d23");
    } else {
      rect(x - 14, y - 36, 3, 5, "#54363a");
      rect(x - 12, y - 31, 1, 10, "#2b1d23");
    }
  }

  // ---------------------------------------------------------------------------
  // Combat telegraph / entities
  // ---------------------------------------------------------------------------
  function drawTelegraph() {
    if (enemy.state !== "windup" || enemy.hp <= 0) return;
    const e = enemy;
    const progress = clamp(1 - e.timer / e.windupDuration, 0, 1);
    const pulse = Math.sin(game.clock * 16) * 0.5 + 0.5;
    const radius = 68;

    ctx.save();
    ctx.translate(e.x, e.y - 4);
    ctx.globalAlpha = 0.07 + progress * 0.13;
    ctx.fillStyle = "#ff284f";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, e.attackAngle - 1.3, e.attackAngle + 1.3);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.22 + progress * 0.5;
    ctx.strokeStyle = "#ff506d";
    ctx.lineWidth = progress > 0.78 ? 2 : 1;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -game.clock * 28;
    ctx.beginPath();
    ctx.arc(0, 0, radius, e.attackAngle - 1.3, e.attackAngle + 1.3);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.08 + progress * 0.16;
    ctx.strokeStyle = "#ffb7b7";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, (radius / 4) * i, e.attackAngle - 1.18, e.attackAngle + 1.18);
      ctx.stroke();
    }

    // Directional sliver
    ctx.globalAlpha = 0.15 + progress * 0.4;
    ctx.fillStyle = "#ff7388";
    const a = e.attackAngle;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a - 0.07) * radius, Math.sin(a - 0.07) * radius);
    ctx.lineTo(Math.cos(a + 0.07) * radius, Math.sin(a + 0.07) * radius);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Exclamation mark above the oni
    const bob = Math.sin(game.clock * 12) * 1.5;
    ctx.save();
    ctx.globalAlpha = 0.55 + pulse * 0.45;
    rect(e.x - 2, e.y - 58 + bob, 4, 11, "#ff4d6d");
    rect(e.x - 2, e.y - 45 + bob, 4, 4, "#ff4d6d");
    ctx.restore();
  }

  function drawEnemy() {
    const e = enemy;
    const t = game.clock;
    const dead = e.hp <= 0;
    const alpha = dead ? clamp(1 - e.deadTime * 0.55, 0, 1) : 1;

    if (alpha <= 0) return;

    // Stunned stars
    if (e.state === "stunned" && !dead) {
      for (let i = 0; i < 3; i += 1) {
        const a = t * 2.5 + (i * TAU) / 3;
        const sx = e.x + Math.cos(a) * 18;
        const sy = e.y - 47 + Math.sin(a) * 4;
        rect(sx - 1, sy, 2, 2, "#ffdf82");
        rect(sx, sy - 1, 1, 1, "#fff7d0");
      }
    }

    // Enrage aura
    if (e.enraged && !dead) {
      const pulse = Math.sin(t * 7) * 3;
      ctx.save();
      ctx.globalAlpha = 0.09 + (Math.sin(t * 9) * 0.5 + 0.5) * 0.06;
      pixelCircle(e.x, e.y - 22, 27 + pulse, "#ff274f");
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    if (dead) {
      ctx.translate(0, e.deadTime * 10);
      ctx.translate(e.x, e.y);
      ctx.rotate(e.deadTime * 0.11);
      ctx.translate(-e.x, -e.y);
    }

    const bob = dead
      ? 0
      : Math.sin(t * 3.6) * 0.8 + Math.sin(e.walkPhase) * (e.state === "idle" ? 0.7 : 0);
    const windupRaise =
      e.state === "windup"
        ? Math.sin(clamp(1 - e.timer / e.windupDuration, 0, 1) * Math.PI * 0.5) * 7
        : 0;
    const lunge = e.state === "strike" ? 4 : 0;

    ctx.save();
    ctx.translate(Math.round(e.x), Math.round(e.y + bob));
    ctx.scale(e.facing, 1);
    ctx.translate(lunge, 0);

    if (dead) ctx.globalAlpha *= 0.9;

    // Back leg
    rect(-10, -11, 7, 11, "#1b151d");
    rect(-9, -8, 5, 8, "#39232b");
    rect(-10, -3, 7, 3, "#0b0910");
    // Front leg
    rect(3, -11, 8, 11, "#21151d");
    rect(4, -8, 5, 8, "#43262f");
    rect(3, -3, 9, 3, "#0c0910");

    // Shoulder pauldrons
    rect(-16, -31, 8, 12, "#391823");
    rect(-15, -30, 6, 3, "#7a2a3b");
    rect(8, -31, 9, 12, "#391823");
    rect(9, -30, 6, 3, "#8b3043");

    // Body
    rect(-12, -30, 24, 21, "#4c1a28");
    rect(-9, -27, 18, 15, "#652235");
    rect(-8, -26, 3, 12, "#8d3145");
    rect(1, -25, 4, 10, "#391522");
    rect(-11, -13, 22, 4, "#28131b");
    rect(-8, -11, 16, 2, "#b37a3f");

    // Chest armor glyph
    rect(-4, -23, 8, 2, "#d29b52");
    rect(-2, -21, 4, 5, "#3b1822");
    rect(-1, -20, 2, 3, "#f0b95f");

    // Arms
    rect(-15, -25, 5, 12, "#4f1b2a");
    rect(-14, -14, 5, 5, "#4a2a2d");
    rect(10, -25, 5, 12, "#5a1e2e");
    rect(10, -14, 6, 5, "#56302e");

    // Head
    rect(-9, -43, 18, 13, "#2b151e");
    rect(-7, -42, 14, 10, "#5d2331");
    rect(-8, -41, 3, 8, "#742d3d");
    rect(-4, -41, 8, 2, "#8b3447");
    rect(1, -38, 7, 3, "#0b080c");
    rect(3, -37, 2, 1, e.enraged ? "#fff0a1" : "#ffbd4a");
    rect(6, -37, 1, 1, e.enraged ? "#fff0a1" : "#ffbd4a");
    if (e.enraged) {
      rect(2, -38, 6, 3, "rgba(255,60,60,0.24)");
    }

    // Mouth
    rect(-1, -32, 3, 2, "#0b080c");
    rect(-4, -31, 2, 1, "#e3d4b2");
    rect(0, -31, 2, 1, "#e3d4b2");
    rect(4, -31, 2, 1, "#e3d4b2");

    // Horns
    pixelLine(-7, -42, -12, -53, 3, "#d9c6a0");
    pixelLine(7, -42, 13, -52, 3, "#d9c6a0");
    pixelLine(-11, -52, -14, -57, 2, "#f0e1bf");
    pixelLine(12, -51, 15, -56, 2, "#f0e1bf");

    // Club pose
    ctx.save();
    if (e.state === "windup") {
      const raise = windupRaise;
      pixelLine(11, -23 - raise * 0.4, 16, -43 - raise, 4, "#4c2c25");
      pixelLine(16, -43 - raise, 21, -56 - raise, 5, "#6b4033");
      pixelLine(19, -51 - raise, 26, -56 - raise, 2, "#cbb693");
      pixelLine(18, -58 - raise, 24, -60 - raise, 2, "#d7c39e");
      rect(12, -27 - raise * 0.3, 4, 5, "#b68154");
    } else if (e.state === "strike") {
      pixelLine(10, -21, 23, -23, 4, "#4c2c25");
      pixelLine(22, -23, 34, -27, 5, "#6b4033");
      pixelLine(31, -29, 37, -32, 2, "#d7c39e");
      rect(11, -25, 4, 5, "#b68154");
    } else {
      pixelLine(11, -24, 18, -38, 4, "#4c2c25");
      pixelLine(17, -37, 21, -47, 5, "#6b4033");
      pixelLine(18, -44, 24, -48, 2, "#bda989");
      pixelLine(19, -49, 23, -52, 2, "#d7c39e");
      rect(11, -27, 4, 5, "#b68154");
    }
    ctx.restore();

    // Hurt flash
    if (e.hurtFlash > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp(e.hurtFlash * 4, 0, 0.55);
      rect(-11, -30, 22, 21, "#ffb4bd");
      rect(-8, -42, 16, 12, "#ffffff");
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
    ctx.restore();
  }

  function drawPlayer() {
    const p = player;
    const t = game.clock;
    const dead = p.hp <= 0;

    // Dodge ghosts
    for (const ghost of p.ghosts) {
      const alpha = (ghost.life / ghost.maxLife) * 0.3;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#62e7f0";
      rect(ghost.x - 6, ghost.y - 21, 12, 15, "#62e7f0");
      rect(ghost.x - 4, ghost.y - 27, 8, 7, "#bdfcff");
      rect(ghost.x - 8, ghost.y - 13, 4, 9, "#2a99a8");
      ctx.restore();
    }

    // Empowered aura
    if (p.buffTimer > 0 && !dead) {
      const pulse = Math.sin(t * 9) * 2;
      ctx.save();
      ctx.globalAlpha = 0.18 + (Math.sin(t * 11) * 0.5 + 0.5) * 0.1;
      pixelCircle(p.x, p.y - 15, 18 + pulse, "#5ee7ef");
      ctx.globalAlpha = 0.6;
      const orbit = t * 2.4;
      for (let i = 0; i < 3; i += 1) {
        const a = orbit + (i * TAU) / 3;
        rect(
          p.x + Math.cos(a) * 17 - 1,
          p.y - 16 + Math.sin(a) * 11 - 1,
          2,
          2,
          i === 1 ? "#ffc857" : "#c4fdff"
        );
      }
      ctx.restore();
    }

    const bob = dead
      ? 0
      : Math.sin(t * 5.2) * 0.7 + (p.moving ? Math.sin(p.walkPhase) * 1.2 : 0);
    const doDodge = p.dodgeTimer > 0;

    ctx.save();
    ctx.globalAlpha = dead ? clamp(1 - p.deadTime * 0.6, 0, 1) : 1;
    if (dead) {
      ctx.translate(p.x, p.y);
      ctx.rotate(-p.facing * Math.min(1.2, p.deadTime * 2.4));
      ctx.translate(-p.x, -p.y + p.deadTime * 5);
    }

    ctx.translate(Math.round(p.x), Math.round(p.y + bob));
    if (doDodge) ctx.translate(0, 4);
    ctx.scale(p.facing, 1);
    if (doDodge) ctx.rotate(-0.16);

    const step = p.moving ? Math.sin(p.walkPhase) * 2.3 : 0;

    // Scarf ribbons (behind)
    const wave = Math.sin(t * 8) * 1.6;
    rect(-11, -20 + wave * 0.35, 5, 2, "#1499ad");
    rect(-14, -18 + wave * 0.7, 4, 2, "#0e7188");
    rect(-8, -21, 6, 3, "#67eef5");

    // Back arm
    rect(-7, -17, 3, 8, "#20314d");
    rect(-8, -11, 3, 4, "#111827");

    // Legs
    rect(-5, -8 + step * 0.2, 4, 8, "#0b111e");
    rect(-5, -3 + step * 0.2, 5, 3, "#070a10");
    rect(2, -8 - step * 0.2, 4, 8, "#101a2b");
    rect(1, -3 - step * 0.2, 5, 3, "#070a10");
    rect(-4, -6, 2, 3, "#2f4c6d");
    rect(3, -6, 2, 3, "#37597d");

    // Body / cloak
    rect(-7, -20, 14, 13, "#101827");
    rect(-5, -19, 11, 11, "#253b5c");
    rect(-4, -18, 3, 9, "#36567c");
    rect(1, -18, 2, 7, "#1a2a44");
    rect(-6, -11, 12, 2, "#101827");
    rect(-5, -10, 10, 2, "#c69a4e");

    // Chest strap
    pixelLine(-4, -18, 3, -10, 1, "#7da9c8");
    rect(3, -16, 2, 2, "#5ee7ef");

    // Head / hood
    rect(-5, -28, 11, 9, "#18263d");
    rect(-4, -27, 9, 7, "#294364");
    rect(-6, -27, 2, 5, "#101a2c");
    rect(-4, -29, 6, 2, "#2f4d71");
    rect(-1, -25, 5, 3, "#090d17");
    rect(2, -25, 2, 1, "#8ef8ff");

    // Neck scarf
    rect(-5, -21, 10, 2, "#3bceda");
    rect(-6, -20, 4, 2, "#1f9cae");

    // Sword
    const attackPose = p.attackAnim > 0;
    if (attackPose) {
      rect(4, -17, 7, 3, "#294566");
      pixelLine(9, -16, 24, -18, 2, "#d9ecf7");
      pixelLine(10, -15, 22, -16, 1, "#ffffff");
      rect(8, -18, 2, 4, "#d6a84f");
      rect(6, -17, 3, 2, "#6c4b2a");
    } else {
      rect(3, -17, 4, 4, "#223b59");
      pixelLine(6, -17, 13, -31, 2, "#b9d4e4");
      pixelLine(7, -18, 12, -30, 1, "#edfaff");
      rect(4, -17, 3, 2, "#d6a84f");
      rect(2, -16, 3, 3, "#243d59");
    }

    // Scarf knot front
    rect(-3, -20, 3, 2, "#8ef8ff");

    // Hurt flash
    if (p.hurtFlash > 0 && !dead) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp(p.hurtFlash * 3, 0, 0.5);
      rect(-6, -28, 13, 21, "#ff9aa7");
      rect(-4, -20, 9, 12, "#ffffff");
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();

    // Small buff marker above the player
    if (p.buffTimer > 0 && !dead) {
      const pulse = Math.sin(t * 10) * 0.5 + 0.5;
      const alpha = p.buffTimer < 1 ? 0.35 + Math.sin(t * 24) * 0.3 : 0.7 + pulse * 0.3;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y - 37 - pulse * 2);
      ctx.rotate(Math.PI / 4);
      rect(-2, -2, 4, 4, p.buffTimer < 1 ? "#ffc857" : "#d8feff");
      ctx.restore();
    }
  }

  function drawEntities() {
    // Floor shadows first
    pixelEllipse(player.x, player.y + 1, player.dodgeTimer > 0 ? 8 : 12, 3, "rgba(0,0,0,0.4)");
    pixelEllipse(enemy.x, enemy.y + 1, 18, 4, "rgba(0,0,0,0.45)");

    if (player.y <= enemy.y) {
      drawPlayer();
      drawEnemy();
    } else {
      drawEnemy();
      drawPlayer();
    }
  }

  // ---------------------------------------------------------------------------
  // FX rendering
  // ---------------------------------------------------------------------------
  function drawFx() {
    // Slashes
    for (const s of slashes) {
      const ratio = clamp(s.life / s.maxLife, 0, 1);
      const progress = 1 - ratio;
      const radius = s.radius + progress * 9;
      ctx.save();
      ctx.globalAlpha = ratio * 0.9;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * (0.45 + ratio * 0.55));
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, s.angle - s.spread / 2, s.angle + s.spread / 2);
      ctx.stroke();

      ctx.globalAlpha = ratio * 0.75;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, s.width * 0.32);
      ctx.beginPath();
      ctx.arc(
        s.x,
        s.y,
        radius - 2,
        s.angle - s.spread * 0.42,
        s.angle + s.spread * 0.42
      );
      ctx.stroke();
      ctx.restore();
    }

    // Rings
    for (const r of rings) {
      const ratio = clamp(r.life / r.maxLife, 0, 1);
      const progress = 1 - ratio;
      const radius = 4 + (r.maxRadius - 4) * (1 - Math.pow(1 - progress, 2));
      ctx.save();
      ctx.globalAlpha = ratio * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // Particles
    for (const p of particles) {
      const ratio = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = ratio;
      const size = Math.max(1, Math.round(p.size * (0.45 + ratio * 0.55)));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
    }
    ctx.globalAlpha = 1;

    // Damage numbers
    for (const n of damageNumbers) {
      const ratio = clamp(n.life / n.maxLife, 0, 1);
      const pop = n.critical ? 1 + Math.max(0, ratio - 0.75) * 1.8 : 1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, ratio * 1.7);
      ctx.font = '900 ' + Math.round(n.size * pop) + "px " + PIXEL_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#06070d";
      ctx.fillText(n.text, Math.round(n.x) + 2, Math.round(n.y) + 2);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, Math.round(n.x), Math.round(n.y));
      if (n.critical) {
        ctx.globalAlpha *= 0.55;
        ctx.fillStyle = "#ffc857";
        ctx.fillText(n.text, Math.round(n.x), Math.round(n.y) + 1);
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  function drawBar(x, y, w, h, ratio, displayRatio, color, trailColor) {
    ctx.fillStyle = "#03050a";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#1b2230";
    ctx.fillRect(x, y, w, h);

    const safeRatio = clamp(ratio, 0, 1);
    const safeDisplay = clamp(displayRatio, 0, 1);
    if (safeDisplay > safeRatio) {
      ctx.fillStyle = trailColor;
      ctx.fillRect(x + Math.round(w * safeRatio), y, Math.round(w * (safeDisplay - safeRatio)), h);
    }

    const width = Math.round(w * safeRatio);
    if (width > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, h);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x + 1, y + 1, Math.max(0, width - 2), 1);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(x + 1, y + h - 1, Math.max(0, width - 2), 1);
    }

    ctx.fillStyle = "rgba(2,4,8,0.58)";
    for (let i = 1; i < 10; i += 1) {
      ctx.fillRect(x + Math.round((w / 10) * i), y, 1, h);
    }
  }

  function drawHUD() {
    ctx.save();

    const hudGradient = ctx.createLinearGradient(0, 0, 0, 48);
    hudGradient.addColorStop(0, "rgba(4,6,12,0.94)");
    hudGradient.addColorStop(0.8, "rgba(4,6,12,0.76)");
    hudGradient.addColorStop(1, "rgba(4,6,12,0.1)");
    ctx.fillStyle = hudGradient;
    ctx.fillRect(0, 0, W, 52);
    ctx.fillStyle = "rgba(94,231,239,0.18)";
    ctx.fillRect(0, 44, W, 1);

    // Player
    text("RONIN", 16, 10, { size: 7, color: "#9feff5" });
    drawBar(
      16,
      20,
      136,
      7,
      player.hp / player.maxHp,
      player.displayHp / player.maxHp,
      player.hp / player.maxHp <= 0.3 ? "#ff5a70" : "#54ead4",
      "#d9fff8"
    );
    text(
      Math.ceil(player.hp) + " / " + player.maxHp,
      154,
      10,
      { size: 7, color: "#c5d3e5", align: "right" }
    );

    // Dodge meter
    text("DODGE [K]", 16, 32, {
      size: 6,
      color: player.dodgeCd <= 0 ? "#79eef7" : "#6f7d92",
    });
    const dodgeRatio = 1 - player.dodgeCd / DODGE_CD;
    ctx.fillStyle = "#04060b";
    ctx.fillRect(66, 34, 55, 3);
    ctx.fillStyle = player.dodgeCd <= 0 ? "#63e9f3" : "#376a76";
    ctx.fillRect(67, 35, Math.max(0, Math.round(53 * dodgeRatio)), 1);

    // Boss
    text("ONI WARDEN", 464, 10, {
      size: 7,
      color: enemy.enraged ? "#ff8da0" : "#ffb2bf",
      align: "right",
    });
    drawBar(
      328,
      20,
      136,
      7,
      enemy.hp / enemy.maxHp,
      enemy.displayHp / enemy.maxHp,
      "#ff4d6d",
      "#ffd2d8"
    );
    text("LV. 12", 328, 32, {
      size: 6,
      color: enemy.enraged ? "#ff7088" : "#776f82",
    });
    if (enemy.enraged) {
      text("ENRAGED", 464, 32, {
        size: 6,
        color: "#ff5c76",
        align: "right",
        alpha: 0.65 + Math.sin(game.clock * 8) * 0.25,
      });
    }

    // Center time
    text(formatTime(game.playTime), 240, 8, {
      size: 8,
      color: "#7d8aa2",
      align: "center",
    });

    if (player.buffTimer > 0) {
      const alpha = player.buffTimer < 1
        ? 0.45 + Math.sin(game.clock * 22) * 0.35
        : 0.8 + Math.sin(game.clock * 5) * 0.2;
      text("EMPOWERED", 240, 21, {
        size: 6,
        color: "#ffdf8a",
        align: "center",
        alpha,
      });
      text("NEXT HIT · STUN / CRIT", 240, 29, {
        size: 6,
        color: "#a8fbff",
        align: "center",
        alpha,
      });
    } else {
      text("PERFECT DODGE TO EMPOWER", 240, 21, {
        size: 5,
        color: "#5d687c",
        align: "center",
      });
    }

    // Low-health warning border
    if (player.hp > 0 && player.hp / player.maxHp <= 0.3) {
      const pulse = Math.sin(game.clock * 8) * 0.5 + 0.5;
      const glow = ctx.createLinearGradient(0, 0, 0, H);
      glow.addColorStop(0, "rgba(255,45,77," + (0.08 + pulse * 0.09) + ")");
      glow.addColorStop(0.22, "rgba(255,45,77,0)");
      glow.addColorStop(0.78, "rgba(255,45,77,0)");
      glow.addColorStop(1, "rgba(255,45,77," + (0.1 + pulse * 0.12) + ")");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  function drawFlash() {
    if (game.flash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(game.flash, 0, 1) * 0.22;
      ctx.fillStyle = game.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Render / loop
  // ---------------------------------------------------------------------------
  function render() {
    ctx.clearRect(0, 0, W, H);

    const shakeX = game.shake > 0 ? rand(-game.shake, game.shake) : 0;
    const shakeY = game.shake > 0 ? rand(-game.shake, game.shake) : 0;

    ctx.save();
    ctx.translate(Math.round(shakeX), Math.round(shakeY));
    drawBackground();
    drawTelegraph();
    drawEntities();
    drawFx();
    ctx.restore();

    drawHUD();
    drawFlash();
  }

  let lastFrame = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);

    let raw = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (raw < 0) raw = 0;

    game.clock += raw;
    game.shake = Math.max(0, game.shake - raw * 26);
    game.flash = Math.max(0, game.flash - raw * 2.8);

    updateAmbient(raw);

    if (game.mode === "playing") {
      if (game.freeze > 0) {
        game.freeze = Math.max(0, game.freeze - raw);
      } else {
        const scale = game.slowmo > 0 ? 0.35 : 1;
        const dt = raw * scale;
        game.playTime += dt;
        game.slowmo = Math.max(0, game.slowmo - raw);

        if (game.ending) {
          updateEnding(dt);
          updateFx(dt);
        } else {
          updateWorld(dt);
          updateFx(dt);
        }
      }
    }

    render();
  }

  // Boot
  resetWorld();
  showOverlay("start");
  requestAnimationFrame(frame);
})();
