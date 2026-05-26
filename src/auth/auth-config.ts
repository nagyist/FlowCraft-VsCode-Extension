/**
 * Public Supabase configuration used by AuthService for token refresh.
 *
 * Both values are public-facing (the same URL and anon key the web app exposes
 * via NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). They are only
 * needed for the refresh-token POST against Supabase's auth endpoint.
 *
 * They can be overridden at launch time with FLOWCRAFT_SUPABASE_URL /
 * FLOWCRAFT_SUPABASE_ANON_KEY env vars (useful for staging).
 */

// Public Supabase project URL + anon key. Safe to embed: the anon key is the
// public client-side key (role: "anon"), not the service-role key. Mirrors the
// values in the FlowCraft web app's NEXT_PUBLIC_SUPABASE_* env vars.
const DEFAULT_SUPABASE_URL = "https://fllqlodhrvmnynkffoss.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbHFsb2RocnZtbnlua2Zmb3NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAzMzcyMzgsImV4cCI6MjAxNTkxMzIzOH0.XOOdT3LUcNcLK4Pho50gWtB57oeTfogV8uPuanBR10c";

const DEFAULT_WEB_BASE_URL = "https://flowcraft.app";

export interface ResolvedAuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  webBaseUrl: string;
}

export function resolveAuthConfig(): ResolvedAuthConfig {
  return {
    supabaseUrl: process.env.FLOWCRAFT_SUPABASE_URL || DEFAULT_SUPABASE_URL,
    supabaseAnonKey:
      process.env.FLOWCRAFT_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
    webBaseUrl: process.env.FLOWCRAFT_WEB_URL || DEFAULT_WEB_BASE_URL,
  };
}
