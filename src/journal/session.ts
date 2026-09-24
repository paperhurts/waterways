// Tiny on purpose: the maps import this to decide whether to load the journal
// at all, so it must not pull in the Supabase client.

import cfg from "../../config/supabase.json";

const ref = new URL(cfg.url).hostname.split(".")[0];
/** Where supabase-js persists the session in localStorage. */
export const SESSION_KEY = `sb-${ref}-auth-token`;

export function hasStoredSession(): boolean {
  try {
    return !!localStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}

export const journalUrl = (hash = ""): string => new URL(`journal.html${hash}`, document.baseURI).href;
