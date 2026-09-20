-- KB-107b: Supabase Storage bucket + storage.objects RLS policies for
-- shop logo uploads. Schema/security surface only - the actual upload UI
-- is KB-107b's own remaining work, not this migration.
--
-- Public-read bucket: a shop's logo needs to render as a plain <img src>
-- on the receipt and in the app UI without a signed-URL round trip for
-- every render, and a logo carries no sensitive information by itself.
-- Every WRITE (insert/update/delete) is gated by shop membership, keyed
-- off the object path's first folder segment (expected convention:
-- "{shop_id}/logo...") via storage.foldername() - the standard Supabase
-- per-folder access-control pattern, not invented here.
--
-- is_shop_member() (public schema, KB-104) is called fully-qualified
-- (public.is_shop_member(...)) since these policies live on
-- storage.objects, outside the public schema's default search_path.

insert into storage.buckets (id, name, public)
values ('shop-logos', 'shop-logos', true)
on conflict (id) do nothing;

create policy shop_logos_select on storage.objects for select
  to public
  using (bucket_id = 'shop-logos');

create policy shop_logos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'shop-logos'
    and public.is_shop_member((storage.foldername(name))[1]::uuid)
  );

create policy shop_logos_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'shop-logos'
    and public.is_shop_member((storage.foldername(name))[1]::uuid)
  );

create policy shop_logos_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'shop-logos'
    and public.is_shop_member((storage.foldername(name))[1]::uuid)
  );
