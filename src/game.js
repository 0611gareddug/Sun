/* 해시계 등반가 — 게임 본체 v2 (픽셀 렌더러 / 시간 양방향 / 입력 / 사운드 / UI) */
(function () {
  'use strict';
  const SC = window.SunCore, LEVELS = window.SunLevels, C = SC.C;
  const CHAPTERS = ['', '새벽 정원', '시계탑 뜰', '해바라기 온실', '풍차 언덕', '구름 고원', '달밤의 시계탑'];
  const CH_SUB = ['', '그림자 걷기와 태양 끌기', '시간대를 고르는 법', '시간에 반응하는 장치들', '돌아가는 그림자', '구름과 바람', '해가 진 뒤, 반대편의 달'];
  const $ = (id) => document.getElementById(id);
  const cv = $('game'), ctx = cv.getContext('2d', { alpha: false });
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || matchMedia('(pointer:coarse)').matches;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, k) => a + (b - a) * k;
  const PXW = 2.5; // 픽셀 1칸 = 월드 2.5

  /* ═════════════ 저장 ═════════════ */
  const SAVE_KEY = 'hsclimb.v2';
  let save = { best: {}, sfx: true, music: true, seenHelp: false };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.best) save = Object.assign(save, s); } catch (e) { }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { } }
  function isUnlocked(i) { return i === 0 || !!save.best[LEVELS[i - 1].id]; }

  /* ═════════════ 사운드 (8비트 느낌 합성) ═════════════ */
  const Snd = (() => {
    let ac = null, sfxG = null, musG = null, noiseBuf = null, pad = null;
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC();
      const master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
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
      env(g, t, 0.005, vol, dur); o.connect(g); g.connect(sfxG); o.start(t); o.stop(t + dur + 0.05);
    }
    function noise(dur, vol, ftype, f0, f1, delay) {
      if (!ac) return; const t = ac.currentTime + (delay || 0);
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain(); env(g, t, 0.004, vol, dur);
      s.connect(f); f.connect(g); g.connect(sfxG); s.start(t); s.stop(t + dur + 0.05);
    }
    function startPad() {
      const out = ac.createGain(); out.gain.value = 0; out.connect(musG);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.connect(out);
      const oscs = [0, 1, 2, 3].map((i) => {
        const o = ac.createOscillator(); o.type = i === 0 ? 'triangle' : 'square';
        const g = ac.createGain(); g.gain.value = i === 0 ? 0.06 : 0.012;
        o.connect(g); g.connect(lp); o.start(); return o;
      });
      out.gain.linearRampToValueAtTime(0.5, ac.currentTime + 3);
      pad = { oscs, last: '' };
    }
    const chords = { day: [130.81, 261.63, 329.63, 392.0], noon: [146.83, 293.66, 369.99, 440.0], eve: [110.0, 220.0, 261.63, 329.63], night: [98.0, 196.0, 233.08, 293.66] };
    let lastTick = 0, tickAlt = false;
    return {
      init,
      mood(m) { if (!pad || pad.last === m) return; pad.last = m; const t = ac.currentTime; chords[m].forEach((f, i) => pad.oscs[i].frequency.setTargetAtTime(f, t, 1.2)); },
      setSfx(on) { save.sfx = on; persist(); if (sfxG) sfxG.gain.value = on ? 1 : 0; },
      setMusic(on) { save.music = on; persist(); if (musG) musG.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.2); },
      jump() { tone('square', 330, 660, 0.09, 0.07); },
      land() { noise(0.05, 0.14, 'lowpass', 500, 200); },
      tick(rev) {
        if (!ac) return; const now = ac.currentTime; if (now - lastTick < 0.08) return; lastTick = now; tickAlt = !tickAlt;
        tone('square', rev ? (tickAlt ? 700 : 560) : (tickAlt ? 1400 : 1100), 0, 0.025, 0.035);
      },
      key() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('square', f, 0, 0.12, 0.06, i * 0.07)); },
      shard() { [1318.5, 1568, 2093].forEach((f, i) => tone('triangle', f, 0, 0.18, 0.08, i * 0.05)); },
      win() { [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone('square', f, 0, 0.16, 0.06, i * 0.08)); tone('triangle', 130.8, 0, 1.0, 0.1, 0.5); },
      burn() { noise(0.5, 0.25, 'bandpass', 3000, 300); tone('square', 440, 70, 0.45, 0.06); },
      rewind() { tone('square', 200, 900, 0.35, 0.05); noise(0.3, 0.06, 'highpass', 2000, 8000); },
      ui() { tone('square', 880, 0, 0.04, 0.04); },
      dusk() { tone('triangle', 220, 110, 1.2, 0.1); },
    };
  })();

  /* ═════════════ 화면 / 픽셀 버퍼 ═════════════ */
  let W = 0, H = 0, DPR = 1, K = 2, lw = 320, lh = 180, viewW = 0, viewH = 0;
  const lo = document.createElement('canvas'), lc = lo.getContext('2d', { willReadFrequently: true });
  let img = null, buf = null, mask = null;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    const target = (H < 520 ? 640 : 800) / PXW;
    K = Math.max(1, Math.round(H * DPR / target));
    lh = Math.ceil(H * DPR / K); lw = Math.ceil(W * DPR / K);
    lo.width = lw; lo.height = lh;
    cv.width = lw * K; cv.height = lh * K;
    cv.style.width = (lw * K / DPR) + 'px'; cv.style.height = (lh * K / DPR) + 'px';
    viewH = lh * PXW; viewW = lw * PXW;
    mask = new Uint8Array(lw * lh);
    const tcs = clamp(Math.min(W, H) * 0.17, 60, 88);
    document.documentElement.style.setProperty('--tcs', tcs + 'px');
    for (const h of hintEls) h.w = 0;
    checkRotate();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  let rotateSkipped = false;
  function checkRotate() { $('rotate').classList.toggle('hidden', !(isTouch && H > W && !rotateSkipped)); }
  $('rotSkip').onclick = () => { rotateSkipped = true; checkRotate(); };
  const cssPerPx = () => K / DPR;

  /* ═════════════ 스프라이트 ═════════════ */
  function makeSprite(rows, pal) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) { const ch = rows[y][x]; if (ch !== '.' && pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }
    const f = document.createElement('canvas'); f.width = w; f.height = h;
    const gf = f.getContext('2d'); gf.translate(w, 0); gf.scale(-1, 1); gf.drawImage(c, 0, 0);
    return { c, f, w, h };
  }
  const PP = { o: '#9b86ff', b: '#140b26', e: '#fff3c4' };
  const SPR = {
    idle: makeSprite(['....oo....', '...obbo...', '...obbo...', '..obbbbo..', '.obbbbbbo.', '.obbbbbbo.', 'obbbbbbbbo', 'obbbbebbeo', 'obbbbebbeo', 'obbbbbbbbo', '.obbbbbbo.', '..oooooo..'], PP),
    blink: makeSprite(['....oo....', '...obbo...', '...obbo...', '..obbbbo..', '.obbbbbbo.', '.obbbbbbo.', 'obbbbbbbbo', 'obbbbbbbbo', 'obbbbebbeo', 'obbbbbbbbo', '.obbbbbbo.', '..oooooo..'], PP),
    run1: makeSprite(['.....oo...', '....obbo..', '...obbo...', '..obbbbo..', '.obbbbbbo.', '.obbbbbbo.', 'obbbbbbbbo', 'obbbbebbeo', 'obbbbebbeo', 'obbbbbbbbo', '.obbbbbbo.', '.oo...ooo.'], PP),
    run2: makeSprite(['.....oo...', '....obbo..', '...obbo...', '..obbbbo..', '.obbbbbbo.', '.obbbbbbo.', 'obbbbbbbbo', 'obbbbebbeo', 'obbbbebbeo', 'obbbbbbbbo', '.obbbbbbo.', '..ooo..oo.'], PP),
    jump: makeSprite(['....oo....', '....oo....', '...obbo...', '...obbo...', '..obbbbo..', '.obbbbbbo.', '.obbbbbbo.', 'obbbbebbeo', 'obbbbebbeo', 'obbbbbbbbo', '.obbbbbbo.', '..oooooo..', '...o..o...'], PP),
    key: makeSprite(['..y.y.y..', '...yyy...', '.yyYYYyy.', 'y.yY.Yy.y', '.yyYYYyy.', '...yyy...', '..y.y.y..', '....y....', '....yyy..', '....y....', '....yy...'], { y: '#ffb84d', Y: '#fff1c9' }),
    shard: makeSprite(['...w...', '..wvw..', '.wvvvv.', 'wvvvvvv', '.vvvvv.', '..vvv..', '...v...'], { w: '#f3eeff', v: '#9b86ff' }),
    flower: makeSprite(['..y.y.y..', '.yyyyyyy.', 'yyybbbyyy', '.yybbbyy.', 'yyybbbyyy', '.yyyyyyy.', '..y.y.y..'], { y: '#ffd23f', b: '#6b3a1a' }),
    hourglass: makeSprite(['vvvvv', '.vwv.', '..v..', '.vwv.', 'vvvvv'], { v: '#c9b8ff', w: '#fff3c4' }),
    gateLamp: makeSprite(['.mmmmm.', 'mgggggm', '.mmmmm.'], { m: '#3a2c63', g: '#7ee0b0' }),
  };
  function blit(s, x, y, flip) { lc.drawImage(flip ? s.f : s.c, Math.round(x), Math.round(y)); }

  /* ═════════════ 상태 ═════════════ */
  let mode = 'title';
  let lvIdx = 0, level = null;
  let t = 0, tTarget = 0, rt = 0, used = 0, player = null, Wd = null, Wprev = null;
  let hasKey = false, gotShard = false, won = false, deadT = 0, winT = 0, endShown = false;
  let parts = [], snaps = [], snapTick = 0, timeDir = 0, timeDirShow = 0;
  let lastHourMark = -1, duskPlayed = false, camInit = false, lookX = 0, camX = 0, camY = 0, flash = 0;
  let runAnim = 0, blinkT = 0;
  let hintEls = [];
  const hills = [];

  function loadLevel(i) {
    lvIdx = i; level = LEVELS[i];
    t = tTarget = level.t0 || 0; rt = 0; used = 0;
    player = SC.newPlayer(level.start[0], level.start[1]);
    hasKey = !level.key; gotShard = false; won = false; deadT = 0; winT = 0; endShown = false;
    parts = []; snaps = []; snapTick = 0; duskPlayed = t >= 1; camInit = false; timeDir = 0; timeDirShow = 0;
    lastHourMark = Math.floor(t * 48);
    Wd = SC.world(level, t, rt); Wprev = null;
    genHills(i);
    $('lvCh').textContent = level.ch + '장 · ' + CHAPTERS[level.ch];
    $('lvName').textContent = level.id + ' ' + level.name;
    $('keyInd').classList.toggle('hidden', !level.key);
    updKeyInd(); buildBar(); buildHints(); hudKey = '';
    showCard(level.ch + '장 · ' + CHAPTERS[level.ch], level.id + ' ' + level.name);
    input.dirL = input.dirR = input.jh = input.jp = false;
  }
  function updKeyInd() { const k = $('keyInd'); k.classList.toggle('got', hasKey); k.textContent = hasKey ? '☼ 태양 열쇠' : '☼ 열쇠 필요'; }
  function genHills(seed) {
    let s = seed * 9301 + 49297;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    hills.length = 0;
    for (let i = 0; i < 3; i++) hills.push({ a: rnd() * 6, b: rnd() * 6, f1: 0.004 + rnd() * 0.004, f2: 0.011 + rnd() * 0.008 });
  }
  const parHours = (lv) => lv.parH || 12;

  /* ═════════════ 입력 ═════════════ */
  const input = { dirL: false, dirR: false, jh: false, jp: false, fwd: false, rew: false, tL: false, tR: false, tJ: false };
  const KL = ['ArrowLeft', 'KeyA'], KR = ['ArrowRight', 'KeyD'], KJ = ['Space', 'ArrowUp', 'KeyW'], KF = ['KeyE', 'ShiftRight', 'KeyX'], KB = ['KeyQ', 'ShiftLeft'];
  window.addEventListener('keydown', (e) => {
    Snd.init();
    const c = e.code;
    if (mode === 'play') {
      if (KL.includes(c)) input.dirL = true;
      if (KR.includes(c)) input.dirR = true;
      if (KJ.includes(c)) { if (!input.jh) input.jp = true; input.jh = true; }
      if (KF.includes(c)) input.fwd = true;
      if (KB.includes(c)) input.rew = true;
      if (c === 'KeyR') restart();
      if (c === 'Escape' || c === 'KeyP') pauseGame();
      if (c.startsWith('Arrow') || c === 'Space') e.preventDefault();
    } else if (mode === 'pause') { if (c === 'Escape' || c === 'KeyP') resumeGame(); }
    else if (mode === 'result') {
      const failing = !$('resFail').classList.contains('hidden');
      if (c === 'KeyR') { hideAll(); restart(); }
      else if (failing && c === 'KeyZ') $('fRewind').click();
      else if (c === 'Enter' || c === 'Space') (failing ? $('fRewind') : $('rNext')).click();
    }
  });
  window.addEventListener('keyup', (e) => {
    const c = e.code;
    if (KL.includes(c)) input.dirL = false; if (KR.includes(c)) input.dirR = false;
    if (KJ.includes(c)) input.jh = false; if (KF.includes(c)) input.fwd = false; if (KB.includes(c)) input.rew = false;
  });
  window.addEventListener('blur', () => { input.dirL = input.dirR = input.jh = input.fwd = input.rew = false; if (mode === 'play') pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') pauseGame(); });

  function bindHold(el, on, off) {
    const ids = new Set();
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); Snd.init(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch (_) { } el.classList.add('on'); on(); });
    const up = (e) => { ids.delete(e.pointerId); if (!ids.size) { el.classList.remove('on'); off(); } };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  bindHold($('tcL'), () => input.tL = true, () => input.tL = false);
  bindHold($('tcR'), () => input.tR = true, () => input.tR = false);
  bindHold($('tcJ'), () => { if (!input.tJ) input.jp = true; input.tJ = true; }, () => input.tJ = false);

  // 태양/달 직접 드래그 (앞뒤 모두)
  let orbDrag = null;
  cv.addEventListener('pointerdown', (e) => {
    Snd.init();
    if (mode !== 'play' || won || player.dead) return;
    const o = orbScreen();
    if (Math.hypot(e.clientX - o.x, e.clientY - o.y) < (isTouch ? 70 : 56)) {
      orbDrag = { id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (_) { } e.preventDefault();
    }
  });
  cv.addEventListener('pointermove', (e) => { if (orbDrag && orbDrag.id === e.pointerId) tTarget = tFromScreen(e.clientX, e.clientY); });
  const endOrb = (e) => { if (orbDrag && orbDrag.id === e.pointerId) { orbDrag = null; tTarget = t; } };
  cv.addEventListener('pointerup', endOrb); cv.addEventListener('pointercancel', endOrb);

  // 시간 막대 (절대 위치, 앞뒤 모두)
  const track = $('tbTrack');
  let barDrag = null;
  function barT(clientX) { const r = track.getBoundingClientRect(); return clamp((clientX - r.left - 6) / (r.width - 12), 0, 1) * SC.tMax(level); }
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault(); Snd.init();
    if (mode !== 'play' || won || player.dead) return;
    barDrag = { id: e.pointerId }; try { track.setPointerCapture(e.pointerId); } catch (_) { }
    tTarget = barT(e.clientX);
  });
  track.addEventListener('pointermove', (e) => { if (barDrag && barDrag.id === e.pointerId) tTarget = barT(e.clientX); });
  const endBar = (e) => { if (barDrag && barDrag.id === e.pointerId) { barDrag = null; tTarget = t; } };
  track.addEventListener('pointerup', endBar); track.addEventListener('pointercancel', endBar); track.addEventListener('lostpointercapture', endBar);

  /* ═════════════ 하늘 좌표 ═════════════ */
  function horizonPx() { return clamp(Math.round((C.G - camY) / PXW), Math.round(lh * 0.35), lh); }
  function skyPx(u, v) { return { x: u * lw, y: v / 0.95 * horizonPx() }; }
  function orbPx() {
    if (level.moon && t >= 1 && t < C.DUSK1) return null;
    const s = (level.moon && t >= C.DUSK1) ? SC.moonSky(t) : SC.sunSky(t);
    return skyPx(s.u, s.v);
  }
  function orbScreen() { const p = orbPx() || skyPx(0.5, 0.92); return { x: p.x * K / DPR, y: p.y * K / DPR }; }
  function tFromScreen(cx, cy) {
    const px = cx * DPR / K, py = cy * DPR / K;
    const u = px / lw, v = py * 0.95 / horizonPx();
    const ca = (0.5 - u) / 0.42, sa = (0.95 - v) / 0.8;
    const a = Math.atan2(Math.max(0.02, sa), ca) * 180 / Math.PI;
    if (!level.moon || t < 1.05) return clamp((a - C.DAY_A0) / (C.DAY_A1 - C.DAY_A0), 0, 1);
    return C.DUSK1 + clamp((a - C.MOON_A0) / (C.MOON_A1 - C.MOON_A0), 0, 1) * (2 - C.DUSK1);
  }

  /* ═════════════ 업데이트 ═════════════ */
  function restart() { if (level) loadLevel(lvIdx); mode = 'play'; showHUD(true); }
  function snapshot() { snaps.push({ p: Object.assign({}, player), t, rt, used, hasKey, gotShard }); if (snaps.length > 40) snaps.shift(); }
  function rewindDeath() {
    const idx = Math.max(0, snaps.length - 21), s = snaps[idx];
    if (!s) { hideAll(); restart(); return; }
    player = Object.assign({}, s.p); player.dead = null;
    t = tTarget = s.t; rt = s.rt; used = s.used; hasKey = s.hasKey; gotShard = s.gotShard;
    snaps = snaps.slice(0, idx);
    deadT = 0; endShown = false; Wprev = null; Wd = SC.world(level, t, rt); parts = [];
    updKeyInd(); hideAll(); mode = 'play'; showHUD(true); Snd.rewind(); flash = 0.25; timeDirShow = -0.6;
  }

  function step(dt) {
    rt += dt;
    timeDir = 0;
    if (!player.dead && !won) {
      const tm = SC.tMax(level);
      if (input.fwd && !input.rew) tTarget = Math.min(tm, t + C.TIME_RATE * dt * 1.5);
      if (input.rew && !input.fwd) tTarget = Math.max(0, t - C.TIME_RATE * dt * 1.5);
      tTarget = clamp(tTarget, 0, tm);
      if (Math.abs(tTarget - t) > 1e-9) {
        const nt = tTarget > t ? Math.min(tTarget, t + C.TIME_RATE * dt) : Math.max(tTarget, t - C.TIME_RATE * dt);
        timeDir = nt > t ? 1 : -1; timeDirShow = 0.25 * timeDir;
        used += Math.abs(nt - t); t = nt;
        const hmk = Math.floor(t * 48);
        if (hmk !== lastHourMark) { lastHourMark = hmk; Snd.tick(timeDir < 0); }
        if (level.moon && t >= 1 && t < C.DUSK1 && !duskPlayed) { duskPlayed = true; Snd.dusk(); }
        if (t < 1) duskPlayed = false;
      }
    }
    Wprev = Wd;
    Wd = SC.world(level, t, rt);
    if (!player.dead && !won) {
      const dir = (input.dirR || input.tR ? 1 : 0) - (input.dirL || input.tL ? 1 : 0);
      const ev = [], vyB = player.vy;
      SC.stepPlayer(player, { dir, jp: input.jp, jh: input.jh || input.tJ }, Wd, level, dt, ev, Wprev);
      input.jp = false;
      for (const e of ev) {
        if (e === 'jump') { Snd.jump(); puff(player.x, player.y, 5); }
        else if (e === 'land') { Snd.land(); if (vyB > 500) puff(player.x, player.y, 6); }
        else if (e === 'burn') killPlayer(player.dead);
      }
      if (!player.dead) {
        if (level.key && !hasKey && SC.overlaps(player, SC.keyRect(level))) { hasKey = true; Snd.key(); updKeyInd(); burst(level.key[0], level.key[1], 22, ['#ffb84d', '#fff1c9']); toast('태양 열쇠 획득! 시계 문이 열렸어요'); }
        if (level.shard && !gotShard && SC.overlaps(player, SC.shardRect(level))) { gotShard = true; Snd.shard(); burst(level.shard[0], level.shard[1], 18, ['#c9b8ff', '#9b86ff', '#ffffff']); }
        if (hasKey && player.gr && SC.overlaps(player, SC.goalRect(level))) winLevel();
        if (++snapTick >= 12) { snapTick = 0; snapshot(); }
      }
      if (Math.abs(player.vx) > 40 && player.gr) runAnim += dt * 10; else runAnim = 0;
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
    if (player.dead) { deadT += dt; if (deadT > 0.9 && !endShown) { endShown = true; showFail(player.dead); } }
    if (won) { winT += dt; if (winT > 1.2 && !endShown) { endShown = true; showClear(); } }
  }
  function killPlayer(reason) {
    if (won) return;
    Snd.burn(); flash = 0.5;
    burst(player.x, player.y - 14, 30, reason === 'gate' ? ['#7ee0b0', '#e8fff4', '#140b26'] : ['#fff1b8', '#ffb35c', '#ff6b3a', '#140b26']);
  }
  function winLevel() { won = true; Snd.win(); flash = 0.3; burst(level.goal[0], level.goal[1] - 36, 36, ['#ffb84d', '#fff1c9', '#ffffff']); }
  function puff(x, y, n) { for (let i = 0; i < n; i++) parts.push({ x, y: y - 2, vx: (Math.random() - 0.5) * 140, vy: -Math.random() * 60, life: 0.3 + Math.random() * 0.2, col: '#463670', g: 300, s: 1 }); }
  function burst(x, y, n, cols) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = 80 + Math.random() * 240; parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.5 + Math.random() * 0.6, col: cols[i % cols.length], g: 420, s: Math.random() < 0.3 ? 2 : 1 }); } }

  /* ═════════════ 팔레트 ═════════════ */
  const SKY = [
    [0.0, [52, 36, 92], [244, 140, 110], [255, 170, 120]],
    [0.18, [70, 112, 196], [248, 208, 160], [255, 220, 170]],
    [0.5, [64, 140, 220], [188, 228, 246], [255, 248, 222]],
    [0.8, [84, 98, 184], [250, 190, 132], [255, 205, 140]],
    [1.0, [60, 38, 96], [255, 112, 70], [255, 135, 85]],
    [1.05, [24, 20, 54], [92, 52, 108], [160, 120, 200]],
    [1.12, [12, 16, 46], [34, 46, 96], [190, 205, 255]],
    [1.6, [10, 14, 42], [28, 42, 92], [200, 215, 255]],
    [2.0, [32, 26, 72], [82, 62, 120], [210, 200, 255]],
  ];
  function mixc(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function hex(c) { return '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
  function palette(tt) {
    if (!level.moon && tt > 1) tt = 1;
    let i = 0; while (i < SKY.length - 2 && SKY[i + 1][0] <= tt) i++;
    const A = SKY[i], B = SKY[i + 1], k = clamp((tt - A[0]) / (B[0] - A[0]), 0, 1);
    return { top: mixc(A[1], B[1], k), bot: mixc(A[2], B[2], k), lc: mixc(A[3], B[3], k) };
  }

  /* ═════════════ 픽셀 래스터 ═════════════ */
  let camPX = 0, camPY = 0;
  const wx = (x) => (x - camPX * PXW) / PXW, wy = (y) => (y - camPY * PXW) / PXW;
  function scan(pts, cb) {
    let minY = Infinity, maxY = -Infinity;
    const n = pts.length, P = new Array(n);
    for (let i = 0; i < n; i++) { const x = wx(pts[i][0]), y = wy(pts[i][1]); P[i] = [x, y]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const y0 = Math.max(0, Math.ceil(minY - 0.5)), y1 = Math.min(lh - 1, Math.floor(maxY - 0.5));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5; let xa = Infinity, xb = -Infinity;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          const x = a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
          if (x < xa) xa = x; if (x > xb) xb = x;
        }
      }
      if (xa > xb) continue;
      const x0 = Math.max(0, Math.ceil(xa - 0.5)), x1 = Math.min(lw - 1, Math.floor(xb - 0.5));
      if (x0 <= x1) cb(y, x0, x1);
    }
  }
  function fillPoly(pts, c) { scan(pts, (y, x0, x1) => { let o = (y * lw + x0) * 4; for (let x = x0; x <= x1; x++, o += 4) { buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; } }); }
  function blendPx(x, y, c, a) {
    if (x < 0 || y < 0 || x >= lw || y >= lh) return;
    const o = (y * lw + x) * 4;
    buf[o] += (c[0] - buf[o]) * a; buf[o + 1] += (c[1] - buf[o + 1]) * a; buf[o + 2] += (c[2] - buf[o + 2]) * a;
  }
  function line(x0, y0, x1, y1, c, a, dashed) {
    x0 = Math.round(wx(x0)); y0 = Math.round(wy(y0)); x1 = Math.round(wx(x1)); y1 = Math.round(wy(y1));
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    for (let g = 0; g < 4000; g++) {
      if (!dashed || (n++ & 2) === 0) blendPx(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /* ═════════════ 렌더링 ═════════════ */
  const stars = Array.from({ length: 70 }, () => ({ u: Math.random(), v: Math.random() * 0.75, p: Math.random() * 6 }));
  function updateCamera(dt) {
    lookX = lerp(lookX, (player.vx || 0) * 0.35, 1 - Math.pow(0.05, dt));
    const tx = player.x + lookX - viewW / 2;
    const minX = Math.min(0, (level.w - viewW) / 2), maxX = Math.max(level.w - viewW, (level.w - viewW) / 2);
    const cx = clamp(tx, minX, maxX);
    const botLimit = C.G - viewH * (isTouch ? 0.74 : 0.76);
    const ty = clamp(player.y - viewH * 0.55, Math.min(-140, botLimit), botLimit);
    if (!camInit) { camX = cx; camY = ty; camInit = true; }
    camX = lerp(camX, cx, 1 - Math.pow(0.004, dt));
    camY = lerp(camY, ty, 1 - Math.pow(0.01, dt));
  }
  function rect(x, y, w, h, col) { lc.fillStyle = col; lc.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function disc(cx, cy, r, col) { lc.fillStyle = col; cx = Math.round(cx); cy = Math.round(cy); for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8)); lc.fillRect(cx - w, cy + dy, w * 2 + 1, 1); } }

  function draw(now) {
    camPX = Math.round(camX / PXW); camPY = Math.round(camY / PXW);
    const pal = palette(t), L = Wd.L, ls = L ? L.s : 0;
    const hy = horizonPx();
    // 1) 하늘 띠
    const bands = 16;
    for (let i = 0; i < bands; i++) rect(0, Math.floor(hy * i / bands), lw, Math.ceil(hy / bands) + 1, hex(mixc(pal.top, pal.bot, i / (bands - 1))));
    rect(0, hy, lw, lh - hy, hex(pal.bot));
    const night = level.moon && t >= 1 ? clamp((t - 1) / 0.12, 0, 1) * (t > 1.85 ? clamp((2 - t) / 0.15, 0.3, 1) : 1) : 0;
    if (night > 0.05) for (const s of stars) { if (Math.sin(now / 600 + s.p) > 1 - night * 1.6) rect(s.u * lw, s.v * hy, 1, 1, '#ffffff'); }
    drawOrb(now, ls);
    if (level.clouds) drawClouds(pal);
    drawFar(pal, hy);
    // 2) 바닥 (빛나는 위험 지대)
    const gy = Math.round(wy(C.G));
    const lit = L ? 0.4 + 0.6 * ls : 0.55;
    const floorTop = mixc(mixc(pal.lc, [255, 255, 255], 0.45), pal.bot, 1 - lit);
    for (let i = 0; i < 6; i++) rect(0, gy + i * 3, lw, 3, hex(mixc(floorTop, mixc(pal.lc, pal.top, 0.5), i / 7)));
    rect(0, gy + 18, lw, lh - gy, hex(mixc(pal.lc, pal.top, 0.62)));
    lc.fillStyle = hex(mixc(floorTop, [255, 255, 255], 0.6));
    for (let x = 0; x < lw; x += 6) { const off = Math.floor((now / 90 + x * 0.5) % 6); if (off < 3) lc.fillRect(x + off, gy + 1, 2, 1); }
    for (let i = 0; i < 18; i++) { const px = ((i * 53.7 + now * 0.012 * ((i % 3) + 1)) % lw) | 0, py = gy + 4 + ((i * 7.3) % 14 | 0); lc.fillRect(px, py - (Math.floor(now / 300 + i) % 3), 1, 1); }
    const lx0 = Math.round(wx(0)), lx1 = Math.round(wx(level.w));
    if (lx0 > 0) rect(0, 0, lx0, lh, 'rgba(11,7,22,0.55)');
    if (lx1 < lw) rect(lx1, 0, lw - lx1, lh, 'rgba(11,7,22,0.55)');

    // 3) 픽셀 버퍼 직접 래스터
    img = lc.getImageData(0, 0, lw, lh); buf = img.data;
    mask.fill(0);
    const markGround = () => { for (const g of Wd.ground) { const x0 = clamp(Math.round(wx(g[0])), 0, lw), x1 = clamp(Math.round(wx(g[1])), 0, lw); for (let y = Math.max(0, gy); y < lh; y++) mask.fill(1, y * lw + x0, y * lw + x1); } };
    if (L) for (const sh of Wd.shapes) scan(sh, (y, x0, x1) => mask.fill(1, y * lw + x0, y * lw + x1 + 1));
    markGround();
    const shc = mixc([20, 12, 42], pal.top, 0.18), sa = L ? 0.8 * ls + 0.05 : 0.7;
    for (let i = 0, o = 0; i < mask.length; i++, o += 4) if (mask[i]) { buf[o] += (shc[0] - buf[o]) * sa; buf[o + 1] += (shc[1] - buf[o + 1]) * sa; buf[o + 2] += (shc[2] - buf[o + 2]) * sa; }
    const base = mixc([28, 20, 50], pal.top, 0.12);
    for (const cp of Wd.polys) {
      if (cp.ghost) continue;
      let col = base;
      if (cp.style === 'leaf') col = mixc(base, [30, 72, 52], 0.55);
      else if (cp.style === 'stalk') col = mixc(base, [52, 110, 60], 0.6);
      else if (cp.style === 'blade') col = mixc(base, [86, 56, 40], 0.4);
      else if (cp.style === 'roof') col = mixc(base, [110, 44, 56], 0.45);
      else if (cp.style === 'beam') col = mixc(base, [64, 50, 96], 0.45);
      else if (cp.style === 'hand') col = mixc(base, [10, 6, 20], 0.5);
      if (cp.src && cp.src.on) col = mixc(base, [90, 70, 150], 0.55);
      fillPoly(cp.pts, col);
    }
    if (Wd.shadowOn) {
      const ec = mixc(pal.lc, [190, 170, 255], 0.65);
      for (const s of Wd.surfaces) if (!s.stone) line(s.x0, s.y0 - 1, s.x1, s.y1 - 1, ec, 0.85 * ls);
    }
    for (const cp of Wd.polys) {
      const p = cp.pts, n = p.length;
      if (cp.ghost) { for (let i = 0; i < 4; i++) line(p[i][0], p[i][1], p[(i + 1) % 4][0], p[(i + 1) % 4][1], [201, 184, 255], 0.9, true); continue; }
      let cx = 0, cy = 0; for (const q of p) { cx += q[0]; cy += q[1]; } cx /= n; cy /= n;
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        let nx = b[1] - a[1], ny = -(b[0] - a[0]);
        if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
        const len = Math.hypot(nx, ny) || 1;
        const lit2 = L ? -(nx * L.dx + ny * L.dy) / len : -1;
        if (lit2 > 0.2) line(a[0], a[1], b[0], b[1], pal.lc, 0.9 * ls);
        else if (ny / len < -0.5) line(a[0], a[1], b[0], b[1], [220, 205, 255], 0.5);
      }
    }
    for (const g of (level.gates || [])) {
      const active = Wd.gates.indexOf(g) >= 0, x = Math.round(wx(g.x)), ya = Math.max(0, Math.round(wy(g.y0))), yb = Math.min(lh - 1, Math.round(wy(g.y1)));
      if (active) {
        const fl = 0.75 + 0.25 * Math.sin(now / 60);
        for (let y = ya; y <= yb; y++) {
          blendPx(x, y, [255, 255, 240], fl); blendPx(x - 1, y, [126, 224, 176], 0.8 * fl); blendPx(x + 1, y, [126, 224, 176], 0.8 * fl);
          if ((y + (now / 40 | 0)) % 7 === 0) { blendPx(x - 2, y, [200, 255, 230], 0.6); blendPx(x + 2, y, [200, 255, 230], 0.6); }
        }
      } else for (let y = ya; y <= yb; y += 4) blendPx(x, y, [126, 224, 176], 0.45);
    }
    lc.putImageData(img, 0, 0);

    // 4) 디테일 & 스프라이트
    for (const cp of Wd.polys) decorate(cp, pal);
    for (const g of (level.gates || [])) blit(SPR.gateLamp, Math.round(wx(g.x)) - 3, gy - 3);
    drawGoal(now);
    if (level.key && !hasKey) blit(SPR.key, wx(level.key[0]) - 4, wy(level.key[1]) - 5 + Math.round(Math.sin(now / 400) * 2));
    if (level.shard && !gotShard) {
      const sx = wx(level.shard[0]) - 3, sy = wy(level.shard[1]) - 3 + Math.round(Math.sin(now / 350) * 2);
      if (Math.floor(now / 120) % 8 === 0) rect(sx + 3, sy - 3, 1, 2, '#ffffff');
      blit(SPR.shard, sx, sy);
    }
    if (player && !player.dead && mode !== 'title') drawPlayer(now);
    for (const p of parts) rect(wx(p.x), wy(p.y), p.s, p.s, p.col);
    if (timeDirShow && mode === 'play') drawTimeFx(now);
    if (flash > 0) { lc.fillStyle = `rgba(255,240,200,${flash})`; lc.fillRect(0, 0, lw, lh); }

    // 5) 정수 배율 확대 출력
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lo, 0, 0, lw * K, lh * K);
  }

  function drawOrb(now, ls) {
    const p = orbPx(); if (!p) return;
    const moon = level.moon && t >= C.DUSK1;
    const r = Math.max(6, Math.round(lh * 0.035));
    const cov = 1 - ls;
    if (!moon) {
      disc(p.x, p.y, r + 6, `rgba(255,236,170,${0.18 * (1 - cov * 0.8)})`);
      disc(p.x, p.y, r + 3, `rgba(255,236,170,${0.28 * (1 - cov * 0.8)})`);
      const rot = Math.floor(now / 500) % 2;
      lc.fillStyle = '#ffe08a';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + rot * Math.PI / 8; lc.fillRect(Math.round(p.x + Math.cos(a) * (r + 4)) - 1, Math.round(p.y + Math.sin(a) * (r + 4)) - 1, 2, 2); }
      disc(p.x, p.y, r, '#ff9a48'); disc(p.x - 1, p.y - 1, r - 2, '#ffd77a'); disc(p.x - 2, p.y - 2, Math.max(1, r - 5), '#fffbe8');
    } else {
      disc(p.x, p.y, r + 4, 'rgba(200,215,255,0.2)');
      disc(p.x, p.y, r, '#eef1ff');
      rect(p.x - 3, p.y - 2, 2, 2, '#b7bfdc'); rect(p.x + 2, p.y + 2, 3, 2, '#b7bfdc'); rect(p.x - 1, p.y + 4, 2, 1, '#b7bfdc');
    }
    if (mode === 'play' && (orbDrag || barDrag || input.fwd || input.rew)) {
      lc.fillStyle = '#ffffff';
      const rr = r + 8 + (Math.floor(now / 150) % 2);
      for (let i = 0; i < 16; i += 2) { const a = i / 16 * 6.283 + now / 800; lc.fillRect(Math.round(p.x + Math.cos(a) * rr), Math.round(p.y + Math.sin(a) * rr), 1, 1); }
    }
    if (mode === 'play' && rt < 8 && used < 0.01 && Math.floor(now / 400) % 2 === 0) {
      lc.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) { lc.fillRect(Math.round(p.x - r - 12 + i), Math.round(p.y - i), 1, i * 2 + 1); lc.fillRect(Math.round(p.x + r + 12 - i), Math.round(p.y - i), 1, i * 2 + 1); }
    }
  }
  function drawClouds(pal) {
    const hy = horizonPx();
    for (const c of level.clouds) {
      const u = SC.cloudU(c, rt), p = skyPx(u, c.v);
      const rw = c.w * 0.5 * lw, rh = c.h * 0.5 * hy / 0.95;
      const col = hex(mixc(pal.bot, [255, 255, 255], 0.65)), sh = hex(mixc(pal.bot, [120, 110, 150], 0.45));
      for (let i = 0; i < 5; i++) { const k = i / 4; disc(p.x - rw * 0.7 + k * rw * 1.4, p.y - rh * 0.1 + 2, Math.round(rh * (0.55 + 0.4 * Math.sin(k * Math.PI))), sh); }
      for (let i = 0; i < 5; i++) { const k = i / 4; disc(p.x - rw * 0.7 + k * rw * 1.4, p.y - rh * 0.1, Math.round(rh * (0.55 + 0.4 * Math.sin(k * Math.PI))), col); }
      rect(p.x - rw * 0.85, p.y, rw * 1.7, Math.max(2, rh * 0.45), col);
    }
  }
  function drawFar(pal, hy) {
    for (let li = 0; li < 3; li++) {
      const hl = hills[li], par = 0.1 + li * 0.12;
      const col = hex(mixc(pal.bot, mixc([28, 20, 50], pal.top, 0.2), 0.3 + li * 0.22));
      lc.fillStyle = col;
      const base = hy - (26 - li * 8);
      for (let x = 0; x < lw; x += 2) {
        const wxp = x + camPX * par;
        const h = Math.round(Math.sin(wxp * hl.f1 + hl.a) * 9 + Math.sin(wxp * hl.f2 + hl.b) * 4);
        lc.fillRect(x, base - h - li * 2, 2, lh);
      }
      if (li === 0) farTower(col, hy, par);
    }
  }
  function farTower(col, hy, par) {
    let x = Math.round(lw * 0.7 - camPX * par * 0.3);
    x = ((x % (lw + 80)) + lw + 80) % (lw + 80) - 40;
    const top = hy - 120;
    lc.fillStyle = col;
    lc.fillRect(x - 16, top + 24, 32, hy - top);
    for (let i = 0; i < 18; i++) lc.fillRect(x - Math.floor(i * 0.9), top + 6 + i, Math.floor(i * 1.8) + 1, 1);
    lc.fillRect(x - 20, top + 22, 40, 3);
    const fy = top + 38;
    disc(x, fy, 8, hex(mixc([255, 240, 210], [80, 70, 110], 0.55)));
    const hr = ((6 + t * 12) % 12) / 12 * 6.283, mn = ((t * 720) % 60) / 60 * 6.283;
    lc.fillStyle = col;
    for (let i = 1; i <= 4; i++) lc.fillRect(Math.round(x + Math.sin(hr) * i), Math.round(fy - Math.cos(hr) * i), 1, 1);
    for (let i = 1; i <= 6; i++) lc.fillRect(Math.round(x + Math.sin(mn) * i), Math.round(fy - Math.cos(mn) * i), 1, 1);
  }
  function decorate(cp, pal) {
    const st = cp.style, src = cp.src || {};
    const p = cp.pts;
    if (cp.ghost) { blit(SPR.hourglass, Math.round((wx(p[0][0]) + wx(p[1][0])) / 2) - 2, Math.round(wy(p[0][1])) - 7); return; }
    if (src.on) blit(SPR.hourglass, Math.round((wx(p[0][0]) + wx(p[1][0])) / 2) - 2, Math.round(wy(p[0][1])) + 2);
    if (st === 'stalk') {
      const x0 = Math.round(wx(p[0][0])), x1 = Math.round(wx(p[1][0])), y0 = Math.round(wy(p[0][1])), yb = Math.round(wy(C.G));
      const cxp = Math.round((x0 + x1) / 2);
      lc.fillStyle = '#7fcf6a';
      for (let y = y0 + 8; y < yb; y += 10) { const s = ((y / 10) | 0) % 2 ? 1 : -1; lc.fillRect(s > 0 ? cxp + 2 : cxp - 7, y, 5, 2); lc.fillRect(s > 0 ? cxp + 7 : cxp - 9, y - 1, 2, 1); }
      lc.fillStyle = '#a6e38e'; lc.fillRect(x0, y0, x1 - x0, 1);
      blit(SPR.flower, cxp - 4, y0 - 8);
      return;
    }
    if (st === 'hand') { const h = src.hand; disc(wx(h.cx), wy(h.cy), 4, '#0b0716'); disc(wx(h.cx), wy(h.cy), 3, '#ffb84d'); return; }
    if (!(src.r || src.slide) || st === 'blade') return;
    const x = Math.round(wx(p[0][0])), y = Math.round(wy(p[0][1])), w = Math.round(wx(p[1][0])) - x, h = Math.round(wy(p[2][1])) - y;
    const hl = hex(mixc(mixc([28, 20, 50], pal.top, 0.12), [255, 225, 170], 0.16)), dk = hex(mixc([28, 20, 50], [0, 0, 0], 0.35));
    if (st === 'pillar' || st === 'tower' || st === 'clocktower' || st === 'mill' || st === 'trunk') {
      lc.fillStyle = hl; lc.fillRect(x - 1, y, w + 2, 3); lc.fillRect(x - 1, y + h - 4, w + 2, 4);
      if (st === 'pillar') { lc.fillStyle = dk; for (let k = x + 3; k < x + w - 2; k += 5) lc.fillRect(k, y + 6, 1, h - 12); }
      if (st === 'trunk') { lc.fillStyle = dk; for (let k = 0; k < 3; k++) lc.fillRect(x + 3 + k * 6, y + 6, 1, h - 12); }
      if (st === 'tower' || st === 'clocktower') { lc.fillStyle = '#ffcf7a'; for (let yy = y + (st === 'clocktower' ? 50 : 14); yy < y + h - 24; yy += 34) { lc.fillRect(x + (w >> 1) - 3, yy, 6, 9); lc.fillRect(x + (w >> 1) - 2, yy - 1, 4, 1); } }
      if (st === 'clocktower') {
        const cxp = x + (w >> 1), cyp = y + 24, r = Math.min((w * 0.36) | 0, 18);
        disc(cxp, cyp, r + 1, dk); disc(cxp, cyp, r, '#ffecbe');
        const hr = ((6 + t * 12) % 12) / 12 * 6.283, mn = ((t * 720) % 60) / 60 * 6.283;
        lc.fillStyle = '#2a1d4f';
        for (let i = 0; i <= r * 0.5; i++) lc.fillRect(Math.round(cxp + Math.sin(hr) * i), Math.round(cyp - Math.cos(hr) * i), 2, 2);
        for (let i = 0; i <= r * 0.8; i++) lc.fillRect(Math.round(cxp + Math.sin(mn) * i), Math.round(cyp - Math.cos(mn) * i), 1, 1);
      }
    } else if (st === 'beam') {
      lc.fillStyle = hl; lc.fillRect(x, y, w, 2);
      lc.fillStyle = dk; for (let k = x + 4; k < x + w - 2; k += 10) lc.fillRect(k, y + (h >> 1), 2, 2);
      if (!src.on && !src.slide) { lc.fillStyle = hex(mixc([28, 20, 50], pal.top, 0.3)); lc.fillRect(x + 3, 0, 1, Math.max(0, y)); lc.fillRect(x + w - 4, 0, 1, Math.max(0, y)); }
    } else if (st === 'stone') {
      lc.fillStyle = hl; lc.fillRect(x, y, w, 2);
      lc.fillStyle = dk; for (let yy = y + 8; yy < y + h; yy += 8) { lc.fillRect(x + 2, yy, w - 4, 1); const off = ((yy / 8) | 0) % 2 ? 6 : 12; for (let xx = x + off; xx < x + w - 2; xx += 14) lc.fillRect(xx, yy - 7, 1, 7); }
    }
  }
  function drawGoal(now) {
    const gx = Math.round(wx(level.goal[0])), gy = Math.round(wy(level.goal[1]));
    const w = 18, h = 28, open = hasKey;
    if (open) { const a = 0.14 + 0.06 * (Math.floor(now / 200) % 2); disc(gx, gy - 16, 22, `rgba(255,214,140,${a})`); disc(gx, gy - 16, 14, `rgba(255,214,140,${a})`); }
    rect(gx - w / 2 - 2, gy - h + 6, w + 4, h - 6, '#0b0716');
    disc(gx, gy - h + 9, w / 2 + 2, '#0b0716');
    const inA = open ? '#ffb84d' : '#2a1d4f', inB = open ? '#fff1c9' : '#3a2c63';
    rect(gx - w / 2, gy - h + 8, w, h - 8, inA);
    disc(gx, gy - h + 9, w / 2, inA);
    rect(gx - w / 2 + 2, gy - h + 10, w - 4, h - 12, inB);
    if (open) for (let i = 0; i < 4; i++) rect(gx - 5 + i * 3, gy - 6 - ((now / 80 + i * 5) % 18 | 0), 1, 2, '#ffffff');
    disc(gx, gy - h + 9, 5, open ? '#e07a2c' : '#9b86ff'); disc(gx, gy - h + 9, 4, open ? '#fff1c9' : '#2a1d4f');
    const a = now / 700;
    rect(gx + Math.round(Math.sin(a) * 2), gy - h + 9 - Math.round(Math.cos(a) * 2), 1, 1, open ? '#e07a2c' : '#c9b8ff');
    if (!open) { rect(gx - 1, gy - 12, 3, 3, '#ffb84d'); rect(gx, gy - 9, 1, 3, '#ffb84d'); }
  }
  function drawPlayer(now) {
    const p = player;
    let s = SPR.idle;
    if (!p.gr) s = SPR.jump;
    else if (Math.abs(p.vx) > 40) s = (Math.floor(runAnim) % 2) ? SPR.run1 : SPR.run2;
    else { blinkT -= 1 / 60; if (blinkT < -3.2) blinkT = 0.14; if (blinkT > 0) s = SPR.blink; }
    const x = Math.round(wx(p.x)) - (s.w >> 1), y = Math.round(wy(p.y)) - s.h + 1;
    lc.fillStyle = 'rgba(155,134,255,0.4)';
    lc.fillRect(x - 1, y + 4, 1, s.h - 6); lc.fillRect(x + s.w, y + 4, 1, s.h - 6);
    const bob = (p.gr && Math.abs(p.vx) < 40) ? (Math.floor(now / 500) % 2) : 0;
    blit(s, x, y + bob, p.face < 0);
  }
  function drawTimeFx(now) {
    const rev = timeDirShow < 0;
    lc.fillStyle = rev ? 'rgba(126,224,176,0.6)' : 'rgba(255,184,77,0.6)';
    const o = (now / 40 | 0) % 8;
    for (let x = o; x < lw; x += 8) { lc.fillRect(x, 0, 4, 1); lc.fillRect(lw - x, lh - 1, 4, 1); }
    for (let y = o; y < lh; y += 8) { lc.fillRect(0, y, 1, 4); lc.fillRect(lw - 1, lh - y, 1, 4); }
  }

  /* ═════════════ 힌트 (DOM, 월드 고정) ═════════════ */
  function hm(tt) {
    let mins = tt <= 1 ? 6 * 60 + tt * 720 : 18 * 60 + (tt - 1) * 720;
    mins = Math.round(mins / 10) * 10 % 1440;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  function buildHints() {
    const box = $('hints'); box.innerHTML = ''; hintEls = [];
    const add = (x, y, text, cls) => { const el = document.createElement('div'); el.className = 'hint ' + (cls || ''); el.textContent = text; box.appendChild(el); hintEls.push({ el, x, y, w: 0, tag: !!cls }); };
    for (const h of (level.hints || [])) add(h.x, h.y, h.text);
    for (const g of (level.gates || [])) add(g.x, C.G - 46, `장막 ${hm(g.open[0])}~${hm(g.open[1])} 열림`, 'tag gate');
    level.casters.forEach(c => { if (c.on) add(c.r[0] + c.r[2] / 2, c.r[1] - 34, `⧗ ${hm(c.on[0])}~${hm(c.on[1])}`, 'tag stone'); });
  }
  function updateHints() {
    const s = cssPerPx();
    for (const h of hintEls) {
      if (!h.w) h.w = h.el.offsetWidth;
      const sx = wx(h.x) * s - h.w / 2, sy = wy(h.y) * s - 14;
      const a = h.tag ? 1 : clamp(1.4 - Math.abs(player.x - h.x) / 600, 0, 1);
      const cxs = clamp(sx, 6, W - h.w - 6), cys = h.tag ? sy : clamp(sy, 58, H - 150);
      h.el.style.transform = `translate(${Math.round(cxs)}px,${Math.round(cys)}px)`;
      h.el.style.opacity = a < 0.05 ? 0 : (a > 0.66 ? 1 : a > 0.33 ? 0.66 : 0.33);
    }
  }

  /* ═════════════ HUD ═════════════ */
  function clockText(tt) {
    let mins = tt <= 1 ? 6 * 60 + tt * 720 : 18 * 60 + (tt - 1) * 720;
    mins = Math.floor(mins) % 1440;
    const h = Math.floor(mins / 60), m = Math.floor(mins % 60 / 10) * 10;
    let hh = h % 12; if (hh === 0) hh = 12;
    return `${h < 12 ? '오전' : '오후'} ${hh}:${String(m).padStart(2, '0')}`;
  }
  function usedText(u) { const m = Math.round(u * 720 / 10) * 10; const h = Math.floor(m / 60); return (h ? h + '시간 ' : '') + (m % 60) + '분'; }
  function buildBar() {
    const tm = SC.tMax(level), pct = (v) => (v / tm * 100).toFixed(2) + '%';
    const stops = []; for (let i = 0; i <= 24; i++) { const p = palette(i / 24 * tm); stops.push(`${hex(mixc(p.bot, p.top, 0.35))} ${(i / 24 * 100).toFixed(1)}%`); }
    $('tbSky').style.background = `linear-gradient(90deg,${stops.join(',')})`;
    let bands = '';
    for (const g of (level.gates || [])) bands += `<div class="tb-band gate" style="left:${pct(g.open[0])};width:${pct(g.open[1] - g.open[0])}"></div>`;
    level.casters.forEach(c => { if (c.on) bands += `<div class="tb-band stone" style="left:${pct(c.on[0])};width:${pct(c.on[1] - c.on[0])}"></div>`; });
    $('tbBands').innerHTML = bands;
    let ticks = '';
    for (let v = 0; v <= tm + 1e-6; v += 0.25) ticks += `<div class="tb-tick" style="left:${pct(v)}"></div>`;
    if (level.moon) ticks += `<div class="tb-tick" style="left:${pct(1)};height:100%"></div><div class="tb-tick" style="left:${pct(C.DUSK1)};height:100%"></div>`;
    $('tbTicks').innerHTML = ticks;
  }
  const thumbCtx = $('tbThumb').getContext('2d'), failCtx = $('failIco').getContext('2d');
  function drawIcon(g, kind) {
    g.clearRect(0, 0, 12, 12);
    const P = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    if (kind === 'sun') { P('#0b0716', 2, 1, 8, 10); P('#0b0716', 1, 2, 10, 8); P('#ff9a48', 3, 2, 6, 8); P('#ff9a48', 2, 3, 8, 6); P('#ffd77a', 3, 3, 5, 5); P('#fffbe8', 4, 4, 2, 2); }
    else if (kind === 'moon') { P('#0b0716', 2, 1, 8, 10); P('#0b0716', 1, 2, 10, 8); P('#eef1ff', 3, 2, 6, 8); P('#eef1ff', 2, 3, 8, 6); P('#b7bfdc', 4, 4, 2, 2); P('#b7bfdc', 7, 7, 2, 1); }
    else if (kind === 'dusk') { P('#0b0716', 2, 1, 8, 10); P('#0b0716', 1, 2, 10, 8); P('#9b6bd6', 3, 2, 6, 8); P('#9b6bd6', 2, 3, 8, 6); P('#c79bff', 4, 4, 3, 3); }
    else if (kind === 'burn') { P('#ff6b3a', 4, 1, 4, 10); P('#ff6b3a', 2, 4, 8, 7); P('#ffb35c', 4, 5, 4, 6); P('#fff1b8', 5, 7, 2, 4); }
    else if (kind === 'gate') { P('#3a2c63', 2, 0, 8, 2); P('#3a2c63', 2, 10, 8, 2); P('#7ee0b0', 4, 2, 4, 8); P('#ffffff', 5, 2, 2, 8); }
  }
  let hudKey = '';
  function updateHUD() {
    const tm = SC.tMax(level);
    const phase = (!level.moon || t < 1) ? 'sun' : t < C.DUSK1 ? 'dusk' : 'moon';
    $('tbThumb').style.left = `calc(6px + (100% - 12px) * ${t / tm})`;
    const key = phase + Math.floor(t * 72) + '|' + Math.round(used * 72);
    if (key !== hudKey) {
      hudKey = key;
      drawIcon(thumbCtx, phase);
      $('clock').className = 'pchip chip clockchip' + (phase === 'sun' ? '' : ' ' + phase);
      $('clockTxt').textContent = phase === 'dusk' ? '황혼' : clockText(t);
      const ph = parHours(level), ut = $('useTxt');
      ut.textContent = `사용 ${usedText(used)} / ★${ph}시간`; ut.classList.toggle('over', used * 12 > ph + 1e-6);
      Snd.mood(phase === 'sun' ? (t < 0.35 ? 'day' : t < 0.7 ? 'noon' : 'eve') : 'night');
    }
    $('tbHint').style.opacity = (rt < 10 && used < 0.01) ? 1 : 0;
  }

  /* ═════════════ 화면 전환 ═════════════ */
  const screens = ['title', 'select', 'pause', 'result', 'help'];
  function hideAll() { screens.forEach(s => $(s).classList.add('hidden')); }
  function showHUD(on) { $('hud').classList.toggle('hidden', !on); $('touch').classList.toggle('hidden', !(on && isTouch)); $('hints').classList.toggle('hidden', !on); }
  function showCard(a, b) { $('cardCh').textContent = a; $('cardName').textContent = b; const c = $('card'); c.classList.add('show'); clearTimeout(showCard._t); showCard._t = setTimeout(() => c.classList.remove('show'), 2000); }
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200); }
  function startLevel(i) { hideAll(); loadLevel(i); mode = 'play'; showHUD(true); }
  function pauseGame() {
    if (mode !== 'play') return; mode = 'pause';
    orbDrag = barDrag = null; tTarget = t; input.tL = input.tR = input.tJ = input.fwd = input.rew = false;
    $('pauseLv').textContent = level.id + ' ' + level.name; updSoundBtns(); $('pause').classList.remove('hidden');
  }
  function resumeGame() { $('pause').classList.add('hidden'); mode = 'play'; }
  const starSvg = (on) => `<svg class="star" viewBox="0 0 9 9" shape-rendering="crispEdges"><g fill="${on ? '#ffb84d' : '#4b3f6e'}"><rect x="4" y="0" width="1" height="2"/><rect x="3" y="2" width="3" height="1"/><rect x="0" y="3" width="9" height="1"/><rect x="1" y="4" width="7" height="1"/><rect x="2" y="5" width="5" height="1"/><rect x="2" y="6" width="2" height="1"/><rect x="5" y="6" width="2" height="1"/><rect x="1" y="7" width="2" height="1"/><rect x="6" y="7" width="2" height="1"/></g>${on ? '<rect x="4" y="3" width="1" height="1" fill="#fff1c9"/>' : ''}</svg>`;
  function showClear() {
    mode = 'result';
    const ph = parHours(level), timeOk = used * 12 <= ph + 1e-6;
    const stars = 1 + (timeOk ? 1 : 0) + (gotShard ? 1 : 0);
    const prev = save.best[level.id] || { s: 0 };
    save.best[level.id] = { s: Math.max(prev.s || 0, stars) }; persist();
    $('resLv').textContent = `${level.id} ${level.name} · 시간 사용 ${usedText(used)}`;
    $('resStars').innerHTML = [0, 1, 2].map(i => starSvg(i < stars)).join('');
    $('resCrit').innerHTML = `<span class="ok">★ 정원 탈출</span><span class="${timeOk ? 'ok' : ''}">${timeOk ? '★' : '☆'} 시간 ${ph}시간 이내 사용</span><span class="${gotShard ? 'ok' : ''}">${gotShard ? '★' : '☆'} 그림자 조각</span>`;
    $('rNext').style.display = lvIdx < LEVELS.length - 1 ? '' : 'none';
    $('resClear').classList.remove('hidden'); $('resFail').classList.add('hidden'); $('result').classList.remove('hidden');
    $('resStars').querySelectorAll('.star').forEach((el, i) => setTimeout(() => { if (i < stars) { el.classList.add('on'); Snd.ui(); } else el.style.opacity = 0.5; }, 200 + i * 240));
    if (lvIdx === LEVELS.length - 1) $('resLv').textContent += ' · 모든 정원 탈출!';
  }
  function showFail(reason) {
    mode = 'result';
    const M = { burn: ['burn', '빛에 닿았어요', '빛나는 바닥은 그림자로 덮였을 때만 안전해요.'], gate: ['gate', '빛의 장막에 닿았어요', '장막은 시간 막대의 초록 띠 시간에만 열려요.'] }[reason] || ['burn', '실패', ''];
    drawIcon(failCtx, M[0]); $('failTitle').textContent = M[1]; $('failMsg').textContent = M[2];
    $('fRewind').style.display = snaps.length ? '' : 'none';
    $('resClear').classList.add('hidden'); $('resFail').classList.remove('hidden'); $('result').classList.remove('hidden');
  }
  function buildSelect() {
    let html = '', total = 0;
    for (let ch = 1; ch <= 6; ch++) {
      html += `<div class="chap"><div class="chap-h"><b>${ch}장 · ${CHAPTERS[ch]}</b><span>${CH_SUB[ch]}</span></div><div class="stages">`;
      LEVELS.forEach((lv, i) => {
        if (lv.ch !== ch) return;
        const b = save.best[lv.id], s = b ? b.s : 0; total += s;
        const un = isUnlocked(i);
        html += `<button class="pbtn stage" data-i="${i}" ${un ? '' : 'disabled'}><span class="num">${lv.id}${un ? '' : ' 잠김'}</span><span>${lv.name}</span><span class="st">${[0, 1, 2].map(k => k < s ? '<i>★</i>' : '★').join('')}</span></button>`;
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
  $('fRewind').onclick = () => rewindDeath();
  $('fSelect').onclick = () => { Snd.ui(); openSelect(); };
  $('btnFull').onclick = () => {
    const d = document, el = d.documentElement;
    if (!(d.fullscreenElement || d.webkitFullscreenElement)) {
      const rq = el.requestFullscreen || el.webkitRequestFullscreen;
      if (rq) { const p = rq.call(el); if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => { }); }
      else toast('이 브라우저는 전체 화면을 지원하지 않아요 — 홈 화면에 추가해 보세요');
    } else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  };
  if (isTouch) document.body.classList.add('touch');
  updSoundBtns();

  /* ═════════════ 타이틀 배경 ═════════════ */
  function titleDemo(now) {
    if (level !== LEVELS[0] || !player) { level = LEVELS[0]; player = SC.newPlayer(level.start[0], level.start[1]); genHills(0); }
    t = 0.5 + 0.45 * Math.sin(now / 9000); rt = now / 1000;
    Wd = SC.world(level, t, rt);
    camX = (level.w - viewW) / 2; camY = C.G - viewH * 0.8;
    draw(now);
  }

  /* ═════════════ 메인 루프 ═════════════ */
  let last = performance.now(), acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1;
    if (mode === 'title') { titleDemo(now); return; }
    if (mode === 'play') {
      acc += dt; let n = 0;
      while (acc >= C.DT && n < 12) { step(C.DT); acc -= C.DT; n++; }
      if (n === 12) acc = 0;
      flash = Math.max(0, flash - dt * 1.5);
      if (!timeDir) timeDirShow = timeDirShow > 0 ? Math.max(0, timeDirShow - dt) : Math.min(0, timeDirShow + dt);
      updateCamera(dt); updateHUD();
    }
    draw(now);
    updateHints();
  }
  /*DEV*/
  if (location.search.indexOf('dev') >= 0) {
    window.__dev = {
      start(i) { startLevel(i); },
      setT(v) { t = tTarget = v; },
      setP(x, y) { player.x = x; player.y = y; camInit = false; },
      state() { return { t, rt, used, x: player.x, y: player.y, dead: player.dead, won, hasKey, mode }; },
      replay(acts) {
        mode = 'replay';
        for (const a of acts) {
          if (a.reset) { player.vx = 0; player.vy = 0; player.buf = 0; player.gr = true; player.coy = C.COYOTE; player.on = a.on; if (Math.hypot(player.x - a.x, player.y - a.y) > 0.5) return { diverged: true, at: [player.x, player.y], exp: [a.x, a.y], t }; continue; }
          input.dirR = a.dir > 0; input.dirL = a.dir < 0; input.jp = a.jp; input.jh = a.jh;
          tTarget = a.tgt === undefined || a.tgt === null ? t : a.tgt;
          step(C.DT);
          if (won || player.dead) break;
        }
        input.dirR = input.dirL = input.jh = false; mode = 'play';
        return { won, dead: player.dead, t, used, x: player.x, y: player.y };
      },
      unlockAll() { LEVELS.forEach(l => save.best[l.id] = save.best[l.id] || { s: 1 }); persist(); },
    };
  }
  /*/DEV*/
  resize();
  requestAnimationFrame(frame);
})();
