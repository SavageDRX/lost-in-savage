(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('en-GB');
  // escape text before it goes into innerHTML
  const esc = t =>
    String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // maps left out of Very easy (they stay in the other pools)
  const VE_SKIP = new Set([
    'alpinevalley',
    'tropical',
    'sacrificeledge',
    'moss',
    'eden',
    'gaome',
    'xr_snap',
    'eden_winter',
    'tuskanflats',
    'glacierpoint',
    'glacierpeak',
    'borderwar',
    'ehe_fixed',
    'xr_pvp',
    'xr_darkwater',
  ]);
  const POOLS = {
    v: { label: 'Very easy', f: m => !VE_SKIP.has(m.id) && (/s2games/i.test(m.author) || m.plays > 500) },
    e: { label: 'Easy', f: m => m.plays > 200 },
    m: { label: 'Medium', f: m => m.plays >= 110 && m.plays <= 200 },
    h: { label: 'Hard', f: m => m.plays >= 70 && m.plays < 110 },
    a: { label: 'Every map', f: m => true },
  };
  // clock: m:ss (h:mm:ss past an hour)
  const fmtTime = ms => {
    const s = Math.max(0, Math.round((ms || 0) / 1000)),
      h = Math.floor(s / 3600),
      m = Math.floor((s % 3600) / 60),
      x = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
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
      pool: 'e', // every visit starts on Easy
      rounds: 5, // every visit starts on 5 rounds, the leaderboard length (other lengths are in Settings)
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
        const b = bcache[e.b] || (bcache[e.b] = getJSON('data/' + e.b + '.json?v=' + DATA_V));
        return b.then(x => {
          if (!x[id]) throw new Error('Could not load ' + id);
          return x[id];
        });
      }
      return getJSON('data/' + id + '.json?v=' + DATA_V);
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
    for (const p of ['pStart', 'pLobby', 'pPick', 'pPin', 'pResult', 'pEnd']) $(p).hidden = p !== name;
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
      upd();
    };
    upd();
  }
  function showBest() {
    const b = store.get(`lis_best_${opts.pool}${opts.rounds}`);
    $('bestTxt').innerHTML = b
      ? `Your best (${POOLS[opts.pool].label}, ${opts.rounds} rounds): <b>${fmt(+b)}</b> / ${fmt(opts.rounds * 5000)}`
      : '';
    const custom = opts.rounds !== LB_ROUNDS;
    $('roundsNote').hidden = !custom;
    if (custom)
      $('roundsNote').innerHTML =
        `Playing <b>${opts.rounds} rounds</b>, so these games won't count for the leaderboard. <button class="link" id="roundsBack" type="button">Back to 5</button>`;
  }
  function thumbStyle(m, size) {
    const c = 15,
      s = size / 96;
    return `background-size:${1440 * s}px auto;background-position:-${(m.t % c) * 96 * s}px -${Math.floor(m.t / c) * 96 * s}px`;
  }
  // bump when map data changes so browsers don't keep an old copy of the map list
  const DATA_V = '1.4';
  function chips() {
    $('chipRound').innerHTML = game
      ? `Round <b>${Math.min(game.i + 1, game.maps.length)}</b> / ${game.maps.length}`
      : 'Round <b>–</b>';
    $('chipScore').innerHTML = `Score <b>${fmt(game ? game.score : 0)}</b>`;
    $('chipDiff').hidden = !game;
    $('chipTime').hidden = !game;
    $('chipLob').hidden = !(game && game.lobby && !game.over);
    if (game) $('chipDiff').innerHTML = `<b>${modeLabel()}</b>`;
    tick();
  }
  const modeLabel = () => (game.lobby ? `Lobby · ${POOLS[game.pool].label}` : POOLS[game.pool].label);
  // time spent guessing: finished rounds plus the round in progress (the clock stops on the results screen)
  const usedMs = () =>
    game ? game.res.reduce((a, r) => a + (r.ms || 0), 0) + (game.t0 ? Date.now() - game.t0 : 0) : 0;
  function tick() {
    if (game) $('chipTime').innerHTML = `Time <b>${fmtTime(usedMs())}</b>`;
  }
  setInterval(tick, 250);

  /* ---------- game ---------- */
  function codeFor(pool, rounds, seed) {
    return `${pool.toUpperCase()}${rounds}-${seed}`;
  }
  function parseCode(c) {
    const m = /^([VEMHA])(3|5|10|15|20)-(\d{1,9})$/.exec(c.trim().toUpperCase());
    return m ? { pool: m[1].toLowerCase(), rounds: +m[2], seed: +m[3] } : null;
  }
  function makeGame(pool, rounds, seed) {
    const list = INDEX.filter(POOLS[pool].f);
    const rnd = mulberry(seed);
    const order = list
      .map(m => [rnd(), m])
      .sort((a, b) => a[0] - b[0])
      .map(x => x[1]);
    return {
      pool,
      rounds,
      seed,
      maps: order.slice(0, rounds),
      spots: Array.from({ length: rounds }, () => Math.floor(rnd() * 1e9) + 1),
      i: -1,
      score: 0,
      res: [],
      list,
      t0: 0,
    };
  }
  // fresh: a new game from Play (seed never shown); postable: a fresh 5-round game, which can go on the leaderboard
  function start(pool, rounds, seed, fresh) {
    game = makeGame(pool, rounds, seed);
    game.fresh = !!fresh;
    game.postable = !!fresh && rounds === LB_ROUNDS;
    $('search').value = '';
    $('intro').hidden = true;
    $('menuBtn').hidden = false;
    nextRound();
  }
  async function nextRound() {
    game.i++;
    game.cur = null;
    game.t0 = 0;
    if (game.i >= game.maps.length) return finish();
    chips();
    panel('pPick');
    renderGrid();
    const g = game,
      m = game.maps[game.i];
    try {
      const spot = await show(m.id, game.spots[game.i]);
      if (!spot || g !== game) return;
      game.cur = { m, spot, pick: null, pin: null };
    } catch (err) {
      setLoading(true, 'Could not load this map. Check your connection and try again.');
      return;
    }
    // the clock starts once you can see the spot
    game.t0 = Date.now();
    tick();
    $('statusL').innerHTML =
      `Round <b>${game.i + 1}</b> of ${game.maps.length} · ${game.lobby ? 'Lobby · ' : ''}${POOLS[game.pool].label}`;
    $('statusR').innerHTML = game.lobby
      ? `Lobby code <b>${esc(lob ? lob.code : '')}</b>`
      : game.fresh
        ? game.postable
          ? 'Leaderboard game'
          : `${game.rounds} rounds · not on the leaderboard`
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
  const ptsFor = (dist, m) => (dist < 3.2 ? 5000 : Math.round(5000 * Math.exp(-(dist - 3.2) / (m.W * 0.4))));
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
      pts = ptsFor(dist, m);
    }
    const ms = game.t0 ? Date.now() - game.t0 : 0;
    game.t0 = 0;
    game.cur = null;
    const r = { m, pick: c.pick, pts, dist, ok, ms, pin: c.pin, spot: c.spot };
    game.score += pts;
    game.res.push(r);
    chips();
    renderResult(r);
    if (game.lobby) lobbySubmit(r, game.i + 1);
  }
  function renderResult(r) {
    const { m, pts, dist, ok } = r,
      c = { pick: r.pick, pin: r.pin, spot: r.spot };
    const tu = c.spot.x / (m.W * 100),
      tv = 1 - c.spot.y / (m.H * 100);
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
    $('resDetail').innerHTML += ` Took <b>${fmtTime(r.ms)}</b>.`;
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
    game.resSvg = svg;
    $('resSvg').innerHTML = svg;
    $('nextBtn').disabled = false;
    $('nextBtn').textContent = game.i + 1 >= game.maps.length ? 'See final score' : 'Next round';
    $('lobRound').hidden = !game.lobby;
    panel('pResult');
    if (game.lobby) lobbyUI();
  }
  $('nextBtn').onclick = () => (game && game.lobby ? lobbyNext() : nextRound());
  const RANKS = [
    [0, 'Lost Nomad'],
    [0.15, 'Scavenger'],
    [0.32, 'Savage'],
    [0.5, 'Legionnaire'],
    [0.68, 'Predator'],
    [0.84, 'Behemoth'],
  ];
  function finish() {
    game.over = true;
    game.t0 = 0;
    const max = game.maps.length * 5000,
      f = game.score / max;
    const rank = RANKS.filter(r => f >= r[0]).pop()[1];
    $('rank').textContent = rank;
    $('total').innerHTML = `${fmt(game.score)} <small>/ ${fmt(max)}</small>`;
    $('endTime').innerHTML = `Time <b>${fmtTime(usedMs())}</b>`;
    $('emojiRow').textContent = emojiRow();
    $('lobEnd').hidden = !game.lobby;
    $('lobEndMsg').hidden = !game.lobby;
    // only code games show their code: a normal game's seed stays hidden so nobody can replay it
    const showCode = !game.lobby && !game.fresh;
    $('shareBtn').textContent = showCode ? 'Copy result & code' : 'Copy result';
    $('againBtn').textContent = 'Play again';
    postFinish();
    if (game.lobby) {
      $('endSub').innerHTML =
        `Lobby <b style="color:var(--accent2)">${esc(lob ? lob.code : '')}</b> · ${POOLS[game.pool].label}`;
    } else {
      const key = `lis_best_${game.pool}${game.rounds}`,
        prev = +(store.get(key) || 0);
      if (game.score > prev) store.set(key, game.score);
      $('endSub').innerHTML =
        `${POOLS[game.pool].label}${showCode ? ` · code <b style="color:var(--accent2)">${codeFor(game.pool, game.rounds, game.seed)}</b>` : ''}${game.score > prev && prev ? ' · new best!' : ''}`;
    }
    $('sumTable').innerHTML = game.res
      .map(
        (r, i) =>
          `<tr><td class="th"><div style="${thumbStyle(r.m, 40)}"></div></td><td class="n">${i + 1}. ${esc(r.m.name)}<small>${r.missed ? 'out of time' : r.ok ? (r.dist == null ? 'spot on' : `${r.dist.toFixed(1)} tiles away`) : `you said ${r.pick ? esc(r.pick.name) : 'nothing'}`}${r.missed ? '' : ` · ${fmtTime(r.ms)}`}</small></td><td class="p">${fmt(r.pts)}</td></tr>`
      )
      .join('');
    panel('pEnd');
    chips();
    if (game.lobby) lobbyUI();
    $('statusL').textContent = 'Game over. Look around as long as you like.';
  }
  function mainMenu() {
    if (lob) leaveLobby();
    game = null;
    showSeq++;
    setLoading(false);
    chips();
    panel('pStart');
    showBest();
    $('intro').hidden = false;
    $('menuBtn').hidden = true;
    $('statusL').textContent = 'Every view is a real spot on a real Savage map, rebuilt from the map files.';
    $('statusR').textContent = '';
  }
  $('againBtn').onclick = () => (game && game.lobby && lob ? lobbyAgain() : mainMenu());
  $('menuBtn').onclick = mainMenu;
  $('logoBtn').onclick = mainMenu;
  $('introPlay').onclick = () => $('playBtn').click();
  // Wordle-style result: one square per round
  const SHARE_URL = 'https://savagedrx.github.io/lost-in-savage/';
  const emojiRow = () =>
    game.res.map(r => (!r.ok ? '🟥' : r.pts >= 4500 ? '🟩' : r.pts >= 2500 ? '🟨' : '🟧')).join('');
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  function shareText() {
    const head = game.lobby
      ? `Lost in Savage – Lobby · ${POOLS[game.pool].label}, ${game.maps.length} rounds`
      : `Lost in Savage – ${POOLS[game.pool].label}, ${game.maps.length} rounds`;
    let place = '';
    if (game.lobby && lob && lob.d) {
      const st = standings(lob.d.players),
        i = st.findIndex(p => p.id === lob.d.me);
      if (i >= 0 && st.length > 1) place = `\nFinished ${ordinal(i + 1)} of ${st.length}`;
    }
    return (
      `${head}\n${emojiRow()}  ${fmt(game.score)} / ${fmt(game.maps.length * 5000)} · ${fmtTime(usedMs())}` +
      place +
      (game.lobby || game.fresh ? '' : `\nGame code: ${codeFor(game.pool, game.rounds, game.seed)}`) +
      `\n${SHARE_URL}`
    );
  }
  $('shareBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareText());
      toast('Copied! Paste it into Discord or send it to a friend.');
    } catch (e) {
      toast(
        game.lobby || game.fresh ? "Couldn't copy. Try again." : 'Code: ' + codeFor(game.pool, game.rounds, game.seed)
      );
    }
  };
  function toast(t) {
    const el = $('toast');
    el.textContent = t;
    el.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('on'), 2600);
  }
  $('roundsNote').addEventListener('click', e => {
    if (e.target.id === 'roundsBack') $('segRounds').querySelector('[data-v="5"]').click();
  });
  $('playBtn').onclick = () => start(opts.pool, opts.rounds, Math.floor(Math.random() * 900000) + 100000, true);
  $('codeBtn').onclick = () => {
    const v = $('codeIn').value.trim().toUpperCase();
    // a 6-letter code is a lobby
    if (SB && /^[A-Z2-9]{6}$/.test(v)) return openLobby(v);
    const c = parseCode(v);
    if (!c) {
      toast("That code doesn't look right. It should look like P5-483920.");
      return;
    }
    start(c.pool, c.rounds, c.seed, false);
  };
  // make a new code to share (with the maps and rounds chosen above); code games can't go on the leaderboard
  $('newCodeBtn').onclick = async () => {
    const c = codeFor(opts.pool, opts.rounds, Math.floor(Math.random() * 900000) + 100000);
    $('codeIn').value = c;
    try {
      await navigator.clipboard.writeText(c);
      toast(`Code ${c} copied. Send it to your friends, then press Play code.`);
    } catch (e) {
      toast(`Your code is ${c}. Send it to your friends, then press Play code.`);
    }
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
  /* ---------- weekly leaderboards start every Monday at 00:00 GMT ---------- */
  const WEEK0 = Date.UTC(2026, 0, 5), // a Monday
    WEEKMS = 7 * 86400000;
  const weekNo = () => Math.floor((Date.now() - WEEK0) / WEEKMS);
  function untilWeekReset() {
    const ms = WEEK0 + (weekNo() + 1) * WEEKMS - Date.now();
    const d = Math.floor(ms / 86400000),
      h = Math.floor((ms % 86400000) / 3600000),
      m = Math.floor((ms % 3600000) / 60000);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
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

  /* ---------- Leaderboards: weekly and all time, one board per difficulty and round count ----------
     Two possible backends:
     1. Supabase (for a public copy such as GitHub Pages): fill in js/config.js. See README.
     2. The shared database of a Claude-hosted artifact, when the page runs there.
     With neither, the leaderboard UI hides itself. */
  const CFG = window.LIS_CONFIG || {};
  const SB =
    CFG.supabaseUrl && CFG.supabaseAnonKey
      ? {
          url: CFG.supabaseUrl
            .trim()
            .replace(/\/+$/, '')
            .replace(/\/rest\/v1$/i, ''),
          key: CFG.supabaseAnonKey,
        }
      : null;
  const newUuid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
          (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
        );
  // an anonymous, random id per browser so each player has one entry per board per day
  function playerId() {
    let id = store.get('lis_player');
    if (!/^[0-9a-f-]{36}$/.test(id || '')) {
      id = newUuid();
      store.set('lis_player', id);
    }
    return id;
  }
  const withTimeout = p =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
  // new-style keys (sb_publishable_...) go in the apikey header only; legacy anon keys (eyJ...) are JWTs and also go in Authorization
  const sbHeaders = extra =>
    SB.key.startsWith('eyJ')
      ? { apikey: SB.key, Authorization: `Bearer ${SB.key}`, ...extra }
      : { apikey: SB.key, ...extra };
  const better = (a, b) => !b || a.score > b.score || (a.score === b.score && a.time < b.time);
  const backends = {
    supabase: {
      // q = { diff, rounds, weekly }; returns the top 50 (each player's best) and where you stand
      async list(q) {
        const r = await withTimeout(
          fetch(`${SB.url}/rest/v1/rpc/leaderboard`, {
            method: 'POST',
            headers: sbHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ p_diff: q.diff, p_rounds: q.rounds, p_weekly: q.weekly, p_player: playerId() }),
          })
        );
        if (!r.ok) throw new Error('http ' + r.status);
        const j = (await r.json()) || {};
        return { rows: j.rows || [], mine: j.mine || null, total: j.total || 0 };
      },
      async submit(e) {
        const r = await withTimeout(
          fetch(`${SB.url}/rest/v1/scores`, {
            method: 'POST',
            headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
            body: JSON.stringify({
              player: playerId(),
              name: e.name,
              diff: e.diff,
              rounds: e.rounds,
              score: e.score,
              time_ms: e.time,
              seed: e.seed,
            }),
          })
        );
        // 409 = this game has already been posted
        if (r.status === 409) throw Object.assign(new Error('dup'), { code: 'duplicate' });
        if (!r.ok) throw new Error('http ' + r.status);
      },
    },
    // Claude artifact database: one document per player with their best on each board, all time and this week
    claude: {
      db: null,
      uid: null,
      async list(q) {
        const key = q.diff + q.rounds,
          wk = weekNo();
        const snap = await withTimeout(this.db.collection('ranked').limit(1000).get());
        const rows = snap.docs
          .map(d => {
            const x = d.data() || {},
              b = q.weekly ? x.week === wk && x.wbest && x.wbest[key] : x.best && x.best[key];
            return b ? { id: d.id, name: x.name, score: b.score, time: b.time, at: b.at || 0 } : null;
          })
          .filter(Boolean)
          .sort((a, b) => byScoreTime(a, b) || a.at - b.at)
          .map((r, i) => ({ ...r, pos: i + 1, me: r.id === this.uid }));
        return { rows: rows.slice(0, TOPN), mine: rows.find(r => r.me) || null, total: rows.length };
      },
      async submit(e) {
        if (!this.uid) throw Object.assign(new Error('no user'), { code: 'invalid_argument' });
        const ref = this.db.collection('ranked').doc(this.uid);
        const prev = await ref.get();
        const d = (prev.exists && prev.data()) || {};
        const key = e.diff + e.rounds,
          wk = weekNo(),
          tag = key + ':' + e.seed;
        const seeds = Array.isArray(d.seeds) ? d.seeds : [];
        if (seeds.includes(tag)) throw Object.assign(new Error('dup'), { code: 'duplicate' });
        const ent = { score: e.score, time: e.time, at: Date.now() };
        const best = { ...(d.best || {}) },
          wbest = d.week === wk ? { ...(d.wbest || {}) } : {};
        if (better(ent, best[key])) best[key] = ent;
        if (better(ent, wbest[key])) wbest[key] = ent;
        await ref.set({ name: e.name, at: Date.now(), best, week: wk, wbest, seeds: [...seeds, tag].slice(-300) });
      },
    },
  };
  let BOARD = null;
  const boardReady = (async () => {
    if (SB) return (BOARD = backends.supabase);
    try {
      if (!window.claude || !window.claude.use) return;
      const db = await window.claude.use('db');
      if (!db) return;
      const u = await window.claude.use('user');
      backends.claude.db = db;
      backends.claude.uid = u ? await u.id() : null;
      BOARD = backends.claude;
    } catch (e) {
      BOARD = null;
    }
  })();
  const TOPN = 50; // players shown on each board
  const LB_ROUNDS = 5; // only 5-round games go on the leaderboards
  // best score first; equal scores go to whoever was quicker
  const byScoreTime = (a, b) =>
    b.score - a.score || (a.time == null ? 1e12 : a.time) - (b.time == null ? 1e12 : b.time);
  // shared data is untrusted: keep only well-formed rows with acceptable names
  const goodRow = (r, rounds) =>
    r &&
    typeof r.score === 'number' &&
    r.score >= 0 &&
    r.score <= rounds * 5000 &&
    typeof r.time === 'number' &&
    r.time >= 0 &&
    typeof r.name === 'string' &&
    !nameProblem(r.name);
  async function renderBoard(el, q) {
    el.hidden = false;
    const my = (el.seq = (el.seq || 0) + 1);
    const head = `<h4>${q.weekly ? 'This week' : 'All time'} · ${POOLS[q.diff].label}</h4>`;
    const foot = n =>
      `<div class="bfoot">${q.weekly ? `New week in ${untilWeekReset()} (Monday 00:00 GMT)` : 'Best game per player'}${n ? ` · ${fmt(n)} player${n === 1 ? '' : 's'}` : ''}</div>`;
    el.innerHTML = head + '<div class="empty">Loading…</div>';
    let res;
    try {
      await boardReady;
      res = BOARD ? await BOARD.list(q) : null;
    } catch (e) {
      res = undefined;
    }
    if (my !== el.seq) return;
    if (res === null) {
      el.innerHTML = head + '<div class="empty">The leaderboards aren\'t available on this copy of the game.</div>';
      return;
    }
    if (res === undefined) {
      el.innerHTML =
        head + '<div class="empty">The leaderboard can\'t be reached right now. Try again in a moment.</div>';
      return;
    }
    // only the top 50 are shown (trimmed here too, in case the server sends more)
    const all = res.rows.filter(r => goodRow(r, q.rounds)),
      rows = all.slice(0, TOPN);
    if (!rows.length) {
      el.innerHTML =
        head +
        `<div class="empty">No scores yet${q.weekly ? ' this week' : ''}. Finish a ${POOLS[q.diff].label} game to be the first!</div>` +
        foot(0);
      return;
    }
    const li = (r, pos) =>
      `<li class="${r.me ? 'me' : ''}"><span class="pos">${pos}</span><span class="nm">${esc(r.name)}</span><span class="tm">${fmtTime(r.time)}</span><span class="sc">${fmt(r.score)}</span></li>`;
    const mine = rows.some(r => r.me)
      ? null
      : res.mine && goodRow(res.mine, q.rounds)
        ? res.mine
        : all.find(r => r.me) || null;
    el.innerHTML =
      head +
      '<ol>' +
      rows.map((r, i) => li(r, i + 1)).join('') +
      (mine ? `<li class="gap">⋯</li>` + li({ ...mine, me: true }, mine.pos) : '') +
      '</ol>' +
      foot(res.total);
  }
  const segPick = (el, val) => {
    for (const b of el.children) b.classList.toggle('on', b.dataset.v === String(val));
  };
  const segClick = (id, fn) =>
    ($(id).onclick = e => {
      const b = e.target.closest('button');
      if (b) fn(b.dataset.v);
    });
  /* the leaderboard window, from the main menu */
  const bq = { diff: 'e', rounds: LB_ROUNDS, weekly: true };
  function openBoards() {
    bq.diff = game ? game.pool : opts.pool;
    $('boardModal').hidden = false;
    refreshBoards();
  }
  function refreshBoards() {
    segPick($('bmPeriod'), bq.weekly ? 'w' : 'a');
    segPick($('bmPool'), bq.diff);
    renderBoard($('bmBoard'), { ...bq });
  }
  segClick('bmPeriod', v => {
    bq.weekly = v === 'w';
    refreshBoards();
  });
  segClick('bmPool', v => {
    bq.diff = v;
    refreshBoards();
  });
  $('boardBtn').onclick = openBoards;
  $('boardNav').onclick = openBoards;
  $('boardClose').onclick = () => ($('boardModal').hidden = true);
  $('boardModal').addEventListener('click', e => {
    if (e.target === $('boardModal')) $('boardModal').hidden = true;
  });
  /* after a game: offer to post it, and show the board it would go on */
  let endWeekly = true;
  function postFinish() {
    $('postEnd').hidden = true;
    $('postNote').textContent = '';
    const g = game;
    boardReady.then(() => {
      if (game !== g || !BOARD) return;
      if (!g.postable) {
        $('postNote').textContent =
          g.rounds !== LB_ROUNDS
            ? 'Only 5-round games go on the leaderboard. You can change the number of rounds in Settings.'
            : "Games played from a game code can't go on the leaderboard.";
        return;
      }
      $('postEnd').hidden = false;
      $('nameBox').hidden = !!g.posted;
      $('nameMsg').classList.remove('bad');
      $('nameMsg').textContent = 'Your best game shows on the weekly and all-time boards.';
      if (!$('nameIn').value) $('nameIn').value = store.get('lis_name') || '';
      endWeekly = true;
      renderEndBoard();
    });
  }
  function renderEndBoard() {
    segPick($('endPeriod'), endWeekly ? 'w' : 'a');
    renderBoard($('endBoard'), { diff: game.pool, rounds: game.rounds, weekly: endWeekly });
  }
  segClick('endPeriod', v => {
    endWeekly = v === 'w';
    if (game) renderEndBoard();
  });
  $('nameBtn').onclick = async () => {
    const n = $('nameIn').value.trim().replace(/\s+/g, ' '),
      p = nameProblem(n);
    if (p) {
      $('nameMsg').textContent = p;
      $('nameMsg').classList.add('bad');
      return;
    }
    await boardReady;
    const g = game;
    if (!BOARD || !g || !g.over || !g.postable || g.posted) return;
    $('nameBtn').disabled = true;
    $('nameMsg').classList.remove('bad');
    $('nameMsg').textContent = 'Posting…';
    try {
      await BOARD.submit({
        name: n,
        diff: g.pool,
        rounds: g.rounds,
        score: g.score,
        time: Math.min(Math.round(usedMs()), 86400000),
        seed: g.seed,
      });
      g.posted = true;
      store.set('lis_name', n);
      if (game === g) {
        $('nameBox').hidden = true;
        renderEndBoard();
      }
      toast('Your score is on the leaderboard!');
    } catch (e) {
      $('nameMsg').classList.add('bad');
      $('nameMsg').textContent =
        e && e.code === 'duplicate'
          ? "You've already posted this game."
          : e && e.code === 'invalid_argument'
            ? "You don't have permission to post scores on this copy of the game."
            : "Couldn't post your score. Please try again.";
    } finally {
      $('nameBtn').disabled = false;
    }
  };
  $('nameIn').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('nameBtn').click();
  });
  // without a leaderboard backend (e.g. a plain static copy) the game still works, just without the boards
  boardReady.then(() => {
    if (!BOARD) {
      $('boardCard').hidden = true;
      $('boardNav').hidden = true;
    }
  });

  /* ---------- lobbies: play the same spots with friends, round by round (Supabase only) ----------
     The host's settings pick the maps; everyone gets the same seed. After each round you see who has
     guessed and where; the host moves everyone on. Talks to the lobby_* functions in tools/leaderboard.sql. */
  let lob = null; // { code, d: last state from the server, ... }
  const PCOLS = ['#6fb6ff', '#ff7ab8', '#9be15d', '#c49bff', '#ff9f43', '#4ee0c9', '#ff6b6b', '#e8e36a'];
  function secretToken() {
    let t = store.get('lis_secret');
    if (!/^[0-9a-f-]{36}$/.test(t || '')) {
      t = newUuid();
      store.set('lis_secret', t);
    }
    return t;
  }
  const safeName = n => (typeof n === 'string' && !nameProblem(n) ? n : 'Player');
  const inviteUrl = code => location.origin + location.pathname + '?lobby=' + code;
  const standings = players => [...players].sort(byScoreTime);
  async function rpc(fn, args) {
    const r = await withTimeout(
      fetch(`${SB.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: sbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(args),
      })
    );
    const txt = await r.text();
    let j = null;
    try {
      j = txt ? JSON.parse(txt) : null;
    } catch (e) {}
    if (!r.ok) {
      // messages raised by the lobby functions are written for players; anything else gets a generic message
      const friendly = j && j.code === 'P0001' && j.message;
      throw Object.assign(new Error(friendly || 'http ' + r.status), { friendly: !!friendly, status: r.status });
    }
    return j;
  }
  const errText = e =>
    e && e.friendly
      ? e.message
      : e && e.status === 404
        ? "Lobbies aren't set up on this copy of the game yet."
        : "Couldn't reach the lobby. Check your connection and try again.";
  // every request is numbered so a slow, older reply can't undo a newer one
  async function lobCall(fn, args) {
    const my = ++lob.sent,
      L = lob;
    const d = await rpc(fn, { p_code: L.code, p_token: secretToken(), ...args });
    if (lob === L && my > L.applied) {
      L.applied = my;
      onLobby(d);
    }
    return d;
  }
  function setUrl(code) {
    try {
      const u = new URL(location.href);
      if (code) u.searchParams.set('lobby', code);
      else u.searchParams.delete('lobby');
      history.replaceState(null, '', u);
    } catch (e) {}
  }
  function openLobby(code) {
    if (lob) leaveLobby();
    game = null;
    showSeq++;
    setLoading(false);
    lob = { code: code || null, d: null, sent: 0, applied: 0, fails: 0, busy: false, timer: 0 };
    $('intro').hidden = true;
    $('menuBtn').hidden = false;
    $('lobName').value = store.get('lis_name') || '';
    $('lobMsg2').textContent = '';
    $('lobMsg2').classList.remove('bad');
    chips();
    if (code) {
      setUrl(code);
      startPolling();
    }
    renderLobby();
  }
  function startPolling() {
    clearInterval(lob.timer);
    const L = lob;
    const poll = async () => {
      if (lob !== L || L.busy) return;
      L.busy = true;
      try {
        await lobCall('lobby_state', {});
        L.fails = 0;
      } catch (e) {
        if (++L.fails === 3) toast('Lost connection to the lobby. Retrying…');
      } finally {
        L.busy = false;
      }
    };
    L.timer = setInterval(poll, 1500);
    poll();
  }
  function leaveLobby() {
    if (!lob) return;
    const L = lob;
    lob = null;
    clearInterval(L.timer);
    if (L.code && L.d && L.d.me) rpc('lobby_leave', { p_code: L.code, p_token: secretToken() }).catch(() => {});
    setUrl(null);
    if (game && game.lobby) game.lobby = false;
  }
  function onLobby(d) {
    if (!lob) return;
    if (!d) {
      toast("That lobby doesn't exist any more.");
      mainMenu();
      return;
    }
    lob.d = d;
    const me = d.me ? d.players.find(p => p.id === d.me) : null;
    if (game && game.lobby) {
      if (d.state === 'wait') {
        // the host has set up a new game: back to the lobby
        game = null;
        showSeq++;
        setLoading(false);
        chips();
        renderLobby();
        return;
      }
      lobbySync(d);
    } else if (me && d.state !== 'wait' && d.seed) startLobbyGame(d, me);
    else renderLobby();
  }
  function renderLobby() {
    if (game) return;
    panel('pLobby');
    const d = lob.d,
      creating = !lob.code;
    const diff = d ? d.diff : opts.pool,
      rounds = d ? d.rounds : opts.rounds;
    $('lobCode').textContent = creating ? '' : lob.code;
    $('lobSub').textContent = `${POOLS[diff].label} · ${rounds} rounds`;
    $('lobInvite').hidden = creating;
    $('lobLink').value = creating ? '' : inviteUrl(lob.code);
    const isMember = !!(d && d.me),
      isHost = isMember && d.host === d.me;
    $('lobJoin').hidden = isMember || (!!d && d.state !== 'wait');
    $('lobJoinBtn').textContent = creating ? 'Create lobby' : 'Join lobby';
    $('lobPlayersBox').hidden = creating;
    if (d) {
      $('lobCount').textContent = `${d.players.length} / 12`;
      $('lobPlayers').innerHTML = d.players
        .map(
          (p, i) =>
            `<li class="${p.id === d.me ? 'me' : ''}${p.idle > 20 ? ' away' : ''}"><i class="dot" style="background:${PCOLS[i % PCOLS.length]}"></i><span class="nm">${esc(safeName(p.name))}</span>${p.id === d.host ? '<span class="badge">Host</span>' : ''}${p.id === d.me ? '<span class="badge you">You</span>' : ''}${p.idle > 20 ? '<span class="badge off">away</span>' : ''}</li>`
        )
        .join('');
    } else $('lobPlayers').innerHTML = creating ? '' : '<li class="empty">Connecting…</li>';
    $('lobOpts').hidden = !(isHost && d.state === 'wait');
    if (isHost) {
      for (const b of $('lobPool').children) b.classList.toggle('on', b.dataset.v === d.diff);
      for (const b of $('lobRounds').children) b.classList.toggle('on', +b.dataset.v === d.rounds);
    }
    $('lobStart').hidden = !(isHost && d.state === 'wait');
    $('lobMsg').textContent = creating
      ? 'Pick a name, create the lobby, then send your friends the invite link.'
      : !d
        ? ''
        : !isMember
          ? d.state === 'wait'
            ? 'Type a name and join to play.'
            : "A game is in progress. You'll be able to join when it finishes."
          : d.state === 'wait'
            ? isHost
              ? 'Send your friends the invite link, then start when everyone is here.'
              : 'Waiting for the host to start the game…'
            : '';
    $('statusL').textContent = creating ? 'Setting up a lobby.' : `Lobby ${lob.code}`;
    $('statusR').textContent = '';
  }
  $('lobJoinBtn').onclick = async () => {
    const n = $('lobName').value.trim().replace(/\s+/g, ' '),
      p = nameProblem(n);
    const msg = $('lobMsg2');
    if (p) {
      msg.textContent = p;
      msg.classList.add('bad');
      return;
    }
    msg.classList.remove('bad');
    msg.textContent = lob.code ? 'Joining…' : 'Creating…';
    $('lobJoinBtn').disabled = true;
    try {
      if (!lob.code) {
        const L = lob;
        const d = await rpc('lobby_create', {
          p_token: secretToken(),
          p_name: n,
          p_diff: opts.pool,
          p_rounds: opts.rounds,
        });
        if (lob !== L) return;
        lob.code = d.code;
        setUrl(d.code);
        lob.applied = ++lob.sent;
        onLobby(d);
        startPolling();
      } else await lobCall('lobby_join', { p_name: n });
      store.set('lis_name', n);
      msg.textContent = '';
    } catch (e) {
      msg.textContent = errText(e);
      msg.classList.add('bad');
    } finally {
      $('lobJoinBtn').disabled = false;
    }
  };
  $('lobName').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('lobJoinBtn').click();
  });
  const lobAct = async (fn, args) => {
    try {
      await lobCall(fn, args);
    } catch (e) {
      toast(errText(e));
    }
  };
  $('lobPool').onclick = e => {
    const b = e.target.closest('button');
    if (b && lob && lob.d) lobAct('lobby_reset', { p_diff: b.dataset.v, p_rounds: lob.d.rounds });
  };
  $('lobRounds').onclick = e => {
    const b = e.target.closest('button');
    if (b && lob && lob.d) lobAct('lobby_reset', { p_diff: lob.d.diff, p_rounds: +b.dataset.v });
  };
  $('lobStart').onclick = () => lobAct('lobby_start', {});
  $('lobLeave').onclick = mainMenu;
  $('lobCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('lobLink').value);
      toast('Invite link copied. Send it to your friends!');
    } catch (e) {
      $('lobLink').select();
      toast('Copy the link from the box.');
    }
  };
  $('hostBtn').onclick = () => openLobby(null);
  // dist from points (the server keeps points, not distance)
  const distFor = (pts, m) => (pts >= 5000 ? null : 3.2 - m.W * 0.4 * Math.log(Math.max(pts, 1) / 5000));
  // other players' pins: smaller, with the name to the side so it doesn't cover the "Here" label
  const PIN2 = (x, y, col, label) =>
    `<g transform="translate(${x} ${y}) scale(.72)"><path d="M0 0 C-14 -22 -22 -32 -22 -44 A22 22 0 1 1 22 -44 C22 -32 14 -22 0 0Z" fill="${col}" stroke="#0d0a07" stroke-width="5"/><circle cy="-44" r="8" fill="#0d0a07"/><text x="30" y="-36" font-family="Inter,sans-serif" font-weight="700" font-size="34" fill="#fff" stroke="#0d0a07" stroke-width="7" paint-order="stroke">${label}</text></g>`;
  const missedRound = m => ({ m, pick: null, pts: 0, dist: null, ok: false, ms: 0, missed: true });
  function startLobbyGame(d, me) {
    game = makeGame(d.diff, d.rounds, d.seed);
    game.lobby = true;
    game.fresh = true;
    game.postable = d.rounds === LB_ROUNDS;
    const byId = id => INDEX.find(m => m.id === id);
    // rebuild the rounds you've already played from the server (after a refresh)
    const upto = d.state === 'done' ? d.rounds : Math.min(d.round, d.rounds);
    for (let r = 1; r <= upto; r++) {
      const x = me.results.find(q => q.r === r),
        m = game.maps[r - 1];
      if (x)
        game.res.push({
          m,
          pick: byId(x.pick) || null,
          pts: x.pts,
          ok: !!x.ok,
          ms: x.ms,
          dist: x.ok ? distFor(x.pts, m) : null,
          pin: x.u == null ? null : { u: x.u, v: x.v },
        });
      else if (r < upto || d.state === 'done') game.res.push(missedRound(m));
    }
    game.score = game.res.reduce((a, r) => a + r.pts, 0);
    $('search').value = '';
    $('intro').hidden = true;
    $('menuBtn').hidden = false;
    if (d.state === 'done') {
      game.i = d.rounds;
      return finish();
    }
    if (game.res.length >= d.round) {
      // you'd already guessed this round: show its result again
      game.i = d.round - 1;
      resumeResult(game.res[game.i], game.spots[game.i]);
    } else {
      game.i = d.round - 2;
      nextRound();
    }
  }
  async function resumeResult(r, seed) {
    chips();
    const g = game;
    try {
      const spot = await show(r.m.id, seed);
      if (!spot || g !== game) return;
      r.spot = spot;
      if (r.ok && r.pin) {
        const tu = spot.x / (r.m.W * 100),
          tv = 1 - spot.y / (r.m.H * 100);
        r.dist = Math.hypot((r.pin.u - tu) * r.m.W, (r.pin.v - tv) * r.m.H);
      }
      if (!r.pick) r.pick = r.m;
      renderResult(r);
    } catch (e) {
      setLoading(true, 'Could not load this map. Check your connection and try again.');
    }
  }
  function lobbySubmit(r, round) {
    const L = lob;
    if (!L) return;
    L.submitting = true;
    const args = {
      p_round: round,
      p_pts: r.pts,
      p_ms: Math.min(Math.round(r.ms), 3600000),
      p_ok: r.ok,
      p_pick: r.pick.id,
      p_u: r.ok ? r.pin.u : null,
      p_v: r.ok ? r.pin.v : null,
    };
    const go = async tries => {
      try {
        await lobCall('lobby_submit', args);
      } catch (e) {
        if (!e.friendly && tries < 3 && lob === L) return go(tries + 1);
        toast(e.friendly ? e.message : "Couldn't send your guess to the lobby.");
      }
    };
    go(0).finally(() => {
      L.submitting = false;
    });
  }
  // keep up with the host: move on when they do, finish when the game ends
  function lobbySync(d) {
    if (lob.submitting) return lobbyUI();
    const cur = game.i + 1;
    if (game.over) return lobbyUI();
    const target = d.state === 'done' ? d.rounds + 1 : d.round;
    if (target > cur) {
      const missed = game.res.length < cur;
      while (game.res.length < Math.min(target - 1, d.rounds)) game.res.push(missedRound(game.maps[game.res.length]));
      if (missed) toast('The host moved on before you guessed. That round scores 0.');
      if (d.state === 'done') {
        game.i = d.rounds;
        finish();
      } else {
        game.i = target - 2;
        nextRound();
      }
      return;
    }
    lobbyUI();
  }
  function lobbyNext() {
    if (!lob || !lob.d) return;
    if (lob.d.host !== lob.d.me) return;
    lobAct('lobby_next', { p_from: lob.d.round });
  }
  function lobbyAgain() {
    const d = lob.d;
    if (d && d.host === d.me) lobAct('lobby_reset', { p_diff: d.diff, p_rounds: d.rounds });
    else mainMenu();
  }
  // standings, who has guessed, other players' pins, and the host's buttons
  function lobbyUI() {
    if (!lob || !lob.d || !game || !game.lobby) return;
    const d = lob.d,
      isHost = d.host === d.me,
      round = d.state === 'done' ? d.rounds : d.round;
    const colour = id =>
      PCOLS[
        Math.max(
          0,
          d.players.findIndex(p => p.id === id)
        ) % PCOLS.length
      ];
    const here = d.players.filter(p => p.idle <= 30 || p.round >= round);
    const guessed = here.filter(p => p.round >= round).length;
    $('chipLob').innerHTML = `Guessed <b>${guessed}</b> / ${here.length}`;
    const rows = (withRound, final) =>
      '<ol>' +
      standings(d.players)
        .map((p, i) => {
          const x = p.results.find(q => q.r === round);
          const now = final ? fmtTime(p.time) : x ? `+${fmt(x.pts)}` : p.idle > 30 ? 'away' : 'guessing…';
          return `<li class="${p.id === d.me ? 'me' : ''}"><span class="pos">${i + 1}</span><i class="dot" style="background:${colour(p.id)}"></i><span class="nm">${esc(safeName(p.name))}${p.id === d.host ? ' <small>host</small>' : ''}</span><span class="tm">${withRound ? now : ''}</span><span class="sc">${fmt(p.score)}</span></li>`;
        })
        .join('') +
      '</ol>';
    if (!$('pResult').hidden) {
      const last = round >= d.rounds;
      $('lobRound').innerHTML = `<h4>Lobby · round ${round} of ${d.rounds}</h4>` + rows(true, false);
      const waiting = here.length - guessed;
      const btn = $('nextBtn');
      if (isHost) {
        btn.disabled = false;
        btn.textContent =
          (last ? 'See final standings' : 'Next round') + (waiting > 0 ? ` (${waiting} still guessing)` : '');
      } else {
        btn.disabled = true;
        btn.textContent = waiting > 0 ? `Waiting for ${waiting} more…` : 'Everyone has guessed · waiting for the host';
      }
      // everyone's pins who picked the right map
      const r = game.res[round - 1];
      if (r && r.spot) {
        let extra = '';
        for (const p of d.players) {
          if (p.id === d.me) continue;
          const x = p.results.find(q => q.r === round);
          if (x && x.ok && x.u != null)
            extra += PIN2(x.u * 1000, x.v * 1000, colour(p.id), esc(safeName(p.name).slice(0, 12)));
        }
        $('resSvg').innerHTML = extra + (game.resSvg || '');
      }
    }
    if (!$('pEnd').hidden) {
      $('lobEnd').innerHTML = `<h4>Final standings</h4>` + rows(true, true);
      $('againBtn').textContent = isHost ? 'New game' : 'Leave lobby';
      $('lobEndMsg').textContent =
        d.state !== 'done'
          ? 'Waiting for everyone to finish…'
          : isHost
            ? 'Start a new game with the same players, or change the maps first.'
            : 'Waiting for the host to start another game…';
    }
  }

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
      INDEX = await (await fetch('data/index.json?v=' + DATA_V)).json();
    } catch (e) {
      setLoading(true, 'Could not load the map list.');
      return;
    }
    $('allCount').textContent = `all ${INDEX.length}`;
    $('cntE').textContent = `${INDEX.filter(POOLS.e.f).length} maps`;
    $('cntM').textContent = `${INDEX.filter(POOLS.m.f).length} maps`;
    $('cntH').textContent = `${INDEX.filter(POOLS.h.f).length} maps`;
    const TIPS = {
      v: "Savage's original S2 Games maps, plus every map played more than 500 times.",
      e: 'The most played maps on the Savage DRX servers, played more than 200 times. The ones most players will know.',
      m: 'Well known maps, played 110 to 199 times.',
      h: 'Rarer maps, played 70 to 109 times.',
      a: 'Every map in the game, from the classics to the rarest.',
    };
    for (const b of $('segPool').children) {
      const n = INDEX.filter(POOLS[b.dataset.v].f).length;
      b.dataset.tip = `${POOLS[b.dataset.v].label} · ${n} maps\n${TIPS[b.dataset.v]}`;
    }
    $('lobbyCard').hidden = !SB;
    const lobParam = (new URLSearchParams(location.search).get('lobby') || '').toUpperCase();
    if (SB && /^[A-Z2-9]{6}$/.test(lobParam)) openLobby(lobParam);

    const spinView = () => {
      if (!game && !drag && R.map && $('intro').hidden) {
        R.yaw += 0.0016;
        need = true;
      }
      requestAnimationFrame(spinView);
    };
    spinView();
  })();
  if (DEBUG) {
    window.__game = () => game;
    window.__lob = () => lob;
  }
})();
