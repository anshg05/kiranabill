


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."bill_items_enforce_immutability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  parent_status text;
  affected_bill_id uuid := coalesce(new.bill_id, old.bill_id);
begin
  select status into parent_status from bills where id = affected_bill_id;

  if parent_status in ('final', 'cancelled') then
    raise exception 'bill_items: cannot add, change, or remove a line item on a % bill (bill_id=%)', parent_status, affected_bill_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."bill_items_enforce_immutability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bills_enforce_immutability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if old.status = 'cancelled' then
    raise exception 'bills: a cancelled bill can never be modified (id=%)', old.id;
  end if;

  if old.status = 'final' then
    if new.status is distinct from 'cancelled' then
      raise exception 'bills: a finalised bill may only transition to cancelled, not to % (id=%)', new.status, old.id;
    end if;

    -- Every column except status must stay byte-identical. Compared via a
    -- jsonb diff of the whole row (minus status), not an explicit column
    -- list - a jsonb list is forced through this check automatically the
    -- moment it exists on the table, so a future column added to bills
    -- can't silently bypass the check by the trigger simply not mentioning
    -- it (the original explicit-list version had exactly that unguarded
    -- gap - see docs/07-DECISIONS.md D18).
    --
    -- jsonb equality can be a footgun for float columns (e.g. distinct
    -- numeric representations of the same value comparing unequal as
    -- jsonb text) - doesn't apply here: every column on bills is
    -- uuid/text/bigint/int/timestamptz, never float or unconstrained
    -- numeric, so this comparison is judged safe for THIS table
    -- specifically, not assumed safe for jsonb diffs in general.
    if (to_jsonb(old) - 'status') is distinct from (to_jsonb(new) - 'status') then
      raise exception 'bills: cancelling a finalised bill may only change status - every other column must stay identical (id=%)', old.id;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."bills_enforce_immutability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."copy_base_catalog"("p_shop_id" "uuid", "p_device_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into shop_products (
    id, shop_id, base_product_id, display_name, category, unit,
    price_paise, aliases, source, local_id, device_id
  )
  select
    gen_random_uuid(), p_shop_id, bp.id, bp.display_name, bp.source_category, bp.default_unit,
    bp.suggested_price_paise, bp.aliases, 'base', gen_random_uuid(), p_device_id
  from base_products bp
  where bp.is_active;
end;
$$;


ALTER FUNCTION "public"."copy_base_catalog"("p_shop_id" "uuid", "p_device_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_shop_member"("check_shop_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from shop_members
    where shop_id = check_shop_id
      and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_shop_member"("check_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_shop_owner"("check_shop_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from shop_members
    where shop_id = check_shop_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;


ALTER FUNCTION "public"."is_shop_owner"("check_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."owns_shop"("check_shop_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from shops
    where id = check_shop_id
      and owner_user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."owns_shop"("check_shop_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."base_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "catalog_version" integer NOT NULL,
    "display_name" "text" NOT NULL,
    "source_category" "text",
    "guard_category" "text" NOT NULL,
    "default_unit" "text" NOT NULL,
    "suggested_price_paise" bigint NOT NULL,
    "aliases" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "base_products_guard_category_check" CHECK (("guard_category" = ANY (ARRAY['dal'::"text", 'oil'::"text", 'masala'::"text", 'tea'::"text", 'grain'::"text", 'soap'::"text", 'hygiene'::"text", 'dairy'::"text", 'snack'::"text", 'sweet'::"text", 'beverage'::"text", 'condiment'::"text", 'dryfruit'::"text", 'household'::"text", 'medicine'::"text", 'other'::"text"]))),
    CONSTRAINT "base_products_suggested_price_paise_check" CHECK (("suggested_price_paise" > 0))
);


ALTER TABLE "public"."base_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "line_no" integer NOT NULL,
    "shop_product_id" "uuid",
    "display_name" "text" NOT NULL,
    "spoken_name" "text",
    "qty" numeric(12,3),
    "unit" "text",
    "rate_paise" bigint,
    "total_paise" bigint NOT NULL,
    "price_type" "text" NOT NULL,
    "source" "text" NOT NULL,
    "review_flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "was_edited" boolean DEFAULT false NOT NULL,
    CONSTRAINT "bill_items_price_type_check" CHECK (("price_type" = ANY (ARRAY['rate'::"text", 'total'::"text", 'default'::"text", 'unknown'::"text"]))),
    CONSTRAINT "bill_items_rate_paise_check" CHECK (("rate_paise" >= 0)),
    CONSTRAINT "bill_items_source_check" CHECK (("source" = ANY (ARRAY['voice'::"text", 'fastpath'::"text", 'manual'::"text"]))),
    CONSTRAINT "bill_items_total_paise_check" CHECK (("total_paise" >= 0))
);


ALTER TABLE "public"."bill_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "local_id" "uuid" NOT NULL,
    "receipt_number" "text" NOT NULL,
    "customer_name" "text" DEFAULT 'Cash'::"text" NOT NULL,
    "customer_mobile" "text",
    "subtotal_paise" bigint NOT NULL,
    "total_paise" bigint NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "schema_version" integer NOT NULL,
    "device_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finalized_at" timestamp with time zone,
    "synced_at" timestamp with time zone,
    CONSTRAINT "bills_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'final'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "bills_subtotal_paise_check" CHECK (("subtotal_paise" >= 0)),
    CONSTRAINT "bills_total_paise_check" CHECK (("total_paise" >= 0))
);


ALTER TABLE "public"."bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learned_aliases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "alias" "text" NOT NULL,
    "shop_product_id" "uuid" NOT NULL,
    "hit_count" integer DEFAULT 0 NOT NULL,
    "confidence" numeric(3,2) NOT NULL,
    "source" "text" NOT NULL,
    "local_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learned_aliases_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "learned_aliases_source_check" CHECK (("source" = ANY (ARRAY['correction'::"text", 'confirmation'::"text"])))
);


ALTER TABLE "public"."learned_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "bill_id" "uuid",
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."learning_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_observations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "shop_product_id" "uuid" NOT NULL,
    "observed_price_paise" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "local_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "price_observations_observed_price_paise_check" CHECK (("observed_price_paise" > 0))
);


ALTER TABLE "public"."price_observations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provisional_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "spoken_name" "text" NOT NULL,
    "seen_count" integer DEFAULT 0 NOT NULL,
    "suggested_unit" "text",
    "suggested_price_paise" bigint,
    "promoted_at" timestamp with time zone,
    "promoted_shop_product_id" "uuid",
    "local_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provisional_products_suggested_price_paise_check" CHECK (("suggested_price_paise" > 0))
);


ALTER TABLE "public"."provisional_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipt_number_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "block_start" integer NOT NULL,
    "block_end" integer NOT NULL,
    "next_number" integer NOT NULL,
    "allocated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."receipt_number_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_members" (
    "shop_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shop_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."shop_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "base_product_id" "uuid",
    "display_name" "text" NOT NULL,
    "category" "text",
    "unit" "text" NOT NULL,
    "price_paise" bigint NOT NULL,
    "aliases" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source" "text" NOT NULL,
    "use_count" integer DEFAULT 0 NOT NULL,
    "sku" "text",
    "barcode" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "local_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shop_products_price_paise_check" CHECK (("price_paise" > 0)),
    CONSTRAINT "shop_products_source_check" CHECK (("source" = ANY (ARRAY['base'::"text", 'custom'::"text", 'learned'::"text"])))
);


ALTER TABLE "public"."shop_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "address" "text",
    "logo_url" "text",
    "catalog_mode" "text" NOT NULL,
    "bill_language" "text" DEFAULT 'hi'::"text" NOT NULL,
    "receipt_prefix" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shops_bill_language_check" CHECK (("bill_language" = ANY (ARRAY['en'::"text", 'hi'::"text", 'both'::"text"]))),
    CONSTRAINT "shops_catalog_mode_check" CHECK (("catalog_mode" = ANY (ARRAY['base_imported'::"text", 'custom_only'::"text"])))
);


ALTER TABLE "public"."shops" OWNER TO "postgres";


ALTER TABLE ONLY "public"."base_products"
    ADD CONSTRAINT "base_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_shop_id_local_id_key" UNIQUE ("shop_id", "local_id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_shop_id_receipt_number_key" UNIQUE ("shop_id", "receipt_number");



ALTER TABLE ONLY "public"."learned_aliases"
    ADD CONSTRAINT "learned_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learned_aliases"
    ADD CONSTRAINT "learned_aliases_shop_id_local_id_key" UNIQUE ("shop_id", "local_id");



ALTER TABLE ONLY "public"."learning_events"
    ADD CONSTRAINT "learning_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_events"
    ADD CONSTRAINT "learning_events_shop_id_local_id_key" UNIQUE ("shop_id", "local_id");



ALTER TABLE ONLY "public"."price_observations"
    ADD CONSTRAINT "price_observations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_observations"
    ADD CONSTRAINT "price_observations_shop_id_local_id_key" UNIQUE ("shop_id", "local_id");



ALTER TABLE ONLY "public"."provisional_products"
    ADD CONSTRAINT "provisional_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provisional_products"
    ADD CONSTRAINT "provisional_products_shop_id_local_id_key" UNIQUE ("shop_id", "local_id");



ALTER TABLE ONLY "public"."receipt_number_blocks"
    ADD CONSTRAINT "receipt_number_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_pkey" PRIMARY KEY ("shop_id", "user_id");



ALTER TABLE ONLY "public"."shop_products"
    ADD CONSTRAINT "shop_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_products"
    ADD CONSTRAINT "shop_products_shop_id_local_id_key" UNIQUE ("shop_id", "local_id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");



CREATE INDEX "bill_items_bill_id_idx" ON "public"."bill_items" USING "btree" ("bill_id");



CREATE INDEX "bill_items_shop_id_display_name_idx" ON "public"."bill_items" USING "btree" ("shop_id", "display_name");



CREATE INDEX "bills_shop_id_created_at_idx" ON "public"."bills" USING "btree" ("shop_id", "created_at" DESC);



CREATE INDEX "bills_shop_id_customer_name_idx" ON "public"."bills" USING "btree" ("shop_id", "customer_name");



CREATE UNIQUE INDEX "learned_aliases_shop_id_lower_idx" ON "public"."learned_aliases" USING "btree" ("shop_id", "lower"("alias"));



CREATE INDEX "provisional_products_shop_id_seen_count_idx" ON "public"."provisional_products" USING "btree" ("shop_id", "seen_count" DESC) WHERE ("promoted_at" IS NULL);



CREATE INDEX "receipt_number_blocks_shop_id_idx" ON "public"."receipt_number_blocks" USING "btree" ("shop_id");



CREATE INDEX "shop_members_user_id_idx" ON "public"."shop_members" USING "btree" ("user_id");



CREATE INDEX "shop_products_shop_id_idx" ON "public"."shop_products" USING "btree" ("shop_id") WHERE "is_active";



CREATE UNIQUE INDEX "shop_products_shop_id_lower_idx" ON "public"."shop_products" USING "btree" ("shop_id", "lower"("display_name"));



CREATE OR REPLACE TRIGGER "bill_items_immutability" BEFORE INSERT OR DELETE OR UPDATE ON "public"."bill_items" FOR EACH ROW EXECUTE FUNCTION "public"."bill_items_enforce_immutability"();



CREATE OR REPLACE TRIGGER "bills_immutability" BEFORE UPDATE ON "public"."bills" FOR EACH ROW EXECUTE FUNCTION "public"."bills_enforce_immutability"();



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id");



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_shop_product_id_fkey" FOREIGN KEY ("shop_product_id") REFERENCES "public"."shop_products"("id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."learned_aliases"
    ADD CONSTRAINT "learned_aliases_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."learned_aliases"
    ADD CONSTRAINT "learned_aliases_shop_product_id_fkey" FOREIGN KEY ("shop_product_id") REFERENCES "public"."shop_products"("id");



ALTER TABLE ONLY "public"."learning_events"
    ADD CONSTRAINT "learning_events_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id");



ALTER TABLE ONLY "public"."learning_events"
    ADD CONSTRAINT "learning_events_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."price_observations"
    ADD CONSTRAINT "price_observations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."price_observations"
    ADD CONSTRAINT "price_observations_shop_product_id_fkey" FOREIGN KEY ("shop_product_id") REFERENCES "public"."shop_products"("id");



ALTER TABLE ONLY "public"."provisional_products"
    ADD CONSTRAINT "provisional_products_promoted_shop_product_id_fkey" FOREIGN KEY ("promoted_shop_product_id") REFERENCES "public"."shop_products"("id");



ALTER TABLE ONLY "public"."provisional_products"
    ADD CONSTRAINT "provisional_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."receipt_number_blocks"
    ADD CONSTRAINT "receipt_number_blocks_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."shop_members"
    ADD CONSTRAINT "shop_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."shop_products"
    ADD CONSTRAINT "shop_products_base_product_id_fkey" FOREIGN KEY ("base_product_id") REFERENCES "public"."base_products"("id");



ALTER TABLE ONLY "public"."shop_products"
    ADD CONSTRAINT "shop_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE "public"."base_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "base_products_select" ON "public"."base_products" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."bill_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bill_items_delete" ON "public"."bill_items" FOR DELETE USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "bill_items_insert" ON "public"."bill_items" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "bill_items_select" ON "public"."bill_items" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "bill_items_update" ON "public"."bill_items" FOR UPDATE USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."bills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bills_insert" ON "public"."bills" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "bills_select" ON "public"."bills" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "bills_update" ON "public"."bills" FOR UPDATE USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."learned_aliases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "learned_aliases_insert" ON "public"."learned_aliases" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "learned_aliases_select" ON "public"."learned_aliases" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "learned_aliases_update" ON "public"."learned_aliases" FOR UPDATE USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."learning_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "learning_events_insert" ON "public"."learning_events" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "learning_events_select" ON "public"."learning_events" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."price_observations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "price_observations_insert" ON "public"."price_observations" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "price_observations_select" ON "public"."price_observations" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."provisional_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "provisional_products_insert" ON "public"."provisional_products" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "provisional_products_select" ON "public"."provisional_products" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "provisional_products_update" ON "public"."provisional_products" FOR UPDATE USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."receipt_number_blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "receipt_number_blocks_insert" ON "public"."receipt_number_blocks" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "receipt_number_blocks_select" ON "public"."receipt_number_blocks" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "receipt_number_blocks_update" ON "public"."receipt_number_blocks" FOR UPDATE USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."shop_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shop_members_insert" ON "public"."shop_members" FOR INSERT WITH CHECK (((("user_id" = "auth"."uid"()) AND ("role" = 'owner'::"text") AND "public"."owns_shop"("shop_id")) OR "public"."is_shop_owner"("shop_id")));



CREATE POLICY "shop_members_select" ON "public"."shop_members" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "shop_members_update" ON "public"."shop_members" FOR UPDATE USING ("public"."is_shop_owner"("shop_id"));



ALTER TABLE "public"."shop_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shop_products_insert" ON "public"."shop_products" FOR INSERT WITH CHECK ("public"."is_shop_member"("shop_id"));



CREATE POLICY "shop_products_select" ON "public"."shop_products" FOR SELECT USING ("public"."is_shop_member"("shop_id"));



CREATE POLICY "shop_products_update" ON "public"."shop_products" FOR UPDATE USING ("public"."is_shop_member"("shop_id"));



ALTER TABLE "public"."shops" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shops_insert" ON "public"."shops" FOR INSERT WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "shops_select" ON "public"."shops" FOR SELECT USING (("public"."is_shop_member"("id") OR ("owner_user_id" = "auth"."uid"())));



CREATE POLICY "shops_update" ON "public"."shops" FOR UPDATE USING ("public"."is_shop_member"("id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."bill_items_enforce_immutability"() TO "anon";
GRANT ALL ON FUNCTION "public"."bill_items_enforce_immutability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bill_items_enforce_immutability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bills_enforce_immutability"() TO "anon";
GRANT ALL ON FUNCTION "public"."bills_enforce_immutability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bills_enforce_immutability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."copy_base_catalog"("p_shop_id" "uuid", "p_device_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."copy_base_catalog"("p_shop_id" "uuid", "p_device_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."copy_base_catalog"("p_shop_id" "uuid", "p_device_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_shop_member"("check_shop_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_shop_member"("check_shop_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_shop_member"("check_shop_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_shop_owner"("check_shop_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_shop_owner"("check_shop_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_shop_owner"("check_shop_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."owns_shop"("check_shop_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."owns_shop"("check_shop_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."owns_shop"("check_shop_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."base_products" TO "anon";
GRANT ALL ON TABLE "public"."base_products" TO "authenticated";
GRANT ALL ON TABLE "public"."base_products" TO "service_role";



GRANT ALL ON TABLE "public"."bill_items" TO "anon";
GRANT ALL ON TABLE "public"."bill_items" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_items" TO "service_role";



GRANT ALL ON TABLE "public"."bills" TO "anon";
GRANT ALL ON TABLE "public"."bills" TO "authenticated";
GRANT ALL ON TABLE "public"."bills" TO "service_role";



GRANT ALL ON TABLE "public"."learned_aliases" TO "anon";
GRANT ALL ON TABLE "public"."learned_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."learned_aliases" TO "service_role";



GRANT ALL ON TABLE "public"."learning_events" TO "anon";
GRANT ALL ON TABLE "public"."learning_events" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_events" TO "service_role";



GRANT ALL ON TABLE "public"."price_observations" TO "anon";
GRANT ALL ON TABLE "public"."price_observations" TO "authenticated";
GRANT ALL ON TABLE "public"."price_observations" TO "service_role";



GRANT ALL ON TABLE "public"."provisional_products" TO "anon";
GRANT ALL ON TABLE "public"."provisional_products" TO "authenticated";
GRANT ALL ON TABLE "public"."provisional_products" TO "service_role";



GRANT ALL ON TABLE "public"."receipt_number_blocks" TO "anon";
GRANT ALL ON TABLE "public"."receipt_number_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_number_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."shop_members" TO "anon";
GRANT ALL ON TABLE "public"."shop_members" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_members" TO "service_role";



GRANT ALL ON TABLE "public"."shop_products" TO "anon";
GRANT ALL ON TABLE "public"."shop_products" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_products" TO "service_role";



GRANT ALL ON TABLE "public"."shops" TO "anon";
GRANT ALL ON TABLE "public"."shops" TO "authenticated";
GRANT ALL ON TABLE "public"."shops" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







