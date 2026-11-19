'use strict';

/* =========================================================
   Number Spark: a maths game for ages 10+
   Modes: Blitz, Make the Number, Pattern Hunt
   ========================================================= */

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const fmt = (n) => (n < 0 ? '−' + Math.abs(n) : String(n));

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('numberspark_' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('numberspark_' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const DIFF = {
  easy:   { label: 'Easy',         blitzStart: 1, mult: 1,   seqTime: 25 },
  normal: { label: 'Normal',       blitzStart: 3, mult: 1.5, seqTime: 20 },
  hard:   { label: 'Brain-burner', blitzStart: 6, mult: 2,   seqTime: 15 },
};

const settings = { diff: store.get('diff', 'normal'), sound: store.get('sound', true) };
if (!DIFF[settings.diff]) settings.diff = 'normal';
const diff = () => DIFF[settings.diff];

/* ---------- sound (Web Audio, no files needed) ---------- */
let actx = null;
function tone(freq, dur = 0.12, type = 'sine', vol = 0.15, when = 0) {
  if (!settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + when;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch { /* audio unavailable */ }
}
const sfx = {
  click: () => tone(520, 0.05, 'square', 0.04),
  good: () => { tone(660, 0.1, 'triangle'); tone(990, 0.15, 'triangle', 0.12, 0.08); },
  bad: () => tone(150, 0.25, 'sawtooth', 0.08),
  levelUp: () => [523, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.12, i * 0.07)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.13, i * 0.1)),
};

/* ---------- screens, timers, feedback ---------- */
let tick = null;     // the one running interval
let session = 0;     // bumps on every game start/exit so stale callbacks do nothing
function stopTick() { if (tick) { clearInterval(tick); tick = null; } }
function later(fn, ms) { const s = session; setTimeout(() => { if (s === session) fn(); }, ms); }

function show(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}
function goHome() { session++; stopTick(); refreshHome(); show('home'); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
}
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ffd23f', '#ff5d8f', '#3ee8d0', '#9b7bff', '#4ade80'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = pick(colors);
    c.style.animationDelay = Math.random() * 0.5 + 's';
    c.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}

/* ---------- home ---------- */
function refreshHome() {
  $$('.diff button').forEach((b) => b.classList.toggle('on', b.dataset.diff === settings.diff));
  $$('[data-best]').forEach((el) => {
    const v = store.get(`best_${el.dataset.best}_${settings.diff}`, 0);
    el.textContent = v ? `🏆 Best (${diff().label}): ${v}` : `No ${diff().label} score yet`;
  });
  $('#soundBtn').textContent = settings.sound ? '🔊' : '🔇';
}

/* ---------- multiple-choice helpers ---------- */
function makeChoices(ans, smart = []) {
  const allowNeg = ans < 0;
  const ok = (c) => Number.isInteger(c) && (allowNeg || c >= 0);
  const set = new Set([ans]);
  const cands = [
    ...smart,
    ...shuffle([ans + 1, ans - 1, ans + 2, ans - 2, ans + 10, ans - 10, ans + rand(3, 7), ans - rand(3, 7)]),
  ];
  for (const c of cands) { if (set.size >= 4) break; if (ok(c)) set.add(c); }
  let guard = 0;
  while (set.size < 4 && guard++ < 200) { const c = ans + rand(-25, 25); if (ok(c)) set.add(c); }
  return shuffle([...set]);
}

const quiz = { lastMode: 'blitz' };

function askQuestion(html, choices, answer, onAnswer) {
  quiz.locked = false;
  quiz.answer = answer;
  quiz.answerIdx = choices.indexOf(answer);
  const qEl = $('#question');
  qEl.innerHTML = html;
  qEl.classList.remove('pop'); void qEl.offsetWidth; qEl.classList.add('pop');
  $('#explain').innerHTML = '';
  const box = $('#choices');
  box.innerHTML = '';
  choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.innerHTML = `<kbd>${i + 1}</kbd><span>${fmt(c)}</span>`;
    b.addEventListener('click', () => {
      if (quiz.locked) return;
      quiz.locked = true;
      const right = c === answer;
      b.classList.add(right ? 'right' : 'wrong');
      if (!right) box.children[choices.indexOf(answer)].classList.add('right');
      onAnswer(right, false);
    });
    box.appendChild(b);
  });
}

/* =========================================================
   MODE 1: BLITZ
   ========================================================= */
const BLITZ = [
  null,
  /* 1 */ () => { const a = rand(1, 10), b = rand(1, 10); return { q: `${a} + ${b}`, a: a + b }; },
  /* 2 */ () => { const a = rand(6, 20), b = rand(1, a); return { q: `${a} − ${b}`, a: a - b }; },
  /* 3 */ () => { const a = rand(2, 5), b = rand(2, 10); return { q: `${a} × ${b}`, a: a * b }; },
  /* 4 */ () => { const a = rand(11, 60), b = rand(11, 39); return { q: `${a} + ${b}`, a: a + b }; },
  /* 5 */ () => { const a = rand(3, 10), b = rand(3, 10); return { q: `${a} × ${b}`, a: a * b }; },
  /* 6 */ () => { const a = rand(2, 10), b = rand(2, 10); return { q: `${a * b} ÷ ${b}`, a }; },
  /* 7 */ () => { const a = rand(50, 150), b = rand(15, a - 10); return { q: `${a} − ${b}`, a: a - b }; },
  /* 8 */ () => { const a = rand(2, 9), b = rand(2, 9), c = rand(2, 20); return { q: `${a} × ${b} + ${c}`, a: a * b + c }; },
  /* 9 */ () => { const n = rand(4, 15); return { q: `${n}²`, a: n * n }; },
  /* 10 */ () => {
    const p = pick([10, 20, 25, 50, 75]);
    const base = p === 25 || p === 75 ? rand(2, 25) * 4 : rand(2, 30) * 10;
    return { q: `${p}% of ${base}`, a: (base * p) / 100 };
  },
  /* 11 */ () => { const a = rand(12, 25), b = rand(3, 9); return { q: `${a} × ${b}`, a: a * b }; },
  /* 12 */ () => pick([
    () => { const a = rand(-15, 15), b = rand(2, 15); return { q: `${fmt(a)} − ${b}`, a: a - b }; },
    () => { const n = rand(6, 20); return { q: `√${n * n}`, a: n }; },
    () => { const a = rand(2, 12), b = rand(2, 12), c = rand(2, 9); return { q: `(${a} + ${b}) × ${c}`, a: (a + b) * c }; },
    () => { const a = rand(11, 19), b = rand(11, 19); return { q: `${a} × ${b}`, a: a * b }; },
  ])(),
];
const MAX_LEVEL = BLITZ.length - 1;
const BLITZ_SECONDS = 60;

function startBlitz() {
  session++; stopTick();
  Object.assign(quiz, {
    mode: 'blitz', lastMode: 'blitz', score: 0, level: diff().blitzStart, maxLevel: diff().blitzStart,
    combo: 0, bestCombo: 0, ups: 0, right: 0, total: 0,
    endAt: performance.now() + BLITZ_SECONDS * 1000,
  });
  $('#qMidLabel').textContent = 'Level';
  $('#qRightLabel').textContent = 'Time';
  $('#combo').textContent = '';
  show('quiz');
  nextBlitz();
  tick = setInterval(blitzTick, 100);
  blitzTick();
}

function blitzTick() {
  const left = Math.max(0, (quiz.endAt - performance.now()) / 1000);
  $('#qRightVal').textContent = Math.ceil(left);
  const bar = $('#qBar');
  bar.style.width = Math.min(100, (left / BLITZ_SECONDS) * 100) + '%';
  bar.classList.toggle('low', left < 10);
  if (left <= 0) endBlitz();
}

function nextBlitz() {
  // mostly current level, sometimes an easier one to keep the rhythm going
  const lv = Math.max(1, quiz.level - pick([0, 0, 0, 1, 2]));
  const { q, a } = BLITZ[lv]();
  $('#qScore').textContent = quiz.score;
  $('#qMidVal').textContent = quiz.level;
  askQuestion(`${q} = ?`, makeChoices(a), a, onBlitzAnswer);
}

function onBlitzAnswer(right) {
  quiz.total++;
  const mult = () => Math.min(5, 1 + Math.floor(quiz.combo / 5));
  if (right) {
    quiz.right++;
    quiz.combo++;
    quiz.bestCombo = Math.max(quiz.bestCombo, quiz.combo);
    quiz.score += Math.round(10 * quiz.level * mult() * diff().mult);
    sfx.good();
    if (quiz.combo % 5 === 0) { quiz.endAt += 3000; toast(`🔥 ${quiz.combo} in a row! +3 seconds`); }
    if (++quiz.ups >= 4 && quiz.level < MAX_LEVEL) {
      quiz.level++; quiz.ups = 0;
      quiz.maxLevel = Math.max(quiz.maxLevel, quiz.level);
      sfx.levelUp();
      toast(`⬆️ Level ${quiz.level}!`);
    }
  } else {
    quiz.combo = 0; quiz.ups = 0;
    quiz.level = Math.max(1, quiz.level - 1);
    quiz.endAt -= 2000;
    sfx.bad();
    shake($('#question'));
  }
  $('#qScore').textContent = quiz.score;
  $('#combo').textContent = quiz.combo >= 2 ? `🔥 ${quiz.combo} in a row · points ×${mult()}` : '';
  later(nextBlitz, right ? 250 : 700);
}

function endBlitz() {
  const acc = quiz.total ? Math.round((quiz.right / quiz.total) * 100) : 0;
  finish('blitz', quiz.score, [
    `✅ Correct: ${quiz.right} / ${quiz.total} (${acc}%)`,
    `🔥 Best combo: ${quiz.bestCombo}`,
    `⬆️ Highest level: ${quiz.maxLevel}`,
  ]);
}

/* =========================================================
   MODE 2: PATTERN HUNT
   ========================================================= */
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
const mk = (f) => Array.from({ length: 6 }, (_, i) => f(i));

const SEQ = {
  add: () => { const a = rand(1, 30), d = rand(2, 12); return { t: mk((i) => a + i * d), rule: `Add ${d} each time.` }; },
  sub: () => { const d = rand(3, 12), a = rand(6 * d, 6 * d + 40); return { t: mk((i) => a - i * d), rule: `Subtract ${d} each time.` }; },
  double: () => { const a = rand(1, 6); return { t: mk((i) => a * 2 ** i), rule: 'Double it each time (× 2).' }; },
  triple: () => { const a = rand(1, 4); return { t: mk((i) => a * 3 ** i), rule: 'Multiply by 3 each time.' }; },
  squares: () => {
    const s = rand(1, 6);
    return { t: mk((i) => (s + i) ** 2), rule: `Square numbers: ${s}², ${s + 1}², ${s + 2}², …` };
  },
  growGap: () => {
    const a = rand(1, 10), g = rand(1, 4);
    return { t: mk((i) => a + i * g + (i * (i - 1)) / 2), rule: `The gap grows by 1 each time (+${g}, +${g + 1}, +${g + 2}, …).` };
  },
  zigzag: () => {
    const p = rand(5, 12), q = rand(1, p - 2), a = rand(1, 20);
    const t = [a];
    for (let i = 1; i < 6; i++) t.push(t[i - 1] + (i % 2 ? p : -q));
    return { t, rule: `Zig-zag: add ${p}, then subtract ${q}, and repeat.` };
  },
  fib: () => {
    const a = rand(1, 5), b = rand(a, 8);
    const t = [a, b];
    while (t.length < 6) t.push(t[t.length - 1] + t[t.length - 2]);
    return { t, rule: 'Each number is the sum of the two before it.' };
  },
  dblPlus: () => {
    const a = rand(1, 5), c = pick([1, 2, -1]);
    const t = [a];
    for (let i = 1; i < 6; i++) t.push(t[i - 1] * 2 + c);
    return { t, rule: `Double it, then ${c > 0 ? 'add' : 'subtract'} ${Math.abs(c)}.` };
  },
  cubes: () => { const s = rand(1, 3); return { t: mk((i) => (s + i) ** 3), rule: `Cube numbers: ${s}³, ${s + 1}³, ${s + 2}³, …` }; },
  primes: () => {
    const s = rand(0, PRIMES.length - 6);
    return { t: PRIMES.slice(s, s + 6), rule: 'Prime numbers: each one divides only by 1 and itself.' };
  },
  sqPlus: () => {
    const s = rand(1, 4), c = rand(1, 9);
    return { t: mk((i) => (s + i) ** 2 + c), rule: `Square numbers plus ${c} (${s}² + ${c}, ${s + 1}² + ${c}, …).` };
  },
  weave: () => {
    const a = rand(1, 10), d1 = rand(2, 6), b = rand(25, 45), d2 = rand(2, 5);
    const t = mk((i) => (i % 2 === 0 ? a + (i / 2) * d1 : b - ((i - 1) / 2) * d2));
    return { t, rule: `Two patterns woven together: ${a}, ${a + d1}, … (+${d1}) and ${b}, ${b - d2}, … (−${d2}).` };
  },
};
const SEQ_SETS = {
  easy: ['add', 'sub', 'double', 'squares', 'zigzag'],
  normal: ['add', 'sub', 'double', 'triple', 'squares', 'growGap', 'zigzag', 'fib', 'dblPlus'],
  hard: ['triple', 'growGap', 'fib', 'dblPlus', 'cubes', 'primes', 'sqPlus', 'weave', 'zigzag'],
};
const SEQ_QUESTIONS = 10;

function seqHtml(shown, reveal) {
  const nums = shown.map((n) => `<span>${fmt(n)}</span>`).join('');
  const last = reveal === undefined ? '<span class="q">?</span>' : `<span class="q revealed">${fmt(reveal)}</span>`;
  return `<div class="seq">${nums}${last}</div>`;
}

function startSequence() {
  session++; stopTick();
  Object.assign(quiz, { mode: 'sequence', lastMode: 'sequence', score: 0, qn: 0, lives: 3, right: 0, lastKind: null });
  $('#qMidLabel').textContent = 'Lives';
  $('#qRightLabel').textContent = 'Question';
  $('#combo').textContent = '';
  show('quiz');
  nextSeq();
}

function seqHud() {
  $('#qScore').textContent = quiz.score;
  $('#qMidVal').textContent = '❤️'.repeat(quiz.lives) || '💀';
  $('#qRightVal').textContent = `${quiz.qn}/${SEQ_QUESTIONS}`;
}

function nextSeq() {
  if (quiz.qn >= SEQ_QUESTIONS || quiz.lives <= 0) return endSequence();
  quiz.qn++;
  let kind;
  do { kind = pick(SEQ_SETS[settings.diff]); } while (kind === quiz.lastKind);
  quiz.lastKind = kind;

  const { t, rule } = SEQ[kind]();
  const shown = t.slice(0, 5);
  const ans = t[5];
  Object.assign(quiz, { rule, shown, seqAns: ans });
  // "smart" wrong answers: what you'd get by guessing a simpler rule
  const smart = [2 * t[4] - t[3], t[4] + (t[3] - t[2]), t[4] * 2].filter((v) => v !== ans);
  seqHud();
  askQuestion(seqHtml(shown), makeChoices(ans, smart), ans, onSeqAnswer);

  const limit = diff().seqTime;
  quiz.qStart = performance.now();
  stopTick();
  tick = setInterval(() => {
    const left = limit - (performance.now() - quiz.qStart) / 1000;
    const bar = $('#qBar');
    bar.style.width = Math.max(0, (left / limit) * 100) + '%';
    bar.classList.toggle('low', left < 5);
    if (left <= 0 && !quiz.locked) {
      quiz.locked = true;
      const btn = $('#choices').children[quiz.answerIdx];
      if (btn) btn.classList.add('right');
      onSeqAnswer(false, true);
    }
  }, 100);
}

function onSeqAnswer(right, timedOut) {
  const left = Math.max(0, diff().seqTime - (performance.now() - quiz.qStart) / 1000);
  stopTick();
  $('#question').innerHTML = seqHtml(quiz.shown, quiz.seqAns);
  if (right) {
    quiz.right++;
    const pts = Math.round((50 + left * 5) * diff().mult);
    quiz.score += pts;
    sfx.good();
    $('#explain').innerHTML = `✅ <b>+${pts}</b> · ${quiz.rule}`;
    seqHud();
    later(nextSeq, 1400);
  } else {
    quiz.lives--;
    sfx.bad();
    shake($('#question'));
    seqHud();
    $('#explain').innerHTML =
      `${timedOut ? "⏰ Time's up!" : '❌ Not quite.'} The answer was <b>${fmt(quiz.seqAns)}</b>.<br>${quiz.rule}<br>` +
      `<button class="next-btn" id="nextBtn">${quiz.lives > 0 && quiz.qn < SEQ_QUESTIONS ? 'Next →' : 'See results →'}</button>`;
    $('#nextBtn').addEventListener('click', nextSeq);
  }
}

function endSequence() {
  finish('sequence', quiz.score, [
    `✅ Correct: ${quiz.right} / ${quiz.qn}`,
    `❤️ Lives left: ${quiz.lives}`,
  ]);
}

/* =========================================================
   MODE 3: MAKE THE NUMBER
   ========================================================= */
const TCFG = {
  easy:   { nums: () => Array.from({ length: 4 }, () => rand(1, 9)), use: [2, 3], min: 10, max: 60 },
  normal: { nums: () => [...Array.from({ length: 4 }, () => rand(1, 10)), pick([25, 50])], use: [3, 4], min: 20, max: 250 },
  hard:   { nums: () => [...Array.from({ length: 4 }, () => rand(1, 10)), ...shuffle([25, 50, 75, 100]).slice(0, 2)], use: [3, 5], min: 101, max: 999 },
};
const T_ROUNDS = 5;
const T = {};

// Build a puzzle by actually doing a random calculation, so it is always solvable.
function genTarget() {
  const cfg = TCFG[settings.diff];
  for (let tries = 0; tries < 5000; tries++) {
    const nums = cfg.nums();
    const order = shuffle(nums.slice());
    const k = rand(cfg.use[0], cfg.use[1]);
    let acc = order[0];
    const steps = [];
    for (let i = 1; i < k; i++) {
      const n = order[i];
      const opts = [['+', acc + n, acc, n]];
      if (n > 1 && acc > 1) opts.push(['×', acc * n, acc, n]);
      if (acc > n) opts.push(['−', acc - n, acc, n]);
      else if (n > acc) opts.push(['−', n - acc, n, acc]);
      if (n > 1 && acc % n === 0) opts.push(['÷', acc / n, acc, n]);
      const [op, r, x, y] = pick(opts);
      steps.push(`${x} ${op} ${y} = ${r}`);
      acc = r;
    }
    if (acc >= cfg.min && acc <= cfg.max && !nums.includes(acc)) return { nums, target: acc, steps };
  }
  return { nums: [4, 6, 2, 9], target: 26, steps: ['4 × 6 = 24', '24 + 2 = 26'] };
}

function startTarget() {
  session++; stopTick();
  quiz.lastMode = 'target';
  Object.assign(T, { score: 0, round: 0, solved: 0 });
  show('target');
  nextTarget();
}

function nextTarget() {
  if (T.round >= T_ROUNDS) return endTarget();
  T.round++;
  const g = genTarget();
  Object.assign(T, {
    target: g.target, steps: g.steps, startNums: g.nums.slice(),
    tiles: g.nums.map((v) => ({ v, made: false })),
    sel: null, op: null, hist: [], log: [], done: false, t0: performance.now(),
  });
  $('#tTarget').textContent = T.target;
  $('#tScore').textContent = T.score;
  $('#tRound').textContent = `${T.round}/${T_ROUNDS}`;
  $('#tMsg').innerHTML = '';
  renderTiles();
  stopTick();
  tick = setInterval(() => {
    if (!T.done) $('#tTime').textContent = Math.floor((performance.now() - T.t0) / 1000) + 's';
  }, 250);
  $('#tTime').textContent = '0s';
}

function renderTiles() {
  const box = $('#tiles');
  box.innerHTML = '';
  T.tiles.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'tile' + (t.made ? ' made' : '') + (i === T.sel ? ' sel' : '') + (t.v === T.target ? ' hit' : '');
    b.textContent = t.v;
    b.addEventListener('click', () => tapTile(i));
    box.appendChild(b);
  });
  $$('#ops button').forEach((b) => b.classList.toggle('on', b.dataset.op === T.op));
  $('#tLog').innerHTML = T.log.join(' &nbsp;·&nbsp; ');
  const closest = T.tiles.reduce((best, t) => (Math.abs(t.v - T.target) < Math.abs(best - T.target) ? t.v : best), T.tiles[0].v);
  const off = Math.abs(closest - T.target);
  $('#tNear').textContent = off === 0 ? '' : `Closest so far: ${closest} (off by ${off})`;
}

function tapTile(i) {
  if (T.done) return;
  sfx.click();
  if (T.sel === null || T.op === null) {
    T.sel = T.sel === i ? null : i;
    if (T.sel === null) T.op = null;
    return renderTiles();
  }
  if (i === T.sel) { T.sel = null; T.op = null; return renderTiles(); }
  combine(T.sel, i, T.op);
}

function chooseOp(op) {
  if (T.done) return;
  if (T.sel === null) { toast('Tap a number first'); return; }
  T.op = T.op === op ? null : op;
  sfx.click();
  renderTiles();
}

function applyOp(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b !== 0 && a % b === 0 ? a / b : NaN;
  }
  return NaN;
}

function combine(i, j, op) {
  const a = T.tiles[i].v, b = T.tiles[j].v;
  const r = applyOp(a, b, op);
  if (!Number.isInteger(r) || r <= 0) {
    sfx.bad();
    toast(op === '÷' ? `${a} doesn't divide evenly by ${b}` : 'Answers must be positive whole numbers');
    shake($('#tiles'));
    return;
  }
  T.hist.push({ tiles: T.tiles.map((t) => ({ ...t })), log: T.log.slice() });
  T.tiles[j] = { v: r, made: true };
  T.tiles.splice(i, 1);
  T.sel = j > i ? j - 1 : j;   // keep the new tile selected so you can chain moves
  T.op = null;
  T.log.push(`${a} ${op} ${b} = ${r}`);
  if (r === T.target) return solveTarget();
  sfx.good();
  renderTiles();
  if (T.tiles.length === 1) $('#tMsg').innerHTML = 'No moves left. Try <b>Undo</b> or <b>Reset</b>.';
}

function roundEndButton() {
  const last = T.round >= T_ROUNDS;
  $('#tMsg').innerHTML += `<br><button class="next-btn" id="nextBtn">${last ? 'See results →' : 'Next round →'}</button>`;
  $('#nextBtn').addEventListener('click', nextTarget);
}

function solveTarget() {
  T.done = true;
  T.sel = null;
  const secs = Math.floor((performance.now() - T.t0) / 1000);
  const pts = Math.round((100 + Math.max(0, 90 - secs) * 2) * diff().mult);
  T.score += pts;
  T.solved++;
  $('#tScore').textContent = T.score;
  renderTiles();
  sfx.win();
  confetti();
  $('#tMsg').innerHTML = `🎉 Bang on! <b>+${pts}</b> points (${secs}s)`;
  roundEndButton();
}

function undoTarget() {
  if (T.done || !T.hist.length) return;
  const h = T.hist.pop();
  T.tiles = h.tiles; T.log = h.log; T.sel = null; T.op = null;
  $('#tMsg').innerHTML = '';
  sfx.click();
  renderTiles();
}

function resetTarget() {
  if (T.done) return;
  T.tiles = T.startNums.map((v) => ({ v, made: false }));
  T.hist = []; T.log = []; T.sel = null; T.op = null;
  $('#tMsg').innerHTML = '';
  sfx.click();
  renderTiles();
}

function giveUpTarget() {
  if (T.done) return;
  T.done = true;
  T.sel = null; T.op = null;
  renderTiles();
  sfx.bad();
  $('#tMsg').innerHTML = `💡 Here's one way:<br><b>${T.steps.join('<br>')}</b>`;
  roundEndButton();
}

function endTarget() {
  finish('target', T.score, [`🎯 Solved: ${T.solved} / ${T_ROUNDS}`]);
}

/* =========================================================
   RESULTS
   ========================================================= */
function finish(mode, score, lines) {
  session++; stopTick();
  const key = `best_${mode}_${settings.diff}`;
  const prev = store.get(key, 0);
  const isBest = score > prev;
  if (isBest) store.set(key, score);
  $('#rTitle').textContent = isBest ? '🏆 New personal best!'
    : score === 0 ? 'Keep practising, you’ve got this!'
    : pick(['Nice work!', 'Good game!', 'Well played!']);
  $('#rScore').textContent = score;
  $('#rBest').textContent = `Best on ${diff().label}: ${Math.max(prev, score)}`;
  $('#rLines').innerHTML = lines.map((l) => `<li>${l}</li>`).join('');
  show('results');
  if (isBest) { confetti(); sfx.win(); }
}

/* =========================================================
   WIRING
   ========================================================= */
const START = { blitz: startBlitz, target: startTarget, sequence: startSequence };

$$('.diff button').forEach((b) => b.addEventListener('click', () => {
  settings.diff = b.dataset.diff;
  store.set('diff', settings.diff);
  sfx.click();
  refreshHome();
}));
$$('.mode-card').forEach((b) => b.addEventListener('click', () => START[b.dataset.mode]()));
$$('#ops button').forEach((b) => b.addEventListener('click', () => chooseOp(b.dataset.op)));
$('#homeBtn').addEventListener('click', goHome);
$('#soundBtn').addEventListener('click', () => {
  settings.sound = !settings.sound;
  store.set('sound', settings.sound);
  refreshHome();
  sfx.click();
});
$('#tUndo').addEventListener('click', undoTarget);
$('#tReset').addEventListener('click', resetTarget);
$('#tGiveUp').addEventListener('click', giveUpTarget);
$('#rAgain').addEventListener('click', () => START[quiz.lastMode]());
$('#rHome').addEventListener('click', goHome);

document.addEventListener('keydown', (e) => {
  const screen = $('.screen.active').id;
  if (e.key === 'Escape') return goHome();
  if (e.key === 'Enter') {
    const n = $('.screen.active #nextBtn');
    if (n) { e.preventDefault(); n.click(); }
    return;
  }
  if (screen === 'quiz' && /^[1-4]$/.test(e.key)) {
    const b = $('#choices').children[+e.key - 1];
    if (b) b.click();
  } else if (screen === 'target') {
    const map = { '+': '+', '-': '−', '*': '×', x: '×', '/': '÷' };
    if (map[e.key]) { e.preventDefault(); chooseOp(map[e.key]); }
    else if (e.key === 'Backspace') { e.preventDefault(); undoTarget(); }
  }
});

refreshHome();
