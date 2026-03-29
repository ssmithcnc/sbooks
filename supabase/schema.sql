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
