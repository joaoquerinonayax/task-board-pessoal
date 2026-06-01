// -----------------------------------------------------------------------------
//  Supabase configuration  —  TEMPLATE
// -----------------------------------------------------------------------------
//  1. Copy this file to  config.js   (cp config.example.js config.js)
//  2. Fill in the two values below from your Supabase project:
//        Supabase Dashboard → Project Settings → API
//        • Project URL   →  url
//        • anon / public →  anonKey
//
//  The anon key is SAFE to commit and publish: it only works for actions your
//  Row Level Security policies allow, and those require a logged-in session.
// -----------------------------------------------------------------------------
window.SUPABASE_CONFIG = {
  url:     "https://YOUR-PROJECT-ref.supabase.co",
  anonKey: "YOUR-ANON-PUBLIC-KEY",
};
