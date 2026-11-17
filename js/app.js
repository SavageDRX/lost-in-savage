(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-GB');
  // escape text before it goes into innerHTML
  const esc = t =>
    String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const POOLS = {
    e: { label: 'Easy', f: m => m.plays > 200 },
    m: { label: 'Medium', f: m => m.plays >= 110 && m.plays <= 200 },
    h: { label: 'Hard', f: m => m.plays >= 50 && m.plays < 110 },
    a: { label: 'Every map', f: m => true },
    r: { label: 'Daily ranked', f: m => m.plays >= 110 },
  };
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
    },
  };
  function mulberry(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let INDEX = [],
    R = null,
    game = null,
    opts = {
      pool: { e: 1, m: 1, h: 1, a: 1 }[store.get('lis_pool')] ? store.get('lis_pool') : 'e',
      rounds: +(store.get('lis_rounds') || 5),
    };
  const cache = {};
  const bcache = {};
  const getJSON = u =>
    fetch(u).then(r => {
      if (!r.ok) throw new Error('Could not load ' + u);
      return r.json();
    });
  // Hard maps are bundled ten to a file (the site has a file limit); others are one file each
  const loadMap = id =>
    cache[id] ||
    (cache[id] = (() => {
      const e = INDEX.find(m => m.id === id);
      if (e && e.b) {
        const b = bcache[e.b] || (bcache[e.b] = getJSON('data/' + e.b + '.json'));
        return b.then(x => {
          if (!x[id]) throw new Error('Could not load ' + id);
          return x[id];
        });
      }
      return getJSON('data/' + id + '.json');
    })());

  /* ---------- 3D view ---------- */
  const cv = $('view');
  let need = true,
    base = { yaw: 0, pitch: -0.03 },
    fov = 68;
  function resize() {
    const r = cv.getBoundingClientRect(),
      d = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(r.width * d)),
      h = Math.max(2, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      need = true;
    }
  }
  new ResizeObserver(resize).observe(cv);
  function frame() {
    if (need && R && R.map) {
      need = false;
      R.fov = (fov * Math.PI) / 180;
      R.render();
      drawCompass();
    }
    requestAnimationFrame(frame);
  }
  function drawCompass() {
    const c = $('compass');
    let h = '';
    const span = (70 * Math.PI) / 180;
    const marks = [
      ['N', 0, 1],
      ['NE', 45, 0],
      ['E', 90, 1],
      ['SE', 135, 0],
      ['S', 180, 1],
      ['SW', 225, 0],
      ['W', 270, 1],
      ['NW', 315, 0],
    ];
    for (let a = 0; a < 360; a += 15) {
      let rel = (a * Math.PI) / 180 - R.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) > span) continue;
      const x = 50 + (rel / span) * 50;
      const m = marks.find(m => m[1] === a);
      h += m
        ? `<span class="${m[2] ? 'cd' : ''}" style="left:${x}%">${m[0]}</span>`
        : `<span style="left:${x}%;font-size:9px;opacity:.5">|</span>`;
    }
    c.innerHTML = h;
  }
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    if (!R) return;
    drag = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('drag');
    $('vhint').style.opacity = 0;
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const k = ((0.0052 * fov) / 68) * (1000 / Math.max(cv.clientWidth, 300));
    R.yaw += (e.clientX - drag.x) * k * -1;
    R.pitch = Math.max(-0.75, Math.min(0.6, R.pitch + (e.clientY - drag.y) * k));
    drag = { x: e.clientX, y: e.clientY };
    need = true;
  });
  const endDrag = () => {
    drag = null;
    cv.classList.remove('drag');
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false }
  );
  function zoom(f) {
    fov = Math.max(22, Math.min(85, fov * f));
    need = true;
  }
  $('zIn').onclick = () => zoom(1 / 1.2);
  $('zOut').onclick = () => zoom(1.2);
  $('vReset').onclick = () => {
    if (!R) return;
    R.yaw = base.yaw;
    R.pitch = base.pitch;
    fov = 68;
    need = true;
  };
  window.addEventListener('keydown', e => {
    if (!R || document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') {
      R.yaw -= 0.12;
      need = true;
    } else if (e.key === 'ArrowRight') {
      R.yaw += 0.12;
      need = true;
    } else if (e.key === 'ArrowUp') {
      R.pitch = Math.min(0.6, R.pitch + 0.08);
      need = true;
    } else if (e.key === 'ArrowDown') {
      R.pitch = Math.max(-0.75, R.pitch - 0.08);
      need = true;
    }
  });

  function setLoading(on, txt) {
    $('loading').hidden = !on;
    if (txt) $('loadTxt').textContent = txt;
  }
  // one map load at a time; a newer request (e.g. Play pressed while the backdrop is loading) supersedes older ones
  let showSeq = 0,
    showChain = Promise.resolve();
  function show(id, seed) {
    const my = ++showSeq;
    setLoading(true, 'Finding a spot…');
    const run = async () => {
      if (my !== showSeq) return null;
      const d = await loadMap(id);
      if (my !== showSeq) return null;
      await new Promise(r => setTimeout(r, 20));
      await R.loadMap(d);
      if (my !== showSeq) return null;
      const s = R.randomSpot(seed);
      R.setView(s.x, s.y, s.yaw, -0.03);
      base = { yaw: s.yaw, pitch: -0.03 };
      fov = 68;
      need = true;
      setLoading(false);
      return s;
    };
    const p = showChain.then(run, run);
    showChain = p.catch(() => {});
    return p;
  }

  /* ---------- panels ---------- */
  function panel(name) {
    for (const p of ['pStart', 'pPick', 'pPin', 'pResult', 'pEnd']) $(p).hidden = p !== name;
  }
  function seg(id, key) {
    const el = $(id);
    const upd = () => {
      for (const b of el.children) b.classList.toggle('on', b.dataset.v == String(opts[key]));
      showBest();
    };
    el.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      opts[key] = key === 'rounds' ? +b.dataset.v : b.dataset.v;
      store.set('lis_' + key, opts[key]);
      upd();
    };
    upd();
  }
  function showBest() {
    const b = store.get(`lis_best_${opts.pool}${opts.rounds}`);
    $('bestTxt').innerHTML = b
      ? `Your best (${POOLS[opts.pool].label}, ${opts.rounds} rounds): <b>${fmt(+b)}</b> / ${fmt(opts.rounds * 5000)}`
      : '';
  }
  function thumbStyle(m, size) {
    const c = 15,
      s = size / 96;
    return `background-size:${1440 * s}px auto;background-position:-${(m.t % c) * 96 * s}px -${Math.floor(m.t / c) * 96 * s}px`;
  }
  function chips() {
    $('chipRound').innerHTML = game
      ? `Round <b>${Math.min(game.i + 1, game.maps.length)}</b> / ${game.maps.length}`
      : 'Round <b>–</b>';
    $('chipScore').innerHTML = `Score <b>${fmt(game ? game.score : 0)}</b>`;
  }

  /* ---------- game ---------- */
  function codeFor(pool, rounds, seed) {
    return `${pool.toUpperCase()}${rounds}-${seed}`;
  }
  function parseCode(c) {
    const m = /^([EMHA])(3|5|10)-(\d{1,9})$/.exec(c.trim().toUpperCase());
    return m ? { pool: m[1].toLowerCase(), rounds: +m[2], seed: +m[3] } : null;
  }
  function start(pool, rounds, seed) {
    const list = INDEX.filter(POOLS[pool].f);
    const rnd = mulberry(seed);
    const order = list
      .map(m => [rnd(), m])
      .sort((a, b) => a[0] - b[0])
      .map(x => x[1]);
    game = {
      pool,
      rounds,
      seed,
      maps: order.slice(0, rounds),
      spots: Array.from({ length: rounds }, () => Math.floor(rnd() * 1e9) + 1),
      i: -1,
      score: 0,
      res: [],
      list,
    };
    store.set('lis_inranked', '0');
    $('search').value = '';
    $('intro').hidden = true;
    $('menuBtn').hidden = false;
    nextRound();
  }
  async function nextRound() {
    game.i++;
    if (game.i >= game.maps.length) return finish();
    chips();
    panel('pPick');
    renderGrid();
    const m = game.maps[game.i];
    try {
      const spot = await show(m.id, game.spots[game.i]);
      if (!spot) return;
      game.cur = { m, spot, pick: null, pin: null };
    } catch (err) {
      setLoading(true, 'Could not load this map. Check your connection and try again.');
      return;
    }
    $('statusL').innerHTML =
      `Round <b>${game.i + 1}</b> of ${game.maps.length} · ${game.ranked ? `Daily ranked · ${dayLabel(game.day)}` : POOLS[game.pool].label + ' maps'}`;
    $('statusR').innerHTML = game.ranked
      ? `Resets in <b>${untilReset()}</b>`
      : `Game code <b>${codeFor(game.pool, game.rounds, game.seed)}</b>`;
    const nx = game.maps[game.i + 1];
    if (nx) loadMap(nx.id);
  }
  function renderGrid() {
    const q = $('search').value.trim().toLowerCase();
    const list = game.list.filter(m => !q || m.name.toLowerCase().includes(q) || m.author.toLowerCase().includes(q));
    $('listCount').textContent = `${list.length} map${list.length === 1 ? '' : 's'}`;
    $('grid').innerHTML = list
      .map(
        m =>
          `<button class="mapbtn" data-id="${esc(m.id)}" title="${esc(m.name)} by ${esc(m.author)}"><div class="th" style="${thumbStyle(m, 112)}"></div><div class="nm">${esc(m.name)}</div><div class="pl">${fmt(m.plays)} plays</div></button>`
      )
      .join('');
    for (const b of $('grid').querySelectorAll('.th')) {
      const w = b.clientWidth || 112;
      if (w !== 112) {
        const m = INDEX.find(x => x.id === b.parentNode.dataset.id);
        b.setAttribute('style', thumbStyle(m, w));
      }
    }
  }
  $('search').addEventListener('input', renderGrid);
  $('grid').addEventListener('click', e => {
    const b = e.target.closest('.mapbtn');
    if (!b || !game || !game.cur) return;
    pickMap(INDEX.find(m => m.id === b.dataset.id));
  });
  function pickMap(m) {
    game.cur.pick = m;
    game.cur.pin = null;
    $('pinName').textContent = m.name;
    $('pinAuthor').textContent = `by ${m.author} · ${fmt(m.plays)} plays`;
    $('pinImg').removeAttribute('src');
    loadMap(m.id)
      .then(d => {
        if (game && game.cur && game.cur.pick === m) $('pinImg').src = d.ov;
      })
      .catch(() => toast('Could not load that minimap.'));
    $('pinSvg').innerHTML = '';
    const g = $('guessBtn');
    g.disabled = true;
    g.textContent = 'Click the minimap to place your pin';
    panel('pPin');
  }
  $('changeMap').onclick = () => {
    panel('pPick');
  };
  const PIN = (x, y, col, label) =>
    `<g transform="translate(${x} ${y})"><path d="M0 0 C-14 -22 -22 -32 -22 -44 A22 22 0 1 1 22 -44 C22 -32 14 -22 0 0Z" fill="${col}" stroke="#0d0a07" stroke-width="4"/><circle cy="-44" r="8" fill="#0d0a07"/>${label ? `<text y="-80" text-anchor="middle" font-family="Inter,sans-serif" font-weight="700" font-size="30" fill="#fff" stroke="#0d0a07" stroke-width="6" paint-order="stroke">${label}</text>` : ''}</g>`;
  $('pinBox').addEventListener('click', e => {
    if (!game || !game.cur || !game.cur.pick) return;
    const r = $('pinBox').getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width,
      v = (e.clientY - r.top) / r.height;
    game.cur.pin = { u, v };
    $('pinSvg').innerHTML = PIN(u * 1000, v * 1000, '#f0c46a');
    const g = $('guessBtn');
    g.disabled = false;
    g.textContent = 'Make my guess';
  });
  $('guessBtn').onclick = () => {
    if (!game.cur.pin) return;
    score();
  };
  function score() {
    const c = game.cur,
      m = c.m,
      ok = c.pick.id === m.id;
    const tu = c.spot.x / (m.W * 100),
      tv = 1 - c.spot.y / (m.H * 100);
    let pts = 0,
      dist = null;
    if (ok) {
      dist = Math.hypot((c.pin.u - tu) * m.W, (c.pin.v - tv) * m.H);
      pts = dist < 2 ? 5000 : Math.round(5000 * Math.exp(-(dist - 2) / (m.W * 0.25)));
    }
    game.score += pts;
    game.res.push({ m, pick: c.pick, pts, dist, ok });
    chips();
    const V = $('verdict');
    if (!ok) {
      V.className = 'verdict bad';
      V.textContent = 'Wrong map';
      $('resDetail').innerHTML =
        `You picked <b>${esc(c.pick.name)}</b>. You were on <b>${esc(m.name)}</b> by ${esc(m.author)}. Here's where you were standing.`;
    } else if (pts >= 4500) {
      V.className = 'verdict good';
      V.textContent = pts === 5000 ? 'Spot on!' : 'Superb!';
    } else if (pts >= 2500) {
      V.className = 'verdict good';
      V.textContent = 'Right map, close!';
    } else {
      V.className = 'verdict ok';
      V.textContent = 'Right map';
    }
    if (ok)
      $('resDetail').innerHTML =
        `<b>${esc(m.name)}</b> by ${esc(m.author)}. Your pin was <b>${dist.toFixed(1)} tiles</b> away (${fmt(Math.round(dist * 100))} game units).`;
    $('ptsNum').textContent = fmt(pts);
    $('ptsBar').style.width = '0';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        $('ptsBar').style.width = pts / 50 + '%';
      })
    );
    $('resImg').removeAttribute('src');
    loadMap(m.id).then(d => {
      $('resImg').src = d.ov;
    });
    let svg = '';
    const T = [tu * 1000, tv * 1000];
    if (ok) {
      const P = [c.pin.u * 1000, c.pin.v * 1000];
      svg +=
        `<line x1="${P[0]}" y1="${P[1]}" x2="${T[0]}" y2="${T[1]}" stroke="#0d0a07" stroke-width="9" stroke-linecap="round"/><line x1="${P[0]}" y1="${P[1]}" x2="${T[0]}" y2="${T[1]}" stroke="#f0c46a" stroke-width="4" stroke-dasharray="14 10" stroke-linecap="round"/>` +
        PIN(P[0], P[1], '#f0c46a', Math.hypot(P[0] - T[0], P[1] - T[1]) > 90 ? 'You' : '');
    }
    svg += PIN(T[0], T[1], '#7fb24a', 'Here');
    if (game.ranked) saveRanked();
    $('resSvg').innerHTML = svg;
    $('nextBtn').textContent = game.i + 1 >= game.maps.length ? 'See final score' : 'Next round';
    panel('pResult');
  }
  $('nextBtn').onclick = () => nextRound();
  const RANKS = [
    [0, 'Lost Nomad'],
    [0.15, 'Scavenger'],
    [0.32, 'Savage'],
    [0.5, 'Legionnaire'],
    [0.68, 'Predator'],
    [0.84, 'Behemoth'],
  ];
  function finish() {
    const max = game.maps.length * 5000,
      f = game.score / max;
    const rank = RANKS.filter(r => f >= r[0]).pop()[1];
    $('rank').textContent = rank;
    $('total').innerHTML = `${fmt(game.score)} <small>/ ${fmt(max)}</small>`;
    $('rankedEnd').hidden = !game.ranked;
    $('shareBtn').textContent = game.ranked ? 'Copy result' : 'Copy result & code';
    $('againBtn').textContent = game.ranked ? 'Main menu' : 'Play again';
    if (game.ranked) {
      rankedFinish();
    } else {
      const key = `lis_best_${game.pool}${game.rounds}`,
        prev = +(store.get(key) || 0);
      if (game.score > prev) store.set(key, game.score);
      $('endSub').innerHTML =
        `${POOLS[game.pool].label} maps · code <b style="color:var(--accent2)">${codeFor(game.pool, game.rounds, game.seed)}</b>${game.score > prev && prev ? ' · new best!' : ''}`;
    }
    $('sumTable').innerHTML = game.res
      .map(
        (r, i) =>
          `<tr><td class="th"><div style="${thumbStyle(r.m, 40)}"></div></td><td class="n">${i + 1}. ${esc(r.m.name)}<small>${r.ok ? `${r.dist.toFixed(1)} tiles away` : `you said ${esc(r.pick.name)}`}</small></td><td class="p">${fmt(r.pts)}</td></tr>`
      )
      .join('');
    panel('pEnd');
    chips();
    $('statusL').textContent = 'Game over. Look around as long as you like.';
  }
  function mainMenu() {
    store.set('lis_inranked', '0');
    game = null;
    showSeq++;
    setLoading(false);
    chips();
    panel('pStart');
    showBest();
    $('intro').hidden = false;
    $('menuBtn').hidden = true;
    updateRankedCard();
    $('startBoard').hidden = true;
    $('statusL').textContent = 'Every view is a real spot on a real Savage map, rebuilt from the map files.';
    $('statusR').textContent = '';
  }
  $('againBtn').onclick = mainMenu;
  $('menuBtn').onclick = mainMenu;
  $('logoBtn').onclick = mainMenu;
  $('introPlay').onclick = () => $('playBtn').click();
  $('shareBtn').onclick = async () => {
    const t = game.ranked
      ? `Lost in Savage daily ranked (${dayLabel(game.day)}): ${fmt(game.score)} / ${fmt(game.maps.length * 5000)}. Can you beat me?`
      : `Lost in Savage: ${fmt(game.score)} / ${fmt(game.maps.length * 5000)} (${POOLS[game.pool].label}, ${game.maps.length} rounds). Can you beat me? Game code: ${codeFor(game.pool, game.rounds, game.seed)}`;
    try {
      await navigator.clipboard.writeText(t);
      toast('Copied! Send it to a friend.');
    } catch (e) {
      toast('Code: ' + codeFor(game.pool, game.rounds, game.seed));
    }
  };
  function toast(t) {
    const el = $('toast');
    el.textContent = t;
    el.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('on'), 2600);
  }
  $('playBtn').onclick = () => start(opts.pool, opts.rounds, Math.floor(Math.random() * 900000) + 100000);
  $('codeBtn').onclick = () => {
    const c = parseCode($('codeIn').value);
    if (!c) {
      toast("That code doesn't look right. It should look like P5-483920.");
      return;
    }
    start(c.pool, c.rounds, c.seed);
  };
  $('codeIn').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('codeBtn').click();
  });
  $('howBtn').onclick = () => ($('howModal').hidden = false);
  $('howClose').onclick = () => ($('howModal').hidden = true);
  $('howModal').addEventListener('click', e => {
    if (e.target === $('howModal')) $('howModal').hidden = true;
  });

  // test hooks (expose the answer!) only on a local dev server with ?debug
  const DEBUG = /[?&]debug\b/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  /* ---------- daily ranked: 3 Easy + 2 Medium, same for everyone, new set at 04:00 GMT ---------- */
  const DAY0 = Date.UTC(2026, 0, 1),
    DAYMS = 86400000,
    RESET_H = 4;
  const rankedDay = () => Math.floor((Date.now() - RESET_H * 3600000 - DAY0) / DAYMS);
  const dayLabel = d =>
    new Date(DAY0 + d * DAYMS + RESET_H * 3600000).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  function untilReset() {
    const next = DAY0 + (rankedDay() + 1) * DAYMS + RESET_H * 3600000,
      ms = Math.max(0, next - Date.now());
    const h = Math.floor(ms / 3600000),
      m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  function rankedSet(day) {
    let h = 0x9e3779b9 ^ (day * 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    const rnd = mulberry(h);
    const pick = (pool, n) =>
      INDEX.filter(POOLS[pool].f)
        .map(m => [rnd(), m])
        .sort((a, b) => a[0] - b[0])
        .slice(0, n)
        .map(x => x[1]);
    const maps = [...pick('e', 3), ...pick('m', 2)]
      .map(m => [rnd(), m])
      .sort((a, b) => a[0] - b[0])
      .map(x => x[1]);
    return { maps, spots: maps.map(() => Math.floor(rnd() * 1e9) + 1) };
  }
  function loadRanked() {
    try {
      const j = JSON.parse(store.get('lis_ranked3') || 'null');
      return j && j.day === rankedDay() ? j : null;
    } catch (e) {
      return null;
    }
  }
  function saveRanked(extra) {
    const prev = loadRanked() || {};
    store.set(
      'lis_ranked3',
      JSON.stringify({
        ...prev,
        day: game.day,
        i: game.i,
        score: game.score,
        res: game.res.map(r => ({ id: r.m.id, pick: r.pick.id, pts: r.pts, dist: r.dist, ok: r.ok })),
        ...(extra || {}),
      })
    );
  }
  function startRanked() {
    const day = rankedDay(),
      saved = loadRanked();
    if (saved && saved.done) {
      showStartBoard(true);
      toast("You've played today's ranked. A new one starts in " + untilReset() + '.');
      return;
    }
    const { maps, spots } = rankedSet(day);
    game = {
      pool: 'r',
      rounds: 5,
      day,
      ranked: true,
      maps,
      spots,
      i: -1,
      score: 0,
      res: [],
      list: INDEX.filter(POOLS.r.f),
    };
    if (saved) {
      const byId = id => INDEX.find(m => m.id === id);
      game.res = (saved.res || [])
        .map(r => ({ m: byId(r.id), pick: byId(r.pick), pts: r.pts, dist: r.dist, ok: r.ok }))
        .filter(r => r.m && r.pick);
      game.i = game.res.length - 1;
      game.score = game.res.reduce((a, r) => a + r.pts, 0);
      if (game.res.length) toast("Picking up today's ranked where you left off.");
    } else store.set('lis_ranked3', JSON.stringify({ day, i: -1, score: 0, res: [] }));
    store.set('lis_inranked', '1');
    $('search').value = '';
    $('intro').hidden = true;
    $('menuBtn').hidden = false;
    nextRound();
  }
  function updateRankedCard() {
    const saved = loadRanked();
    $('rankedInfo').innerHTML =
      `Resets daily at 4:00 GMT (in <b>${untilReset()}</b>).` +
      (saved && saved.done
        ? ` You scored <b>${fmt(saved.score)}</b> today.`
        : saved && saved.res && saved.res.length
          ? ` You're on round ${saved.res.length + 1} of 5.`
          : '');
    $('rankedBtn').textContent =
      saved && saved.done
        ? 'Played today ✓'
        : saved && saved.res && saved.res.length
          ? 'Continue ranked'
          : "Play today's ranked";
    $('rankedBtn').disabled = !!(saved && saved.done);
  }

  /* name filter: blocks slurs and obvious abuse, including l33t spellings, spacing and repeated letters */
  const BAD_ANY = [
    'nigger',
    'nigga',
    'nigr',
    'nigg',
    'niglet',
    'faggot',
    'fagot',
    'fagit',
    'retard',
    'tranny',
    'trany',
    'wetback',
    'raghead',
    'towelhead',
    'beaner',
    'cunt',
    'whore',
    'slut',
    'rapist',
    'nazi',
    'hitler',
    'kkk',
    'jizz',
    'fuck',
    'fuk',
    'fck',
    'phuck',
    'motherf',
    'shit',
    'bitch',
    'bastard',
    'wank',
    'twat',
    'porn',
    'molest',
    'paedo',
    'penis',
    'vagina',
    'pussy',
    'dildo',
    'dickhead',
    'bigdick',
    'cocksuck',
    'blowjob',
    'handjob',
    'suckmy',
    'gaychamber',
    'gasthe',
    'killall',
    'killyourself',
    'jigaboo',
    'porchmonkey',
    'junglebunny',
    'sandnig',
    'shemale',
    'golliwog',
    'gyppo',
    'pikey',
    'lesbo',
    'heilhit',
    'siegheil',
    '1488',
    'whitepower',
  ];
  const BAD_WORD = [
    'fag',
    'fags',
    'ass',
    'arse',
    'sex',
    'nig',
    'niger',
    'negro',
    'jew',
    'jews',
    'kys',
    'cum',
    'tit',
    'tits',
    'hoe',
    'ho',
    'sperm',
    'semen',
    'fap',
    'nob',
    'knob',
    'prick',
    'piss',
    'slag',
    'skank',
    'thot',
    'incel',
    'isis',
    'jihad',
    'spic',
    'mong',
    'coon',
    'homo',
    'tard',
    'anal',
    'anus',
    'cock',
    'dick',
    'rape',
    'raped',
    'wog',
    'boob',
    'boobs',
    'sieg',
    'heil',
    'queer',
    'paki',
    'gook',
    'kike',
    'chink',
    'dyke',
    'spaz',
    'pedo',
    'gypo',
    'gay',
  ];
  const LEET = {
    0: 'o',
    1: 'i',
    '!': 'i',
    '|': 'i',
    3: 'e',
    4: 'a',
    '@': 'a',
    5: 's',
    $: 's',
    7: 't',
    '+': 't',
    8: 'b',
    9: 'g',
    6: 'g',
    2: 'z',
    '(': 'c',
    '<': 'c',
    '€': 'e',
    '£': 'l',
  };
  function nameProblem(raw) {
    const n = (raw || '').trim().replace(/\s+/g, ' ');
    if (n.length < 2) return 'Please use at least 2 characters.';
    if (n.length > 16) return 'Please keep it to 16 characters.';
    if (!/^[A-Za-z0-9 _.\-]+$/.test(n)) return 'Only letters, numbers, spaces, _ - and . please.';
    const low = n.toLowerCase(),
      map = [...low].map(c => LEET[c] || c).join('');
    const squash = t => t.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
    const flat = squash(map),
      flat2 = map.replace(/[^a-z]/g, '');
    if (
      /1488/.test(low) ||
      BAD_ANY.some(w => {
        const c = w.replace(/(.)\1+/g, '$1');
        return (c.length >= 3 && flat.includes(c)) || flat2.includes(w);
      })
    )
      return "That name isn't allowed. Please pick another.";
    const parts = map.split(/[^a-z]+/).filter(Boolean),
      words = [...parts, ...parts.map(w => w.replace(/(.)\1+/g, '$1'))];
    if (words.some(w => BAD_WORD.includes(w)) || BAD_WORD.includes(flat) || BAD_WORD.includes(flat2))
      return "That name isn't allowed. Please pick another.";
    return null;
  }
  if (DEBUG) window.__nameProblem = nameProblem;
  $('nameIn').value = store.get('lis_name') || '';
  $('nameIn').addEventListener('input', () => {
    const p = $('nameIn').value.trim() ? nameProblem($('nameIn').value) : null;
    $('nameMsg').textContent = p || '2–16 letters, numbers, spaces, _ - or .';
    $('nameMsg').classList.toggle('bad', !!p);
  });
  $('nameIn').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('nameBtn').click();
  });

  /* Leaderboard: one document per player (ranked/<their id>), holding their latest day's score */
  let DB = null,
    UID = null;
  const dbReady = (async () => {
    try {
      if (!window.claude || !window.claude.use) return;
      DB = await window.claude.use('db');
      const u = await window.claude.use('user');
      UID = u ? await u.id() : null;
    } catch (e) {
      DB = null;
    }
  })();
  async function fetchBoard(day) {
    await dbReady;
    if (!DB) return null;
    const q = DB.collection('ranked').where('day', '==', day).orderBy('score', 'desc').limit(100);
    const snap = await Promise.race([
      q.get(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(
        r =>
          typeof r.score === 'number' &&
          r.score >= 0 &&
          r.score <= 25000 &&
          typeof r.name === 'string' &&
          !nameProblem(r.name)
      );
  }
  async function renderBoard(el, day) {
    el.hidden = false;
    el.innerHTML = `<h4>Today's leaderboard · ${dayLabel(day)}</h4><div class="empty">Loading…</div>`;
    let rows;
    try {
      rows = await fetchBoard(day);
    } catch (e) {
      rows = undefined;
    }
    const head = `<h4>Today's leaderboard · ${dayLabel(day)}</h4>`;
    if (rows === null) {
      el.innerHTML =
        head + '<div class="empty">The global leaderboard isn\'t available on this copy of the game.</div>';
      return;
    }
    if (rows === undefined) {
      el.innerHTML =
        head + '<div class="empty">The leaderboard can\'t be reached right now. Try again in a moment.</div>';
      return;
    }
    if (!rows.length) {
      el.innerHTML = head + '<div class="empty">No scores yet today. Be the first!</div>';
      return;
    }
    el.innerHTML =
      head +
      '<ol>' +
      rows
        .map(
          (r, i) =>
            `<li class="${r.id === UID ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="sc">${fmt(r.score)}</span></li>`
        )
        .join('') +
      '</ol>';
  }
  function showStartBoard(force) {
    const el = $('startBoard');
    if (!el.hidden && !force) {
      el.hidden = true;
      return;
    }
    renderBoard(el, rankedDay());
  }
  function rankedFinish() {
    saveRanked({ done: true });
    $('endSub').innerHTML =
      `Daily ranked <b style="color:var(--accent2)">${dayLabel(game.day)}</b> · new set in ${untilReset()}`;
    const saved = loadRanked();
    $('nameBox').hidden = !!saved.sent;
    $('nameMsg').classList.remove('bad');
    $('nameMsg').textContent = '2–16 letters, numbers, spaces, _ - or .';
    dbReady.then(() => {
      if (!DB) {
        $('nameBox').hidden = true;
        $('endBoard').hidden = true;
      } else renderBoard($('endBoard'), game.day);
    });
  }
  $('nameBtn').onclick = async () => {
    const n = $('nameIn').value.trim().replace(/\s+/g, ' '),
      p = nameProblem(n);
    if (p) {
      $('nameMsg').textContent = p;
      $('nameMsg').classList.add('bad');
      return;
    }
    await dbReady;
    if (!DB || !UID) {
      $('nameMsg').textContent = "The global leaderboard isn't available on this copy of the game.";
      $('nameMsg').classList.add('bad');
      return;
    }
    const saved = loadRanked();
    if (!saved || !saved.done) {
      return;
    }
    $('nameBtn').disabled = true;
    $('nameMsg').classList.remove('bad');
    $('nameMsg').textContent = 'Posting…';
    try {
      await DB.collection('ranked')
        .doc(UID)
        .set({
          name: n,
          score: saved.score,
          day: saved.day,
          at: Date.now(),
          rounds: (saved.res || []).map(r => ({ id: r.id, pts: r.pts })),
        });
      store.set('lis_name', n);
      store.set('lis_ranked3', JSON.stringify({ ...saved, sent: true }));
      $('nameBox').hidden = true;
      toast('Your score is on the leaderboard!');
      renderBoard($('endBoard'), saved.day);
    } catch (e) {
      $('nameMsg').classList.add('bad');
      $('nameMsg').textContent =
        e && e.code === 'invalid_argument'
          ? "You don't have permission to post scores on this copy of the game."
          : "Couldn't post your score. Please try again.";
    } finally {
      $('nameBtn').disabled = false;
    }
  };
  $('rankedBtn').onclick = startRanked;
  // without a leaderboard backend (e.g. a static GitHub Pages copy) ranked still works, just without the global board
  dbReady.then(() => {
    if (!DB) {
      $('boardBtn').hidden = true;
      document.querySelector('#rankedCard .tag').hidden = true;
    }
  });
  $('boardBtn').onclick = () => showStartBoard();

  /* ---------- settings (top right): same app themes as the Minimap Maker ---------- */
  const PREFS = (() => {
    try {
      const j = JSON.parse(localStorage.getItem('lisPrefs') || 'null');
      return j && typeof j === 'object' ? j : {};
    } catch (e) {
      return {};
    }
  })();
  const savePrefs = () => {
    try {
      localStorage.setItem('lisPrefs', JSON.stringify(PREFS));
    } catch (e) {}
  };
  const APP_THEMES = {
    dark: {
      name: 'Dark',
      dot: '#23262c',
      v: {
        bg: '#121317',
        panel: '#1b1d22',
        panel2: '#23262c',
        line: '#343842',
        text: '#e8e9ec',
        mute: '#9a9fab',
        accent: '#d9a441',
        accent2: '#f0c46a',
        field: '#101115',
        deep: '#0b0c0f',
        rowline: '#3b404b',
        onacc: '#17130a',
        hl: '#2a2a24',
        sum: '#17191d',
        hover: '#5d6472',
        glow: '#1d2028',
      },
    },
    light: {
      name: 'Light',
      dot: '#f2f3f5',
      light: true,
      v: {
        bg: '#eef0f3',
        panel: '#ffffff',
        panel2: '#f5f6f8',
        line: '#d5d9e0',
        text: '#1f2329',
        mute: '#626a76',
        accent: '#b57c14',
        accent2: '#9a6608',
        field: '#ffffff',
        deep: '#ffffff',
        rowline: '#cfd4dc',
        onacc: '#ffffff',
        hl: '#fbf1dc',
        sum: '#f7f8fa',
        hover: '#a9b0bb',
        glow: '#ffffff',
      },
    },
    pink: {
      name: 'Pink',
      dot: '#e0559a',
      light: true,
      v: {
        bg: '#fde9f1',
        panel: '#fff5f9',
        panel2: '#ffeaf2',
        line: '#f4c4d7',
        text: '#4b1b33',
        mute: '#9a5577',
        accent: '#e0559a',
        accent2: '#c03c7e',
        field: '#ffffff',
        deep: '#fff7fb',
        rowline: '#f0b7cd',
        onacc: '#ffffff',
        hl: '#ffd9e8',
        sum: '#fff0f6',
        hover: '#e98bb5',
        glow: '#ffd3e5',
      },
    },
    savage: {
      name: 'Savage',
      dot: '#7a5426',
      v: {
        bg: '#16130f',
        panel: '#211c16',
        panel2: '#2a241c',
        line: '#3a3127',
        text: '#ece4d6',
        mute: '#a69a86',
        accent: '#d9a441',
        accent2: '#f0c46a',
        field: '#15110c',
        deep: '#0d0a07',
        rowline: '#4a3e30',
        onacc: '#1b1408',
        hl: '#2c2318',
        sum: '#1a1611',
        hover: '#8a7656',
        glow: '#2b2217',
      },
    },
    crimson: {
      name: 'Crimson',
      dot: '#c0392b',
      v: {
        bg: '#1a0f10',
        panel: '#241517',
        panel2: '#2e1b1e',
        line: '#4a2a2e',
        text: '#f2e6e6',
        mute: '#b39497',
        accent: '#d6453a',
        accent2: '#f07a6c',
        field: '#180d0e',
        deep: '#110909',
        rowline: '#55303a',
        onacc: '#1c0705',
        hl: '#3a1d20',
        sum: '#1f1214',
        hover: '#8a4a50',
        glow: '#3a1517',
      },
    },
    ocean: {
      name: 'Ocean',
      dot: '#3fa7d6',
      v: {
        bg: '#0d1824',
        panel: '#132234',
        panel2: '#1a2c41',
        line: '#29415c',
        text: '#e3eef8',
        mute: '#8fa8c0',
        accent: '#3fa7d6',
        accent2: '#7fd0f5',
        field: '#0e1b29',
        deep: '#09131d',
        rowline: '#2f4b69',
        onacc: '#06121c',
        hl: '#183552',
        sum: '#112032',
        hover: '#4d7396',
        glow: '#173250',
      },
    },
    forest: {
      name: 'Forest',
      dot: '#6fa83c',
      v: {
        bg: '#0f1710',
        panel: '#162217',
        panel2: '#1d2c1e',
        line: '#2f4430',
        text: '#e5efe2',
        mute: '#94aa90',
        accent: '#7fb547',
        accent2: '#b2dc7a',
        field: '#0f1810',
        deep: '#0a100a',
        rowline: '#38523a',
        onacc: '#0d1606',
        hl: '#22381f',
        sum: '#142015',
        hover: '#5b7d58',
        glow: '#1d331c',
      },
    },
    purple: {
      name: 'Midnight purple',
      dot: '#a47cf0',
      v: {
        bg: '#14101f',
        panel: '#1d1730',
        panel2: '#251e3c',
        line: '#3a3058',
        text: '#ece7f8',
        mute: '#a59cc0',
        accent: '#a47cf0',
        accent2: '#cbb2ff',
        field: '#130f1f',
        deep: '#0d0a16',
        rowline: '#463a6b',
        onacc: '#140c26',
        hl: '#2e2450',
        sum: '#1a1530',
        hover: '#6f61a0',
        glow: '#2a2048',
      },
    },
  };
  function applyAppTheme(id) {
    if (!Object.prototype.hasOwnProperty.call(APP_THEMES, id)) id = 'dark';
    const t = APP_THEMES[id],
      r = document.documentElement.style;
    for (const [k, v] of Object.entries(t.v)) r.setProperty('--' + k, v);
    r.colorScheme = t.light ? 'light' : 'dark';
    document.documentElement.classList.toggle('lighttheme', !!t.light);
    document.body.style.background = `radial-gradient(1200px 600px at 20% -10%,${t.v.glow} 0%,transparent 60%),${t.v.bg}`;
    if (PREFS.theme !== id) {
      PREFS.theme = id;
      savePrefs();
    }
    document.querySelectorAll('.apptheme').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  }
  for (const [id, t] of Object.entries(APP_THEMES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'apptheme';
    b.dataset.id = id;
    b.innerHTML = `<i style="background:${t.dot}"></i>${t.name}`;
    b.onclick = e => {
      e.stopPropagation();
      applyAppTheme(id);
    };
    $('appThemes').append(b);
  }
  $('setBtn').onclick = e => {
    e.stopPropagation();
    $('projPop').classList.remove('open');
    $('setPop').classList.toggle('open');
  };
  $('projBtn').onclick = e => {
    e.stopPropagation();
    $('setPop').classList.remove('open');
    $('projPop').classList.toggle('open');
  };
  $('projPop').addEventListener('click', e => e.stopPropagation());
  $('setPop').addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => {
    $('setPop').classList.remove('open');
    $('projPop').classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('setPop').classList.remove('open');
      $('projPop').classList.remove('open');
    }
  });
  const CUR_SRC = new Image();
  CUR_SRC.src =
    'data:image/png;base64,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';
  function applyCursorSize(px) {
    px = Math.max(14, Math.min(40, +px || 22));
    $('curSz').value = px;
    $('curSzV').textContent = px + 'px';
    const go = () => {
      const k = px / Math.max(CUR_SRC.naturalWidth, CUR_SRC.naturalHeight),
        c = document.createElement('canvas');
      c.width = Math.round(CUR_SRC.naturalWidth * k);
      c.height = Math.round(CUR_SRC.naturalHeight * k);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(CUR_SRC, 0, 0, c.width, c.height);
      document.documentElement.style.setProperty('--savcur', `url(${c.toDataURL()}) 1 0,auto`);
    };
    CUR_SRC.complete && CUR_SRC.naturalWidth ? go() : CUR_SRC.addEventListener('load', go, { once: true });
    if (PREFS.cursz !== px) {
      PREFS.cursz = px;
      savePrefs();
    }
  }
  $('curSz').oninput = e => applyCursorSize(e.target.value);
  function applyCursor(on) {
    on = !!on;
    document.documentElement.classList.toggle('savcur', on);
    $('savCurChk').checked = on;
    $('curSzRow').style.opacity = on ? 1 : 0.45;
    $('curSz').disabled = !on;
    if (PREFS.savcur !== on) {
      PREFS.savcur = on;
      savePrefs();
    }
  }
  $('savCurChk').onchange = e => applyCursor(e.target.checked);
  function applyCompass(on) {
    on = on !== false;
    $('compass').style.display = on ? '' : 'none';
    $('compassChk').checked = on;
    if (PREFS.compass !== on) {
      PREFS.compass = on;
      savePrefs();
    }
  }
  $('compassChk').onchange = e => applyCompass(e.target.checked);
  function applyGrass(on) {
    on = on !== false;
    $('grassChk').checked = on;
    window.__showGrass = on;
    if (R) {
      R.showGrass = on;
      need = true;
    }
    if (PREFS.grass !== on) {
      PREFS.grass = on;
      savePrefs();
    }
  }
  $('grassChk').onchange = e => applyGrass(e.target.checked);
  $('resetBest').onclick = () => {
    $('setPop').classList.remove('open');
    $('resetModal').hidden = false;
  };
  $('resetNo').onclick = () => ($('resetModal').hidden = true);
  $('resetModal').addEventListener('click', e => {
    if (e.target === $('resetModal')) $('resetModal').hidden = true;
  });
  $('resetYes').onclick = () => {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('lis_best_'))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
    $('resetModal').hidden = true;
    showBest();
    toast('Best scores cleared.');
  };
  applyAppTheme(PREFS.theme || 'dark');
  applyCursorSize(PREFS.cursz || 22);
  applyCursor(PREFS.savcur);
  applyCompass(PREFS.compass);
  applyGrass(PREFS.grass);
  /* ---------- boot ---------- */
  (async () => {
    seg('segPool', 'pool');
    seg('segRounds', 'rounds');
    chips();
    try {
      R = new SavageRenderer(cv);
    } catch (e) {
      setLoading(true, 'Your browser needs WebGL 2 to show the 3D view.');
      $('playBtn').disabled = true;
      return;
    }
    if (DEBUG) window.__R = R;
    R.showGrass = window.__showGrass !== false;
    resize();
    requestAnimationFrame(frame);
    try {
      INDEX = await (await fetch('data/index.json')).json();
    } catch (e) {
      setLoading(true, 'Could not load the map list.');
      return;
    }
    $('allCount').textContent = `all ${INDEX.length}`;
    $('cntE').textContent = `${INDEX.filter(POOLS.e.f).length} maps`;
    $('cntM').textContent = `${INDEX.filter(POOLS.m.f).length} maps`;
    $('cntH').textContent = `${INDEX.filter(POOLS.h.f).length} maps`;
    const TIPS = {
      e: 'The most played maps on the Savage DRX servers, played more than 200 times. The ones most players will know.',
      m: 'Well known maps, played 110 to 199 times.',
      h: 'Rarer maps, played 50 to 109 times.',
      a: 'Every map in the game, from the classics to the rarest.',
    };
    for (const b of $('segPool').children) {
      const n = INDEX.filter(POOLS[b.dataset.v].f).length;
      b.dataset.tip = `${POOLS[b.dataset.v].label} · ${n} maps\n${TIPS[b.dataset.v]}`;
    }
    updateRankedCard();
    setInterval(updateRankedCard, 60000);
    {
      const sv = loadRanked();
      if (sv && !sv.done && store.get('lis_inranked') === '1') startRanked();
    } // refreshing mid-ranked puts you back where you were
    const spinView = () => {
      if (!game && !drag && R.map && $('intro').hidden) {
        R.yaw += 0.0016;
        need = true;
      }
      requestAnimationFrame(spinView);
    };
    spinView();
  })();
  if (DEBUG) window.__game = () => game;
})();
