begin;

alter table public.community_posts
  add column art_kind text not null default 'other' check(art_kind in ('character','scene','effect','screenshot','video','audio','other')),
  add column linked_game_id uuid,
  add constraint community_artwork_fields check(section='art' or (art_kind='other' and linked_game_id is null));
grant insert(art_kind,linked_game_id),update(art_kind,linked_game_id) on public.community_posts to authenticated;

-- This is a provenance reference, deliberately not a cascading foreign key:
-- deleting a game must not delete or silently unpublish someone else's artwork.
-- Lookups expose only currently published games; a removed reference is unavailable.
create function public.community_guard_artwork() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.linked_game_id is not null and (tg_op='INSERT' or new.linked_game_id is distinct from old.linked_game_id) then
    if new.section<>'art' or not exists(select 1 from public.community_posts p where p.id=new.linked_game_id and p.section='workshop' and p.moderation='published') then
      raise exception using errcode='22023',message='Select a published workshop game';
    end if;
  end if;
  if tg_op='UPDATE' and row(new.art_kind,new.linked_game_id) is distinct from row(old.art_kind,old.linked_game_id) and old.moderation<>'draft' then
    new.moderation='pending';
  end if;
  return new;
end;
$$;
create trigger community_artwork_guard before insert or update on public.community_posts
  for each row execute function public.community_guard_artwork();
create index community_artwork_category on public.community_posts(art_kind,created_at desc) where section='art' and moderation='published';

commit;
