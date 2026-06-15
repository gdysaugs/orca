create extension if not exists pgcrypto;

create or replace function public.consume_tickets(
  p_ticket_id uuid,
  p_usage_id text,
  p_cost integer,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
) returns table (
  tickets_left integer,
  already_consumed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_tickets integer;
  updated_tickets integer;
begin
  if p_ticket_id is null or p_usage_id is null or p_usage_id = '' then
    raise exception 'INVALID_INPUT';
  end if;
  if p_cost is null or p_cost < 1 then
    raise exception 'INVALID_COST';
  end if;

  select tickets into current_tickets
  from public.user_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'TICKET_ROW_NOT_FOUND';
  end if;

  insert into public.ticket_events (usage_id, user_id, email, delta, reason, metadata)
  select p_usage_id, user_id, email, -p_cost, p_reason, coalesce(p_metadata, '{}'::jsonb)
  from public.user_tickets
  where id = p_ticket_id
  on conflict (usage_id) do nothing;

  if not found then
    return query select current_tickets, true;
    return;
  end if;

  update public.user_tickets
  set tickets = tickets - p_cost,
      updated_at = now()
  where id = p_ticket_id
    and tickets >= p_cost
  returning tickets into updated_tickets;

  if not found then
    raise exception 'INSUFFICIENT_TICKETS';
  end if;

  return query select updated_tickets, false;
end;
$$;

create or replace function public.refund_tickets(
  p_ticket_id uuid,
  p_usage_id text,
  p_amount integer,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
) returns table (
  tickets_left integer,
  already_refunded boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_tickets integer;
  updated_tickets integer;
begin
  if p_ticket_id is null or p_usage_id is null or p_usage_id = '' then
    raise exception 'INVALID_INPUT';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select tickets into current_tickets
  from public.user_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'TICKET_ROW_NOT_FOUND';
  end if;

  insert into public.ticket_events (usage_id, user_id, email, delta, reason, metadata)
  select p_usage_id, user_id, email, p_amount, p_reason, coalesce(p_metadata, '{}'::jsonb)
  from public.user_tickets
  where id = p_ticket_id
  on conflict (usage_id) do nothing;

  if not found then
    return query select current_tickets, true;
    return;
  end if;

  update public.user_tickets
  set tickets = tickets + p_amount,
      updated_at = now()
  where id = p_ticket_id
  returning tickets into updated_tickets;

  if not found then
    raise exception 'TICKET_ROW_NOT_FOUND';
  end if;

  return query select updated_tickets, false;
end;
$$;

create or replace function public.grant_tickets(
  p_usage_id text,
  p_user_id uuid,
  p_email text,
  p_amount integer,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb,
  p_stripe_customer_id text default null
) returns table (
  tickets_left integer,
  already_processed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_tickets integer;
  ticket_id uuid;
begin
  if p_usage_id is null or p_usage_id = '' then
    raise exception 'INVALID_USAGE_ID';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_email is null or p_email = '' then
    raise exception 'INVALID_EMAIL';
  end if;
  if p_user_id is null then
    raise exception 'INVALID_USER_ID';
  end if;

  insert into public.ticket_events (usage_id, user_id, email, delta, reason, metadata)
  values (p_usage_id, p_user_id, p_email, p_amount, p_reason, coalesce(p_metadata, '{}'::jsonb))
  on conflict (usage_id) do nothing;

  if not found then
    select tickets into updated_tickets
    from public.user_tickets
    where user_id = p_user_id or lower(email) = lower(p_email)
    limit 1;
    return query select coalesce(updated_tickets, 0), true;
    return;
  end if;

  select id into ticket_id
  from public.user_tickets
  where user_id = p_user_id or lower(email) = lower(p_email)
  order by case when user_id = p_user_id then 0 else 1 end
  limit 1
  for update;

  if found then
    update public.user_tickets
    set tickets = tickets + p_amount,
        user_id = p_user_id,
        email = p_email,
        stripe_customer_id = coalesce(p_stripe_customer_id, stripe_customer_id),
        updated_at = now()
    where id = ticket_id
    returning tickets into updated_tickets;
  else
    insert into public.user_tickets (user_id, email, stripe_customer_id, tickets)
    values (p_user_id, p_email, p_stripe_customer_id, p_amount)
    returning tickets into updated_tickets;
  end if;

  return query select updated_tickets, false;
end;
$$;

create or replace function public.claim_daily_bonus()
returns table (
  claimed boolean,
  tickets_left integer,
  seconds_remaining integer,
  next_claim_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_auth_email text;
  v_user_created_at timestamptz;
  v_ticket_id uuid;
  v_tickets integer;
  v_last_claim_at timestamptz;
  v_next_claim_at timestamptz;
  v_now timestamptz := now();
  v_usage_id text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select email, created_at into v_auth_email, v_user_created_at
  from auth.users
  where id = v_user_id;

  v_email := coalesce(nullif(v_email, ''), v_auth_email, '');
  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  select id, tickets into v_ticket_id, v_tickets
  from public.user_tickets
  where user_id = v_user_id or lower(email) = lower(v_email)
  order by case when user_id = v_user_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    insert into public.user_tickets (user_id, email, tickets)
    values (v_user_id, v_email, 3)
    returning id, tickets into v_ticket_id, v_tickets;

    insert into public.ticket_events (usage_id, user_id, email, delta, reason, metadata)
    values (
      'signup:' || v_user_id::text,
      v_user_id,
      v_email,
      3,
      'signup_bonus',
      jsonb_build_object('source', 'claim_daily_bonus_bootstrap')
    )
    on conflict (usage_id) do nothing;
  else
    update public.user_tickets
    set user_id = v_user_id,
        email = v_email,
        updated_at = updated_at
    where id = v_ticket_id
    returning tickets into v_tickets;
  end if;

  select max(created_at) into v_last_claim_at
  from public.ticket_events
  where user_id = v_user_id
    and reason in ('daily_bonus', 'daily_bonus_claim');

  v_next_claim_at := greatest(
    coalesce(v_user_created_at + interval '12 hours', '-infinity'::timestamptz),
    coalesce(v_last_claim_at + interval '12 hours', '-infinity'::timestamptz)
  );

  if v_next_claim_at > v_now then
    return query select
      false,
      v_tickets,
      ceil(extract(epoch from (v_next_claim_at - v_now)))::integer,
      v_next_claim_at;
    return;
  end if;

  v_usage_id := 'daily:' || v_user_id::text || ':' || gen_random_uuid()::text;

  insert into public.ticket_events (usage_id, user_id, email, delta, reason, metadata)
  values (
    v_usage_id,
    v_user_id,
    v_email,
    1,
    'daily_bonus_claim',
    jsonb_build_object('source', 'claim_daily_bonus', 'cooldown_hours', 12)
  );

  update public.user_tickets
  set tickets = tickets + 1,
      updated_at = now()
  where id = v_ticket_id
  returning tickets into v_tickets;

  insert into public.daily_bonus_claims (usage_id, user_id, email, bonus_amount, cooldown_hours, metadata)
  values (
    v_usage_id,
    v_user_id,
    v_email,
    1,
    12,
    jsonb_build_object('source', 'claim_daily_bonus')
  );

  return query select true, v_tickets, 12 * 60 * 60, v_now + interval '12 hours';
end;
$$;

revoke all on function public.consume_tickets(uuid, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_tickets(uuid, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.grant_tickets(text, uuid, text, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_daily_bonus() from public, anon;

grant execute on function public.consume_tickets(uuid, text, integer, text, jsonb) to service_role;
grant execute on function public.refund_tickets(uuid, text, integer, text, jsonb) to service_role;
grant execute on function public.grant_tickets(text, uuid, text, integer, text, jsonb, text) to service_role;
grant execute on function public.claim_daily_bonus() to authenticated;
