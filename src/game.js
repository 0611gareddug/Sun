/* 해시계 등반가 — 게임 본체 (렌더링 / 입력 / 사운드 / UI) */
(function () {
  'use strict';
  const SC = window.SunCore, LEVELS = window.SunLevels, C = SC.C;
  const CHAPTERS = ['', '새벽 정원', '시계탑 뜰', '풍차 언덕', '구름 고원', '달밤의 시계탑'];
  const $ = (id) => document.getElementById(id);
  const cv = $('game'), ctx = cv.getContext('2d', { alpha: false });
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || matchMedia('(pointer:coarse)').matches;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, k) => a + (b - a) * k;

  /* ═════════════ 저장 ═════════════ */
  const SAVE_KEY = 'hsclimb.v1';
  let save = { best: {}, sfx: true, music: true, seenHelp: false };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.best) save = Object.assign(save, s); } catch (e) { }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { } }
  function isUnlocked(i) { return i === 0 || !!save.best[LEVELS[i - 1].id]; }

  /* ═════════════ 사운드 (WebAudio 합성) ═════════════ */
  const Snd = (() => {
    let ac = null, master = null, sfxG = null, musG = null, noiseBuf = null, pad = null;
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
      sfxG = ac.createGain(); sfxG.gain.value = save.sfx ? 1 : 0; sfxG.connect(master);
      musG = ac.createGain(); musG.gain.value = save.music ? 1 : 0; musG.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      startPad();
    }
    function env(g, t, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); }
    function tone(type, f0, f1, dur, vol, delay) {
      if (!ac) return; const t = ac.currentTime + (delay || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      env(g, t, 0.008, vol, dur); o.connect(g); g.connect(sfxG); o.start(t); o.stop(t + dur + 0.05);
    }
    function noise(dur, vol, ftype, f0, f1, delay) {
      if (!ac) return; const t = ac.currentTime + (delay || 0);
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain(); env(g, t, 0.005, vol, dur);
      s.connect(f); f.connect(g); g.connect(sfxG); s.start(t); s.stop(t + dur + 0.05);
    }
    function startPad() {
      const out = ac.createGain(); out.gain.value = 0.0; out.connect(musG);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3; lp.connect(out);
      const oscs = [];
      [0, 1, 2, 3].forEach((i) => {
        const o = ac.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine';
        const g = ac.createGain(); g.gain.value = i < 2 ? 0.05 : 0.03;
        o.connect(g); g.connect(lp); o.start(); oscs.push(o);
      });
      const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 260; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      out.gain.linearRampToValueAtTime(0.55, ac.currentTime + 3);
      pad = { oscs, out, last: '' };
    }
    const chords = {
      day: [130.81, 196.0, 329.63, 392.0], noon: [146.83, 220.0, 369.99, 440.0],
      eve: [110.0, 164.81, 261.63, 329.63], night: [98.0, 146.83, 233.08, 293.66],
    };
    function mood(m) {
      if (!pad || pad.last === m) return; pad.last = m;
      const t = ac.currentTime; chords[m].forEach((f, i) => pad.oscs[i].frequency.setTargetAtTime(f * (i === 3 ? 1.003 : 1), t, 1.6));
    }
    let lastTick = 0, tickAlt = false;
    return {
      init, mood,
      setSfx(on) { save.sfx = on; persist(); if (sfxG) sfxG.gain.value = on ? 1 : 0; },
      setMusic(on) { save.music = on; persist(); if (musG) musG.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.2); },
      jump() { tone('triangle', 420, 820, 0.11, 0.16); },
      land() { noise(0.07, 0.18, 'lowpass', 600, 200); },
      tick() {
        if (!ac) return; const now = ac.currentTime; if (now - lastTick < 0.09) return; lastTick = now; tickAlt = !tickAlt;
        tone('sine', tickAlt ? 1900 : 1450, 0, 0.035, 0.06); noise(0.02, 0.05, 'highpass', 4000);
      },
      key() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('sine', f, 0, 0.35, 0.13, i * 0.07)); },
      shard() { [1318.5, 1568, 2093].forEach((f, i) => tone('triangle', f, 0, 0.25, 0.08, i * 0.05)); },
      win() { [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone('triangle', f, 0, 0.6, 0.12, i * 0.09)); noise(1.2, 0.05, 'highpass', 3000, 9000, 0.1); },
      burn() { noise(0.6, 0.3, 'bandpass', 3000, 300); tone('sawtooth', 440, 80, 0.5, 0.08); },
      fail() { tone('sine', 330, 160, 0.7, 0.12); },
      ui() { tone('sine', 880, 0, 0.06, 0.06); },
      dusk() { tone('sine', 220, 110, 1.4, 0.1); },
    };
  })();

  /* ═════════════ 화면 / 카메라 ═════════════ */
  let W = 0, H = 0, DPR = 1, scale = 1, camX = 0, camY = 0, viewW = 0, viewH = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    viewH = H < 520 ? 640 : 800;
    scale = H / viewH;
    viewW = W / scale;
    const tcs = clamp(Math.min(W, H) * 0.17, 62, 92);
    document.documentElement.style.setProperty('--tcs', tcs + 'px');
    checkRotate();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  let rotateSkipped = false;
  function checkRotate() {
    const show = isTouch && H > W && !rotateSkipped;
    $('rotate').classList.toggle('hidden', !show);
  }
  $('rotSkip').onclick = () => { rotateSkipped = true; checkRotate(); };

  /* ═════════════ 상태 ═════════════ */
  let mode = 'title';           // title | play | pause | result
  let lvIdx = 0, level = null;
  let t = 0, tTarget = 0, rt = 0, player = null, Wd = null;
  let hasKey = false, gotShard = false, won = false, deadT = 0, winT = 0, endShown = false;
  let parts = [], trail = [];
  let sq = 0, blink = 0, lastHourMark = -1, duskPlayed = false;
  let camInit = false, lookX = 0;
  const bgSeed = { hills: [] };

  function loadLevel(i) {
    lvIdx = i; level = LEVELS[i];
    level._static = null;
    t = tTarget = level.t0 || 0; rt = 0;
    player = SC.newPlayer(level.start[0], level.start[1]);
    hasKey = !level.key; gotShard = false; won = false; deadT = 0; winT = 0; endShown = false;
    parts = []; trail = []; sq = 0; duskPlayed = false; camInit = false;
    lastHourMark = Math.floor(t * 48);
    Wd = SC.world(level, t, rt);
    genHills(i);
    $('lvCh').textContent = level.ch + '장 · ' + CHAPTERS[level.ch];
    $('lvName').textContent = level.id + ' ' + level.name;
    $('keyInd').classList.toggle('hidden', !level.key);
    updKeyInd();
    buildMarks();
    showCard(level.ch + '장 · ' + CHAPTERS[level.ch], level.id + '  ' + level.name);
    input.dirL = input.dirR = false; input.jh = false; input.jp = false;
  }
  function updKeyInd() {
    const k = $('keyInd'); k.classList.toggle('got', hasKey); k.textContent = hasKey ? '☼ 태양 열쇠' : '☼ 열쇠 필요';
  }
  function genHills(seed) {
    let s = seed * 9301 + 49297;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    bgSeed.hills = [0, 1, 2].map(() => ({ a: rnd() * 6, b: rnd() * 6, c: rnd() * 6, f1: 0.002 + rnd() * 0.002, f2: 0.005 + rnd() * 0.004 }));
  }

  /* ═════════════ 입력 ═════════════ */
  const input = { dirL: false, dirR: false, jh: false, jp: false, timeKey: false, tL: false, tR: false, tJ: false };
  const KEYS_L = ['ArrowLeft', 'KeyA'], KEYS_R = ['ArrowRight', 'KeyD'], KEYS_J = ['Space', 'ArrowUp', 'KeyW', 'KeyZ'], KEYS_T = ['KeyE', 'ShiftLeft', 'ShiftRight', 'KeyX'];
  window.addEventListener('keydown', (e) => {
    Snd.init();
    const c = e.code;
    if (mode === 'play') {
      if (KEYS_L.includes(c)) input.dirL = true;
      if (KEYS_R.includes(c)) input.dirR = true;
      if (KEYS_J.includes(c)) { if (!input.jh) input.jp = true; input.jh = true; }
      if (KEYS_T.includes(c)) input.timeKey = true;
      if (c === 'KeyR') restart();
      if (c === 'Escape' || c === 'KeyP') pauseGame();
      if (c.startsWith('Arrow') || c === 'Space') e.preventDefault();
    } else if (mode === 'pause') {
      if (c === 'Escape' || c === 'KeyP') resumeGame();
    } else if (mode === 'result') {
      if (c === 'KeyR') { hideAll(); restart(); }
      if ((c === 'Enter' || c === 'Space') && !$('resClear').classList.contains('hidden')) $('rNext').click();
      else if ((c === 'Enter' || c === 'Space')) $('fRetry').click();
    }
  });
  window.addEventListener('keyup', (e) => {
    const c = e.code;
    if (KEYS_L.includes(c)) input.dirL = false;
    if (KEYS_R.includes(c)) input.dirR = false;
    if (KEYS_J.includes(c)) input.jh = false;
    if (KEYS_T.includes(c)) input.timeKey = false;
  });
  window.addEventListener('blur', () => { input.dirL = input.dirR = input.jh = input.timeKey = false; if (mode === 'play') pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') pauseGame(); });

  // 터치 버튼 (멀티터치)
  function bindHold(el, on, off) {
    const ids = new Set();
    const down = (e) => { e.preventDefault(); Snd.init(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch (_) { } el.classList.add('on'); on(); };
    const up = (e) => { ids.delete(e.pointerId); if (!ids.size) { el.classList.remove('on'); off(); } };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  bindHold($('tcL'), () => input.tL = true, () => input.tL = false);
  bindHold($('tcR'), () => input.tR = true, () => input.tR = false);
  bindHold($('tcJ'), () => { if (!input.tJ) input.jp = true; input.tJ = true; }, () => input.tJ = false);

  // 태양 직접 드래그
  let orbDrag = null;  // {id, lastX}
  cv.addEventListener('pointerdown', (e) => {
    Snd.init();
    if (mode !== 'play' || won || player.dead) return;
    const o = orbScreen();
    const r = isTouch ? 80 : 64;
    if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) < r) {
      orbDrag = { id: e.pointerId, lastX: e.clientX };
      try { cv.setPointerCapture(e.pointerId); } catch (_) { }
      e.preventDefault();
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!orbDrag || orbDrag.id !== e.pointerId) return;
    const cand = tFromScreen(e.clientX, e.clientY, e.clientX - orbDrag.lastX);
    orbDrag.lastX = e.clientX;
    if (cand !== null && cand > tTarget) tTarget = Math.min(cand, SC.tMax(level));
  });
  const endOrb = (e) => { if (orbDrag && orbDrag.id === e.pointerId) { orbDrag = null; tTarget = t; } };
  cv.addEventListener('pointerup', endOrb); cv.addEventListener('pointercancel', endOrb);

  // 시간 막대
  const track = $('tbTrack');
  let barDrag = null;
  function barT(clientX) {
    const r = track.getBoundingClientRect();
    return clamp((clientX - r.left - 4) / (r.width - 8), 0, 1) * SC.tMax(level);
  }
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault(); Snd.init();
    if (mode !== 'play' || won || player.dead) return;
    barDrag = { id: e.pointerId, x0: e.clientX, t0: t };
    try { track.setPointerCapture(e.pointerId); } catch (_) { }
  });
  track.addEventListener('pointermove', (e) => {
    if (!barDrag || barDrag.id !== e.pointerId) return;
    const r = track.getBoundingClientRect();
    // 상대 드래그: 손가락이 오른쪽으로 움직인 만큼 진행 (썸을 정확히 잡지 않아도 됨)
    const dt = (e.clientX - barDrag.x0) / (r.width - 8) * SC.tMax(level);
    const cand = Math.max(barDrag.t0 + dt, Math.min(barT(e.clientX), barDrag.t0 + Math.max(0, dt)));
    if (cand > tTarget) tTarget = Math.min(cand, SC.tMax(level));
  });
  const endBar = (e) => { if (barDrag && barDrag.id === e.pointerId) { barDrag = null; tTarget = t; } };
  track.addEventListener('pointerup', endBar); track.addEventListener('pointercancel', endBar); track.addEventListener('lostpointercapture', endBar);

  /* ═════════════ 하늘 좌표 매핑 ═════════════ */
  function horizonY() { return clamp((C.G - camY) * scale, H * 0.35, H); }
  function skyToScreen(u, v) { return { x: u * W, y: v / 0.95 * horizonY() }; }
  function orbScreen() {
    const L = Wd && Wd.L;
    if (L) return skyToScreen(L.sky.u, L.sky.v);
    if (level.moon && t >= 1 && t < C.DUSK1) return skyToScreen(0.5, 0.9);
    return null;
  }
  function tFromScreen(px, py, dx) {
    const hy = horizonY();
    const u = px / W, v = py * 0.95 / hy;
    const ca = (0.5 - u) / 0.42, sa = (0.95 - v) / 0.8;
    let a = Math.atan2(Math.max(0.02, sa), ca) * 180 / Math.PI;
    if (t < 1) {
      const c = (a - C.DAY_A0) / (C.DAY_A1 - C.DAY_A0);
      return c > 0.995 ? 1 : c;
    }
    if (t < C.DUSK1) return t + Math.max(0, dx) / W * 0.4;
    const c = (a - C.MOON_A0) / (C.MOON_A1 - C.MOON_A0);
    return C.DUSK1 + clamp(c, 0, 1) * (2 - C.DUSK1);
  }

  /* ═════════════ 업데이트 ═════════════ */
  function restart() { if (level) loadLevel(lvIdx); mode = 'play'; showHUD(true); }

  function step(dt) {
    rt += dt;
    if (!player.dead && !won) {
      if (input.timeKey) tTarget = Math.max(tTarget, t + C.TIME_RATE * dt + 1e-7);
      const tm = SC.tMax(level);
      if (t < tTarget) {
        const nt = Math.min(tTarget, t + C.TIME_RATE * dt, tm);
        t = nt;
        const hm = Math.floor(t * 48);
        if (hm !== lastHourMark) { lastHourMark = hm; Snd.tick(); }
        if (level.moon && t >= 1 && !duskPlayed) { duskPlayed = true; Snd.dusk(); }
      }
      if (t >= tm - 1e-9 || (!level.moon && t >= 1)) { killPlayer(level.moon ? 'moonset' : 'sunset'); }
    }
    Wd = SC.world(level, t, rt);
    if (!player.dead && !won) {
      const dir = (input.dirR || input.tR ? 1 : 0) - (input.dirL || input.tL ? 1 : 0);
      const ev = [];
      const wasGr = player.gr;
      const vyBefore = player.vy;
      SC.stepPlayer(player, { dir, jp: input.jp, jh: input.jh || input.tJ }, Wd, level, dt, ev);
      input.jp = false;
      for (const e of ev) {
        if (e === 'jump') { Snd.jump(); sq = -0.25; puff(player.x, player.y, 6, '#2a2050'); }
        else if (e === 'land') { Snd.land(); sq = clamp(vyBefore / 2400, 0.08, 0.35); puff(player.x, player.y, 8, '#2a2050'); }
        else if (e === 'burn') { killPlayer('burn'); }
      }
      if (!wasGr && player.gr) { /* land handled */ }
      if (level.key && !hasKey && SC.overlaps(player, SC.keyRect(level))) {
        hasKey = true; Snd.key(); updKeyInd(); burst(level.key[0], level.key[1], 26, ['#ffcf7a', '#fff3c4', '#ff9f4a']); toast('태양 열쇠를 얻었어요! 시계 문이 열렸어요');
      }
      if (level.shard && !gotShard && SC.overlaps(player, SC.shardRect(level))) {
        gotShard = true; Snd.shard(); burst(level.shard[0], level.shard[1], 20, ['#c9b6ff', '#9b86ff', '#ffffff']);
      }
      if (hasKey && SC.overlaps(player, SC.goalRect(level))) winLevel();
      // 이동 잔상
      if (Math.abs(player.vx) > 30 || !player.gr) { if (Math.random() < 0.5) trail.push({ x: player.x + (Math.random() - 0.5) * 8, y: player.y - 10 - Math.random() * 12, life: 0.5, r: 2 + Math.random() * 3 }); }
    }
    sq *= Math.pow(0.0005, dt);
    // 파티클
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98;
    }
    for (let i = trail.length - 1; i >= 0; i--) { const p = trail[i]; p.life -= dt; p.y -= 12 * dt; if (p.life <= 0) trail.splice(i, 1); }
    if (player.dead) { deadT += dt; if (deadT > 1.1 && !endShown) { endShown = true; showFail(player.dead); } }
    if (won) { winT += dt; if (winT > 1.3 && !endShown) { endShown = true; showClear(); } }
  }
  function killPlayer(reason) {
    if (player.dead || won) return;
    player.dead = reason;
    if (reason === 'burn') { Snd.burn(); burst(player.x, player.y - 14, 34, ['#fff1b8', '#ffb35c', '#ff6b3a', '#2a2050']); flash = 0.5; }
    else { Snd.fail(); burst(player.x, player.y - 14, 24, ['#2a2050', '#5b4a9a', '#9b86ff']); }
  }
  function winLevel() { won = true; Snd.win(); burst(level.goal[0], level.goal[1] - 36, 40, ['#ffcf7a', '#fff3c4', '#ffffff', '#ff9f4a']); flash = 0.35; }
  let flash = 0;
  function puff(x, y, n, col) { for (let i = 0; i < n; i++) parts.push({ x, y: y - 2, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 60, life: 0.35 + Math.random() * 0.2, max: 0.55, col, r: 2 + Math.random() * 2.5, g: 300 }); }
  function burst(x, y, n, cols) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 260; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.6 + Math.random() * 0.6, max: 1.2, col: cols[i % cols.length], r: 2 + Math.random() * 3.5, g: 420 }); } }

  /* ═════════════ 색상 (시간대) ═════════════ */
  const SKY = [ // [t, top, bottom, ambient(물체 색), light color]
    [0.0, [38, 30, 78], [246, 150, 120], [36, 26, 58], [255, 170, 120]],
    [0.18, [72, 120, 196], [250, 214, 170], [34, 30, 62], [255, 220, 170]],
    [0.5, [70, 150, 222], [200, 232, 246], [30, 30, 60], [255, 250, 225]],
    [0.8, [86, 106, 186], [250, 196, 140], [36, 28, 60], [255, 205, 140]],
    [0.98, [58, 40, 96], [255, 120, 74], [40, 24, 54], [255, 130, 80]],
    [1.05, [22, 20, 52], [96, 56, 110], [22, 18, 42], [150, 110, 190]],
    [1.12, [12, 16, 46], [36, 48, 96], [18, 18, 40], [190, 205, 255]],
    [1.6, [10, 14, 42], [30, 44, 92], [16, 16, 38], [200, 215, 255]],
    [2.0, [30, 26, 70], [80, 64, 118], [22, 18, 44], [210, 200, 255]],
  ];
  function mixc(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function rgb(c, a) { return a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
  function palette(tt) {
    let i = 0; while (i < SKY.length - 2 && SKY[i + 1][0] <= tt) i++;
    const A = SKY[i], B = SKY[i + 1]; const k = clamp((tt - A[0]) / (B[0] - A[0]), 0, 1);
    return { top: mixc(A[1], B[1], k), bot: mixc(A[2], B[2], k), amb: mixc(A[3], B[3], k), lc: mixc(A[4], B[4], k) };
  }

  /* ═════════════ 렌더링 ═════════════ */
  const stars = Array.from({ length: 90 }, () => ({ u: Math.random(), v: Math.random() * 0.8, r: Math.random() * 1.4 + 0.3, p: Math.random() * 6 }));
  function updateCamera(dt) {
    const tx = player.x + lookX - viewW / 2;
    lookX = lerp(lookX, (player.vx || 0) * 0.35, 1 - Math.pow(0.05, dt));
    const minX = Math.min(0, (level.w - viewW) / 2), maxX = Math.max(level.w - viewW, (level.w - viewW) / 2);
    const cx = clamp(tx, minX, maxX);
    const topLimit = -40, botLimit = C.H + 10 - viewH;
    const ty = clamp(player.y - viewH * 0.55, Math.min(topLimit, botLimit), botLimit);
    if (!camInit) { camX = cx; camY = ty; camInit = true; }
    camX = lerp(camX, cx, 1 - Math.pow(0.004, dt));
    camY = lerp(camY, ty, 1 - Math.pow(0.01, dt));
  }

  function draw(now) {
    const pal = palette(t);
    const L = Wd.L; const ls = L ? L.s : 0;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 하늘
    const hy = horizonY();
    const g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, rgb(pal.top)); g.addColorStop(1, rgb(pal.bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 별
    const night = t >= 1 ? clamp((t - 1) / 0.12, 0, 1) * (t > 1.85 ? clamp((2 - t) / 0.15, 0.3, 1) : 1) : clamp((0.06 - t) / 0.06, 0, 0.5);
    if (night > 0.01) {
      ctx.fillStyle = '#fff';
      for (const s of stars) { ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(now / 700 + s.p)); ctx.fillRect(s.u * W, s.v * hy, s.r, s.r); }
      ctx.globalAlpha = 1;
    }
    // 태양/달
    drawOrb(pal, now);
    // 구름
    if (level.clouds) drawClouds(pal, ls);
    // 원경
    drawFar(pal, now);

    // 월드 좌표계
    const s = scale;
    ctx.setTransform(DPR * s, 0, 0, DPR * s, -camX * s * DPR, -camY * s * DPR);
    const x0 = camX - 20, x1 = camX + viewW + 20;
    // 빛나는 바닥
    const lit = L ? 0.35 + 0.65 * ls : 0.55;
    const fg = ctx.createLinearGradient(0, C.G, 0, C.H + 40);
    const lc = pal.lc;
    fg.addColorStop(0, rgb(mixc(lc, [255, 255, 255], 0.35), lit));
    fg.addColorStop(0.25, rgb(lc, 0.85 * lit));
    fg.addColorStop(1, rgb(mixc(lc, pal.amb, 0.6), 1));
    ctx.fillStyle = rgb(mixc(pal.amb, lc, 0.25)); ctx.fillRect(x0, C.G, x1 - x0, C.H + 400 - C.G);
    ctx.fillStyle = fg; ctx.fillRect(x0, C.G, x1 - x0, C.H + 400 - C.G);
    // 바닥 반짝임
    ctx.fillStyle = rgb([255, 250, 220], 0.5 * lit);
    for (let i = 0; i < 26; i++) {
      const px = ((i * 197.3 + now * 0.02 * (i % 3 + 1)) % (viewW + 40)) + camX - 20;
      const py = C.G + 6 + ((i * 53.1) % 60) + Math.sin(now / 600 + i) * 4;
      ctx.fillRect(px, py, 2.2, 2.2);
    }
    // 레벨 경계 밖 어둡게
    ctx.fillStyle = rgb(pal.amb, 0.85);
    if (x0 < 0) ctx.fillRect(x0, C.G - 2000, -x0, 2600);
    if (x1 > level.w) ctx.fillRect(level.w, C.G - 2000, x1 - level.w, 2600);

    // 그림자
    if (L) {
      const sa = 0.78 * ls;
      const shCol = rgb(mixc(pal.amb, [8, 4, 20], 0.5), sa);
      ctx.fillStyle = shCol;
      ctx.beginPath();
      for (const sh of Wd.shapes) {
        ctx.moveTo(sh[0][0], sh[0][1]);
        for (let i = 1; i < sh.length; i++) ctx.lineTo(sh[i][0], sh[i][1]);
        ctx.closePath();
      }
      for (const gi of Wd.ground) ctx.rect(gi[0], C.G, gi[1] - gi[0], C.H + 400 - C.G);
      ctx.fill('nonzero');
      // 그림자 바닥 가장자리 부드럽게
      ctx.fillStyle = rgb(mixc(pal.amb, [8, 4, 20], 0.5), 0.25 * ls);
      for (const gi of Wd.ground) { ctx.fillRect(gi[0] - 6, C.G, 6, C.H + 400 - C.G); ctx.fillRect(gi[1], C.G, 6, C.H + 400 - C.G); }
    } else {
      // 그림자 없음 — 물체 발밑만 어둡게
      ctx.fillStyle = rgb(mixc(pal.amb, [8, 4, 20], 0.5), 0.7);
      for (const gi of Wd.ground) ctx.fillRect(gi[0], C.G, gi[1] - gi[0], C.H + 400 - C.G);
    }
    // 걸을 수 있는 그림자 가장자리
    if (Wd.shadowOn) {
      ctx.strokeStyle = rgb(mixc(pal.lc, [180, 160, 255], 0.6), 0.55 * ls);
      ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const sf of Wd.surfaces) { ctx.moveTo(sf.x0, sf.y0); ctx.lineTo(sf.x1, sf.y1); }
      ctx.stroke();
    }
    // 힌트
    drawHints(pal);
    // 물체
    drawCasters(pal, L, now);
    // 목표/열쇠/조각
    drawGoal(now);
    if (level.key && !hasKey) drawKey(level.key[0], level.key[1], now);
    if (level.shard && !gotShard) drawShard(level.shard[0], level.shard[1], now);
    // 잔상
    for (const p of trail) { ctx.fillStyle = rgb([60, 40, 120], p.life * 0.9); ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life * 2, 0, 6.283); ctx.fill(); }
    // 플레이어
    if (!player.dead) drawPlayer(now);
    // 파티클
    for (const p of parts) { ctx.globalAlpha = clamp(p.life / (p.max * 0.6), 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r); }
    ctx.globalAlpha = 1;

    // 화면 효과
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (flash > 0) { ctx.fillStyle = `rgba(255,240,200,${flash})`; ctx.fillRect(0, 0, W, H); }
    // 비네트
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,4,20,0.42)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // 드래그 안내 (시작 직후)
    if (mode === 'play' && !won && !player.dead) drawOrbHint(now);
  }

  function drawOrb(pal, now) {
    const L = Wd.L;
    let pos, kind;
    if (t < 1) { pos = SC.sunSky(t); kind = 'sun'; }
    else if (level.moon && t >= C.DUSK1) { pos = SC.moonSky(t); kind = 'moon'; }
    else return;
    const p = skyToScreen(pos.u, pos.v);
    const R = clamp(Math.min(W, H) * 0.045, 18, 34);
    const cov = L ? 1 - L.s : 0;
    const glowR = R * (kind === 'sun' ? 5 : 3.5);
    const gg = ctx.createRadialGradient(p.x, p.y, R * 0.5, p.x, p.y, glowR);
    if (kind === 'sun') { gg.addColorStop(0, `rgba(255,235,170,${0.55 * (1 - cov * 0.7)})`); gg.addColorStop(1, 'rgba(255,200,120,0)'); }
    else { gg.addColorStop(0, `rgba(210,220,255,${0.4 * (1 - cov * 0.7)})`); gg.addColorStop(1, 'rgba(180,190,255,0)'); }
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, 6.283); ctx.fill();
    if (kind === 'sun') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(now / 4000);
      ctx.strokeStyle = 'rgba(255,230,160,0.55)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(R * 1.3, 0); ctx.lineTo(R * (1.6 + 0.15 * Math.sin(now / 300 + i)), 0); ctx.stroke(); }
      ctx.restore();
      const sg = ctx.createRadialGradient(p.x - R * 0.3, p.y - R * 0.3, R * 0.1, p.x, p.y, R);
      sg.addColorStop(0, '#fffbe8'); sg.addColorStop(0.5, '#ffd77a'); sg.addColorStop(1, '#ff9a48');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 6.283); ctx.fill();
    } else {
      ctx.fillStyle = '#eef1ff'; ctx.beginPath(); ctx.arc(p.x, p.y, R * 0.85, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(160,170,210,0.45)';
      [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.38, 0.12]].forEach(([a, b, r]) => { ctx.beginPath(); ctx.arc(p.x + a * R, p.y + b * R, r * R, 0, 6.283); ctx.fill(); });
    }
    // 드래그 중 표시
    if (orbDrag || barDrag || input.timeKey) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.9 + Math.sin(now / 120) * 2, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  function drawOrbHint(now) {
    if (rt > 9 || t > (level.t0 || 0) + 0.02) return;
    const o = orbScreen(); if (!o) return;
    const a = clamp(1 - rt / 9, 0, 1) * (0.6 + 0.4 * Math.sin(now / 250));
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#fff';
    ctx.font = '600 14px "Gowun Dodum", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(isTouch ? '끌어서 시간 흐르기 →' : '드래그 또는 E키 →', o.x, o.y + 62);
    ctx.restore();
  }
  function drawClouds(pal, ls) {
    const hy = horizonY();
    for (const c of level.clouds) {
      const u = SC.cloudU(c, rt);
      const p = skyToScreen(u, c.v);
      const rw = c.w * 0.5 * W, rh = c.h * 0.5 * hy / 0.95;
      const col = mixc(pal.bot, [255, 255, 255], 0.55);
      ctx.fillStyle = rgb(mixc(col, pal.amb, 0.15), 0.93);
      ctx.beginPath();
      const bumps = 6;
      for (let i = 0; i < bumps; i++) {
        const k = i / (bumps - 1);
        const bx = p.x - rw * 0.8 + k * rw * 1.6, br = rh * (0.55 + 0.45 * Math.sin(k * Math.PI));
        ctx.moveTo(bx + br, p.y); ctx.arc(bx, p.y - br * 0.2, br, 0, 6.283);
      }
      ctx.ellipse(p.x, p.y + rh * 0.2, rw * 0.95, rh * 0.55, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = rgb(mixc(col, pal.amb, 0.45), 0.5);
      ctx.beginPath(); ctx.ellipse(p.x, p.y + rh * 0.45, rw * 0.85, rh * 0.28, 0, 0, 6.283); ctx.fill();
    }
  }
  function drawFar(pal, now) {
    const hy = horizonY();
    // 먼 언덕 3겹
    for (let li = 0; li < 3; li++) {
      const hl = bgSeed.hills[li]; const par = 0.08 + li * 0.1;
      const col = mixc(pal.bot, pal.amb, 0.35 + li * 0.2);
      ctx.fillStyle = rgb(col);
      ctx.beginPath(); ctx.moveTo(0, H);
      const base = hy - (70 - li * 18) * scale * 1.2;
      for (let x = 0; x <= W + 20; x += 20) {
        const wx = (x / scale + camX * par);
        const y = base - (Math.sin(wx * hl.f1 + hl.a) * 26 + Math.sin(wx * hl.f2 + hl.b) * 14) * scale - li * 6;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      if (li === 0) drawFarTower(col, hy, par);
    }
  }
  function drawFarTower(col, hy, par) {
    // 원경의 거대한 시계탑 — 바늘이 게임 속 시각을 가리킴
    const cx = (level.w * 0.62 - camX * par) * scale * 0.6 + W * 0.25;
    const bw = 60 * scale, top = hy - 330 * scale;
    ctx.fillStyle = rgb(mixc(col, [0, 0, 0], 0.08));
    ctx.beginPath();
    ctx.moveTo(cx - bw, hy); ctx.lineTo(cx - bw * 0.8, top + 40 * scale); ctx.lineTo(cx - bw * 0.95, top + 30 * scale);
    ctx.lineTo(cx, top - 70 * scale); ctx.lineTo(cx + bw * 0.95, top + 30 * scale); ctx.lineTo(cx + bw * 0.8, top + 40 * scale); ctx.lineTo(cx + bw, hy);
    ctx.closePath(); ctx.fill();
    const fy = top + 80 * scale, fr = 34 * scale;
    ctx.fillStyle = rgb(mixc(col, [255, 240, 210], 0.25)); ctx.beginPath(); ctx.arc(cx, fy, fr, 0, 6.283); ctx.fill();
    const hour = (6 + t * 12) % 12, minute = (t * 12 * 60) % 60;
    ctx.strokeStyle = rgb(mixc(col, [0, 0, 0], 0.3)); ctx.lineCap = 'round';
    const hand = (ang, len, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(cx, fy); ctx.lineTo(cx + Math.sin(ang) * len, fy - Math.cos(ang) * len); ctx.stroke(); };
    hand(hour / 12 * 6.283, fr * 0.55, 3 * scale + 1); hand(minute / 60 * 6.283, fr * 0.82, 2 * scale + 1);
  }

  function drawHints(pal) {
    if (!level.hints || mode === 'title') return;
    ctx.font = '18px "Gowun Dodum", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const h of level.hints) {
      const d = Math.abs(player.x - h.x);
      const a = clamp(1.4 - d / 600, 0.0, 1);
      if (a <= 0.02) continue;
      const tw = ctx.measureText(h.text).width + 28;
      ctx.globalAlpha = a * 0.75; ctx.fillStyle = 'rgba(14,10,30,0.8)';
      roundRect(h.x - tw / 2, h.y - 17, tw, 34, 17); ctx.fill();
      ctx.globalAlpha = a; ctx.fillStyle = '#f6ecd9'; ctx.fillText(h.text, h.x, h.y + 1);
    }
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawCasters(pal, L, now) {
    const base = mixc(pal.amb, [10, 6, 22], 0.25);
    const rim = pal.lc;
    for (const cp of Wd.polys) {
      const pts = cp.pts, st = cp.style;
      let col = base;
      if (st === 'leaf') col = mixc(base, [20, 50, 40], 0.35);
      else if (st === 'blade') col = mixc(base, [60, 40, 30], 0.25);
      else if (st === 'roof') col = mixc(base, [70, 30, 40], 0.3);
      else if (st === 'beam') col = mixc(base, [50, 40, 70], 0.3);
      ctx.fillStyle = rgb(col);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath(); ctx.fill();
      // 디테일
      decorate(cp, col, now);
      // 림 라이트: 광원을 향한 변
      if (L) {
        ctx.strokeStyle = rgb(rim, 0.7 * L.s); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        ctx.beginPath();
        const n = pts.length;
        let cx = 0, cy = 0; for (const q of pts) { cx += q[0]; cy += q[1]; } cx /= n; cy /= n;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          let nx = b[1] - a[1], ny = -(b[0] - a[0]);
          const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy;
          if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
          const dot = -(nx * L.dx + ny * L.dy) / Math.hypot(nx, ny);
          if (dot > 0.15) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        }
        ctx.stroke();
      }
    }
    // 풍차 허브
    for (const c of level.casters) if (c.mill) {
      ctx.fillStyle = rgb(mixc(base, [255, 210, 150], 0.15)); ctx.beginPath(); ctx.arc(c.mill.cx, c.mill.cy, 16, 0, 6.283); ctx.fill();
      ctx.fillStyle = rgb(pal.lc, 0.6); ctx.beginPath(); ctx.arc(c.mill.cx, c.mill.cy, 5, 0, 6.283); ctx.fill();
    }
  }
  function decorate(cp, col, now) {
    const st = cp.style, src = cp.src;
    if (!src || !(src.r || src.slide)) {
      if (st === 'gnomon') {
        const p = cp.pts; ctx.strokeStyle = rgb(mixc(col, [255, 220, 160], 0.18)); ctx.lineWidth = 2;
        ctx.beginPath(); for (let k = 1; k < 6; k++) { const y = lerp(p[1][1], p[0][1], k / 6); ctx.moveTo(p[3][0] - 6, y); ctx.lineTo(p[3][0] - 22, y); } ctx.stroke();
      }
      if (st === 'blade') {
        const p = cp.pts; ctx.strokeStyle = rgb(mixc(col, [255, 220, 160], 0.12)); ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = 1; k < 5; k++) { const a = lerp(p[0][0], p[1][0], k / 5), b = lerp(p[0][1], p[1][1], k / 5), c2 = lerp(p[3][0], p[2][0], k / 5), d = lerp(p[3][1], p[2][1], k / 5); ctx.moveTo(a, b); ctx.lineTo(c2, d); }
        ctx.stroke();
      }
      return;
    }
    const x = cp.pts[0][0], y = cp.pts[0][1], w = cp.pts[1][0] - cp.pts[0][0], h = cp.pts[2][1] - cp.pts[1][1];
    const hl = rgb(mixc(col, [255, 225, 170], 0.13));
    const dk = rgb(mixc(col, [0, 0, 0], 0.35));
    if (st === 'pillar' || st === 'tower' || st === 'clocktower' || st === 'mill' || st === 'trunk') {
      ctx.fillStyle = hl; ctx.fillRect(x - 4, y, w + 8, 10); ctx.fillRect(x - 4, y + h - 12, w + 8, 12);
      if (st === 'pillar') { ctx.fillStyle = dk; for (let k = x + 10; k < x + w - 6; k += 14) ctx.fillRect(k, y + 16, 3, h - 34); }
      if (st === 'tower' || st === 'clocktower') {
        ctx.fillStyle = 'rgba(255,200,120,0.55)';
        for (let yy = y + 40; yy < y + h - 60; yy += 90) { roundRect(x + w / 2 - 9, yy, 18, 30, 9); ctx.fill(); }
      }
      if (st === 'clocktower') {
        const cx = x + w / 2, cy = y + 60, r = Math.min(w * 0.36, 46);
        ctx.fillStyle = 'rgba(255,236,190,0.9)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.fill();
        ctx.strokeStyle = dk; ctx.lineWidth = 4; ctx.lineCap = 'round';
        const hr = ((6 + t * 12) % 12) / 12 * 6.283, mn = ((t * 720) % 60) / 60 * 6.283;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(hr) * r * 0.5, cy - Math.cos(hr) * r * 0.5); ctx.stroke();
        ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(mn) * r * 0.8, cy - Math.cos(mn) * r * 0.8); ctx.stroke();
      }
      if (st === 'trunk') { ctx.fillStyle = dk; for (let k = 0; k < 4; k++) ctx.fillRect(x + 8 + k * 9, y + 20, 2, h - 40); }
    } else if (st === 'beam') {
      ctx.fillStyle = hl; ctx.fillRect(x, y, w, 4);
      ctx.fillStyle = dk;
      for (let k = x + 12; k < x + w - 6; k += 26) { ctx.beginPath(); ctx.arc(k, y + h / 2 + 1, 2.5, 0, 6.283); ctx.fill(); }
      // 매달린 사슬
      ctx.strokeStyle = rgb(mixc(col, [255, 225, 170], 0.08), 0.8); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + 10, y - 900); ctx.moveTo(x + w - 10, y); ctx.lineTo(x + w - 10, y - 900); ctx.stroke();
    } else if (st === 'stone') {
      ctx.fillStyle = hl; ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = dk;
      for (let yy = y + 22; yy < y + h; yy += 22) ctx.fillRect(x + 4, yy, w - 8, 2);
    }
  }

  function drawGoal(now) {
    const [gx, gy] = level.goal;
    const open = hasKey;
    const w = 46, h = 70;
    ctx.save(); ctx.translate(gx, gy);
    if (open) {
      const gl = ctx.createRadialGradient(0, -h * 0.55, 4, 0, -h * 0.55, 90);
      gl.addColorStop(0, `rgba(255,214,140,${0.55 + 0.15 * Math.sin(now / 300)})`); gl.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -h * 0.55, 90, 0, 6.283); ctx.fill();
    }
    // 아치 틀
    ctx.fillStyle = '#1d1534';
    ctx.beginPath(); ctx.moveTo(-w / 2 - 6, 0); ctx.lineTo(-w / 2 - 6, -h + w / 2); ctx.arc(0, -h + w / 2, w / 2 + 6, Math.PI, 0); ctx.lineTo(w / 2 + 6, 0); ctx.closePath(); ctx.fill();
    // 안쪽
    const ig = ctx.createLinearGradient(0, -h, 0, 0);
    if (open) { ig.addColorStop(0, '#fff3cf'); ig.addColorStop(1, '#ffae55'); } else { ig.addColorStop(0, '#3a2d5e'); ig.addColorStop(1, '#241a40'); }
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h + w / 2); ctx.arc(0, -h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill();
    // 시계 문양
    const cy = -h + w / 2 + 2;
    ctx.strokeStyle = open ? 'rgba(120,60,10,0.7)' : 'rgba(180,160,230,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, cy, 13, 0, 6.283); ctx.stroke();
    const a1 = now / 900, a2 = now / 5000;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(Math.sin(a1) * 10, cy - Math.cos(a1) * 10); ctx.moveTo(0, cy); ctx.lineTo(Math.sin(a2) * 6, cy - Math.cos(a2) * 6); ctx.stroke();
    if (!open) {
      ctx.fillStyle = 'rgba(255,207,122,0.6)'; ctx.beginPath(); ctx.arc(0, -22, 5, 0, 6.283); ctx.fill(); ctx.fillRect(-2, -22, 4, 11);
    }
    ctx.restore();
  }
  function drawKey(x, y, now) {
    const b = Math.sin(now / 400) * 5;
    ctx.save(); ctx.translate(x, y + b);
    const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 40); gl.addColorStop(0, 'rgba(255,220,140,0.6)'); gl.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 40, 0, 6.283); ctx.fill();
    ctx.rotate(Math.sin(now / 700) * 0.2);
    ctx.fillStyle = '#ffcf7a'; ctx.strokeStyle = '#ffcf7a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, -6, 7, 0, 6.283); ctx.fill();
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + now / 1500; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 9, -6 + Math.sin(a) * 9); ctx.lineTo(Math.cos(a) * 13, -6 + Math.sin(a) * 13); ctx.stroke(); }
    ctx.fillRect(-1.5, 1, 3, 16); ctx.fillRect(1, 11, 6, 3); ctx.fillRect(1, 15, 4, 2.5);
    ctx.restore();
  }
  function drawShard(x, y, now) {
    const b = Math.sin(now / 350 + 1) * 4;
    ctx.save(); ctx.translate(x, y + b); ctx.rotate(Math.sin(now / 900) * 0.3);
    const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 30); gl.addColorStop(0, 'rgba(190,170,255,0.6)'); gl.addColorStop(1, 'rgba(150,130,255,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#b9a6ff'; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(8, 0); ctx.lineTo(0, 13); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#eee8ff'; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(3, -1); ctx.lineTo(-3, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawPlayer(now) {
    const p = player;
    const x = p.x, y = p.y;
    let sx = 1 + sq, sy = 1 - sq;
    if (!p.gr) { const st = clamp(-p.vy / 2000, -0.15, 0.2); sx = 1 - st; sy = 1 + st; }
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
    // 오라
    const gl = ctx.createRadialGradient(0, -15, 3, 0, -15, 30); gl.addColorStop(0, 'rgba(120,90,230,0.35)'); gl.addColorStop(1, 'rgba(120,90,230,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -15, 30, 0, 6.283); ctx.fill();
    // 몸 (잉크 방울)
    const lean = clamp(-p.vx / 250, -1, 1) * 6;
    const wob = Math.sin(now / 160) * 1.2;
    ctx.fillStyle = '#120b24';
    ctx.beginPath();
    ctx.moveTo(lean + wob, -36);
    ctx.bezierCurveTo(lean * 0.5 + 6, -28, 12, -20, 12, -10);
    ctx.bezierCurveTo(12, -2, 6, 0, 0, 0);
    ctx.bezierCurveTo(-6, 0, -12, -2, -12, -10);
    ctx.bezierCurveTo(-12, -20, lean * 0.5 - 6, -28, lean + wob, -36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,130,255,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    // 눈
    blink -= 1 / 60; if (blink < -3 - Math.random() * 2) blink = 0.12;
    const eh = blink > 0 ? 0.6 : 3.4;
    const ex = p.face * 2.5;
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.ellipse(ex - 4.2, -13, 2.3, eh, 0, 0, 6.283); ctx.ellipse(ex + 4.2, -13, 2.3, eh, 0, 0, 6.283); ctx.fill();
    // 꼬리 위습
    ctx.restore();
  }

  /* ═════════════ HUD 갱신 ═════════════ */
  function clockText(tt) {
    let mins;
    if (tt < 1) mins = 6 * 60 + tt * 12 * 60; else mins = 18 * 60 + (tt - 1) * 12 * 60;
    mins = Math.floor(mins) % (24 * 60);
    const h = Math.floor(mins / 60), m = Math.floor(mins % 60 / 5) * 5;
    const ap = h < 12 ? '오전' : '오후'; let hh = h % 12; if (hh === 0) hh = 12;
    return `${ap} ${hh}:${String(m).padStart(2, '0')}`;
  }
  function buildMarks() {
    const tm = SC.tMax(level);
    const marks = [0.5]; if (level.moon) marks.push(1, C.DUSK1, 1.55);
    $('tbMarks').innerHTML = marks.map(m => `<div class="tb-mark" style="left:calc(4px + (100% - 8px) * ${m / tm})"></div>`).join('');
    const stops = [];
    const N = 24; for (let i = 0; i <= N; i++) { const tt = i / N * tm; const p = palette(tt); stops.push(`${rgb(mixc(p.bot, p.top, 0.4))} ${(i / N * 100).toFixed(1)}%`); }
    $('tbGrad').style.background = `linear-gradient(90deg,${stops.join(',')})`;
    $('tbEnd').textContent = level.moon ? '월몰' : '일몰';
  }
  let hudCache = '';
  function updateHUD() {
    const tm = SC.tMax(level);
    const k = t / tm;
    const thumb = $('tbThumb');
    thumb.style.left = `calc(4px + (100% - 8px) * ${k})`;
    $('tbPast').style.width = `calc(4px + (100% - 8px) * ${k})`;
    const phase = t < 1 ? 'sun' : t < C.DUSK1 ? 'dusk' : 'moon';
    const key = phase + Math.floor(t * 48);
    if (key !== hudCache) {
      hudCache = key;
      thumb.className = 'tb-thumb' + (phase === 'sun' ? '' : ' ' + phase);
      const cl = $('clock'); cl.className = 'clock' + (phase === 'sun' ? '' : ' ' + phase);
      $('clockTxt').textContent = phase === 'dusk' ? '황혼' : clockText(t);
      const remain = level.moon ? 2 - t : 1 - t;
      $('timebar').classList.toggle('warn', remain < 0.08 || (level.moon && t < 1 && 1 - t < 0.05));
      $('tbTxt').textContent = phase === 'dusk' ? '황혼 — 그림자가 없어요!' : phase === 'moon' ? '달빛 그림자' : t < 0.5 ? '오전' : '오후';
      Snd.mood(phase === 'sun' ? (t < 0.35 ? 'day' : t < 0.7 ? 'noon' : 'eve') : 'night');
    }
    $('tbHint').style.opacity = (t - (level.t0 || 0) < 0.01 && rt < 12) ? 1 : 0;
  }

  /* ═════════════ 화면 전환 / UI ═════════════ */
  const screens = ['title', 'select', 'pause', 'result', 'help'];
  function hideAll() { screens.forEach(s => $(s).classList.add('hidden')); }
  function showHUD(on) { $('hud').classList.toggle('hidden', !on); $('touch').classList.toggle('hidden', !(on && isTouch)); }
  function showCard(a, b) {
    $('cardCh').textContent = a; $('cardName').textContent = b;
    const c = $('card'); c.classList.add('show'); clearTimeout(showCard._t); showCard._t = setTimeout(() => c.classList.remove('show'), 2200);
  }
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200); }

  function startLevel(i) { hideAll(); loadLevel(i); mode = 'play'; showHUD(true); }
  function pauseGame() {
    if (mode !== 'play') return; mode = 'pause';
    orbDrag = barDrag = null; tTarget = t; input.tL = input.tR = input.tJ = false;
    $('pauseLv').textContent = level.id + ' ' + level.name; updSoundBtns();
    $('pause').classList.remove('hidden');
  }
  function resumeGame() { $('pause').classList.add('hidden'); mode = 'play'; }
  function showClear() {
    mode = 'result';
    const timeOk = t <= level.par + 1e-6;
    const stars = 1 + (timeOk ? 1 : 0) + (gotShard ? 1 : 0);
    const prev = save.best[level.id] || { s: 0 };
    save.best[level.id] = { s: Math.max(prev.s || 0, stars), sh: !!(prev.sh || gotShard), tm: !!(prev.tm || timeOk) };
    persist();
    $('resLv').textContent = level.id + ' ' + level.name + ' — ' + clockText(t) + '에 도착';
    const starSvg = (on, i) => `<svg class="star" data-i="${i}" viewBox="0 0 24 24"><path fill="${on ? '#ffcf7a' : '#5e5478'}" d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/></svg>`;
    $('resStars').innerHTML = [0, 1, 2].map(i => starSvg(i < stars, i)).join('');
    const parTxt = clockText(level.par);
    $('resCrit').innerHTML = `<span class="ok">★ 정원 탈출</span><span class="${timeOk ? 'ok' : ''}">${timeOk ? '★' : '☆'} ${parTxt} 이전에 도착</span><span class="${gotShard ? 'ok' : ''}">${gotShard ? '★' : '☆'} 그림자 조각 획득</span>`;
    $('rNext').style.display = lvIdx < LEVELS.length - 1 ? '' : 'none';
    $('resClear').classList.remove('hidden'); $('resFail').classList.add('hidden');
    $('result').classList.remove('hidden');
    const ss = $('resStars').querySelectorAll('.star');
    ss.forEach((el, i) => setTimeout(() => { if (i < stars) { el.classList.add('on'); Snd.ui(); } else el.style.opacity = 0.35; }, 250 + i * 260));
    if (lvIdx === LEVELS.length - 1) $('resLv').textContent += ' · 모든 정원을 탈출했어요!';
  }
  function showFail(reason) {
    mode = 'result';
    const M = {
      burn: ['☀', '빛에 닿았어요', '빛나는 바닥은 그림자로 덮였을 때만 안전해요.'],
      sunset: ['🌇', '해가 졌어요', '해가 지면 모든 그림자가 사라져요. 더 일찍 움직여 보세요.'],
      moonset: ['🌘', '달이 졌어요', '달이 지기 전에 시계 문에 도착해야 해요.'],
    }[reason] || ['☀', '실패', ''];
    $('failIco').textContent = M[0]; $('failTitle').textContent = M[1]; $('failMsg').textContent = M[2];
    $('resClear').classList.add('hidden'); $('resFail').classList.remove('hidden');
    $('result').classList.remove('hidden');
  }
  function buildSelect() {
    let html = '', total = 0;
    for (let ch = 1; ch <= 5; ch++) {
      html += `<div class="chap"><div class="chap-h"><b>${ch}장 · ${CHAPTERS[ch]}</b><span>${['', '그림자 걷기와 태양 끌기', '시간의 순서를 계획하기', '돌아가는 그림자', '구름과 바람', '해가 진 뒤, 반대편의 달'][ch]}</span></div><div class="stages">`;
      LEVELS.forEach((lv, i) => {
        if (lv.ch !== ch) return;
        const b = save.best[lv.id]; const s = b ? b.s : 0; total += s;
        const un = isUnlocked(i);
        html += `<button class="stage" data-i="${i}" ${un ? '' : 'disabled'}><span class="num">${lv.id}${un ? '' : ' 🔒'}</span><span class="nm">${lv.name}</span><span class="st">${[0, 1, 2].map(k => k < s ? '<i>★</i>' : '★').join('')}</span></button>`;
      });
      html += '</div></div>';
    }
    $('chapters').innerHTML = html;
    $('totalStars').textContent = `★ ${total}/${LEVELS.length * 3}`;
    $('chapters').querySelectorAll('.stage').forEach(b => b.onclick = () => { Snd.init(); Snd.ui(); startLevel(+b.dataset.i); });
  }
  function openSelect() { hideAll(); mode = 'title'; showHUD(false); buildSelect(); $('select').classList.remove('hidden'); }
  function updSoundBtns() {
    $('pSfx').textContent = '효과음 ' + (save.sfx ? '켜짐' : '꺼짐');
    $('pMusic').textContent = '배경음 ' + (save.music ? '켜짐' : '꺼짐');
    $('btnSound').textContent = '소리 ' + (save.sfx || save.music ? '켜짐' : '꺼짐');
  }
  function nextUncleared() { for (let i = 0; i < LEVELS.length; i++) if (!save.best[LEVELS[i].id]) return i; return 0; }

  $('btnStart').onclick = () => { Snd.init(); Snd.ui(); if (!save.seenHelp) { save.seenHelp = true; persist(); hideAll(); $('help').classList.remove('hidden'); $('help').dataset.next = 'start'; return; } startLevel(nextUncleared()); };
  $('btnSelect').onclick = () => { Snd.init(); Snd.ui(); openSelect(); };
  $('btnHelp').onclick = () => { Snd.init(); Snd.ui(); hideAll(); $('help').classList.remove('hidden'); $('help').dataset.next = 'title'; };
  $('helpClose').onclick = () => { Snd.ui(); const n = $('help').dataset.next; hideAll(); if (n === 'start') startLevel(nextUncleared()); else $('title').classList.remove('hidden'); };
  $('btnSound').onclick = () => { Snd.init(); const on = !(save.sfx || save.music); Snd.setSfx(on); Snd.setMusic(on); updSoundBtns(); };
  $('selBack').onclick = () => { Snd.ui(); hideAll(); $('title').classList.remove('hidden'); };
  $('btnPause').onclick = () => { Snd.ui(); pauseGame(); };
  $('pResume').onclick = () => { Snd.ui(); resumeGame(); };
  $('pRestart').onclick = () => { Snd.ui(); hideAll(); restart(); };
  $('pSelect').onclick = () => { Snd.ui(); openSelect(); };
  $('pSfx').onclick = () => { Snd.setSfx(!save.sfx); updSoundBtns(); Snd.ui(); };
  $('pMusic').onclick = () => { Snd.setMusic(!save.music); updSoundBtns(); };
  $('rNext').onclick = () => { Snd.ui(); startLevel(Math.min(lvIdx + 1, LEVELS.length - 1)); };
  $('rRetry').onclick = () => { Snd.ui(); hideAll(); restart(); };
  $('rSelect').onclick = () => { Snd.ui(); openSelect(); };
  $('fRetry').onclick = () => { Snd.ui(); hideAll(); restart(); };
  $('fSelect').onclick = () => { Snd.ui(); openSelect(); };
  $('btnFull').onclick = () => {
    const d = document, el = d.documentElement;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) {
      const rq = el.requestFullscreen || el.webkitRequestFullscreen;
      if (rq) { const p = rq.call(el); if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => { }); }
      else toast('이 브라우저는 전체 화면을 지원하지 않아요 — 홈 화면에 추가해 보세요');
    } else { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
  };
  if (isTouch) document.body.classList.add('touch');
  updSoundBtns();

  /* ═════════════ 타이틀 배경 데모 ═════════════ */
  function titleDemo(now) {
    // 타이틀/선택 화면 뒤에서 1-1 장면이 천천히 흐름
    if (!level || level !== LEVELS[0] || mode !== 'title') { level = LEVELS[0]; level._static = null; player = SC.newPlayer(level.start[0], level.start[1]); genHills(0); }
    t = 0.08 + ((now / 1000) * 0.02) % 0.86; rt = now / 1000;
    Wd = SC.world(level, t, rt);
    camX = (level.w - viewW) / 2; camY = C.H + 10 - viewH;
    const save0 = player.dead; player.dead = 'hide';
    draw(now); player.dead = save0;
  }

  /* ═════════════ 메인 루프 ═════════════ */
  let last = performance.now(), acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1;
    if (mode === 'title') { titleDemo(now); return; }
    if (mode === 'play') {
      acc += dt;
      let n = 0;
      while (acc >= C.DT && n < 12) { step(C.DT); acc -= C.DT; n++; }
      if (n === 12) acc = 0;
      flash = Math.max(0, flash - dt * 1.5);
      updateCamera(dt);
      updateHUD();
    }
    draw(now);
  }
  /*DEV*/
  if (location.search.indexOf('dev') >= 0) {
    window.__dev = {
      start(i) { startLevel(i); },
      setT(v) { t = tTarget = v; },
      setP(x, y) { player.x = x; player.y = y; camInit = false; },
      noDie() { player.dead = null; },
      state() { return { t, rt, x: player.x, y: player.y, dead: player.dead, won, hasKey }; },
      unlockAll() { LEVELS.forEach(l => save.best[l.id] = save.best[l.id] || { s: 1 }); persist(); },
    };
  }
  /*/DEV*/
  resize();
  requestAnimationFrame(frame);
})();
