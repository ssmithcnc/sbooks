import { createClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (!client) {
    client = createClient(
      getEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getEnv("SUPABASE_SECRET_KEY"),
      { auth: { persistSession: false } }
    );
  }
  return client;
}
