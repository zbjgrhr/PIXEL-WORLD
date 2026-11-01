begin;

-- Serialize attachment creation with file cleanup and post submission. A file
-- already marked for deletion cannot be reattached while its bytes disappear.
create or replace function public.community_guard_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.community_posts; m public.community_media; upload_state text;
begin
  select * into m from public.community_media where id=new.media_id;
  select state into upload_state from public.community_uploads where id=new.media_id or media_id=new.media_id for update;
  if found and upload_state<>'complete' and not (coalesce(auth.role(),'')='service_role' and upload_state='verifying') then
    raise exception using errcode='40001',message='File is not available for attachment';
  end if;
  select * into p from public.community_posts where id=new.post_id for update;
  if p.id is null or m.id is null or (coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or p.owner_id<>auth.uid()))
    or m.owner_id<>p.owner_id or p.moderation<>'draft' or (p.experiment_id is not null and m.run_id is distinct from p.experiment_id)
    or (p.section='art' and m.kind not in ('image','video','audio')) then raise exception 'Invalid attachment ownership or post state'; end if;
  return new;
end;
$$;

create function public.community_withdraw_post(p_post_id uuid,p_expected_version timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.community_posts;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sign in first'; end if;
  select * into p from public.community_posts where id=p_post_id and owner_id=auth.uid() for update;
  if not found then raise exception using errcode='42501',message='Post not available'; end if;
  if p.updated_at is distinct from p_expected_version or p.moderation='draft' then raise exception using errcode='40001',message='Post changed; reload before withdrawal'; end if;
  update public.community_posts set moderation='draft' where id=p.id returning * into p;
  return to_jsonb(p);
end;
$$;
revoke all on function public.community_withdraw_post(uuid,timestamptz) from public;
grant execute on function public.community_withdraw_post(uuid,timestamptz) to authenticated;

-- Definer access is limited to the owner's locked draft and its exact link.
-- The file and its verified metadata remain intact, including quota usage.
create function public.community_detach_media(p_post_id uuid,p_expected_version timestamptz,p_media_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.community_posts;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sign in first'; end if;
  select * into p from public.community_posts where id=p_post_id and owner_id=auth.uid() for update;
  if not found then raise exception using errcode='42501',message='Post not available'; end if;
  if p.updated_at is distinct from p_expected_version or p.moderation<>'draft' then raise exception using errcode='40001',message='Draft changed; reload before removing attachment'; end if;
  delete from public.community_post_media where post_id=p.id and media_id=p_media_id;
  if not found then raise exception using errcode='40001',message='Attachment changed'; end if;
  update public.community_uploads set post_id=null where owner_id=auth.uid() and media_id=p_media_id
    and not exists(select 1 from public.community_post_media pm where pm.media_id=p_media_id);
  update public.community_posts set updated_at=now() where id=p.id returning * into p;
  return to_jsonb(p);
end;
$$;
revoke all on function public.community_detach_media(uuid,timestamptz,uuid) from public;
grant execute on function public.community_detach_media(uuid,timestamptz,uuid) to authenticated;

commit;
