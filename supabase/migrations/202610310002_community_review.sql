begin;

create table public.community_moderation_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  subject_kind text not null check(subject_kind in ('post','report')),
  subject_id uuid not null,
  action text not null check(action in ('approve','reject','hide','resolve','dismiss')),
  previous_state text not null,
  next_state text not null,
  reason text not null check(char_length(btrim(reason)) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.community_moderation_events enable row level security;
revoke all on public.community_moderation_events from anon,authenticated;
grant select on public.community_moderation_events to authenticated;
grant all on public.community_moderation_events to service_role;
create policy moderation_events_read on public.community_moderation_events for select to authenticated using(public.community_is_moderator());

-- Apply submission requirements to direct Data API writes as well as the RPC.
create function public.community_guard_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.moderation in ('pending','published') then
    if new.section='art' and not exists(select 1 from public.community_post_media pm join public.community_media m on m.id=pm.media_id
      where pm.post_id=new.id and m.owner_id=new.owner_id and m.verified_at is not null and m.sha256 is not null and m.kind in ('image','video','audio')) then
      raise exception using errcode='22023',message='Artwork needs verified media';
    end if;
    if new.experiment_id is not null and not exists(select 1 from public.community_experiments e where e.id=new.experiment_id and e.owner_id=new.owner_id and e.language=new.language) then
      raise exception using errcode='22023',message='Experiment language does not match';
    end if;
  end if;
  return new;
end;
$$;
create trigger community_submission_guard before insert or update on public.community_posts for each row execute function public.community_guard_submission();

-- The mutation and its audit event commit together. Clients cannot forge events.
create function public.community_submit_post(p_post_id uuid, p_expected_updated_at timestamptz) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.community_posts;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sign in first'; end if;
  select * into p from public.community_posts where id=p_post_id and owner_id=auth.uid() for update;
  if not found then raise exception using errcode='42501',message='Post not available'; end if;
  if p.updated_at is distinct from p_expected_updated_at or p.moderation not in ('draft','rejected') then
    raise exception using errcode='40001',message='Post changed; reload before submission';
  end if;
  if p.section='art' and not exists(select 1 from public.community_post_media pm join public.community_media m on m.id=pm.media_id
    where pm.post_id=p.id and m.owner_id=auth.uid() and m.verified_at is not null and m.sha256 is not null and m.kind in ('image','video','audio')) then
    raise exception using errcode='22023',message='Artwork needs verified media';
  end if;
  if p.experiment_id is not null and not exists(select 1 from public.community_experiments e where e.id=p.experiment_id and e.owner_id=p.owner_id and e.language=p.language) then
    raise exception using errcode='22023',message='Experiment language does not match';
  end if;
  update public.community_posts set moderation='pending' where id=p.id returning * into p;
  return to_jsonb(p);
end;
$$;
revoke all on function public.community_submit_post(uuid,timestamptz) from public;
grant execute on function public.community_submit_post(uuid,timestamptz) to authenticated;

create function public.community_review(p_kind text,p_subject_id uuid,p_action text,p_expected_version text,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.community_posts; r public.community_reports; next_state text; previous_state text;
begin
  if auth.uid() is null or not public.community_is_moderator() then raise exception using errcode='42501',message='Moderator access required'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 2000 then raise exception using errcode='22023',message='A review reason is required'; end if;
  if p_reason ~* '(sk-(or-v1-)?[a-z0-9_-]{20,}|Bearer[[:space:]]+[a-z0-9._~-]{16,}|(api[_ -]?key|access[_ -]?token|service[_ -]?role[_ -]?key)["'']?[[:space:]]*[:=][[:space:]]*["'']?[a-z0-9._~-]{8,})' then
    raise exception using errcode='22023',message='Remove credentials';
  end if;
  if p_kind='post' and p_action in ('approve','reject','hide') then
    select * into p from public.community_posts where id=p_subject_id for update;
    if not found then raise exception using errcode='40001',message='Post no longer available'; end if;
    if p.updated_at is distinct from p_expected_version::timestamptz then raise exception using errcode='40001',message='Post changed; reload before review'; end if;
    if (p_action in ('approve','reject') and p.moderation<>'pending') or (p_action='hide' and p.moderation<>'published') then
      raise exception using errcode='40001',message='Post state changed';
    end if;
    if p_action='approve' and p.section='art' and not exists(select 1 from public.community_post_media pm join public.community_media m on m.id=pm.media_id
      where pm.post_id=p.id and m.owner_id=p.owner_id and m.verified_at is not null and m.sha256 is not null and m.kind in ('image','video','audio')) then
      raise exception using errcode='22023',message='Artwork needs verified media';
    end if;
    previous_state=p.moderation;
    next_state=case when p_action='approve' then 'published' else 'rejected' end;
    update public.community_posts set moderation=next_state where id=p.id;
  elsif p_kind='report' and p_action in ('resolve','dismiss') then
    select * into r from public.community_reports where id=p_subject_id for update;
    if not found or r.status<>'open' or p_expected_version is distinct from r.status then raise exception using errcode='40001',message='Report state changed'; end if;
    previous_state=r.status;
    next_state=case when p_action='resolve' then 'resolved' else 'dismissed' end;
    update public.community_reports set status=next_state where id=r.id;
  else raise exception using errcode='22023',message='Invalid review action';
  end if;
  insert into public.community_moderation_events(actor_id,subject_kind,subject_id,action,previous_state,next_state,reason)
  values(auth.uid(),p_kind,p_subject_id,p_action,previous_state,next_state,btrim(p_reason));
  return jsonb_build_object('id',p_subject_id,'kind',p_kind,'state',next_state);
end;
$$;
revoke all on function public.community_review(text,uuid,text,text,text) from public;
grant execute on function public.community_review(text,uuid,text,text,text) to authenticated;
commit;
