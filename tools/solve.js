/* 스테이지 검증 솔버 (개발용)
   사용법: node tools/solve.js [levelId] [--shard] [--path]
   - 실제 게임과 동일한 코어 물리로 탐색
   - 비용 = 시간 이동량(앞/뒤 합계). 0-1 BFS로 "최소 시간 사용량" 풀이를 찾음 → 별 기준(par) 산정 */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '../src/core.js'));
global.SunCore = core;
require(path.join(__dirname, '../src/levels.js'));
const LEVELS = global.SunLevels;
const { C, world, stepPlayer, newPlayer, overlaps, goalRect, shardRect, keyRect, tMax } = core;
const DT = C.DT;
const STEP_T = 0.02;

function isDyn(level) { return level.casters.some(c => c.mill || c.sway || c.slide) || (level.clouds && level.clouds.length); }

function solve(level, opts = {}) {
  const dyn = isDyn(level);
  const period = level.period || 1;
  const cache = new Map();
  const Wf = (t, rt) => {
    let k = Math.round(t * 1e5);
    if (dyn) k = k * 100000 + Math.round((((rt % period) + period) % period) / DT);
    let w = cache.get(k);
    if (!w) { w = world(level, t, rt); if (cache.size > 40000) cache.clear(); cache.set(k, w); }
    return w;
  };
  const gr = goalRect(level), kr = keyRect(level), sr = opts.shard ? shardRect(level) : null;
  const need = (kr ? 1 : 0) | (sr ? 2 : 0);
  const TM = tMax(level);
  const maxStates = opts.maxStates || 3000000;

  // 한 동작 시뮬레이션: ctl(i,p,t) -> {dir,jp,jh,tgt} 또는 null(종료)
  function sim(st, ctl, rec) {
    const p = newPlayer(st.x, st.y); p.gr = true; p.coy = C.COYOTE; p.on = st.on;
    let t = st.t, rt = st.rt, k = st.k, prev = Wf(t, rt), used = 0;
    if (rec) rec.push({ reset: true, x: st.x, y: st.y, on: st.on });
    for (let i = 0; i < 700; i++) {
      const a = ctl(i, p, t);
      if (a === null) break;
      if (a.tgt !== undefined && Math.abs(a.tgt - t) > 1e-12) {
        const nt = a.tgt > t ? Math.min(a.tgt, t + C.TIME_RATE * DT) : Math.max(a.tgt, t - C.TIME_RATE * DT);
        used += Math.abs(nt - t); t = nt;
      }
      rt += DT;
      const w = Wf(t, rt);
      if (rec) rec.push({ dir: a.dir || 0, jp: !!a.jp, jh: !!a.jh, tgt: a.tgt });
      stepPlayer(p, a, w, level, DT, null, prev);
      prev = w;
      if (p.dead) return null;
      if (kr && !(k & 1) && overlaps(p, kr)) k |= 1;
      if (sr && !(k & 2) && overlaps(p, sr)) k |= 2;
      if ((k & need) === need && p.gr && overlaps(p, gr)) return { win: true, t, used };
    }
    if (!p.gr) return null;
    return { x: p.x, y: p.y, t, rt, k, on: p.on, used };
  }
  const moves = [];
  for (const dir of [-1, 1]) for (const n of [4, 14]) moves.push({ lab: 'walk' + dir + 'x' + n, f: () => (i, p) => (i < n || !p.gr) ? { dir, jh: false } : null });
  for (const dir of [-1, 0, 1]) for (const hold of [999, 10]) for (const delay of [0, 30]) {
    if (dir === 0 && delay) continue;
    moves.push({ lab: 'jump' + dir + (hold < 99 ? 's' : '') + (delay ? 'd' : ''), f: () => (i, p) => {
      const d = i < delay ? 0 : dir;
      if (i === 0) return { dir: d, jp: true, jh: true };
      if (i > 2 && p.gr) return null;
      return { dir: d, jh: i < hold };
    } });
  }
  if (dyn) moves.push({ lab: 'wait', f: () => (i, p) => (i < 12 || !p.gr) ? { dir: 0 } : null });
  const timeMoves = [];
  for (const sgn of [1, -1]) for (const walk of [0, -1, 1]) timeMoves.push({ lab: (sgn > 0 ? 'fwd' : 'rew') + (walk ? (walk > 0 ? '>' : '<') : ''), sgn, walk });

  function replay(last, lastCtl) {
    const chain = []; for (let s = last; s.par; s = s.par) chain.unshift(s);
    const acts = [];
    for (const s of chain) sim(s.par, s.ctl, acts);
    sim(last, lastCtl, acts);
    return acts;
  }
  function key(st) {
    let s = Math.round(st.t / STEP_T * 2) + '|' + Math.round(st.x / 6) + '|' + Math.round(st.y / 4) + '|' + (st.k || 0);
    if (dyn) s += '|' + Math.round(((st.rt % period) + period) % period / 0.1);
    return s;
  }
  function trace(st) { const o = []; while (st && st.lab) { o.push(st.lab + '@' + Math.round(st.x) + ',' + Math.round(st.y) + ',t' + st.t.toFixed(2)); st = st.par; } return o.reverse(); }

  const start = { x: level.start[0], y: level.start[1], t: level.t0 || 0, rt: 0, k: 0, on: -1, cost: 0 };
  const seen = new Map([[key(start), 0]]);
  // 0-1 BFS (비용 단위 = STEP_T 한 번)
  let cur = [start], next = [], count = 0, layer = 0;
  while (cur.length) {
    for (let qi = 0; qi < cur.length; qi++) {
      const st = cur[qi];
      if (++count > maxStates) return { ok: false, reason: 'limit', count };
      for (const m of moves) {
        const cf = m.f();
        const r = sim(st, cf);
        if (!r) continue;
        if (r.win) return { ok: true, used: layer * STEP_T + r.used, t: r.t, count, path: trace(st).concat(m.lab), acts: replay(st, cf) };
        const kk = key(r); if (seen.has(kk)) continue;
        seen.set(kk, layer); r.par = st; r.lab = m.lab; r.ctl = cf; cur.push(r);
      }
      for (const tm of timeMoves) {
        const tgt = Math.round((st.t + tm.sgn * STEP_T) / STEP_T) * STEP_T;
        if (tgt < -1e-9 || tgt > TM + 1e-9) continue;
        const cf = (i, p, t) => {
          const moving = Math.abs(t - tgt) > 1e-9;
          if (!moving && p.gr && i > 0) return null;
          return { dir: moving ? tm.walk : 0, tgt };
        };
        const r = sim(st, cf);
        if (!r) continue;
        if (r.win) return { ok: true, used: layer * STEP_T + r.used, t: r.t, count, path: trace(st).concat(tm.lab), acts: replay(st, cf) };
        const kk = key(r); if (seen.has(kk)) continue;
        seen.set(kk, layer + 1); r.par = st; r.lab = tm.lab; r.ctl = cf; next.push(r);
      }
    }
    cur = next; next = []; layer++;
  }
  return { ok: false, reason: 'exhausted', count };
}

function compress(p) {
  const out = []; let last = null, n = 0;
  for (const s of p) { const a = s.split('@')[0]; if (a === last && /^(fwd|rew)/.test(a)) { n++; out[out.length - 1] = a + ' x' + n + ' -> ' + (s.split('@')[1] || ''); continue; } last = a; n = 1; out.push(s); }
  return out;
}
if (require.main === module) {
  const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  for (const lv of LEVELS) {
    if (only && lv.id !== only) continue;
    const t1 = Date.now();
    const r = solve(lv);
    console.log(lv.id.padEnd(5), lv.name.padEnd(12), r.ok ? 'OK  used=' + r.used.toFixed(2) + ' (★' + lv.parH + 'h)' : 'FAIL ' + r.reason, 'states=' + r.count, (Date.now() - t1) + 'ms');
    if (process.argv.includes('--path') && r.path) console.log(compress(r.path).join('\n'));
    if (process.argv.includes('--acts') && r.acts) require('fs').writeFileSync(process.argv[process.argv.indexOf('--acts') + 1], JSON.stringify(r.acts));
    if (process.argv.includes('--shard') && lv.shard) { const r2 = solve(lv, { shard: true }); console.log('      shard+goal:', r2.ok ? 'OK used=' + r2.used.toFixed(2) : 'FAIL ' + r2.reason); }
  }
}
module.exports = { solve };
