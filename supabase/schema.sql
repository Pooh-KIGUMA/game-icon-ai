-- Iconia AI production account/billing foundation.
-- Run this in Supabase SQL editor when authentication is connected.
create table if not exists public.iconia_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','standard','pro')),
  credits integer not null default 10 check (credits >= 0),
  period_start timestamptz not null default date_trunc('month', now()),
  updated_at timestamptz not null default now()
);

alter table public.iconia_accounts enable row level security;
create policy "Users can read their own Iconia account"
  on public.iconia_accounts for select
  using (auth.uid() = user_id);

create or replace function public.consume_iconia_credit()
returns table(plan text, credits integer)
language plpgsql security definer set search_path = public
as $$
begin
  update public.iconia_accounts
     set credits = credits - 1, updated_at = now()
   where user_id = auth.uid() and credits > 0
   returning iconia_accounts.plan, iconia_accounts.credits into plan, credits;
  if not found then
    raise exception 'NO_CREDITS';
  end if;
  return next;
end;
$$;

create or replace function public.grant_iconia_ad_reward()
returns integer
language plpgsql security definer set search_path = public
as $$
declare new_credits integer;
begin
  update public.iconia_accounts
     set credits = credits + 3, updated_at = now()
   where user_id = auth.uid() and plan = 'free'
   returning iconia_accounts.credits into new_credits;
  if not found then raise exception 'AD_REWARD_UNAVAILABLE'; end if;
  return new_credits;
end;
$$;
