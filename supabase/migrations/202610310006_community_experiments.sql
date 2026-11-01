begin;

alter table public.community_experiments add column validated_at timestamptz;
-- Imported records are immutable snapshots. No direct client write may forge
-- evidence ownership, change language after review, or accept its own template.
revoke insert,update,delete on public.community_experiments from authenticated;
create policy experiments_moderator_read on public.community_experiments for select to authenticated using(public.community_is_moderator());

create function public.community_import_experiment(p_owner uuid,p_post_id uuid,p_expected_version timestamptz,p_record jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.community_posts; imported_id uuid; linked_ids jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Trusted import required'; end if;
  select * into p from public.community_posts where id=p_post_id and owner_id=p_owner for update;
  if not found then raise exception using errcode='42501',message='Draft not available'; end if;
  if p.updated_at is distinct from p_expected_version or p.moderation<>'draft' or p.section<>'workshop' or p.experiment_id is not null then
    raise exception using errcode='40001',message='Draft changed; import needs an unlinked workshop draft';
  end if;
  if p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>64000
    or p_record->>'ownerId' is distinct from p_owner::text or p_record->>'language' is distinct from p.language
    or coalesce(p_record->>'outcome','') not in ('completed','partial','failed')
    or p_record->'templateReview' is distinct from '{"state":"not-reviewed","reviewerId":null,"reviewedAt":null}'::jsonb
    or jsonb_typeof(p_record->'mediaIds') is distinct from 'array' then
    raise exception using errcode='22023',message='Invalid canonical experiment';
  end if;
  imported_id=(p_record->>'id')::uuid;
  if imported_id is null then raise exception using errcode='22023',message='Missing experiment identity'; end if;
  if exists(select 1 from public.community_post_media pm join public.community_media m on m.id=pm.media_id
    where pm.post_id=p.id and (m.owner_id<>p_owner or m.run_id is not null or m.verified_at is null or m.sha256 !~ '^[a-f0-9]{64}$' or m.sha256 is null)) then
    raise exception using errcode='22023',message='Attachments are not available for this experiment';
  end if;
  select coalesce(jsonb_agg(media_id::text order by media_id::text),'[]'::jsonb) into linked_ids from public.community_post_media where post_id=p.id;
  if jsonb_array_length(linked_ids)>30 or linked_ids is distinct from (select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from jsonb_array_elements_text(p_record->'mediaIds')) then
    raise exception using errcode='22023',message='Experiment attachments changed';
  end if;
  insert into public.community_experiments(id,owner_id,language,outcome,record,validated_at)
    values(imported_id,p_owner,p.language,p_record->>'outcome',p_record,now());
  update public.community_media set run_id=imported_id where id in(select media_id from public.community_post_media where post_id=p.id);
  update public.community_posts set experiment_id=imported_id where id=p.id returning * into p;
  return to_jsonb(p);
end;
$$;
revoke all on function public.community_import_experiment(uuid,uuid,timestamptz,jsonb) from public;
grant execute on function public.community_import_experiment(uuid,uuid,timestamptz,jsonb) to service_role;

commit;
