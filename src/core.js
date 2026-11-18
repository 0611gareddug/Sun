/* 해시계 등반가 — 코어 (그림자 기하 + 물리). 브라우저/Node 공용
   v2: 시간 양방향, 시간 연동 기믹(해바라기·시곗바늘·시간의 돌·빛의 장막), 움직이는 발판 운반 */
(function (root) {
  'use strict';
  const C = {
    G: 680, H: 760,
    GRAV: 2300, JUMP_V: 800, RUN: 250, ACC_G: 2800, ACC_A: 1800, MAX_FALL: 950,
    COYOTE: 0.1, BUFFER: 0.12, PW: 22, PH: 30,
    MAX_SLOPE: 1.6, SNAP_UP: 30, SNAP_DOWN: 16,
    TIME_RATE: 0.2,     // 초당 시간 이동 최대치 (앞/뒤 모두)
    DT: 1 / 120,
    DAY_A0: 16, DAY_A1: 164,
    DUSK0: 1, DUSK1: 1.1,
    MOON_A0: 20, MOON_A1: 160,
  };
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, k) => a + (b - a) * k;

  function tMax(level) { return level.moon ? 2 : 1; }
  function sunAngle(t) { return C.DAY_A0 + (C.DAY_A1 - C.DAY_A0) * clamp(t, 0, 1); }
  function moonAngle(t) { return C.MOON_A0 + (C.MOON_A1 - C.MOON_A0) * clamp((t - C.DUSK1) / (2 - C.DUSK1), 0, 1); }
  function sunSky(t) { const a = sunAngle(t) * D2R; return { u: 0.5 - 0.42 * Math.cos(a), v: 0.95 - 0.8 * Math.sin(a) }; }
  function moonSky(t) { const a = moonAngle(t) * D2R; return { u: 0.5 - 0.42 * Math.cos(a), v: 0.95 - 0.8 * Math.sin(a) }; }

  function cloudU(c, rt) {
    const span = 1 + 2 * c.w;
    let u = (c.off + c.spd * rt) % span; if (u < 0) u += span;
    return u - c.w;
  }
  function cloudCover(level, sky, rt) {
    if (!level.clouds) return 0;
    let cov = 0;
    for (const c of level.clouds) {
      const dx = (sky.u - cloudU(c, rt)) / (c.w * 0.5), dy = (sky.v - c.v) / (c.h * 0.5);
      const k = clamp((1.25 - Math.sqrt(dx * dx + dy * dy)) / 0.4, 0, 1);
      if (k > cov) cov = k;
    }
    return cov;
  }
  function light(level, t, rt) {
    let L = null;
    if (t <= 1 && (!level.moon || t < C.DUSK0)) {
      const a = sunAngle(t);
      L = { dx: Math.cos(a * D2R), dy: Math.sin(a * D2R), kind: 'sun', a, sky: sunSky(t) };
    } else if (level.moon && t >= C.DUSK1) {
      const a = moonAngle(t);
      L = { dx: Math.cos(a * D2R), dy: Math.sin(a * D2R), kind: 'moon', a, sky: moonSky(t) };
    }
    if (L) { L.s = 1 - cloudCover(level, L.sky, rt); L.solid = L.s >= 0.5; }
    return L;
  }
  function inRange(t, r) { return t >= r[0] - 1e-9 && t <= r[1] + 1e-9; }

  /* ---------- 캐스터 ---------- */
  function rectPts(r) { const [x, y, w, h] = r; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
  function rotPts(pts, px, py, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return pts.map(([x, y]) => [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c]);
  }
  // 동적 캐스터의 자세: {px,py,ang,tx,ty}. 점 운반 계산에 사용
  function poseOf(level, c, sub, t, rt) {
    const k = clamp(t / tMax(level), 0, 1);
    if (c.mill) { const m = c.mill; return { px: m.cx, py: m.cy, ang: (m.ph || 0) + m.spd * rt + sub * Math.PI * 2 / m.n, tx: 0, ty: 0 }; }
    if (c.sway) { const w = c.sway; return { px: w.px, py: w.py, ang: w.amp * Math.sin((w.ph || 0) + rt * Math.PI * 2 * w.freq), tx: 0, ty: 0 }; }
    if (c.slide) { const sl = c.slide; const q = 0.5 - 0.5 * Math.cos((sl.ph || 0) + rt * Math.PI * 2 * sl.freq); return { px: 0, py: 0, ang: 0, tx: sl.dx * q, ty: sl.dy * q }; }
    if (c.hand) { const h = c.hand; return { px: h.cx, py: h.cy, ang: lerp(h.a0, h.a1, k) * D2R, tx: 0, ty: 0 }; }
    if (c.grow) { const g = c.grow; return { px: 0, py: 0, ang: 0, tx: 0, ty: lerp(g.y0, g.y1, k) - g.y0 }; }
    return null;
  }
  function applyPose(P, x, y) {
    const c = Math.cos(P.ang), s = Math.sin(P.ang);
    const dx = x - P.px, dy = y - P.py;
    return [P.px + dx * c - dy * s + P.tx, P.py + dx * s + dy * c + P.ty];
  }
  function invPose(P, x, y) {
    const c = Math.cos(-P.ang), s = Math.sin(-P.ang);
    const dx = x - P.tx - P.px, dy = y - P.ty - P.py;
    return [P.px + dx * c - dy * s, P.py + dx * s + dy * c];
  }
  // [{pts, style, src, cid, pose, ghost}]
  function casterPolys(level, t, rt) {
    const out = [];
    level.casters.forEach((c, i) => {
      if (c.on && !inRange(t, c.on)) { out.push({ pts: rectPts(c.r), style: 'ghost', src: c, cid: i * 16, ghost: true }); return; }
      if (c.r) { out.push({ pts: c._pts || (c._pts = rectPts(c.r)), style: c.s || 'stone', src: c, cid: i * 16 }); return; }
      if (c.p) { out.push({ pts: c.p, style: c.s || 'stone', src: c, cid: i * 16 }); return; }
      if (c.mill) {
        const m = c.mill, hw = m.wid / 2;
        const base = [[m.cx + 14, m.cy - hw * 0.5], [m.cx + m.len, m.cy - hw], [m.cx + m.len, m.cy + hw], [m.cx + 14, m.cy + hw * 0.5]];
        for (let j = 0; j < m.n; j++) {
          const P = poseOf(level, c, j, t, rt);
          out.push({ pts: base.map(q => applyPose(P, q[0], q[1])), style: 'blade', src: c, cid: i * 16 + j, pose: P });
        }
        return;
      }
      if (c.hand) {
        const h = c.hand, hw = h.wid / 2;
        const base = [[h.cx - 26, h.cy - hw], [h.cx + h.len * 0.86, h.cy - hw], [h.cx + h.len, h.cy], [h.cx + h.len * 0.86, h.cy + hw], [h.cx - 26, h.cy + hw]];
        const P = poseOf(level, c, 0, t, rt);
        out.push({ pts: base.map(q => applyPose(P, q[0], q[1])), style: 'hand', src: c, cid: i * 16, pose: P });
        return;
      }
      if (c.grow) {
        const g = c.grow, P = poseOf(level, c, 0, t, rt);
        const top = g.y0 + P.ty;
        out.push({ pts: [[g.x, top], [g.x + g.w, top], [g.x + g.w, C.G], [g.x, C.G]], style: 'stalk', src: c, cid: i * 16, pose: P });
        return;
      }
      const P = poseOf(level, c, 0, t, rt);
      const src = c.sway ? c.sway.pts : rectPts(c.slide.r);
      out.push({ pts: src.map(q => applyPose(P, q[0], q[1])), style: c.s || (c.sway ? 'leaf' : 'beam'), src: c, cid: i * 16, pose: P });
    });
    return out;
  }

  /* ---------- 볼록 껍질 ---------- */
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const top = [], bot = [];
    for (const q of p) { while (top.length >= 2 && cross(top[top.length - 2], top[top.length - 1], q) <= 0) top.pop(); top.push(q); }
    for (const q of p) { while (bot.length >= 2 && cross(bot[bot.length - 2], bot[bot.length - 1], q) >= 0) bot.pop(); bot.push(q); }
    return { top, full: top.concat(bot.slice(1, -1).reverse()) };
  }

  /* ---------- 월드 ---------- */
  function world(level, t, rt) {
    const L = light(level, t, rt);
    const polys = casterPolys(level, t, rt);
    const shadowOn = !!(L && L.solid);
    const surfaces = [], ground = [], shapes = [], poses = {};
    for (const cp of polys) {
      if (cp.ghost) continue;
      if (cp.pose) poses[cp.cid] = cp.pose;
      const own = new Set(cp.pts);
      let pts = cp.pts;
      if (L) {
        const proj = [];
        for (const q of cp.pts) {
          if (q[1] >= C.G) proj.push(q);
          else { const k = (C.G - q[1]) / L.dy; proj.push([q[0] + L.dx * k, C.G]); }
        }
        pts = cp.pts.concat(proj);
      }
      const h = hull(pts);
      shapes.push(h.full);
      const top = shadowOn ? h.top : hull(cp.pts).top;
      for (let i = 0; i < top.length - 1; i++) {
        const a = top[i], b = top[i + 1];
        if (b[0] - a[0] < 0.5) continue;
        const sl = (b[1] - a[1]) / (b[0] - a[0]);
        if (Math.abs(sl) > C.MAX_SLOPE) continue;
        if (a[1] >= C.G - 0.5 && b[1] >= C.G - 0.5) continue;
        const mine = own.has(a) && own.has(b);
        surfaces.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], sl, cid: (mine && cp.pose) ? cp.cid : -1, stone: mine });
      }
      const gsrc = shadowOn ? h.full : cp.pts;
      let mn = Infinity, mx = -Infinity;
      for (const q of gsrc) if (q[1] >= C.G - 0.5) { if (q[0] < mn) mn = q[0]; if (q[0] > mx) mx = q[0]; }
      if (mn < mx) ground.push([mn, mx]);
    }
    const gates = [];
    if (level.gates) for (const g of level.gates) if (!inRange(t, g.open)) gates.push(g);
    return { L, polys, surfaces, ground, shapes, shadowOn, poses, gates, t, rt };
  }

  function groundCovered(W, x, m) {
    for (const g of W.ground) if (x + m >= g[0] && x - m <= g[1]) return true;
    return false;
  }
  function surfY(s, x) { return s.y0 + s.sl * (Math.max(s.x0, Math.min(s.x1, x)) - s.x0); }

  /* ---------- 플레이어 ---------- */
  function newPlayer(x, y) { return { x, y, vx: 0, vy: 0, gr: true, coy: 0, buf: 0, face: 1, dead: null, on: -1 }; }
  // inp: {dir, jp, jh}. Wp: 직전 스텝 월드 (운반 계산용)
  function stepPlayer(p, inp, W, level, dt, ev, Wp) {
    if (p.dead) return;
    // 움직이는 발판 운반
    if (p.gr && p.on >= 0 && Wp) {
      const A = Wp.poses[p.on], B = W.poses[p.on];
      if (A && B) { const l = invPose(A, p.x, p.y); const n = applyPose(B, l[0], l[1]); p.x = n[0]; p.y = n[1]; }
    }
    const dir = inp.dir || 0;
    if (dir) p.face = dir;
    const target = dir * C.RUN, acc = (p.gr ? C.ACC_G : C.ACC_A) * dt;
    if (p.vx < target) p.vx = Math.min(target, p.vx + acc); else if (p.vx > target) p.vx = Math.max(target, p.vx - acc);
    if (inp.jp) p.buf = C.BUFFER; else p.buf = Math.max(0, p.buf - dt);
    if (p.gr) p.coy = C.COYOTE; else p.coy = Math.max(0, p.coy - dt);
    if (p.buf > 0 && p.coy > 0) { p.vy = -C.JUMP_V; p.gr = false; p.coy = 0; p.buf = 0; p.on = -1; if (ev) ev.push('jump'); }
    if (!inp.jh && p.vy < -200 && !p.gr) p.vy = -200;

    const wasGr = p.gr;
    p.vy = Math.min(C.MAX_FALL, p.vy + C.GRAV * dt);
    let nx = p.x + p.vx * dt;
    const lo = 12, hi = level.w - 12;
    if (nx < lo) { nx = lo; p.vx = 0; } else if (nx > hi) { nx = hi; p.vx = 0; }
    p.x = nx;
    const prevFeet = p.y, ny = p.y + p.vy * dt;
    let best = null, bestS = null;
    if (p.vy >= 0 || wasGr) {
      const up = wasGr ? C.SNAP_UP : 4, dn = wasGr ? C.SNAP_DOWN : 0;
      const lowB = prevFeet - up, hiB = Math.max(ny, prevFeet) + dn;
      const xl = p.x - 7, xr = p.x + 7;
      for (const s of W.surfaces) {
        if (s.x1 < xl || s.x0 > xr) continue;
        const sy = surfY(s, p.x);
        if (sy >= lowB && sy <= hiB && (best === null || sy < best)) { best = sy; bestS = s; }
      }
      if (C.G >= lowB && C.G <= hiB + 0.01 && groundCovered(W, p.x, 5) && (best === null || C.G < best)) { best = C.G; bestS = null; }
    }
    if (best !== null) {
      if (!wasGr && ev) ev.push('land');
      p.y = best; p.vy = 0; p.gr = true; p.on = bestS ? bestS.cid : -1;
    } else { p.y = ny; p.gr = false; p.on = -1; }
    if (p.y >= C.G - 0.01 && !groundCovered(W, p.x, 5)) {
      p.y = Math.min(p.y, C.G + 4); p.dead = 'burn'; if (ev) ev.push('burn');
      return;
    }
    for (const g of W.gates) {
      if (Math.abs(p.x - g.x) < C.PW / 2 + 5 && p.y > g.y0 && p.y - C.PH < g.y1) { p.dead = 'gate'; if (ev) ev.push('burn'); return; }
    }
  }

  function overlaps(p, r) { return p.x + C.PW / 2 > r[0] && p.x - C.PW / 2 < r[0] + r[2] && p.y > r[1] && p.y - C.PH < r[1] + r[3]; }
  function goalRect(level) { return [level.goal[0] - 24, level.goal[1] - 70, 48, 70]; }
  function shardRect(level) { return level.shard ? [level.shard[0] - 14, level.shard[1] - 14, 28, 28] : null; }
  function keyRect(level) { return level.key ? [level.key[0] - 16, level.key[1] - 16, 32, 32] : null; }

  const API = { C, light, world, stepPlayer, newPlayer, overlaps, goalRect, shardRect, keyRect, casterPolys, hull, sunSky, moonSky, cloudU, cloudCover, tMax, surfY, groundCovered, sunAngle, moonAngle, inRange, poseOf };
  root.SunCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
