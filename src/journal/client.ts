import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import cfg from "../../config/supabase.json";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  // Implicit flow: a sign-in link opened in a phone's mail app browser still
  // works, which PKCE's same-browser code verifier would not allow.
  return (client ??= createClient(cfg.url, cfg.publishableKey, {
    auth: { flowType: "implicit", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }));
}
