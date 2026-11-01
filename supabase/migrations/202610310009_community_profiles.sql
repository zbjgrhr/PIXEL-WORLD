begin;

alter table public.community_profiles
  add column avatar_media_id uuid references public.community_media(id) on delete set null,
  add column updated_at timestamptz not null default now();

-- Profile changes go through one versioned operation. Official status remains
-- an administrator decision, never a name or a browser-controlled checkbox.
revoke insert(id,display_name), update(display_name) on public.community_profiles from authenticated;

create function public.community_save_profile(p_name text,p_avatar uuid,p_expected timestamptz,p_public_consent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid(); old_profile public.community_profiles; image public.community_media;
begin
  if uid is null then raise exception using errcode='42501',message='Sign in first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,91));
  select * into old_profile from public.community_profiles where id=uid for update;
  if (old_profile.id is null and p_expected is not null)
    or (old_profile.id is not null and (p_expected is null or p_expected<>old_profile.updated_at)) then
    raise exception using errcode='40001',message='Profile changed; reload before saving';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]'
    or p_name ~* '(sk-(or-v1-)?[a-z0-9_-]{20,}|Bearer[[:space:]]+[a-z0-9._~-]{16,}|(api[_ -]?key|access[_ -]?token)["'']?[[:space:]]*[:=])' then
    raise exception using errcode='22023',message='Check the public display name';
  end if;
  if p_avatar is not null then
    select * into image from public.community_media where id=p_avatar for update;
    if image.id is null or image.owner_id<>uid or image.kind<>'image' or image.verified_at is null
      or image.sha256 is null or image.bytes>5000000 or coalesce(image.frame_count,0)<>1
      or coalesce(image.pixel_width,0) not between 1 and 4096 or coalesce(image.pixel_height,0) not between 1 and 4096
      or exists(select 1 from public.community_uploads where media_id=p_avatar and state<>'complete') then
      raise exception using errcode='22023',message='Choose your own verified static image, at most 5 MB and 4096 pixels per side';
    end if;
    if p_avatar is distinct from old_profile.avatar_media_id and not coalesce(p_public_consent,false) then
      raise exception using errcode='22023',message='Confirm publication of the cropped avatar';
    end if;
  end if;
  insert into public.community_profiles(id,display_name,avatar_media_id) values(uid,btrim(p_name),p_avatar)
    on conflict(id) do update set display_name=excluded.display_name,avatar_media_id=excluded.avatar_media_id,
      updated_at=greatest(clock_timestamp(),public.community_profiles.updated_at+interval '1 microsecond')
    returning * into old_profile;
  return to_jsonb(old_profile);
end; $$;
revoke all on function public.community_save_profile(text,uuid,timestamptz,boolean) from public;
grant execute on function public.community_save_profile(text,uuid,timestamptz,boolean) to authenticated;

-- Lock the same media row as profile assignment before permitting byte removal.
-- Clearing the avatar first is required; deleting a post still keeps the file.
create function public.community_guard_avatar_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.state='deleting' and old.state is distinct from new.state and new.media_id is not null then
    perform 1 from public.community_media where id=new.media_id for update;
    if exists(select 1 from public.community_profiles where avatar_media_id=new.media_id) then
      raise exception using errcode='40001',message='Remove this image from your profile before deleting it';
    end if;
  end if;
  return new;
end; $$;
create trigger community_avatar_cleanup before update on public.community_uploads
  for each row execute function public.community_guard_avatar_cleanup();

commit;
