import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Newer Supabase projects call it the publishable key; older ones the anon key. Either works.
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
    client = createClient(url, key);
  }
  return client;
}

/** Everyone (host and players) gets an anonymous Supabase user, kept per device. */
export async function ensureSession(): Promise<string> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signedIn, error } = await sb.auth.signInAnonymously();
  if (error || !signedIn.user) throw error ?? new Error("Couldn't sign in");
  return signedIn.user.id;
}
