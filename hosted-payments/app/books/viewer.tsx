"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import styles from "./viewer.module.css";
import Workspace from "./workspace";

type Row = { sync_id: string; entity: string; payload: Record<string, unknown> };
type Workspace = { id: string; name: string; owner_id: string; synced_at: string | null };

export default function Books({ url, apiKey }: { url: string; apiKey: string }) {
  const client = useMemo<SupabaseClient | null>(() => url && apiKey ? createClient(url, apiKey) : null, [url, apiKey]);
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [reload, setReload] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!client) { setLoading(false); return; }
    let active = true;
    client.auth.getUser().then(({ data }) => { if (active) { setUser(data.user?.id || null); setLoading(false); } });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user.id || null);
      if (!session) { setRows([]); setWorkspaces([]); setWorkspace(""); }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);

  useEffect(() => {
    if (!client || !user) return;
    let active = true;
    setError("");
    client.from("books_workspaces").select("id,name,owner_id,synced_at").order("name").then(({ data, error }) => {
      if (!active) return;
      if (error) { setError("Online books are not available yet. Please try again later."); return; }
      setWorkspaces(data || []);
      setWorkspace(previous => (data || []).some(w => w.id === previous) ? previous : data?.[0]?.id || "");
    });
    return () => { active = false; };
  }, [client, user, reload]);

  useEffect(() => {
    if (!client || !user || !workspace) return;
    let active = true;
    setRows([]); setBusy(true); setError("");
    async function read() {
      const all: Row[] = [];
      // Pin a revision by checking the workspace before and after all pages.
      const before = await client!.from("books_workspaces").select("revision").eq("id", workspace).single();
      if (before.error) throw new Error("Unable to read workspace.");
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client!.from("books_records").select("sync_id,entity,payload")
          .eq("workspace_id", workspace).eq("deleted", false).order("sync_id").range(offset, offset + 499);
        if (error) throw new Error("Unable to read online books.");
        all.push(...(data || []) as Row[]);
        if ((data || []).length < 500) break;
      }
      const after = await client!.from("books_workspaces").select("revision").eq("id", workspace).single();
      if (after.error || before.data.revision !== after.data.revision) throw new Error("Books changed while loading. Please refresh.");
      if (active) setRows(all);
    }
    read().catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, user, workspace, reload]);

  const current = workspaces.find(w => w.id === workspace);
  const isOwner = current?.owner_id === user;

  if (loading) return <main className={styles.login}>Loading S-Books...</main>;
  if (!user) return <main className={styles.login}>
    <img src="/sbooks-brand-badge.png" width="56" height="56" alt="S-Books" />
    <h1>S-Books Online</h1>
    {!client ? <p>Online sign-in is not configured yet.</p> : <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const data = new FormData(event.currentTarget);
      const credentials = { email: String(data.get("email")), password: String(data.get("password")) };
      const result = registering ? await client.auth.signUp(credentials) : await client.auth.signInWithPassword(credentials);
      if (result.error) setError(registering ? "Account creation failed. Please check your details or sign in." : "Sign-in failed. Check your email and password.");
      else if (registering) setNotice("Check your email to confirm your account, then sign in here.");
      setBusy(false);
    }}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={busy}>{busy ? "Please wait..." : registering ? "Create account" : "Sign in"}</button>
      <button type="button" onClick={() => { setRegistering(!registering); setError(""); setNotice(""); }}>{registering ? "Back to sign in" : "Create account"}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </main>;

  return <Workspace rows={rows} isOwner={isOwner} busy={busy} error={error || (!workspaces.length ? "No workspace access has been assigned to this account." : "")}
    syncedAt={current?.synced_at || null} refresh={() => setReload(reload+1)} signOut={() => { client!.auth.signOut(); }} />;
}
