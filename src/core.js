/* 해시계 등반가 — 코어 (그림자 기하 + 물리). 브라우저/Node 공용 */
(function (root) {
  'use strict';
  const C = {
    G: 680,            // 지면 y
    H: 760,            // 월드 높이
    GRAV: 2300,
    JUMP_V: 800,
    RUN: 250,
    ACC_G: 2800,
    ACC_A: 1800,
    MAX_FALL: 950,
    COYOTE: 0.1,
    BUFFER: 0.12,
    PW: 22,
    PH: 30,
    MAX_SLOPE: 1.6,     // 약 58도
    SNAP_UP: 30,
    SNAP_DOWN: 16,
    TIME_RATE: 0.16,    // 초당 하루 진행 최대치
    DT: 1 / 120,
    DAY_A0: 16, DAY_A1: 164,
    DUSK0: 1, DUSK1: 1.1,
    MOON_A0: 20, MOON_A1: 160,
    SKY_SUN_R: 0.035
  };
  const D2R = Math.PI / 180;

  /* ---------- 하늘 좌표 (정규화 0..1) ---------- */
  function sunAngle(t) { return C.DAY_A0 + (C.DAY_A1 - C.DAY_A0) * Math.max(0, Math.min(1, t)); }
  function moonAngle(t) {
    const u = (t - C.DUSK1) / (2 - C.DUSK1);
    return C.MOON_A0 + (C.MOON_A1 - C.MOON_A0) * Math.max(0, Math.min(1, u));
  }
  function sunSky(t) { const a = sunAngle(t) * D2R; return { u: 0.5 - 0.42 * Math.cos(a), v: 0.95 - 0.8 * Math.sin(a) }; }
  function moonSky(t) { const a = moonAngle(t) * D2R; return { u: 0.5 - 0.42 * Math.cos(a), v: 0.95 - 0.8 * Math.sin(a) }; }

  function cloudU(c, rt) {
    const span = 1 + 2 * c.w;
    let u = (c.off + c.spd * rt) % span;
    if (u < 0) u += span;
    return u - c.w;
  }
  function cloudCover(level, sky, rt) {
    if (!level.clouds) return 0;
    let cov = 0;
    for (const c of level.clouds) {
      const cu = cloudU(c, rt);
      const dx = (sky.u - cu) / (c.w * 0.5), dy = (sky.v - c.v) / (c.h * 0.5);
      const d = Math.sqrt(dx * dx + dy * dy);
      const k = Math.max(0, Math.min(1, (1.25 - d) / 0.4));
      if (k > cov) cov = k;
    }
    return cov;
  }

  /* 광원: {dx,dy,s,kind,a} 또는 null */
  function light(level, t, rt) {
    let L = null;
    if (t < 1) {
      const a = sunAngle(t);
      L = { dx: Math.cos(a * D2R), dy: Math.sin(a * D2R), kind: 'sun', a, sky: sunSky(t), s: 1 };
    } else if (level.moon && t >= C.DUSK1 && t < 2) {
      const a = moonAngle(t);
      L = { dx: Math.cos(a * D2R), dy: Math.sin(a * D2R), kind: 'moon', a, sky: moonSky(t), s: 1 };
    }
    if (L) {
      L.s = 1 - cloudCover(level, L.sky, rt);
      if (L.s < 0.5) L.solid = false; else L.solid = true;
    }
    return L;
  }

  /* ---------- 캐스터(그림자를 만드는 물체) ---------- */
  function rectPts(r) { const [x, y, w, h] = r; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
  function rot(pts, px, py, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return pts.map(([x, y]) => [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c]);
  }
  // 반환: [{pts, style}]
  function casterPolys(level, rt) {
    if (!level._static) {
      level._static = []; level._dyn = [];
      for (const c of level.casters) {
        if (c.r) level._static.push({ pts: rectPts(c.r), style: c.s || 'stone', src: c });
        else if (c.p) level._static.push({ pts: c.p.map(q => q.slice()), style: c.s || 'stone', src: c });
        else level._dyn.push(c);
      }
    }
    if (!level._dyn.length) return level._static;
    const out = level._static.slice();
    for (const c of level._dyn) {
      if (c.mill) {
        const m = c.mill;
        const base = m.ph || 0;
        for (let i = 0; i < m.n; i++) {
          const ang = base + m.spd * rt + i * Math.PI * 2 / m.n;
          const hw = m.wid / 2;
          const pts = [[m.cx + 14, m.cy - hw * 0.5], [m.cx + m.len, m.cy - hw], [m.cx + m.len, m.cy + hw], [m.cx + 14, m.cy + hw * 0.5]];
          out.push({ pts: rot(pts, m.cx, m.cy, ang), style: 'blade', src: c });
        }
      } else if (c.sway) {
        const w = c.sway;
        const ang = w.amp * Math.sin((w.ph || 0) + rt * Math.PI * 2 * w.freq);
        out.push({ pts: rot(w.pts, w.px, w.py, ang), style: c.s || 'leaf', src: c });
      } else if (c.slide) {
        const sl = c.slide;
        const k = 0.5 - 0.5 * Math.cos((sl.ph || 0) + rt * Math.PI * 2 * sl.freq);
        const pts = rectPts(sl.r).map(([x, y]) => [x + sl.dx * k, y + sl.dy * k]);
        out.push({ pts, style: c.s || 'stone', src: c });
      }
    }
    return out;
  }

  /* ---------- 볼록 껍질 ---------- */
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const top = [], bot = [];
    for (const q of p) {
      while (top.length >= 2 && cross(top[top.length - 2], top[top.length - 1], q) <= 0) top.pop();
      top.push(q);
    }
    for (const q of p) {
      while (bot.length >= 2 && cross(bot[bot.length - 2], bot[bot.length - 1], q) >= 0) bot.pop();
      bot.push(q);
    }
    const full = top.concat(bot.slice(1, -1).reverse());
    return { top, full };
  }

  /* ---------- 월드 계산 ---------- */
  function world(level, t, rt) {
    const L = light(level, t, rt);
    const polys = casterPolys(level, rt);
    const shadowOn = !!(L && L.solid);
    const surfaces = [];
    const ground = [];
    const shapes = [];     // 그림자 껍질(렌더용)
    for (const cp of polys) {
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
      const useTop = shadowOn ? h.top : hull(cp.pts).top;
      for (let i = 0; i < useTop.length - 1; i++) {
        const a = useTop[i], b = useTop[i + 1];
        if (b[0] - a[0] < 0.5) continue;
        const sl = (b[1] - a[1]) / (b[0] - a[0]);
        if (Math.abs(sl) > C.MAX_SLOPE) continue;
        if (a[1] >= C.G - 0.5 && b[1] >= C.G - 0.5) continue; // 지면 위 선분은 따로
        surfaces.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], sl });
      }
      const gsrc = shadowOn ? h.full : cp.pts;
      let mn = Infinity, mx = -Infinity;
      for (const q of gsrc) if (q[1] >= C.G - 0.5) { if (q[0] < mn) mn = q[0]; if (q[0] > mx) mx = q[0]; }
      if (mn < mx) ground.push([mn, mx]);
    }
    return { L, polys, surfaces, ground, shapes, shadowOn };
  }

  function groundCovered(W, x, m) {
    for (const g of W.ground) if (x + m >= g[0] && x - m <= g[1]) return true;
    return false;
  }
  function surfY(s, x) {
    const cx = Math.max(s.x0, Math.min(s.x1, x));
    return s.y0 + s.sl * (cx - s.x0);
  }

  /* ---------- 플레이어 ---------- */
  function newPlayer(x, y) {
    return { x, y, vx: 0, vy: 0, gr: true, coy: 0, buf: 0, face: 1, dead: null, surf: null };
  }
  // inp: {dir, jp (jump pressed this step), jh (jump held)}
  function stepPlayer(p, inp, W, level, dt, ev) {
    if (p.dead) return;
    const dir = inp.dir || 0;
    if (dir) p.face = dir;
    const target = dir * C.RUN;
    const acc = (p.gr ? C.ACC_G : C.ACC_A) * dt;
    if (p.vx < target) p.vx = Math.min(target, p.vx + acc);
    else if (p.vx > target) p.vx = Math.max(target, p.vx - acc);

    if (inp.jp) p.buf = C.BUFFER;
    else p.buf = Math.max(0, p.buf - dt);
    if (p.gr) p.coy = C.COYOTE; else p.coy = Math.max(0, p.coy - dt);

    if (p.buf > 0 && p.coy > 0) {
      p.vy = -C.JUMP_V; p.gr = false; p.coy = 0; p.buf = 0;
      if (ev) ev.push('jump');
    }
    if (!inp.jh && p.vy < -200 && !p.gr) p.vy = Math.max(p.vy, -200) ;

    const wasGr = p.gr;
    p.vy = Math.min(C.MAX_FALL, p.vy + C.GRAV * dt);
    let nx = p.x + p.vx * dt;
    const lo = 12, hi = level.w - 12;
    if (nx < lo) { nx = lo; p.vx = 0; } else if (nx > hi) { nx = hi; p.vx = 0; }
    p.x = nx;
    const prevFeet = p.y;
    const ny = p.y + p.vy * dt;

    let best = null;
    if (p.vy >= 0 || wasGr) {
      const up = wasGr ? C.SNAP_UP : 4;
      const dn = wasGr ? C.SNAP_DOWN : 0;
      const lowB = prevFeet - up, hiB = Math.max(ny, prevFeet) + dn;
      const xl = p.x - 7, xr = p.x + 7;
      for (const s of W.surfaces) {
        if (s.x1 < xl || s.x0 > xr) continue;
        const sy = surfY(s, p.x);
        if (sy >= lowB && sy <= hiB) { if (best === null || sy < best) best = sy; }
      }
      // 지면
      if (C.G >= lowB && C.G <= hiB + 0.01 && groundCovered(W, p.x, 5)) {
        if (best === null || C.G < best) best = C.G;
      }
    }
    if (best !== null && (p.vy >= 0 || wasGr) && !(p.vy < 0 && !wasGr)) {
      if (!wasGr && ev) ev.push('land');
      p.y = best; p.vy = 0; p.gr = true;
    } else {
      if (wasGr && p.vy < 0) { /* 점프 시작 */ }
      p.y = ny; p.gr = false;
    }
    if (p.y >= C.G - 0.01 && !groundCovered(W, p.x, 5)) {
      p.y = Math.min(p.y, C.G + 4);
      p.dead = 'burn';
      if (ev) ev.push('burn');
    }
  }

  function overlaps(p, r) {
    return p.x + C.PW / 2 > r[0] && p.x - C.PW / 2 < r[0] + r[2] && p.y > r[1] && p.y - C.PH < r[1] + r[3];
  }
  function goalRect(level) { return [level.goal[0] - 24, level.goal[1] - 70, 48, 70]; }
  function keyRect(level) { return level.key ? [level.key[0] - 16, level.key[1] - 16, 32, 32] : null; }
  function shardRect(level) { return level.shard ? [level.shard[0] - 14, level.shard[1] - 14, 28, 28] : null; }
  function tMax(level) { return level.moon ? 2 : 1; }

  const API = { C, light, world, stepPlayer, newPlayer, overlaps, goalRect, shardRect, keyRect, casterPolys, hull, sunSky, moonSky, cloudU, cloudCover, tMax, surfY, groundCovered, sunAngle, moonAngle };
  root.SunCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
