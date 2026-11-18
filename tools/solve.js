/* 스테이지 클리어 가능성 검증 솔버 (개발용) — node tools/solve.js [levelId] */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '../src/core.js'));
global.SunCore = core;
require(path.join(__dirname, '../src/levels.js'));
const LEVELS = global.SunLevels;
const { C, world, stepPlayer, newPlayer, overlaps, goalRect, shardRect, keyRect, tMax } = core;
const DT = C.DT;

function makeWorldFn(level) {
  const dyn = level.casters.some(c => !c.r && !c.p) || (level.clouds && level.clouds.length);
  const cache = new Map();
  const period = level.period || 1;
  return (t, rt) => {
    let k = Math.round(t * 1e5);
    if (dyn) k = k * 100000 + Math.round((((rt % period) + period) % period) / DT) ;
    let w = cache.get(k);
    if (!w) { w = world(level, t, rt); if (cache.size > 40000) cache.clear(); cache.set(k, w); }
    return w;
  };
}

function solve(level, opts = {}) {
  const W = makeWorldFn(level);
  const dyn = level.casters.some(c => !c.r && !c.p) || (level.clouds && level.clouds.length);
  const period = level.period || 1;
  const gr0 = goalRect(level);
  const kr = keyRect(level);
  const target = opts.target === 'shard' ? shardRect(level) : null;
  const sr = opts.target === 'both' ? shardRect(level) : null;
  const need = (kr ? 1 : 0) | (sr ? 2 : 0);
  const TM = tMax(level);
  const maxStates = opts.maxStates || 4000000;

  function sim(st, plan) {
    // plan: function(step, p) -> {dir, jp, jh, adv}
    const p = newPlayer(st.x, st.y); p.gr = true; p.coy = C.COYOTE;
    let t = st.t, rt = st.rt, k = st.k;
    for (let i = 0; i < 600; i++) {
      const a = plan(i, p);
      if (a === null) break;
      if (a.adv) t = Math.min(a.tgt, t + C.TIME_RATE * DT);
      rt += DT;
      if (t >= TM - 1e-9) return { dead: true };
      if (level.moon && t >= 1 && t < C.DUSK1) { /* dusk */ }
      const w = W(t, rt);
      stepPlayer(p, a, w, level, DT, null);
      if (p.dead) return { dead: true };
      if (kr && !(k & 1) && overlaps(p, kr)) k |= 1;
      if (sr && !(k & 2) && overlaps(p, sr)) k |= 2;
      if (target ? overlaps(p, target) : ((k & need) === need && overlaps(p, gr0))) return { win: true, t };
    }
    if (!p.gr) return { dead: true };
    return { x: p.x, y: p.y, t, rt, k };
  }

  const plans = [];
  // 걷기
  for (const dir of [-1, 1]) for (const n of [4, 14]) {
    plans.push(Object.assign(() => (i, p) => {
      if (i < n) return { dir, jh: false };
      if (!p.gr) return { dir, jh: false };
      return null;
    }, { lab: 'walk' + dir + 'x' + n }));
  }
  // 점프
  for (const dir of [-1, 0, 1]) for (const hold of [999, 10]) for (const delay of [0, 30]) {
    if (dir === 0 && delay) continue;
    plans.push(Object.assign(() => (i, p) => {
      const d = i < delay ? 0 : dir;
      if (i === 0) return { dir: d, jp: true, jh: true };
      if (i > 2 && p.gr) return null;
      return { dir: d, jh: i < hold };
    }, { lab: 'jump' + dir + (hold < 99 ? 's' : '') + (delay ? 'd' : '') }));
  }
  // 기다리기 (동적)
  const waitPlan = () => (i, p) => (i < 12 || !p.gr) ? { dir: 0 } : null;

  function trace(st) {
    const out = [];
    while (st && st.lab) { out.push(st.lab + '@' + Math.round(st.x) + ',' + Math.round(st.y) + ',t' + st.t.toFixed(2)); st = st.par; }
    return out.reverse();
  }
  function key(st) {
    const ti = Math.round(st.t * 100);
    let k = ti + '|' + Math.round(st.x / 6) + '|' + Math.round(st.y / 4) + '|' + (st.k || 0);
    if (dyn) k += '|' + Math.round(((st.rt % period) + period) % period / 0.1);
    return k;
  }

  const t0 = level.t0 || 0;
  const start = { x: level.start[0], y: level.start[1], t: t0, rt: 0, k: 0 };
  const seen = new Set([key(start)]);
  // 시간 단위 버킷 큐
  const buckets = [];
  const push = (st) => { const ti = Math.round(st.t * 100); (buckets[ti] || (buckets[ti] = [])).push(st); };
  push(start);
  let count = 0;
  for (let ti = Math.round(t0 * 100); ti < Math.round(TM * 100) + 2; ti++) {
    const q = buckets[ti];
    if (!q) continue;
    for (let qi = 0; qi < q.length; qi++) {
      const st = q[qi];
      count++;
      if (count > maxStates) return { ok: false, reason: 'limit', count };
      const cands = plans.map(f => [f(), f.lab]);
      if (dyn) cands.push([waitPlan(), 'wait']);
      for (const [plan, lab] of cands) {
        const r = sim(st, plan);
        if (r.win) return { ok: true, t: r.t, count, path: trace(st).concat(lab) };
        if (r.dead) continue;
        const k = key(r);
        if (seen.has(k)) continue;
        seen.add(k); r.par = st; r.lab = lab;
        push(r);
      }
      // 시간 진행: 별도 처리 (목표 t 도달 후 착지까지)
      {
        const tgt = st.t + 0.01;
        const p = newPlayer(st.x, st.y); p.gr = true;
        let t = st.t, rt = st.rt, dead = false, win = false, kk = st.k;
        for (let i = 0; i < 400; i++) {
          const adv = t < tgt - 1e-12;
          if (adv) t = Math.min(tgt, t + C.TIME_RATE * DT);
          rt += DT;
          if (t >= TM - 1e-9) { dead = true; break; }
          const w = W(t, rt);
          stepPlayer(p, { dir: 0 }, w, level, DT, null);
          if (p.dead) { dead = true; break; }
          if (kr && !(kk & 1) && overlaps(p, kr)) kk |= 1;
          if (sr && !(kk & 2) && overlaps(p, sr)) kk |= 2;
          if (target ? overlaps(p, target) : ((kk & need) === need && overlaps(p, gr0))) { win = true; break; }
          if (!adv && p.gr) break;
        }
        if (win) return { ok: true, t, count, path: trace(st).concat('adv') };
        if (!dead && p.gr) {
          const r = { x: p.x, y: p.y, t, rt, k: kk };
          const k = key(r);
          if (!seen.has(k)) { seen.add(k); r.par = st; r.lab = 'adv'; push(r); }
        }
      }
    }
    buckets[ti] = null;
  }
  return { ok: false, reason: 'exhausted', count };
}

function compress(path) {
  const out = []; let last = null, n = 0;
  for (const p of path) { const a = p.split('@')[0]; if (a === 'adv' && last === 'adv') { n++; out[out.length - 1] = 'adv x' + n + ' -> ' + p.split('@')[1]; continue; } last = a; n = 1; out.push(p); }
  return out;
}
const only = process.argv[2];
for (const lv of LEVELS) {
  if (only && lv.id !== only) continue;
  const t1 = Date.now();
  const r = solve(lv);
  if (process.argv[3] === 'shard' || process.argv.includes('--shard')) { const r2 = solve(lv, { target: 'both' }); console.log('   shard+goal:', r2.ok ? 'OK t=' + r2.t.toFixed(3) : 'FAIL ' + r2.reason); }
  console.log(lv.id.padEnd(5), lv.name.padEnd(14), r.ok ? 'OK  minT=' + r.t.toFixed(3) + ' (par ' + lv.par + ')' : 'FAIL ' + r.reason, 'states=' + r.count, (Date.now() - t1) + 'ms');
  if (only && r.path) console.log(compress(r.path).join('\n'));
}
module.exports = { solve };
