// Data layer. Reads Supabase via the REST API using window.CONFIG (anon key only).
// Normalizes the REAL schema (app/supabase/schema.sql, written by the bot's
// cloud_sync.py) into the shape app.js consumes. On missing key / any fetch
// error / empty rows -> returns MOCK, so the app is never a blank screen.
//
// REAL Supabase tables (see schema.sql — these are the source of truth):
//   accounts         (name, equity, risk_pct, max_open, updated_at)
//   positions        (id, account, coin, side, entry, stop, target, bars, tier, opened_at)
//   equity_snapshots (id, account, run_time, equity_closed, equity_marked, open_positions)
//   trades           (id, account, coin, side, tier, entry_time, exit_time, entry, exit,
//                     reason, r, pnl_usd, equity_after)
//   bot_status       (id=1, last_cycle, running, global_caution, quarantine[], note)
//
// Honesty: the DB carries NO invented per-position unrealized P&L and NO
// projected returns. This layer never fabricates them either — position rows
// show entry/side/bars only; per-coin health is derived from real closed
// trades + the quarantine list. Projections live in the ADD screen, clearly
// labelled as estimates.
//
// ponytail: plain fetch against PostgREST, no @supabase/supabase-js dependency.
window.DATA = (function () {
  var cfg = window.CONFIG || {};
  var URL = (cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY = cfg.SUPABASE_ANON_KEY || '';
  var configured = !!(URL && KEY);
  var START = Number(cfg.startingCapitalPerAccount != null ? cfg.startingCapitalPerAccount : 10000);

  function rest(path) {
    return fetch(URL + '/rest/v1/' + path, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' },
    }).then(function (r) {
      if (!r.ok) throw new Error('supabase ' + r.status + ' on ' + path);
      return r.json();
    });
  }

  function num(x) { var n = Number(x); return Number.isFinite(n) ? n : 0; }
  function coinShort(s) { return String(s || '').replace(/USDT$/, ''); }

  var LETTER = { A_1pct_x3: 'A', 'B_1.5pct_x2': 'B', C_quality_tilt: 'C' };
  function accLabel(name) { return 'Strategy ' + (LETTER[name] || String(name).charAt(0).toUpperCase()); }
  function accSub(a) {
    var t = a.max_open === 1 ? 'quality tilt' : (a.max_open + ' open');
    return (a.risk_pct % 1 === 0 ? a.risk_pct.toFixed(0) : a.risk_pct) + '% risk · ' + t;
  }

  // Map the REAL rows -> the snapshot app.js renders.
  function normalize(raw) {
    var positions = raw.positions || [];
    // open-count per account
    var openBy = {};
    positions.forEach(function (p) { openBy[p.account] = (openBy[p.account] || 0) + 1; });

    var accounts = (raw.accounts || []).map(function (a) {
      return {
        id: a.name,
        label: accLabel(a.name),
        sub: accSub({ risk_pct: num(a.risk_pct), max_open: num(a.max_open) }),
        equity: num(a.equity),
        start: START,
        risk_pct: num(a.risk_pct),
        max_open: num(a.max_open),
        open: openBy[a.name] || 0,
        // day/week realized P&L are NOT synced to the DB; leave null so the UI
        // omits them rather than inventing zeros. (Honest: no data => no number.)
        day_real: null,
        week_real: null,
      };
    });

    // holdings = open positions. No live price is synced, so NO unrealized % —
    // we do not fabricate one. Show entry / side / bars / tier only.
    var holdings = positions.map(function (p) {
      return {
        coin: p.coin, account: p.account, side: p.side,
        entry: num(p.entry), stop: num(p.stop), target: num(p.target),
        bars: num(p.bars), tier: p.tier, unreal_pct: null,
      };
    });

    // equity curve = TOTAL marked equity per run_time (sum across accounts).
    var byT = {};
    (raw.equity || []).forEach(function (e) {
      var t = new Date(e.run_time).getTime();
      if (!Number.isFinite(t)) return;
      byT[t] = (byT[t] || 0) + num(e.equity_marked);
    });
    var equity = Object.keys(byT).map(function (k) {
      return { t: Number(k), equity_marked: Math.round(byT[k] * 100) / 100 };
    }).sort(function (a, b) { return a.t - b.t; });

    // per-coin health derived from real closed trades + quarantine list.
    var status0 = (raw.status && raw.status[0]) || {};
    var quar = status0.quarantine || [];
    var agg = {}; // coin -> {n, sumR}
    (raw.trades || []).forEach(function (t) {
      var c = t.coin; if (!c) return;
      if (!agg[c]) agg[c] = { n: 0, sumR: 0 };
      agg[c].n += 1; agg[c].sumR += num(t.r);
    });
    var COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LTCUSDT', 'ADAUSDT', 'DOGEUSDT'];
    var coinHealth = COINS.map(function (c) {
      var g = agg[c] || { n: 0, sumR: 0 };
      var exp = g.n ? g.sumR / g.n : 0;
      var st = quar.indexOf(c) >= 0 ? 'quarantined' : (g.n >= 10 && exp < 0 ? 'caution' : 'ok');
      return { coin: c, trades: g.n, exp_r: exp, status: st };
    });

    var status = {
      running: !!status0.running,
      last_cycle: status0.last_cycle || null,
      global_caution: !!status0.global_caution,
      global_caution_reason: status0.note || '',
      quarantined: quar,
      vm: 'ok',
      vm_note: status0.note && status0.global_caution ? status0.note : 'Paper runner · 4h bars · 24/7',
    };

    return {
      accounts: accounts, holdings: holdings, equity: equity, coinHealth: coinHealth,
      status: status, startedAt: status0.last_cycle || null, mode: 'paper', isMock: false,
    };
  }

  // Public: Promise<snapshot>, never rejects — falls back to MOCK.
  function load() {
    if (!configured) return Promise.resolve(tagFallback('no-key'));
    return Promise.all([
      rest('accounts?select=*').catch(function () { return []; }),
      rest('positions?select=*').catch(function () { return []; }),
      rest('equity_snapshots?select=account,run_time,equity_marked&order=run_time.asc&limit=2000').catch(function () { return []; }),
      rest('trades?select=coin,r&order=exit_time.desc&limit=2000').catch(function () { return []; }),
      rest('bot_status?select=*&limit=1').catch(function () { return []; }),
    ]).then(function (res) {
      var live = normalize({ accounts: res[0], positions: res[1], equity: res[2], trades: res[3], status: res[4] });
      // Connected, but the bot has not synced a cycle yet -> honest cold start
      // (3 paper accounts at starting capital, nothing open), NOT sample data.
      if (!live.accounts.length && !live.equity.length) return coldStart();
      return live;
    }).catch(function () { return tagFallback('error'); });
  }

  function tagFallback(reason) {
    var m = JSON.parse(JSON.stringify(window.MOCK));
    m.isMock = true; m.mockReason = reason; // 'no-key' | 'error'
    return m;
  }

  // Tables exist but the bot has not pushed a cycle yet. Show the HONEST cold
  // start (3 paper accounts at their starting capital, flat, nothing open) so
  // "connected but empty" never looks like fake gains. isCold -> "awaiting
  // first sync" badge. Mirrors what the very first real sync will show.
  function coldStart() {
    var defs = [
      { name: 'A_1pct_x3', risk_pct: 1.0, max_open: 3 },
      { name: 'B_1.5pct_x2', risk_pct: 1.5, max_open: 2 },
      { name: 'C_quality_tilt', risk_pct: 1.0, max_open: 3 },
    ];
    var accounts = defs.map(function (d) {
      return {
        id: d.name, label: accLabel(d.name), sub: accSub(d),
        equity: START, start: START, risk_pct: d.risk_pct, max_open: d.max_open,
        open: 0, day_real: null, week_real: null,
      };
    });
    var coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LTCUSDT', 'ADAUSDT', 'DOGEUSDT'];
    return {
      accounts: accounts, holdings: [], equity: [],
      coinHealth: coins.map(function (c) { return { coin: c, trades: 0, exp_r: 0, status: 'ok' }; }),
      status: {
        running: false, last_cycle: null, global_caution: false,
        global_caution_reason: '', quarantined: [], vm: 'offline',
        vm_note: 'Not deployed yet — deploy the bot to start syncing',
      },
      startedAt: null, mode: 'paper', isMock: false, isCold: true,
    };
  }

  // Record a paper withdrawal INTENT. anon key is read-only by contract, so
  // intent is stored client-side only; copy makes clear real withdrawals are
  // manual on the exchange and no funds move.
  function recordWithdrawIntent(amount) {
    var key = 'bleuspace_paper_withdraw_intents';
    var list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { list = []; }
    list.unshift({ amount: amount, at: new Date().toISOString(), mode: 'paper' });
    try { localStorage.setItem(key, JSON.stringify(list.slice(0, 20))); } catch (e) {}
    return list[0];
  }

  // Latest crypto headlines the bot mirrored into Supabase (news table).
  // Read-only via anon; [] on missing key / no table / error (app shows empty state).
  function loadNews() {
    if (!configured) return Promise.resolve([]);
    return rest('news?select=source,title,url,published_at&order=published_at.desc.nullslast&limit=15')
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return { source: r.source, title: r.title, url: r.url, published_at: r.published_at };
        });
      })
      .catch(function () { return []; });
  }

  return { load: load, configured: configured, recordWithdrawIntent: recordWithdrawIntent, loadNews: loadNews };
})();
