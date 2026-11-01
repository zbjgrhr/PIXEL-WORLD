begin;

-- An imported record describes one evidence snapshot. Text/permissions may be
-- revised and reviewed again; replacing its proof requires a new run/draft.
create function public.community_guard_evidence_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_post uuid; linked_experiment uuid;
begin
  target_post=case when tg_op='DELETE' then old.post_id else new.post_id end;
  select experiment_id into linked_experiment from public.community_posts where id=target_post for update;
  if found and linked_experiment is not null and exists(select 1 from public.community_experiments where id=linked_experiment and validated_at is not null) then
    raise exception using errcode='40001',message='Imported evidence is a snapshot; use a new draft for changed evidence';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger community_evidence_attachment_guard before insert or delete on public.community_post_media
  for each row execute function public.community_guard_evidence_snapshot();
create trigger community_evidence_upload_guard before insert on public.community_uploads
  for each row execute function public.community_guard_evidence_snapshot();

commit;
