-- KB-107: broaden shops_select so an owner can see their own shop even
-- before their shop_members row exists.
--
-- KB-104's original shops_select (`using (is_shop_member(id))`) made an
-- orphaned shop - the row exists (shops_insert succeeded) but the
-- following shop_members bootstrap insert never completed - permanently
-- invisible to its own owner. Harmless as a momentary artifact during a
-- successful bootstrap (KB-104's own smoke test observed it: "shop A
-- insert" read back as 0 rows for an instant), but a real dead end during
-- a FAILED one: KB-107's createShop() resume logic needs to detect and
-- resume exactly this state, and couldn't see it at all under the old
-- policy.
--
-- owner_user_id = auth.uid() does not create a new way to claim or see a
-- shop - shops_insert already requires exactly this same condition to
-- create the row in the first place. This only lets an already-true fact
-- (you are recorded as this shop's owner) also grant read access to it,
-- closing the blind spot rather than opening a new one. See
-- docs/07-DECISIONS.md D20.

drop policy shops_select on shops;

create policy shops_select on shops for select
  using (is_shop_member(id) or owner_user_id = auth.uid());
