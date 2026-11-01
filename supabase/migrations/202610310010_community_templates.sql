begin;

-- Separate, append-only decisions. Publishing a post never accepts a template.
create table public.community_template_reviews (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  experiment_id uuid not null references public.community_experiments(id) on delete restrict,
  post_version timestamptz not null,
  decision text not null check(decision in ('accepted','rejected')),
  checks jsonb not null check(jsonb_typeof(checks)='object'),
  note text not null check(char_length(btrim(note)) between 1 and 2000),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp()
);
create index community_template_reviews_latest on public.community_template_reviews(post_id,reviewed_at desc,id desc);
alter table public.community_template_reviews enable row level security;
revoke all on public.community_template_reviews from anon,authenticated;
grant select on public.community_template_reviews to authenticated;
grant all on public.community_template_reviews to service_role;
create policy template_reviews_moderator on public.community_template_reviews for select to authenticated using(public.community_is_moderator());

create function public.community_review_template(p_post_id uuid,p_expected timestamptz,p_decision text,p_checks jsonb,p_note text,p_media_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.community_posts; e public.community_experiments; ids uuid[]; criterion text; c jsonb; result public.community_template_reviews;
begin
  if auth.uid() is null or not public.community_is_moderator() then raise exception using errcode='42501',message='Moderator required'; end if;
  select * into p from public.community_posts where id=p_post_id for update;
  if not found or p.experiment_id is null or p.section<>'workshop' then raise exception using errcode='22023',message='An experiment workshop post is required'; end if;
  if p.updated_at is distinct from p_expected then raise exception using errcode='40001',message='Post changed; reload before reviewing'; end if;
  if p_decision is null or p_decision not in ('accepted','rejected') or p_note is null or char_length(btrim(p_note)) not between 1 and 2000
    or p_checks is null or jsonb_typeof(p_checks)<>'object' or octet_length(p_checks::text)>16000 then raise exception using errcode='22023',message='Check template decision'; end if;
  if (p_note||p_checks::text) ~* '(sk-(or-v1-)?[a-z0-9_-]{20,}|Bearer[[:space:]]+[a-z0-9._~-]{16,}|(api[_ -]?key|access[_ -]?token)["'']?[[:space:]]*[:=])' then raise exception using errcode='22023',message='Remove credentials'; end if;
  select * into e from public.community_experiments where id=p.experiment_id and owner_id=p.owner_id for update;
  if not found or e.validated_at is null or e.language<>p.language then raise exception using errcode='22023',message='Verified experiment required'; end if;
  if p_decision='accepted' then
    if p.moderation<>'published' or p.reuse<>'remix-with-credit' or e.outcome<>'completed' or e.record->>'outcome' is distinct from 'completed'
      then raise exception using errcode='22023',message='A completed, published experiment with adaptation permission is required'; end if;
    select coalesce(array_agg(media_id order by media_id),'{}') into ids from public.community_post_media where post_id=p.id;
    if cardinality(ids)=0 or cardinality(ids)>30 or p_media_ids is null or cardinality(p_media_ids)<>cardinality(ids)
      or not ids @> p_media_ids or not p_media_ids @> ids then raise exception using errcode='22023',message='Review every current attachment'; end if;
    if exists(select 1 from public.community_media m where m.id=any(ids) and (m.owner_id<>p.owner_id or m.run_id is distinct from e.id
      or m.verified_at is null or m.sha256 is null or m.sha256 !~ '^[a-f0-9]{64}$')) then raise exception using errcode='22023',message='Verified same-run evidence required'; end if;
    if not exists(select 1 from public.community_media where id=any(ids) and kind='game-spec')
      or not exists(select 1 from public.community_media where id=any(ids) and kind='game-zip')
      or not exists(select 1 from public.community_media where id=any(ids) and (kind='video' or kind='image' and storage_key ~* '\.(gif|webp)$') and duration_seconds>0 and duration_seconds<=60)
      then raise exception using errcode='22023',message='GameSpec, ZIP and a verified demonstration of at most 60 seconds are required'; end if;
    if jsonb_typeof(e.record->'issues') is distinct from 'array' or exists(select 1 from jsonb_array_elements(e.record->'issues') issue where issue->>'severity' in ('blocking','major') and issue->>'resolved' is distinct from 'true')
      then raise exception using errcode='22023',message='Blocking or major issues remain'; end if;
    foreach criterion in array array['storyFidelity','artQuality','webPlaythrough','offlinePlaythrough'] loop
      c=p_checks->criterion;
      if c is null or c->>'state' is distinct from 'passed' or jsonb_typeof(c->'note') is distinct from 'string' or char_length(btrim(coalesce(c->>'note',''))) not between 1 and 2000
        or jsonb_typeof(c->'evidenceIds') is distinct from 'array' then raise exception using errcode='22023',message='Four documented quality checks are required'; end if;
      if jsonb_array_length(c->'evidenceIds')=0 or exists(select 1 from jsonb_array_elements_text(c->'evidenceIds') proof where not proof=any(ids::text[]))
        then raise exception using errcode='22023',message='Check evidence must belong to this run'; end if;
      if e.record->'checks'->criterion->>'state' is distinct from 'passed' then raise exception using errcode='22023',message='Author checks must also be complete'; end if;
    end loop;
  end if;
  insert into public.community_template_reviews(post_id,experiment_id,post_version,decision,checks,note,reviewer_id)
    values(p.id,e.id,p.updated_at,p_decision,p_checks,btrim(p_note),auth.uid()) returning * into result;
  return to_jsonb(result);
end; $$;
revoke all on function public.community_review_template(uuid,timestamptz,text,jsonb,text,uuid[]) from public;
grant execute on function public.community_review_template(uuid,timestamptz,text,jsonb,text,uuid[]) to authenticated;

-- Read the latest decision, including rejection: never search for an older
-- accepted row after a withdrawal. Caller-visible posts are checked by the API.
create function public.community_latest_template_reviews(p_post_ids uuid[])
returns setof public.community_template_reviews language sql stable security definer set search_path='' as $$
  select distinct on(r.post_id) r.* from public.community_template_reviews r
  where cardinality(p_post_ids)<=20 and r.post_id=any(p_post_ids)
  order by r.post_id,r.reviewed_at desc,r.id desc;
$$;
revoke all on function public.community_latest_template_reviews(uuid[]) from public;
grant execute on function public.community_latest_template_reviews(uuid[]) to service_role;

-- Start with selected works, not the newest 20 ordinary posts, otherwise new
-- non-selected experiments would push older qualified templates out of view.
create function public.community_public_template_candidates(p_language text)
returns table(post_id uuid) language sql stable security definer set search_path='' as $$
  select p.id from public.community_posts p
  join public.community_experiments e on e.id=p.experiment_id and e.owner_id=p.owner_id
  join lateral (select r.* from public.community_template_reviews r where r.post_id=p.id order by r.reviewed_at desc,r.id desc limit 1) latest on true
  where p_language in ('zh-CN','en') and p.language=p_language and p.section='workshop' and p.moderation='published' and p.reuse='remix-with-credit'
    and e.validated_at is not null and e.outcome='completed' and latest.decision='accepted'
    and latest.post_version=p.updated_at and latest.experiment_id=e.id
  order by latest.reviewed_at desc,p.id limit 20;
$$;
revoke all on function public.community_public_template_candidates(text) from public;
grant execute on function public.community_public_template_candidates(text) to service_role;
commit;
