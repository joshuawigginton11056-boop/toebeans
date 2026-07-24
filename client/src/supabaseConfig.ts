// Ghost-racing relay config (multiplayer session, 2026-07-24).
//
// These are the connection details for the Supabase project that relays pose
// packets between players (Realtime "broadcast" only — no database, no auth).
//
// ⚠ The anon / publishable key below is PUBLIC BY DESIGN. Supabase intends it
// to ship inside the website's JavaScript — anyone visiting the deployed game
// can already read it in their browser. It can't touch your database (we never
// use one here), only join broadcast rooms. So committing it is safe and is the
// standard way to ship a client-only Supabase feature. NEVER put the
// `service_role` / `secret` key here — that one is different and must stay
// private.
//
// Environment variables win if set (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY,
// see client/.env.example) — handy for pointing a local build at a throwaway
// project — but these baked-in defaults mean the live site just works.

export const SUPABASE_URL = "https://ptztlpogwdvunikpyplc.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0enRscG9nd2R2dW5pa3B5cGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDQxODAsImV4cCI6MjEwMDQ4MDE4MH0.pOGGuxdxiPrixmUUbDql6nPSv18VlPZBNioKk3ewHrg";
