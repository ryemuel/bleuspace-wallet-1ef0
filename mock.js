// Bundled MOCK data so the app renders standalone (no Supabase key needed).
// Shapes MIRROR the Supabase views/tables the bot syncs (see supa.js normalize()),
// which in turn mirror the bot's local state files. Numbers are deliberately
// FLAT / near-breakeven — this is a paper bot with a thin edge; the mock must not
// imply gains. Two accounts sit slightly up, one slightly down; total ≈ flat.
window.MOCK = (function () {
  const START = 10000;

  // 3 paper accounts (matches state.json account names). day_real/week_real are
  // null because the live DB does not sync them — mock mirrors that so the demo
  // behaves exactly like the real data path (no fields the app can't really show).
  const accounts = [
    { id: 'A_1pct_x3',    label: 'Strategy A', sub: '1% risk · 3 open',      equity: 10142.30, start: START, risk_pct: 1.0, max_open: 3, day_real: null, week_real: null, open: 1 },
    { id: 'B_1.5pct_x2',  label: 'Strategy B', sub: '1.5% risk · 2 open',    equity: 9876.55,  start: START, risk_pct: 1.5, max_open: 2, day_real: null, week_real: null, open: 0 },
    { id: 'C_quality_tilt', label: 'Strategy C', sub: '1% risk · quality tilt', equity: 10037.80, start: START, risk_pct: 1.0, max_open: 1, day_real: null, week_real: null, open: 1 },
  ];

  // Holdings = open positions across accounts (mirrors state.json accounts[].open[]).
  // unreal_pct is null: no live price is synced, so no fabricated unrealized P&L.
  const holdings = [
    { coin: 'BTCUSDT', account: 'A_1pct_x3',    side: 'long', entry: 61240.0, stop: 60110.0, target: 63200.0, bars: 4, tier: 1, unreal_pct: null },
    { coin: 'SOLUSDT', account: 'C_quality_tilt', side: 'long', entry: 148.20, stop: 142.10, target: 159.00, bars: 2, tier: 1, unreal_pct: null },
  ];

  // Equity snapshots (mirrors equity.csv -> one marked-equity point per run).
  // Build a flat-ish walk of TOTAL marked equity across 3 accounts (~30000 base),
  // ~180 daily points. Random-walk with tiny drift and a real drawdown dip so the
  // chart tells the honest story: it wobbles, it dipped ~-9% mid-window, recovered.
  function buildEquity() {
    const points = [];
    const base = START * accounts.length; // 30000
    let v = base;
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const N = 180;
    // deterministic pseudo-random so the chart is stable across reloads
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = N - 1; i >= 0; i--) {
      const t = now - i * dayMs;
      // gentle mean-reverting wobble + a scripted drawdown around i≈70-95
      const drift = (rnd() - 0.48) * 45;
      let shock = 0;
      const idx = N - 1 - i;
      if (idx > 60 && idx < 95) shock = -Math.sin((idx - 60) / 34 * Math.PI) * 900; // ~-9% dip then back
      v = v + drift;
      const marked = Math.max(base * 0.7, v + shock);
      points.push({ t, equity_marked: Math.round(marked * 100) / 100 });
    }
    return points;
  }

  const equity = buildEquity();

  // Per-coin health (mirrors a coin_health view derived from trades + quarantine).
  const coinHealth = [
    { coin: 'BTCUSDT', trades: 41, exp_r: 0.11, status: 'ok' },
    { coin: 'ETHUSDT', trades: 38, exp_r: 0.07, status: 'ok' },
    { coin: 'SOLUSDT', trades: 44, exp_r: 0.14, status: 'ok' },
    { coin: 'BNBUSDT', trades: 33, exp_r: 0.02, status: 'ok' },
    { coin: 'XRPUSDT', trades: 31, exp_r: -0.05, status: 'caution' },
    { coin: 'LTCUSDT', trades: 36, exp_r: 0.06, status: 'ok' },
    { coin: 'ADAUSDT', trades: 30, exp_r: -0.12, status: 'quarantined' },
    { coin: 'DOGEUSDT', trades: 35, exp_r: 0.03, status: 'ok' },
  ];

  const status = {
    running: true,
    last_cycle: new Date(Date.now() - 42 * 60 * 1000).toISOString(), // 42 min ago
    global_caution: false,      // {active} in global_caution.json
    global_caution_reason: '',
    quarantined: ['ADAUSDT'],   // keys of quarantine.json
    vm: 'ok',                   // "virtual computer" / host status line
    vm_note: 'Paper runner · 4h bars · 24/7',
  };

  const startedAt = '2026-07-03T00:49:39Z';

  return { accounts, holdings, equity, coinHealth, status, startedAt, mode: 'paper', isMock: true };
})();
