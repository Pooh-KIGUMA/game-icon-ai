-- Iconia AI production account/billing foundation.
-- Run this once in the Supabase SQL editor.
create table if not exists public.iconia_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','standard','pro')),
  credits integer not null default 10 check (credits >= 0),
  period_start timestamptz not null default date_trunc('month', now()),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);

alter table public.iconia_accounts enable row level security;
drop policy if exists "Users can read their own Iconia account" on public.iconia_accounts;
create policy "Users can read their own Iconia account" on public.iconia_accounts for select using (auth.uid() = user_id);

create or replace function public.consume_iconia_credit_for_user(p_user_id uuid)
returns table(plan text, credits integer)
language plpgsql security definer set search_path = public
as $$
begin
  update public.iconia_accounts set credits = credits - 1, updated_at = now()
  where user_id = p_user_id and credits > 0
  returning iconia_accounts.plan, iconia_accounts.credits into plan, credits;
  if not found then return; end if;
  return next;
end;
$$;

create or replace function public.refund_iconia_credit_for_user(p_user_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_credits integer;
begin
  update public.iconia_accounts set credits = credits + 1, updated_at = now()
  where user_id = p_user_id returning iconia_accounts.credits into new_credits;
  return new_credits;
end;
$$;

create or replace function public.grant_iconia_ad_reward_for_user(p_user_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_credits integer;
begin
  update public.iconia_accounts set credits = credits + 3, updated_at = now()
  where user_id = p_user_id and plan = 'free'
  returning iconia_accounts.credits into new_credits;
  return new_credits;
end;
$$;

-- Stripe webhook support. The webhook is the authority for paid plan state.
create index if not exists iconia_accounts_stripe_customer_idx on public.iconia_accounts(stripe_customer_id);
