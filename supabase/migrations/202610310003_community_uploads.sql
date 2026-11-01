begin;

alter table public.community_media
  add column original_name text check(char_length(original_name) <= 255),
  add column mime_type text,
  add column pixel_width integer check(pixel_width > 0 and pixel_width <= 8192),
  add column pixel_height integer check(pixel_height > 0 and pixel_height <= 8192),
  add column frame_count integer check(frame_count > 0 and frame_count <= 1000);
-- Only trusted verification can create/delete file records. Players cannot drop
-- a verified row to make its stored bytes disappear from the quota calculation.
revoke insert,delete on public.community_media from authenticated;
revoke insert(owner_id,run_id,kind,storage_key,bytes) on public.community_media from authenticated;

create table public.community_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete set null,
  section text not null check(section in ('workshop','art')),
  language text not null check(language in ('zh-CN','en')),
  experiment_id uuid,
  original_name text not null check(char_length(original_name) between 1 and 255),
  mime_type text not null,
  kind text not null check(kind in ('image','video','audio','game-zip','game-spec','report')),
  declared_bytes bigint not null check(declared_bytes between 1 and 45000000),
  storage_key text not null unique,
  state text not null default 'reserved' check(state in ('reserved','verifying','complete','deleting','deleted','failed')),
  media_id uuid references public.community_media(id) on delete restrict,
  failure_code text check(char_length(failure_code) <= 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 minutes',
  foreign key(experiment_id,owner_id) references public.community_experiments(id,owner_id),
  check(storage_key like owner_id::text || '/%' and storage_key !~ '\.\.' and storage_key ~ '^[a-zA-Z0-9_./-]+$')
);
alter table public.community_uploads enable row level security;
revoke all on public.community_uploads from anon,authenticated;
grant select on public.community_uploads to authenticated;
grant all on public.community_uploads to service_role;
create policy uploads_read_self on public.community_uploads for select to authenticated using(owner_id=(select auth.uid()));
create index community_uploads_owner on public.community_uploads(owner_id,created_at desc);

create function public.community_reserve_upload(p_post_id uuid,p_expected_version timestamptz,p_name text,p_mime text,p_kind text,p_extension text,p_bytes bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.community_posts; u public.community_uploads; used bigint; own_used bigint; pending integer; uid uuid=auth.uid();
begin
  if uid is null then raise exception using errcode='42501',message='Sign in first'; end if;
  if p_name is null or char_length(p_name) not between 1 and 255 or position('/' in p_name)>0 or position(chr(92) in p_name)>0 or p_name ~ '[[:cntrl:]]'
    or p_bytes is null or p_bytes not between 1 and 45000000 or p_extension is null or lower(regexp_replace(p_name,'^.*\.',''))<>p_extension then raise exception using errcode='22023',message='Invalid file metadata'; end if;
  if not coalesce((p_kind='image' and ((p_extension='png' and p_mime='image/png') or (p_extension in ('jpg','jpeg') and p_mime='image/jpeg') or (p_extension='webp' and p_mime='image/webp') or (p_extension='gif' and p_mime='image/gif')))
    or (p_kind='video' and ((p_extension='mp4' and p_mime='video/mp4') or (p_extension='webm' and p_mime='video/webm')))
    or (p_kind='audio' and ((p_extension='mp3' and p_mime='audio/mpeg') or (p_extension='wav' and p_mime in ('audio/wav','audio/x-wav')) or (p_extension='ogg' and p_mime='audio/ogg')))
    or (p_kind='game-zip' and p_extension='zip' and p_mime in ('application/zip','application/x-zip-compressed'))
    or (p_kind='game-spec' and p_extension='json' and p_mime='application/json')
    or (p_kind='report' and ((p_extension='md' and p_mime in ('text/markdown','text/plain')) or (p_extension in ('txt','log') and p_mime='text/plain'))),false) then raise exception using errcode='22023',message='Unsupported file type'; end if;
  perform pg_advisory_xact_lock(736902101);
  select * into p from public.community_posts where id=p_post_id and owner_id=uid for update;
  if not found then raise exception using errcode='42501',message='Post not available'; end if;
  if p.moderation<>'draft' or p.updated_at is distinct from p_expected_version then raise exception using errcode='40001',message='Save the latest draft before uploading'; end if;
  if p.section='art' and p_kind not in ('image','video','audio') then raise exception using errcode='22023',message='Artwork accepts media only'; end if;
  if (select count(*) from public.community_post_media where post_id=p.id)>=30 then raise exception using errcode='53000',message='Attachment limit reached'; end if;
  select count(*) into pending from public.community_uploads where owner_id=uid and media_id is null and state in ('reserved','verifying','deleting');
  if pending>=2 then raise exception using errcode='53000',message='Finish or cancel pending uploads'; end if;
  -- Reserve the full maximum for every unfinished upload, not an untrusted
  -- claimed byte count. Expired tickets retain their reservation until cleanup.
  select coalesce(sum(bytes),0) into used from public.community_media where verified_at is not null;
  used=used+(select count(*)*45000000 from public.community_uploads where media_id is null and state in ('reserved','verifying','deleting'));
  select coalesce(sum(bytes),0) into own_used from public.community_media where verified_at is not null and owner_id=uid;
  own_used=own_used+pending*45000000;
  if used+45000000>850000000 or own_used+45000000>300000000 then raise exception using errcode='53000',message='Community storage limit reached'; end if;
  u.id=gen_random_uuid();
  insert into public.community_uploads(id,owner_id,post_id,section,language,experiment_id,original_name,mime_type,kind,declared_bytes,storage_key)
    values(u.id,uid,p.id,p.section,p.language,p.experiment_id,p_name,p_mime,p_kind,p_bytes,uid::text || '/' || u.id::text || '.' || p_extension) returning * into u;
  return to_jsonb(u);
end;
$$;
revoke all on function public.community_reserve_upload(uuid,timestamptz,text,text,text,text,bigint) from public;
grant execute on function public.community_reserve_upload(uuid,timestamptz,text,text,text,text,bigint) to authenticated;

create function public.community_can_upload(p_key text) returns boolean
language plpgsql security definer set search_path='' as $$
declare u public.community_uploads;
begin
  if auth.uid() is null then return false; end if;
  -- Serialize object insertion with verification/cancellation of this ticket.
  select * into u from public.community_uploads where storage_key=p_key and owner_id=auth.uid() for update;
  return found and u.state='reserved' and u.expires_at>now();
end;
$$;
revoke all on function public.community_can_upload(text) from public;
grant execute on function public.community_can_upload(text) to authenticated;
drop policy community_upload_own on storage.objects;
create policy community_upload_reserved on storage.objects for insert to authenticated with check(bucket_id='community-media' and public.community_can_upload(name));
drop policy community_delete_unused_own on storage.objects;
create policy community_delete_cancelled on storage.objects for delete to authenticated using(bucket_id='community-media'
  and exists(select 1 from public.community_uploads u where u.storage_key=name and u.owner_id=(select auth.uid()) and u.state='deleting'));

create function public.community_begin_verify(p_upload_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.community_uploads;
begin
  select * into u from public.community_uploads where id=p_upload_id and owner_id=auth.uid() for update;
  if not found then raise exception using errcode='42501',message='Upload not available'; end if;
  if u.state='complete' then return to_jsonb(u); end if;
  if u.state<>'reserved' or u.expires_at<=now() then raise exception using errcode='40001',message='Upload changed or expired'; end if;
  update public.community_uploads set state='verifying' where id=u.id returning * into u;
  return to_jsonb(u);
end;
$$;
revoke all on function public.community_begin_verify(uuid) from public;
grant execute on function public.community_begin_verify(uuid) to authenticated;

create or replace function public.community_guard_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.community_posts; m public.community_media;
begin
  select * into p from public.community_posts where id=new.post_id;
  select * into m from public.community_media where id=new.media_id;
  if p.id is null or m.id is null or (coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or p.owner_id<>auth.uid()))
    or m.owner_id<>p.owner_id or p.moderation<>'draft' or (p.experiment_id is not null and m.run_id is distinct from p.experiment_id)
    or (p.section='art' and m.kind not in ('image','video','audio')) then raise exception 'Invalid attachment ownership or post state'; end if;
  return new;
end;
$$;

create function public.community_commit_upload(p_upload_id uuid,p_owner uuid,p_bytes bigint,p_kind text,p_sha256 text,p_duration double precision,p_width integer,p_height integer,p_frames integer,p_work_language text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.community_uploads; p public.community_posts; m public.community_media;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Trusted verification required'; end if;
  perform pg_advisory_xact_lock(736902101);
  select * into u from public.community_uploads where id=p_upload_id and owner_id=p_owner for update;
  if not found then raise exception using errcode='42501',message='Upload not available'; end if;
  if u.state='complete' then select * into m from public.community_media where id=u.media_id; return to_jsonb(m); end if;
  if u.state<>'verifying' then raise exception using errcode='40001',message='Upload state changed'; end if;
  select * into p from public.community_posts where id=u.post_id and owner_id=p_owner for update;
  if not found or p.moderation<>'draft' or p.section<>u.section or p.language<>u.language or p.experiment_id is distinct from u.experiment_id then raise exception using errcode='40001',message='Target draft changed'; end if;
  if p_bytes is distinct from u.declared_bytes or p_kind is distinct from u.kind or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
    or (p_work_language is not null and p_work_language<>p.language) then raise exception using errcode='22023',message='File verification does not match draft'; end if;
  if not exists(select 1 from storage.objects where bucket_id='community-media' and name=u.storage_key) then raise exception using errcode='22023',message='Stored object missing'; end if;
  if (select count(*) from public.community_post_media where post_id=p.id)>=30 then raise exception using errcode='53000',message='Attachment limit reached'; end if;
  insert into public.community_media(id,owner_id,run_id,kind,storage_key,bytes,sha256,duration_seconds,verified_at,original_name,mime_type,pixel_width,pixel_height,frame_count)
    values(u.id,p_owner,u.experiment_id,p_kind,u.storage_key,p_bytes,p_sha256,p_duration,now(),u.original_name,u.mime_type,p_width,p_height,p_frames) returning * into m;
  insert into public.community_post_media(post_id,media_id) values(p.id,m.id);
  update public.community_uploads set state='complete',media_id=m.id where id=u.id;
  update public.community_posts set updated_at=now() where id=p.id;
  return to_jsonb(m);
end;
$$;
revoke all on function public.community_commit_upload(uuid,uuid,bigint,text,text,double precision,integer,integer,integer,text) from public;
grant execute on function public.community_commit_upload(uuid,uuid,bigint,text,text,double precision,integer,integer,integer,text) to service_role;

create function public.community_begin_upload_delete(p_upload_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.community_uploads;
begin
  perform pg_advisory_xact_lock(736902101);
  select * into u from public.community_uploads where id=p_upload_id and owner_id=auth.uid() for update;
  if not found then raise exception using errcode='42501',message='Upload not available'; end if;
  if u.media_id is not null and exists(select 1 from public.community_post_media where media_id=u.media_id) then raise exception using errcode='40001',message='File is still attached to a post'; end if;
  if u.state in ('deleted','failed') then return to_jsonb(u); end if;
  update public.community_uploads set state='deleting' where id=u.id returning * into u;
  return to_jsonb(u);
end;
$$;
revoke all on function public.community_begin_upload_delete(uuid) from public;
grant execute on function public.community_begin_upload_delete(uuid) to authenticated;

create function public.community_finish_upload_delete(p_upload_id uuid,p_owner uuid,p_failure_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare u public.community_uploads;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception using errcode='42501',message='Trusted cleanup required'; end if;
  perform pg_advisory_xact_lock(736902101);
  select * into u from public.community_uploads where id=p_upload_id and owner_id=p_owner for update;
  if not found then raise exception using errcode='42501',message='Upload not available'; end if;
  if u.state in ('deleted','failed') then return true; end if;
  if u.state<>'deleting' or exists(select 1 from storage.objects where bucket_id='community-media' and name=u.storage_key) then raise exception using errcode='40001',message='Stored bytes still need cleanup'; end if;
  if p_failure_code is not null and p_failure_code not in ('INVALID_CONTENT','TYPE_MISMATCH','LIMIT_EXCEEDED','PRIVATE_CONTENT','INVALID_ARCHIVE','DRAFT_CHANGED','UPLOAD_FAILED') then raise exception using errcode='22023',message='Invalid cleanup code'; end if;
  if u.media_id is not null and exists(select 1 from public.community_post_media where media_id=u.media_id) then raise exception using errcode='40001',message='File is still attached'; end if;
  update public.community_uploads set media_id=null where id=u.id;
  if u.media_id is not null then delete from public.community_media where id=u.media_id; end if;
  update public.community_uploads set state=case when p_failure_code is null then 'deleted' else 'failed' end,failure_code=p_failure_code where id=u.id;
  return true;
end;
$$;
revoke all on function public.community_finish_upload_delete(uuid,uuid,text) from public;
grant execute on function public.community_finish_upload_delete(uuid,uuid,text) to service_role;
commit;
