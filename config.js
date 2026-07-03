// Default/fallback CONFIG. config.local.js (gitignored) loads BEFORE this and,
// if it set window.CONFIG, this file leaves it alone. So the owner's real key in
// config.local.js always wins; this file only provides safe defaults for a
// fresh checkout with no local override.
window.CONFIG = window.CONFIG || {
  SUPABASE_URL: 'https://qghprysrgjyghpqypoec.supabase.co',
  // anon / publishable key — read-only by design (RLS locks it to SELECT), so
  // it is safe to ship in the client. This is NOT the secret write key.
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnaHByeXNyZ2p5Z2hwcXlwb2VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMzI1MjUsImV4cCI6MjA5ODYwODUyNX0.JPW91jVIKL532LtxJFwqKsGG9btVRJ8iRQq9RsNA2JE',
  expectedAnnualReturn: 0.10,
  expectedDrawdown: -0.28,
  startingCapitalPerAccount: 10000,
};
