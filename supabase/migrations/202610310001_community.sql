-- Run once on the user's Supabase project. Not applied to any cloud project yet.
begin;

create table public.community_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 80),
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.community_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.community_moderators enable row level security;
revoke all on public.community_moderators from anon, authenticated;

create function public.community_is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.community_moderators where user_id = auth.uid());
$$;
revoke all on function public.community_is_moderator() from public;
grant execute on function public.community_is_moderator() to anon, authenticated, service_role;

create table public.community_experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  language text not null check (language in ('zh-CN', 'en')),
  outcome text not null check (outcome in ('completed', 'partial', 'failed')),
  record jsonb not null default '{}'::jsonb check (jsonb_typeof(record) = 'object'),
  created_at timestamptz not null default now(),
  unique(id, owner_id)
);

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section text not null check (section in ('workshop', 'art')),
  language text not null check (language in ('zh-CN', 'en')),
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 10000),
  experiment_id uuid,
  rights text not null check (rights in ('original', 'ai-generated', 'licensed')),
  license_note text not null default '' check (char_length(license_note) <= 2000),
  reuse text not null default 'view-only' check (reuse in ('view-only', 'download', 'remix-with-credit')),
  moderation text not null default 'draft' check (moderation in ('draft', 'pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (experiment_id, owner_id) references public.community_experiments(id, owner_id),
  check (rights <> 'licensed' or char_length(btrim(license_note)) > 0)
);

create table public.community_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_id uuid,
  kind text not null check (kind in ('image', 'video', 'audio', 'game-zip', 'game-spec', 'report')),
  storage_key text not null unique,
  bytes bigint not null check (bytes between 1 and 45000000),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  duration_seconds double precision check (duration_seconds >= 0 and duration_seconds < 'Infinity'::float8),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (run_id, owner_id) references public.community_experiments(id, owner_id),
  check (storage_key like owner_id::text || '/%' and storage_key !~ '\.\.' and storage_key ~ '^[a-zA-Z0-9_./-]+$')
);

create table public.community_post_media (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  media_id uuid not null references public.community_media(id) on delete restrict,
  primary key(post_id, media_id)
);

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique(reporter_id, post_id)
);

create index community_posts_feed on public.community_posts(section, created_at desc) where moderation = 'published';
create index community_posts_owner on public.community_posts(owner_id, created_at desc);
create index community_media_owner on public.community_media(owner_id);

-- Defence in depth for direct Data API calls, not just the Next.js interface.
create function public.community_guard_post() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.title || E'\n' || new.description || E'\n' || new.license_note) ~*
    '(sk-(or-v1-)?[a-z0-9_-]{20,}|Bearer[[:space:]]+[a-z0-9._~-]{16,}|(api[_ -]?key|access[_ -]?token|service[_ -]?role[_ -]?key)["'']?[[:space:]]*[:=][[:space:]]*["'']?[a-z0-9._~-]{8,})' then
    raise exception 'Remove credentials before submitting content';
  end if;
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id or new.id <> old.id then raise exception 'Post identity is immutable'; end if;
    new.updated_at = now();
    if not public.community_is_moderator() and coalesce(auth.role(), '') <> 'service_role' then
      if new.moderation not in ('draft', 'pending') and new.moderation <> old.moderation then raise exception 'Moderator approval required'; end if;
      if row(new.title,new.description,new.rights,new.license_note,new.reuse,new.language,new.section,new.experiment_id)
        is distinct from row(old.title,old.description,old.rights,old.license_note,old.reuse,old.language,old.section,old.experiment_id) then
        new.moderation = case when old.moderation = 'draft' then 'draft' else 'pending' end;
      end if;
    end if;
  elsif new.moderation not in ('draft','pending') and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'New posts need review';
  end if;
  if new.moderation in ('pending','published') then
    if exists(select 1 from public.community_post_media pm join public.community_media m on m.id = pm.media_id
      where pm.post_id = new.id and (m.owner_id <> new.owner_id or m.verified_at is null or m.sha256 is null
        or (new.section = 'art' and m.kind not in ('image','video','audio'))
        or (new.experiment_id is not null and m.run_id is distinct from new.experiment_id))) then
      raise exception 'Attachments are unverified or belong to another experiment';
    end if;
  end if;
  return new;
end;
$$;
create trigger community_post_guard before insert or update on public.community_posts for each row execute function public.community_guard_post();

-- Attachment edits require a draft, so a published post cannot acquire an unchecked file.
create function public.community_guard_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.community_posts; m public.community_media;
begin
  select * into p from public.community_posts where id = new.post_id;
  select * into m from public.community_media where id = new.media_id;
  if p.id is null or m.id is null or p.owner_id <> auth.uid() or m.owner_id <> p.owner_id or p.moderation <> 'draft'
    or (p.experiment_id is not null and m.run_id is distinct from p.experiment_id)
    or (p.section = 'art' and m.kind not in ('image','video','audio')) then raise exception 'Invalid attachment ownership or post state'; end if;
  return new;
end;
$$;
create trigger community_attachment_guard before insert or update on public.community_post_media for each row execute function public.community_guard_attachment();

alter table public.community_profiles enable row level security;
alter table public.community_experiments enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_media enable row level security;
alter table public.community_post_media enable row level security;
alter table public.community_reports enable row level security;

revoke all on public.community_profiles, public.community_experiments, public.community_posts, public.community_media, public.community_post_media, public.community_reports from anon, authenticated;
grant select on public.community_profiles, public.community_posts, public.community_media, public.community_post_media to anon, authenticated;
grant insert(id,display_name), update(display_name) on public.community_profiles to authenticated;
grant select, insert, update, delete on public.community_experiments to authenticated;
grant insert(owner_id,section,language,title,description,experiment_id,rights,license_note,reuse), delete on public.community_posts to authenticated;
grant update(section,language,title,description,experiment_id,rights,license_note,reuse,moderation) on public.community_posts to authenticated;
-- Only trusted server upload verification can assign a hash or verified_at.
grant insert(owner_id,run_id,kind,storage_key,bytes), delete on public.community_media to authenticated;
grant insert, delete on public.community_post_media to authenticated;
grant select, insert(reporter_id,post_id,reason) on public.community_reports to authenticated;
grant update(status) on public.community_reports to authenticated;
grant all on public.community_profiles, public.community_moderators, public.community_experiments, public.community_posts, public.community_media, public.community_post_media, public.community_reports to service_role;

create policy profiles_read on public.community_profiles for select using(true);
create policy profiles_create_self on public.community_profiles for insert to authenticated with check(id = (select auth.uid()));
create policy profiles_edit_self on public.community_profiles for update to authenticated using(id = (select auth.uid())) with check(id = (select auth.uid()));
create policy experiments_owner on public.community_experiments for all to authenticated using(owner_id = (select auth.uid())) with check(owner_id = (select auth.uid()));
create policy posts_read on public.community_posts for select using(moderation = 'published' or owner_id = (select auth.uid()) or public.community_is_moderator());
create policy posts_create_self on public.community_posts for insert to authenticated with check(owner_id = (select auth.uid()) and moderation = 'draft');
create policy posts_edit_self on public.community_posts for update to authenticated using(owner_id = (select auth.uid()) or public.community_is_moderator()) with check(owner_id = (select auth.uid()) or public.community_is_moderator());
create policy posts_delete_self on public.community_posts for delete to authenticated using(owner_id = (select auth.uid()) or public.community_is_moderator());
create policy media_read on public.community_media for select using(owner_id = (select auth.uid()) or public.community_is_moderator() or (verified_at is not null and exists(select 1 from public.community_post_media pm join public.community_posts p on p.id = pm.post_id where pm.media_id = community_media.id and p.moderation = 'published')));
create policy media_create_self on public.community_media for insert to authenticated with check(owner_id = (select auth.uid()) and verified_at is null and sha256 is null);
create policy media_delete_self on public.community_media for delete to authenticated using(owner_id = (select auth.uid()));
create policy attachments_read on public.community_post_media for select using(exists(select 1 from public.community_posts p where p.id = post_id));
create policy attachments_create_self on public.community_post_media for insert to authenticated with check(exists(select 1 from public.community_posts p where p.id = post_id and p.owner_id = (select auth.uid()) and p.moderation = 'draft'));
create policy attachments_delete_self on public.community_post_media for delete to authenticated using(exists(select 1 from public.community_posts p where p.id = post_id and p.owner_id = (select auth.uid()) and p.moderation = 'draft'));
create policy reports_create_self on public.community_reports for insert to authenticated with check(reporter_id = (select auth.uid()) and status = 'open'
  and exists(select 1 from public.community_posts p where p.id = post_id and p.moderation = 'published'));
create policy reports_read_self on public.community_reports for select to authenticated using(reporter_id = (select auth.uid()) or public.community_is_moderator());
create policy reports_moderator_update on public.community_reports for update to authenticated using(public.community_is_moderator()) with check(public.community_is_moderator());

-- Private bucket: publication is governed by signed/authorized reads, not public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('community-media','community-media',false,45000000,array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','audio/mpeg','audio/wav','audio/x-wav','audio/ogg','application/zip','application/x-zip-compressed','application/json','text/markdown','text/plain']);
create policy community_upload_own on storage.objects for insert to authenticated with check(bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No UPDATE policy: an already verified object cannot be overwritten with other bytes.
create policy community_read_media on storage.objects for select using(bucket_id = 'community-media' and (
  (storage.foldername(name))[1] = (select auth.uid())::text or exists(select 1 from public.community_media m where m.storage_key = name and m.verified_at is not null)));
create policy community_delete_unused_own on storage.objects for delete to authenticated using(bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists(select 1 from public.community_media m join public.community_post_media pm on pm.media_id = m.id where m.storage_key = name));

commit;
