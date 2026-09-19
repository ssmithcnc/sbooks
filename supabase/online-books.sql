-- Additive read-only mirror. Run in the sbooks-prod SQL editor.
begin;
create table if not exists public.books_workspaces (
  id uuid primary key,
  name text not null,
  owner_id uuid not null references auth.users(id),
  source_id uuid not null unique,
  revision bigint not null default -1,
  synced_at timestamptz
);
create table if not exists public.books_members (
  workspace_id uuid not null references public.books_workspaces(id),
  user_id uuid not null references auth.users(id),
  primary key(workspace_id,user_id)
);
create table if not exists public.books_records (
  workspace_id uuid not null references public.books_workspaces(id),
  sync_id uuid not null,
  entity text not null check(entity in ('accounts','account_anchors','paychecks','recurring_rules','transactions','cc_snapshots','customers','products','documents','document_lines','pay_period_archives','business_profile')),
  local_key text not null,
  scope text not null check(scope in ('owner','business')),
  payload jsonb not null,
  revision bigint not null,
  deleted boolean not null default false,
  primary key(workspace_id,sync_id),
  unique(workspace_id,entity,local_key)
);
alter table public.books_workspaces enable row level security;
alter table public.books_members enable row level security;
alter table public.books_records enable row level security;
revoke all on public.books_workspaces, public.books_members, public.books_records from anon, authenticated;
grant select on public.books_workspaces, public.books_members, public.books_records to authenticated;
grant all on public.books_workspaces, public.books_members, public.books_records to service_role;
drop policy if exists books_members_self on public.books_members;
create policy books_members_self on public.books_members for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists books_workspace_access on public.books_workspaces;
create policy books_workspace_access on public.books_workspaces for select to authenticated using(
  owner_id=(select auth.uid()) or exists(select 1 from public.books_members m where m.workspace_id=id and m.user_id=(select auth.uid()))
);
drop policy if exists books_record_access on public.books_records;
create policy books_record_access on public.books_records for select to authenticated using(
  exists(select 1 from public.books_workspaces w where w.id=workspace_id and
    (w.owner_id=(select auth.uid()) or (scope='business' and exists(
      select 1 from public.books_members m where m.workspace_id=w.id and m.user_id=(select auth.uid())
    ))))
);

-- A complete snapshot becomes visible atomically; an interrupted upload changes nothing.
create or replace function public.books_apply_snapshot(p_workspace uuid, p_source uuid, p_revision bigint, p_records jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare w public.books_workspaces; n integer;
begin
  select * into w from public.books_workspaces where id=p_workspace for update;
  if not found or w.source_id<>p_source then raise exception 'Unknown workspace or source'; end if;
  if p_revision<w.revision then raise exception 'Stale source revision: review required'; end if;
  if p_revision=w.revision then return jsonb_build_object('revision',w.revision,'replayed',true); end if;
  if jsonb_typeof(p_records)<>'array' then raise exception 'Expected complete record array'; end if;
  insert into public.books_records(workspace_id,sync_id,entity,local_key,scope,payload,revision,deleted)
  select p_workspace,r.sync_id,r.entity,r.local_key,
    case when r.entity in ('customers','products','documents','document_lines','business_profile') then 'business' else 'owner' end,
    r.payload,p_revision,false
  from jsonb_to_recordset(p_records) as r(sync_id uuid,entity text,local_key text,payload jsonb)
  on conflict(workspace_id,sync_id) do update set
    payload=excluded.payload, revision=excluded.revision, deleted=false, scope=excluded.scope;
  get diagnostics n=row_count;
  update public.books_records set deleted=true, revision=p_revision
    where workspace_id=p_workspace and revision<p_revision and not deleted;
  update public.books_workspaces set revision=p_revision,synced_at=now() where id=p_workspace;
  return jsonb_build_object('revision',p_revision,'records',n);
end $$;
revoke all on function public.books_apply_snapshot(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.books_apply_snapshot(uuid,uuid,bigint,jsonb) to service_role;
create or replace function public.books_verify_snapshot(p_workspace uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object('revision',w.revision,'records',coalesce((
    select jsonb_agg(jsonb_build_object('sync_id',r.sync_id,'payload',r.payload))
    from public.books_records r where r.workspace_id=w.id and not r.deleted
  ),'[]'::jsonb)) from public.books_workspaces w where w.id=p_workspace;
$$;
revoke all on function public.books_verify_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.books_verify_snapshot(uuid) to service_role;
create or replace function public.books_setup_workspace(p_source uuid, p_email text)
returns uuid language plpgsql security definer set search_path=public as $$
declare owner_uuid uuid; workspace_uuid uuid;
begin
  select id into owner_uuid from auth.users where lower(email)=lower(p_email) and email_confirmed_at is not null;
  if owner_uuid is null then raise exception 'Owner must sign up and confirm email first'; end if;
  insert into public.books_workspaces(id,name,owner_id,source_id)
    values(gen_random_uuid(),'S-Books',owner_uuid,p_source) on conflict(source_id) do nothing;
  select id into workspace_uuid from public.books_workspaces where source_id=p_source and owner_id=owner_uuid;
  if workspace_uuid is null then raise exception 'Source already belongs to another owner'; end if;
  return workspace_uuid;
end $$;
revoke all on function public.books_setup_workspace(uuid,text) from public,anon,authenticated;
grant execute on function public.books_setup_workspace(uuid,text) to service_role;
commit;
