create extension if not exists pgcrypto;

create table if not exists business_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  company_name text not null,
  company_email text,
  company_phone text,
  company_website text,
  manual_bank_instructions text,
  stripe_publishable_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references business_profiles(id) on delete cascade,
  local_invoice_id bigint,
  public_id text unique not null,
  invoice_number text not null,
  customer_name text not null,
  customer_email text,
  issue_date date not null,
  due_date date,
  currency text not null default 'USD',
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  status text not null default 'open',
  payment_status text not null default 'unpaid',
  payment_page_url text,
  latest_checkout_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_business_profile on invoices(business_profile_id);
create index if not exists idx_invoices_public_id on invoices(public_id);

create table if not exists invoice_payment_options (
  invoice_id uuid primary key references invoices(id) on delete cascade,
  accept_manual_ach boolean not null default true,
  accept_stripe_card boolean not null default true,
  accept_stripe_ach boolean not null default true,
  accept_paypal boolean not null default false,
  accept_venmo boolean not null default false,
  allow_partial_payment boolean not null default false,
  deposit_enabled boolean not null default false,
  deposit_amount numeric(12,2),
  updated_at timestamptz not null default now()
);

create table if not exists invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  sort_order integer not null default 0,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2),
  amount numeric(12,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoice_line_items_invoice on invoice_line_items(invoice_id, sort_order, created_at);

create table if not exists payment_sessions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  provider text not null,
  provider_session_id text,
  payment_method text not null,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  status text not null default 'created',
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payment_sessions_invoice on payment_sessions(invoice_id);

create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  provider text not null,
  provider_event_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_events_invoice on payment_events(invoice_id);

create table if not exists invoice_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete set null,
  provider text not null default 'resend',
  provider_message_id text,
  recipient_email text not null,
  subject text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_email_deliveries_invoice on invoice_email_deliveries(invoice_id, created_at desc);

create table if not exists receipt_uploads (
  id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references business_profiles(id) on delete cascade,
  source text not null default 'mobile',
  bucket_name text not null default 'receipts',
  object_path text not null,
  vendor_name text,
  receipt_date date,
  total_amount numeric(12,2),
  status text not null default 'uploaded',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_receipt_uploads_business_profile on receipt_uploads(business_profile_id);

create table if not exists receipt_ocr_results (
  receipt_upload_id uuid primary key references receipt_uploads(id) on delete cascade,
  processor text not null,
  raw_text text,
  normalized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  vendor text,
  receipt_date timestamptz,
  order_number text,
  total numeric(12,2),
  tax numeric(12,2),
  expense_category text,
  pages_to_keep text,
  confidence numeric(5,4) not null default 0,
  source text not null default 'upload',
  raw_text text,
  structured jsonb not null default '{}'::jsonb,
  status text not null default 'needs_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipts_status_check check (status in ('needs_review', 'approved', 'flagged'))
);

alter table receipts add column if not exists updated_at timestamptz not null default now();
alter table receipts add column if not exists structured jsonb not null default '{}'::jsonb;
alter table receipts add column if not exists status text not null default 'needs_review';
alter table receipts add column if not exists source text not null default 'upload';
alter table receipts add column if not exists confidence numeric(5,4) not null default 0;
alter table receipts add column if not exists expense_category text;
alter table receipts add column if not exists pages_to_keep text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'receipts_status_check'
  ) then
    alter table receipts
      add constraint receipts_status_check
      check (status in ('needs_review', 'approved', 'flagged'));
  end if;
end $$;

create index if not exists idx_receipts_status_created_at on receipts(status, created_at desc);
create index if not exists idx_receipts_vendor on receipts(vendor);
create index if not exists idx_receipts_receipt_date on receipts(receipt_date desc);

create table if not exists receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  description text not null default '',
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2),
  total_price numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table receipt_items add column if not exists created_at timestamptz not null default now();
alter table receipt_items add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_receipt_items_receipt on receipt_items(receipt_id);

create table if not exists receipt_files (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  bucket_name text not null default 'receipts',
  file_type text,
  file_path text not null,
  original_name text,
  mime_type text,
  byte_size bigint,
  page_count integer,
  created_at timestamptz not null default now()
);

alter table receipt_files add column if not exists bucket_name text not null default 'receipts';
alter table receipt_files add column if not exists original_name text;
alter table receipt_files add column if not exists mime_type text;
alter table receipt_files add column if not exists byte_size bigint;
alter table receipt_files add column if not exists page_count integer;
create index if not exists idx_receipt_files_receipt on receipt_files(receipt_id);
