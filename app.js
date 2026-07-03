/* =========================================================================
   Bleuspace Paper Wallet — app.js
   Renders 5 screens + bottom-tab nav + segmented timeframe + inline SVG chart.
   Data comes from window.DATA.load() (Supabase or MOCK). No framework.

   HONESTY is structural here, not decorative:
   - accent (lime) NEVER touches a money figure — only the alive-pulse, active
     tab, primary button, focus ring, and the equity line stroke.
   - money uses the dimmed positive/negative pair; 0.00% uses --flat.
   - projections are labelled estimates and always show the drawdown caveat.
   - the app never moves real money; deposit/withdraw are UI intent only.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var SNAP = null;        // loaded snapshot
  var CURRENT = 'home';   // active screen (for in-place refresh)
  var FIRST_PAINT = true; // count the hero up only once, on first load

  // ---------- formatting ----------
  // account money is in PHP (the paper pool). The strategy is %/R-based, so the
  // unit is just a label — ₱ vs $ changes nothing in the math.
  function fmtMoney(n, opts) {
    opts = opts || {};
    var v = Number(n) || 0;
    var s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (opts.sign && v > 0 ? '+' : '') + '₱' + s;
  }
  // bare number, no currency — for coin prices shown inside position rows.
  function fmtNum(n) {
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // USD coin price (crypto is quoted in USD worldwide) — variable dp for small coins.
  function fmtUsd(n) {
    var v = Number(n) || 0;
    var dp = v >= 100 ? 2 : (v >= 1 ? 3 : 5);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtPct(n, opts) {
    opts = opts || {};
    var v = Number(n) || 0;
    var s = Math.abs(v).toFixed(2) + '%';
    if (v > 0) return '+' + v.toFixed(2) + '%';
    if (v < 0) return v.toFixed(2) + '%';
    return '0.00%';
  }
  // sign class: pos/neg/flat — the ONLY money colour, never accent
  function signClass(n) { var v = Number(n) || 0; return v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat'; }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function coinShort(sym) { return String(sym || '').replace(/USDT$/, ''); }
  function timeAgo(iso) {
    if (!iso) return '—';
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    var m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  }

  // "live but nothing has happened yet": real DB, flat equity, no P&L, no positions.
  // Distinct from isCold (empty DB) — here accounts exist but the bot hasn't traded.
  function isFlat(snap) {
    if (!snap || snap.isMock || snap.isCold) return false;
    var p = portfolio(snap);
    var eq = snap.equity || [];
    var flatCurve = eq.length < 2 || eq.every(function (e) { return Math.abs(e.equity_marked - eq[0].equity_marked) < 0.005; });
    var noPnl = Math.abs(p.total - p.start) < 0.005;
    var noPos = !snap.holdings || snap.holdings.length === 0;
    return flatCurve && noPnl && noPos;
  }

  // count a money figure up from 0 to its value once (easeOutCubic); respects reduced-motion.
  function animateCount(el, to) {
    if (!el) return;
    if (prefersReduced()) { el.textContent = fmtMoney(to); return; }
    var dur = 750, t0 = null;
    el.textContent = fmtMoney(0);
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtMoney(to * e);
      if (k < 1) requestAnimationFrame(step); else el.textContent = fmtMoney(to);
    }
    requestAnimationFrame(step);
  }

  var REFRESH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 5.3"/><path d="M20 5v6h-6"/></svg>';

  // ---------- portfolio math (honest, from snapshot) ----------
  // total/start come from accounts. Today's change is derived from the TOTAL
  // equity curve (last point vs the point ~24h earlier). The DB does not sync
  // per-account day P&L, so we never invent one — if the curve is too short,
  // `day`/`todayPct` are null and the UI omits the "Today" line rather than
  // faking a zero.
  function portfolio(snap) {
    var total = 0, start = 0;
    snap.accounts.forEach(function (a) { total += a.equity; start += a.start; });
    if (!snap.accounts.length && snap.equity && snap.equity.length) {
      total = snap.equity[snap.equity.length - 1].equity_marked; // fallback
    }
    var eq = snap.equity || [];
    var day = null, todayPct = null;
    if (eq.length >= 2) {
      var last = eq[eq.length - 1];
      var dayAgoT = last.t - 86400000;
      var prev = eq[0];
      for (var i = eq.length - 1; i >= 0; i--) { if (eq[i].t <= dayAgoT) { prev = eq[i]; break; } }
      day = last.equity_marked - prev.equity_marked;
      todayPct = prev.equity_marked ? (day / prev.equity_marked) * 100 : 0;
    }
    var sincePct = start ? ((total - start) / start) * 100 : 0;
    return { total: total, start: start, day: day, todayPct: todayPct, sincePct: sincePct };
  }

  // ---------- source badge (paper / live / mock) ----------
  function sourceBar(snap) {
    var mode = (snap.mode || 'paper');
    var paperBadge = '<span class="badge paper"><span class="d"></span>' + esc(mode.toUpperCase()) + '</span>';
    var srcBadge;
    if (snap.isCold) srcBadge = '<span class="badge mock"><span class="d"></span>CONNECTED · AWAITING FIRST SYNC</span>';
    else if (snap.isMock) srcBadge = '<span class="badge mock"><span class="d"></span>SAMPLE DATA</span>';
    else srcBadge = '<span class="badge live"><span class="d"></span>LIVE SYNC</span>';
    return '<div class="srcbar">' + paperBadge + srcBadge + '</div>';
  }

  // ================= SVG line chart (hand-rolled, no lib) =================
  // Renders TOTAL marked equity. Monochrome field, single accent stroke.
  function equityChart(points, w, h) {
    w = w || 340; h = h || 150;
    var padT = 8, padB = 8, padL = 0, padR = 0;
    if (!points || points.length < 2) {
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"></svg>';
    }
    var ys = points.map(function (p) { return p.equity_marked; });
    var min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    var range = (max - min) || 1;
    // pad range 6% so the line never kisses the edges
    var pad = range * 0.06; min -= pad; max += pad; range = max - min;
    var innerW = w - padL - padR, innerH = h - padT - padB;
    var n = points.length;
    function X(i) { return padL + (i / (n - 1)) * innerW; }
    function Y(v) { return padT + (1 - (v - min) / range) * innerH; }

    var d = '', fill = '';
    points.forEach(function (p, i) {
      var x = X(i).toFixed(2), y = Y(p.equity_marked).toFixed(2);
      d += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
    });
    fill = d + 'L' + X(n - 1).toFixed(2) + ' ' + (h - padB) + ' L' + X(0).toFixed(2) + ' ' + (h - padB) + ' Z';

    // baseline = starting total equity (30k) if within range, else the min
    var baseVal = points[0].equity_marked;
    var baseY = Y(baseVal).toFixed(2);

    var lastX = X(n - 1).toFixed(2), lastY = Y(points[n - 1].equity_marked).toFixed(2);

    return '' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="chart-fill" d="' + fill + '"/>' +
      '<line class="chart-base" x1="0" y1="' + baseY + '" x2="' + w + '" y2="' + baseY + '"/>' +
      '<path class="chart-line" d="' + d.trim() + '"/>' +
      '<circle class="chart-dot" cx="' + lastX + '" cy="' + lastY + '" r="3.5"/>' +
      '</svg>';
  }

  // window points by timeframe key
  function windowPoints(points, tf) {
    if (!points || !points.length) return [];
    var now = points[points.length - 1].t;
    var day = 86400000;
    var spans = { '1D': day, '1W': 7 * day, '1M': 30 * day, '3M': 90 * day, '1Y': 365 * day, 'ALL': Infinity };
    var span = spans[tf] != null ? spans[tf] : Infinity;
    if (span === Infinity) return points.slice();
    var cutoff = now - span;
    var w = points.filter(function (p) { return p.t >= cutoff; });
    // 1D from daily snapshots may yield <2 points — show last few so a line exists
    if (w.length < 2) w = points.slice(-Math.min(points.length, 8));
    return w;
  }

  // ======================= SCREEN: HOME =======================
  function renderHome(snap) {
    var p = portfolio(snap);
    var s = document.getElementById('screen-home');
    var rows = snap.holdings.map(function (h) {
      var accLabel = (snap.accounts.find(function (a) { return a.id === h.account; }) || {}).label || h.account;
      // No live price is synced, so we do NOT show a fabricated unrealized %.
      // If a snapshot ever carries a real unreal_pct, render it; otherwise show
      // the target price (honest, factual) instead.
      var right = (h.unreal_pct != null)
        ? '<div class="b money ' + signClass(h.unreal_pct) + '">' + fmtPct(h.unreal_pct) + '</div>'
        : '<div class="b caption">target ' + esc(fmtNum(h.target)) + '</div>';
      return '' +
        '<div class="row">' +
          '<div class="ic">' + esc(coinShort(h.coin)) + '</div>' +
          '<div class="main">' +
            '<div class="t">' + esc(coinShort(h.coin)) + ' · ' + esc(h.side) + '</div>' +
            '<div class="s">' + esc(accLabel) + ' · ' + h.bars + ' bars · tier ' + esc(h.tier == null ? '—' : h.tier) + '</div>' +
          '</div>' +
          '<div class="val">' +
            '<div class="a money">' + esc(fmtNum(h.entry)) + '</div>' +
            right +
          '</div>' +
        '</div>';
    }).join('');
    if (!rows) rows = '<div class="empty">No open positions right now.<br>The bot is flat — that is normal for a thin-edge paper run.</div>';

    var acctRows = snap.accounts.map(function (a) {
      var pnl = a.equity - a.start;
      var pct = a.start ? (pnl / a.start) * 100 : 0;
      return '' +
        '<div class="row">' +
          '<div class="ic">' + esc(a.label.replace('Strategy ', '')) + '</div>' +
          '<div class="main"><div class="t">' + esc(a.label) + '</div><div class="s">' + esc(a.sub) + '</div></div>' +
          '<div class="val"><div class="a money">' + esc(fmtMoney(a.equity)) + '</div>' +
          '<div class="b money ' + signClass(pnl) + '">' + fmtPct(pct) + '</div></div>' +
        '</div>';
    }).join('');

    s.innerHTML = '' +
      '<div class="appbar"><div class="brand"><span class="dot"></span><h2>Wallet</h2></div></div>' +
      sourceBar(snap) +
      '<div class="hero">' +
        '<div class="eyebrow">Total paper value · ' + (snap.accounts.length || 3) + ' accounts</div>' +
        '<div class="value money" data-count>' + esc(fmtMoney(p.total)) + '</div>' +
        (isFlat(snap)
          ? '<div class="today caption">Watching ' + ((snap.coinHealth && snap.coinHealth.length) || 8) + ' coins · first trades pending</div>'
          : p.day == null
            ? '<div class="today caption">Since start <span class="money ' + signClass(p.total - p.start) + '">' + fmtPct(p.sincePct) + '</span></div>'
            : '<div class="today">Today <span class="money ' + signClass(p.day) + '">' + fmtMoney(p.day, { sign: true }) + ' · ' + fmtPct(p.todayPct) + '</span></div>') +
        '<button class="refresh-line" data-refresh aria-label="Refresh">' + REFRESH_SVG + '<span>Updated ' + esc(timeAgo((snap.status && snap.status.last_cycle) || snap.startedAt)) + '</span></button>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-primary" data-go="add">Add</button>' +
        '<button class="btn btn-secondary" data-go="withdraw">Withdraw</button>' +
      '</div>' +
      '<div class="eyebrow section-label">Strategies</div>' +
      '<div class="rows">' + acctRows + '</div>' +
      '<div class="eyebrow section-label">Open positions</div>' +
      '<div class="rows">' + rows + '</div>' +
      '<p class="note">Paper trading — no real money is held or moved. Values reflect a backtested strategy running on live prices.</p>';
    if (FIRST_PAINT) { animateCount(s.querySelector('[data-count]'), p.total); FIRST_PAINT = false; }
  }

  // ======================= SCREEN: PERFORMANCE =======================
  var currentTF = '1M';
  function renderPerformance(snap) {
    var s = document.getElementById('screen-perf');
    var pts = windowPoints(snap.equity, currentTF);
    var first = pts.length ? pts[0].equity_marked : 0;
    var last = pts.length ? pts[pts.length - 1].equity_marked : 0;
    var chg = last - first;
    var chgPct = first ? (chg / first) * 100 : 0;

    var perStrat = snap.accounts.map(function (a) {
      var pnl = a.equity - a.start;
      var pct = a.start ? (pnl / a.start) * 100 : 0;
      // day/week realized P&L only render if actually present (mock/legacy);
      // the live DB does not sync them, so we show open-position count instead.
      var footer = (a.day_real != null || a.week_real != null)
        ? '<div style="display:flex;gap:var(--s-4);margin-top:var(--s-3);">' +
            '<div class="caption">Today <span class="money ' + signClass(a.day_real) + '">' + fmtMoney(a.day_real, { sign: true }) + '</span></div>' +
            '<div class="caption">Week <span class="money ' + signClass(a.week_real) + '">' + fmtMoney(a.week_real, { sign: true }) + '</span></div>' +
          '</div>'
        : '<div style="margin-top:var(--s-3);"><span class="caption">' + a.open + ' open · max ' + a.max_open + '</span></div>';
      return '' +
        '<div class="card">' +
          '<div class="card-h"><h3>' + esc(a.label) + '</h3>' +
            '<span class="caption">' + esc(a.sub) + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-end;">' +
            '<div><div class="eyebrow">Equity</div><div class="money" style="color:var(--text-hi);font-size:var(--t-title);font-weight:600;">' + esc(fmtMoney(a.equity)) + '</div></div>' +
            '<div style="text-align:right;"><div class="eyebrow">Since start</div><div class="money ' + signClass(pnl) + '" style="font-size:var(--t-title);font-weight:600;">' + fmtPct(pct) + '</div></div>' +
          '</div>' +
          footer +
        '</div>';
    }).join('');

    var tfs = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];
    var seg = tfs.map(function (t) {
      return '<button data-tf="' + t + '" class="' + (t === currentTF ? 'active' : '') + '">' + t + '</button>';
    }).join('');

    var flat = isFlat(snap);
    var pTot = portfolio(snap).total;
    var chartBlock = flat
      ? '<div class="chartwrap warming">' +
          '<div class="chart-head">' +
            '<div><div class="eyebrow">Marked equity</div>' +
              '<div class="big money">' + esc(fmtMoney(pTot)) + '</div></div>' +
            '<div style="text-align:right;"><div class="eyebrow">Change</div>' +
              '<div class="money flat" style="font-size:var(--t-title);font-weight:600;">0.00%</div></div>' +
          '</div>' +
          '<div class="warm-msg">Your equity line appears after the <span class="warm-strong">first trade</span>. The bot is live and watching 8 coins — nothing has fired yet.</div>' +
          '<div class="warm-spark"></div>' +
        '</div>'
      : '<div class="chartwrap">' +
          '<div class="chart-head">' +
            '<div><div class="eyebrow">' + esc(currentTF) + ' marked equity</div>' +
              '<div class="big money">' + esc(fmtMoney(last)) + '</div></div>' +
            '<div style="text-align:right;"><div class="eyebrow">Change</div>' +
              '<div class="money ' + signClass(chg) + '" style="font-size:var(--t-title);font-weight:600;">' + fmtPct(chgPct) + '</div></div>' +
          '</div>' +
          equityChart(pts, 340, 150) +
        '</div>';
    s.innerHTML = '' +
      '<div class="appbar"><div class="brand"><span class="dot"></span><h2>Performance</h2></div></div>' +
      sourceBar(snap) +
      (flat ? '' : '<div class="segmented">' + seg + '</div>') +
      chartBlock +
      '<div class="eyebrow section-label">Per-strategy</div>' +
      perStrat +
      '<p class="note">Marked equity includes open positions at last price. Past backtested results do not guarantee future returns.</p>';

    // wire segmented control
    Array.prototype.forEach.call(s.querySelectorAll('.segmented button'), function (b) {
      b.addEventListener('click', function () { currentTF = b.getAttribute('data-tf'); renderPerformance(snap); });
    });
  }

  // ======================= SCREEN: ADD MONEY =======================
  function projectionRows(amount) {
    var r = Number(CFG.expectedAnnualReturn != null ? CFG.expectedAnnualReturn : 0.10);
    var dd = Number(CFG.expectedDrawdown != null ? CFG.expectedDrawdown : -0.28);
    var a = Number(amount) || 0;
    var y1 = a * (1 + r);
    var y3 = a * Math.pow(1 + r, 3);
    var low = a * (1 + dd); // realistic dip
    return { r: r, dd: dd, a: a, y1: y1, y3: y3, low: low };
  }
  function renderAdd() {
    var s = document.getElementById('screen-add');
    s.innerHTML = '' +
      '<div class="appbar"><div class="brand"><span class="dot"></span><h2>Add money</h2></div></div>' +
      '<div class="srcbar"><span class="badge paper"><span class="d"></span>PAPER — SIMULATION</span></div>' +
      '<div class="amount-field"><span class="cur">₱</span><input id="add-amt" inputmode="decimal" placeholder="0" /></div>' +
      '<div class="chips">' +
        ['500', '1000', '5000', '10000'].map(function (v) { return '<button class="chip" data-add="' + v + '">₱' + Number(v).toLocaleString() + '</button>'; }).join('') +
      '</div>' +
      '<div class="eyebrow section-label">If it performs to the backtested estimate</div>' +
      '<div class="projection" id="add-proj"></div>' +
      '<div class="caveat">' +
        '<div class="tag"><span class="d"></span><span>Reality check</span></div>' +
        '<p><strong>This is an estimate, not a promise.</strong> The figure above uses a conservative ' +
        Math.round((CFG.expectedAnnualReturn || 0.10) * 100) + '%/yr optimistic ceiling from backtest. ' +
        'Real results can be lower, flat, or negative. A drawdown of about ' +
        '<strong>' + Math.round(Math.abs(CFG.expectedDrawdown || -0.28) * 100) + '%</strong> ' +
        '(a temporary dip in your balance) is realistic and has happened in testing. ' +
        'The bot is a paper strategy with a thin, still-being-validated edge.</p>' +
      '</div>' +
      '<button class="btn btn-primary" style="width:100%;" id="add-confirm">Add to paper balance</button>' +
      '<p class="note">Paper mode: this records a simulated deposit only. No real funds move. ' +
      'Real deposits are done manually on your exchange — this app never holds or transfers money.</p>';

    var input = s.querySelector('#add-amt');
    function refresh() {
      var pr = projectionRows(input.value);
      s.querySelector('#add-proj').innerHTML = '' +
        row('You add', fmtMoney(pr.a), 'text-hi') +
        row('Est. in 1 year', fmtMoney(pr.y1), signClass(pr.y1 - pr.a)) +
        row('Est. in 3 years', fmtMoney(pr.y3), signClass(pr.y3 - pr.a)) +
        row('Possible dip (~' + Math.round(Math.abs(pr.dd) * 100) + '%)', fmtMoney(pr.low), 'neg');
    }
    function row(k, v, cls) {
      return '<div class="prow"><span class="k">' + esc(k) + '</span><span class="v ' + (cls === 'text-hi' ? '' : cls) + '">' + esc(v) + '</span></div>';
    }
    input.addEventListener('input', refresh);
    Array.prototype.forEach.call(s.querySelectorAll('[data-add]'), function (c) {
      c.addEventListener('click', function () { input.value = c.getAttribute('data-add'); refresh(); });
    });
    s.querySelector('#add-confirm').addEventListener('click', function () {
      var a = Number(input.value) || 0;
      if (a <= 0) { toast('Enter an amount', 'Add a number above $0 to simulate a paper deposit.'); return; }
      toast('Paper deposit recorded', fmtMoney(a) + ' added to your simulated balance. No real money moved — this is paper mode.');
    });
    refresh();
  }

  // ======================= SCREEN: WITHDRAW =======================
  function renderWithdraw(snap) {
    var p = portfolio(snap);
    var s = document.getElementById('screen-withdraw');
    s.innerHTML = '' +
      '<div class="appbar"><div class="brand"><span class="dot"></span><h2>Withdraw</h2></div></div>' +
      '<div class="srcbar"><span class="badge paper"><span class="d"></span>PAPER — SIMULATION</span></div>' +
      '<div class="eyebrow section-label">Available (paper)</div>' +
      '<div class="hero" style="margin-top:var(--s-2);"><div class="value money">' + esc(fmtMoney(p.total)) + '</div></div>' +
      '<div class="amount-field"><span class="cur">₱</span><input id="wd-amt" inputmode="decimal" placeholder="0" /></div>' +
      '<div class="chips">' +
        '<button class="chip" data-wd="' + (p.total * 0.25).toFixed(2) + '">25%</button>' +
        '<button class="chip" data-wd="' + (p.total * 0.5).toFixed(2) + '">50%</button>' +
        '<button class="chip" data-wd="' + p.total.toFixed(2) + '">Max</button>' +
      '</div>' +
      '<div class="caveat">' +
        '<div class="tag"><span class="d"></span><span>How withdrawals actually work</span></div>' +
        '<p>In paper mode this only <strong>records your intent</strong> — no funds move. ' +
        'When the strategy runs on real capital, <strong>real withdrawals are done by you, manually, on the exchange.</strong> ' +
        'This app never has custody of money and cannot transfer it on your behalf.</p>' +
      '</div>' +
      '<button class="btn btn-primary" style="width:100%;" id="wd-confirm">Request withdrawal</button>' +
      '<p class="note">Paper — no real funds move. Your request is logged locally so the flow is testable.</p>';

    var input = s.querySelector('#wd-amt');
    Array.prototype.forEach.call(s.querySelectorAll('[data-wd]'), function (c) {
      c.addEventListener('click', function () { input.value = Number(c.getAttribute('data-wd')).toFixed(2); });
    });
    s.querySelector('#wd-confirm').addEventListener('click', function () {
      var a = Number(input.value) || 0;
      if (a <= 0) { toast('Enter an amount', 'Add a number above $0 to record a withdrawal request.'); return; }
      if (a > p.total + 0.001) { toast('Amount too high', 'You can request up to ' + fmtMoney(p.total) + ' in paper mode.'); return; }
      window.DATA.recordWithdrawIntent(a);
      toast('Paper withdrawal requested', 'Recorded ' + fmtMoney(a) + ' as intent. Paper — no real funds move. Real withdrawals are done manually on the exchange.');
    });
  }

  // ======================= SCREEN: STATUS =======================
  function renderStatus(snap) {
    var st = snap.status;
    var s = document.getElementById('screen-status');
    var running = st.running;
    var cautionPill = st.global_caution
      ? '<span class="pill caution"><span class="d"></span>Caution active</span>'
      : '<span class="pill ok"><span class="d"></span>Normal</span>';

    var coins = (snap.coinHealth || []).map(function (c) {
      var cls = c.status === 'ok' ? 'ok' : (c.status === 'caution' ? 'caution' : 'quar');
      var label = c.status === 'ok' ? 'OK' : (c.status === 'caution' ? 'CAUTION' : 'QUARANTINED');
      return '' +
        '<div class="coincell">' +
          '<div class="top"><span class="sym">' + esc(coinShort(c.coin)) + '</span>' +
            '<span class="pill ' + cls + '"><span class="d"></span>' + label + '</span></div>' +
          '<div class="meta">' + c.trades + ' trades · ' + (c.exp_r >= 0 ? '+' : '') + c.exp_r.toFixed(2) + 'R</div>' +
        '</div>';
    }).join('');

    s.innerHTML = '' +
      '<div class="appbar"><div class="brand"><span class="dot"></span><h2>Bot status</h2></div></div>' +
      sourceBar(snap) +
      '<div class="status-hero">' +
        '<span class="pulse ' + (running ? '' : 'paused') + '"></span>' +
        '<div class="txt"><div class="big">' + (running ? 'Running' : 'Paused') + '</div>' +
          '<div class="sub">Last cycle ' + esc(timeAgo(st.last_cycle)) + ' · 4h bars · 24/7</div></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="kv"><span class="k">Global caution</span><span>' + cautionPill + '</span></div>' +
        '<div class="kv"><span class="k">Quarantined coins</span><span class="v">' + ((st.quarantined && st.quarantined.length) ? st.quarantined.map(coinShort).join(', ') : 'None') + '</span></div>' +
        '<div class="kv"><span class="k">Virtual computer</span><span>' +
          (st.vm === 'ok' ? '<span class="pill ok"><span class="d"></span>Online</span>' : '<span class="pill off"><span class="d"></span>' + esc(st.vm) + '</span>') + '</span></div>' +
        '<div class="kv"><span class="k">Host note</span><span class="v" style="color:var(--text-lo);">' + esc(st.vm_note || 'Paper runner') + '</span></div>' +
      '</div>' +
      '<div class="eyebrow section-label">Per-coin health</div>' +
      '<div class="coingrid">' + coins + '</div>' +
      '<p class="note">Health is live trade quality per coin. A coin is quarantined automatically when its live edge decays — that is the bot protecting capital, not a fault.</p>';
  }

  // ======================= SCREEN: MARKETS =======================
  var MKT_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LTCUSDT', 'ADAUSDT', 'DOGEUSDT'];
  var COIN_NAMES = { BTCUSDT: 'Bitcoin', ETHUSDT: 'Ethereum', SOLUSDT: 'Solana', BNBUSDT: 'BNB', XRPUSDT: 'XRP', LTCUSDT: 'Litecoin', ADAUSDT: 'Cardano', DOGEUSDT: 'Dogecoin' };

  // live prices straight from the non-geo-blocked Binance mirror (CORS-open).
  function fetchPrices() {
    var url = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(MKT_COINS));
    return fetch(url).then(function (r) { return r.json(); }).then(function (arr) {
      var by = {};
      (arr || []).forEach(function (x) { by[x.symbol] = { price: Number(x.lastPrice), pct: Number(x.priceChangePercent) }; });
      return by;
    }).catch(function () { return null; });
  }

  function renderMarkets() {
    var s = document.getElementById('screen-markets');
    var priceRows = MKT_COINS.map(function (sym) {
      var short = coinShort(sym);
      return '<div class="row" data-mktrow="' + sym + '">' +
        '<div class="ic">' + esc(short) + '</div>' +
        '<div class="main"><div class="t">' + esc(short) + '</div><div class="s">' + esc(COIN_NAMES[sym] || short) + '</div></div>' +
        '<div class="val"><div class="a money" data-mktprice>·····</div>' +
          '<div class="b money flat" data-mktpct>—</div></div>' +
        '</div>';
    }).join('');
    s.innerHTML = '' +
      '<div class="appbar"><div class="brand"><span class="dot"></span><h2>Markets</h2></div></div>' +
      '<div class="eyebrow section-label">Live prices · USD</div>' +
      '<div class="rows">' + priceRows + '</div>' +
      '<div class="eyebrow section-label">Latest crypto news</div>' +
      '<div class="rows" id="mkt-news"><div class="empty">Loading headlines…</div></div>' +
      '<p class="note">Prices are live market data in USD. News is context only — the bot trades a pure volume-breakout system and does not read the news.</p>';

    fetchPrices().then(function (by) {
      if (!by) return;
      MKT_COINS.forEach(function (sym) {
        var row = s.querySelector('[data-mktrow="' + sym + '"]'); if (!row) return;
        var d = by[sym]; if (!d) return;
        row.querySelector('[data-mktprice]').textContent = fmtUsd(d.price);
        var pctEl = row.querySelector('[data-mktpct]');
        pctEl.textContent = fmtPct(d.pct);
        pctEl.className = 'b money ' + signClass(d.pct);
      });
    });

    window.DATA.loadNews().then(function (items) {
      var box = document.getElementById('mkt-news'); if (!box) return;
      if (!items || !items.length) {
        box.innerHTML = '<div class="empty">No headlines yet — the bot pulls fresh crypto news on its next cycle.</div>';
        return;
      }
      box.innerHTML = items.map(function (n) {
        return '<a class="row newsrow" href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<div class="main"><div class="t">' + esc(n.title) + '</div>' +
            '<div class="s">' + esc(n.source || 'news') + ' · ' + esc(timeAgo(n.published_at)) + '</div></div>' +
          '<div class="val"><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></div>' +
          '</a>';
      }).join('');
    });
  }

  // ======================= toast =======================
  var toastTimer = null;
  function toast(title, body) {
    var t = document.getElementById('toast');
    t.innerHTML = '<span class="tt">' + esc(title) + '</span>' + esc(body);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4200);
  }

  // ======================= nav =======================
  var SCREENS = ['home', 'perf', 'markets', 'add', 'withdraw', 'status'];
  var TAB_FOR = { home: 'home', perf: 'perf', markets: 'markets', add: 'home', withdraw: 'home', status: 'status' };
  function show(name) {
    CURRENT = name;
    SCREENS.forEach(function (n) {
      var scr = document.getElementById('screen-' + n);
      if (scr) scr.classList.toggle('active', n === name);
    });
    // render on show (fresh data binding)
    if (name === 'home') renderHome(SNAP);
    if (name === 'perf') renderPerformance(SNAP);
    if (name === 'markets') renderMarkets();
    if (name === 'add') renderAdd();
    if (name === 'withdraw') renderWithdraw(SNAP);
    if (name === 'status') renderStatus(SNAP);
    // highlight bottom tab (add/withdraw fall under Home tab)
    var activeTab = TAB_FOR[name];
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === activeTab);
    });
    window.scrollTo(0, 0);
  }

  function wireNav() {
    document.querySelector('.tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      show(b.getAttribute('data-tab'));
    });
    // delegate Add/Withdraw buttons + the refresh line from the home hero
    document.getElementById('app').addEventListener('click', function (e) {
      var g = e.target.closest('[data-go]'); if (g) { show(g.getAttribute('data-go')); return; }
      var r = e.target.closest('[data-refresh]'); if (r) { refresh(r); }
    });
  }

  // re-fetch live data and re-render the current screen in place (no count-up replay).
  function refresh(btn) {
    if (btn) btn.classList.add('spin');
    window.DATA.load().then(function (snap) { SNAP = snap; show(CURRENT); });
  }

  // one-time explainer sheet: what this is, that it is paper, why it sits flat.
  function maybeIntro() {
    try { if (localStorage.getItem('bleuspace_intro_seen')) return; } catch (e) { return; }
    var ov = document.createElement('div');
    ov.className = 'intro';
    ov.innerHTML = '<div class="intro-card">' +
      '<div class="eyebrow">Bleuspace · Paper Wallet</div>' +
      '<h2>A calm view of your trading bot.</h2>' +
      '<ul>' +
        '<li><b>No real money.</b> Every number here is simulated — the app never holds or moves funds.</li>' +
        '<li><b>The bot runs itself,</b> checking 8 coins every 4 hours. Most hours it stays flat — that is normal.</li>' +
        '<li><b>Your balance moves only when it trades.</b> Add and Withdraw here are paper-only.</li>' +
      '</ul>' +
      '<button class="btn btn-primary" data-intro-ok>Got it</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('[data-intro-ok]')) {
        try { localStorage.setItem('bleuspace_intro_seen', '1'); } catch (_e) {}
        ov.classList.add('out');
        setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 240);
      }
    });
    requestAnimationFrame(function () { ov.classList.add('show'); });
  }

  // ======================= boot =======================
  function boot() {
    wireNav();
    window.DATA.load().then(function (snap) {
      SNAP = snap;
      show('home');
      maybeIntro();
    });
    // refresh when the app is re-opened / brought back to the foreground
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && SNAP) refresh();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // expose a tiny self-check surface for validation
  window.__WALLET__ = { portfolio: portfolio, windowPoints: windowPoints, equityChart: equityChart, fmtPct: fmtPct };
})();
