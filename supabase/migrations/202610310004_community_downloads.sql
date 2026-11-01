begin;

-- Publicly displayed artwork is readable for preview. Archives and reports
-- require an explicit public download grant, even when callers bypass our API
-- and use the Storage SDK directly. Owners and moderators retain review access.
drop policy community_read_media on storage.objects;
create policy community_read_media on storage.objects for select using (
  bucket_id = 'community-media' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.community_media m
      where m.storage_key = name and m.verified_at is not null and (
        m.kind in ('image','video','audio')
        or public.community_is_moderator()
        or exists (
          select 1 from public.community_post_media pm
          join public.community_posts p on p.id = pm.post_id
          where pm.media_id = m.id and p.moderation = 'published'
            and p.reuse in ('download','remix-with-credit')
        )
      )
    )
  )
);

commit;
