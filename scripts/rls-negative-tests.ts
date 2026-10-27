// KB-105: the permanent, automated version of KB-104's manual two-shop
// smoke test. Runs directly against Postgres with `pg` (not Vitest - this
// needs a real database with RLS actually enforced, which is deliberately
// outside domain/'s pure-TypeScript boundary, see CLAUDE.md hard rule 3).
//
// The whole run is one transaction, rolled back at the end - not
// DELETE-based cleanup like KB-103/KB-104's manual scratch scripts. That
// sidesteps the exact trap KB-103's verification script hit: a bill_items
// row locked by its own immutability trigger once its parent bill is
// final, which a DELETE-based cleanup can't remove no matter who runs it.
//
// Each check runs inside its own SAVEPOINT, not just the outer
// transaction - a rejected query (which is the whole point of half these
// tests) aborts the enclosing transaction in Postgres until rolled back,
// so without per-check savepoints, the first expected rejection would
// poison every check after it with an unrelated "current transaction is
// aborted" error instead of the real assertion. Found this the hard way
// on the first real run of this exact script, not assumed safe upfront.
//
// Every simulated user session uses `set local role authenticated` +
// `set_config('request.jwt.claim.sub', <uuid>, true)` - the exact GUC
// auth.uid() reads (confirmed by reading its real definition on the local
// Postgres during KB-104, not assumed). `local`/`true` scope both to the
// current transaction, so switching simulated users mid-transaction never
// leaks into the next check.

import { randomUUID } from "node:crypto";
import { Client } from "pg";

const DEFAULT_LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function resolveDbUrl(): string {
  const url = process.env.RLS_TEST_DB_URL ?? DEFAULT_LOCAL_DB_URL;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`RLS_TEST_DB_URL is not a valid connection URL: "${url}"`);
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(
      `Refusing to run: resolved host "${hostname}" is not 127.0.0.1/localhost. ` +
        `This suite creates and destroys real rows inside a transaction it rolls back - ` +
        `it must never run against a remote database, even a "staging" one. ` +
        `(resolved from RLS_TEST_DB_URL if set, otherwise the hardcoded local default)`
    );
  }
  return url;
}

type PgError = Error & { code?: string };

async function asUser(client: Client, userId: string): Promise<void> {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query("set local role authenticated");
}

async function asSuperuser(client: Client): Promise<void> {
  await client.query("reset role");
}

/** An unauthenticated caller: the `anon` role, no user id (KB-105b). */
async function asAnon(client: Client): Promise<void> {
  await client.query("select set_config('request.jwt.claim.sub', '', true)");
  await client.query("set local role anon");
}

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function report(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}\n        ${detail}`);
}

/** Runs `task` inside its own SAVEPOINT so a failure never poisons the outer transaction for later checks. */
async function withSavepoint<T>(
  client: Client,
  task: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  await client.query("savepoint check_sp");
  try {
    const value = await task();
    await client.query("release savepoint check_sp");
    return { ok: true, value };
  } catch (error) {
    await client.query("rollback to savepoint check_sp");
    await client.query("release savepoint check_sp");
    return { ok: false, error };
  }
}

/** A check expected to succeed. `fn` returns a human-readable detail string. */
async function check(client: Client, name: string, fn: () => Promise<string>): Promise<void> {
  const result = await withSavepoint(client, fn);
  if (result.ok) {
    report(name, true, result.value);
  } else {
    const err = result.error;
    report(name, false, err instanceof Error ? err.message : String(err));
  }
}

/** A check expected to fail with a specific Postgres error code (e.g. 42501 for RLS, P0001 for a trigger raise). */
async function checkRejects(
  client: Client,
  name: string,
  expectedCode: string,
  fn: () => Promise<void>
): Promise<void> {
  const result = await withSavepoint(client, fn);
  if (result.ok) {
    report(name, false, "expected the operation to be rejected, but it succeeded");
    return;
  }
  const pgErr = result.error as PgError;
  if (!pgErr || typeof pgErr !== "object" || pgErr.code === undefined) {
    report(name, false, `expected a Postgres error with code ${expectedCode}, got: ${String(result.error)}`);
    return;
  }
  if (pgErr.code !== expectedCode) {
    report(name, false, `expected error code ${expectedCode}, got ${pgErr.code}: ${pgErr.message}`);
    return;
  }
  report(name, true, `rejected with code ${expectedCode} as expected ("${pgErr.message}")`);
}

async function main(): Promise<void> {
  const dbUrl = resolveDbUrl();
  console.log(`Connecting to ${dbUrl.replace(/:[^:@]+@/, ":****@")} (host check passed - local only)\n`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  await client.query("begin");

  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const staffA = randomUUID();
  const shopA = randomUUID();
  const shopB = randomUUID();
  const shopProductB = randomUUID();
  const billB = randomUUID();
  const billItemB = randomUUID();
  const shopProductA = randomUUID();
  const billA = randomUUID();
  const billItemA = randomUUID();
  const billItemA2 = randomUUID();

  try {
    await asSuperuser(client);
    await client.query(
      `insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)`,
      [ownerA, "ownerA@rls-test.local", ownerB, "ownerB@rls-test.local", staffA, "staffA@rls-test.local"]
    );

    // --- Bootstrap ---

    await check(client, "bootstrap: owner A creates shop A as themselves", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into shops (id, owner_user_id, name, catalog_mode) values ($1, $2, 'Shop A', 'custom_only')`,
        [shopA, ownerA]
      );
      return "insert succeeded";
    });

    await check(
      client,
      "bootstrap: owner A can see their own shop row BEFORE the shop_members row exists " +
        "[the orphaned-shop visibility gap KB-107's resume logic depends on - shops_select must allow " +
        "owner_user_id = auth.uid() in addition to is_shop_member(), or a failed bootstrap becomes " +
        "permanently invisible to its own owner - see 07-DECISIONS.md D20]",
      async () => {
        const res = await client.query(`select 1 from shops where id = $1`, [shopA]);
        if (res.rowCount !== 1) throw new Error(`expected the owner to see their own unmembered shop, got ${res.rowCount} rows`);
        return "owner can see their own shop row even with no membership row yet, as expected";
      }
    );

    await check(
      client,
      "bootstrap negative case: a DIFFERENT user (owner B) cannot see owner A's unmembered shop via the " +
        "broadened owner_user_id clause - it only grants visibility to the actual owner, not everyone",
      async () => {
        await asUser(client, ownerB);
        const res = await client.query(`select 1 from shops where id = $1`, [shopA]);
        if (res.rowCount !== 0) throw new Error(`expected 0 rows, got ${res.rowCount}`);
        return "0 rows visible to a non-owner, non-member user, as expected";
      }
    );

    await check(
      client,
      "bootstrap: owner A inserts their own owner-membership row " +
        "[REGRESSION TEST for the real KB-104 bug: this exact insert was broken pre-owns_shop() fix]",
      async () => {
        await asUser(client, ownerA);
        await client.query(`insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')`, [
          shopA,
          ownerA,
        ]);
        return "insert succeeded";
      }
    );

    await check(client, "bootstrap: owner B creates shop B and their own membership row", async () => {
      await asUser(client, ownerB);
      await client.query(
        `insert into shops (id, owner_user_id, name, catalog_mode) values ($1, $2, 'Shop B', 'custom_only')`,
        [shopB, ownerB]
      );
      await client.query(`insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')`, [
        shopB,
        ownerB,
      ]);
      return "both inserts succeeded";
    });

    // --- Seed one row per relevant table per shop, as each shop's own owner ---

    await asUser(client, ownerB);
    await client.query(
      `insert into shop_products (id, shop_id, display_name, unit, price_paise, source, local_id, device_id)
       values ($1, $2, 'Shop B Product', 'kg', 5000, 'custom', gen_random_uuid(), 'test-device')`,
      [shopProductB, shopB]
    );
    await client.query(
      `insert into bills (id, shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id)
       values ($1, $2, gen_random_uuid(), 'B-0001', 1000, 1000, 'draft', 1, 'test-device')`,
      [billB, shopB]
    );
    await client.query(
      `insert into bill_items (id, bill_id, shop_id, line_no, display_name, total_paise, price_type, source)
       values ($1, $2, $3, 1, 'Shop B Item', 1000, 'total', 'manual')`,
      [billItemB, billB, shopB]
    );

    await asUser(client, ownerA);
    await client.query(
      `insert into shop_products (id, shop_id, display_name, unit, price_paise, source, local_id, device_id)
       values ($1, $2, 'Shop A Product', 'kg', 3000, 'custom', gen_random_uuid(), 'test-device')`,
      [shopProductA, shopA]
    );
    await client.query(
      `insert into bills (id, shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id)
       values ($1, $2, gen_random_uuid(), 'A-0001', 2000, 2000, 'draft', 1, 'test-device')`,
      [billA, shopA]
    );
    await client.query(
      `insert into bill_items (id, bill_id, shop_id, line_no, display_name, total_paise, price_type, source)
       values ($1, $2, $3, 1, 'Shop A Item', 2000, 'total', 'manual')`,
      [billItemA, billA, shopA]
    );

    // --- Read isolation (as shop A's owner) ---

    await asUser(client, ownerA);

    await check(client, "read isolation: shop A sees zero of shop B's shops row", async () => {
      const res = await client.query(`select 1 from shops where id = $1`, [shopB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows, got ${res.rowCount}`);
      return "0 rows visible, as expected";
    });

    await check(client, "read isolation: shop A sees zero of shop B's shop_products", async () => {
      const res = await client.query(`select 1 from shop_products where shop_id = $1`, [shopB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows, got ${res.rowCount}`);
      return "0 rows visible, as expected";
    });

    await check(client, "read isolation: shop A sees zero of shop B's bills", async () => {
      const res = await client.query(`select 1 from bills where shop_id = $1`, [shopB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows, got ${res.rowCount}`);
      return "0 rows visible, as expected";
    });

    await check(client, "read isolation: shop A sees zero of shop B's bill_items", async () => {
      const res = await client.query(`select 1 from bill_items where shop_id = $1`, [shopB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows, got ${res.rowCount}`);
      return "0 rows visible, as expected";
    });

    await check(client, "read isolation sanity: shop A sees its own shop_products (should be 1)", async () => {
      const res = await client.query(`select 1 from shop_products where shop_id = $1`, [shopA]);
      if (res.rowCount !== 1) throw new Error(`expected 1 row, got ${res.rowCount}`);
      return "1 row visible, as expected";
    });

    // --- Write isolation (shop A attempting to write into shop B) ---

    await checkRejects(
      client,
      "write isolation: shop A cannot INSERT a shop_products row into shop B",
      "42501",
      async () => {
        await client.query(
          `insert into shop_products (id, shop_id, display_name, unit, price_paise, source, local_id, device_id)
           values (gen_random_uuid(), $1, 'Smuggled', 'kg', 100, 'custom', gen_random_uuid(), 'test-device')`,
          [shopB]
        );
      }
    );

    // KB-311 (Catalog screen): price edits are UPDATEs from the client.
    await check(client, "write isolation: shop A's price UPDATE on shop B's shop_products row affects zero rows", async () => {
      const res = await client.query(`update shop_products set price_paise = 1 where id = $1`, [shopProductB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows affected, got ${res.rowCount}`);
      return "0 rows affected, as expected";
    });

    await checkRejects(
      client,
      "write isolation: shop A cannot move its own shop_products row into shop B (UPDATE shop_id)",
      "42501",
      async () => {
        await client.query(`update shop_products set shop_id = $1 where id = $2`, [shopB, shopProductA]);
      }
    );

    // KB-330 (D71): the Catalog renames, edits aliases and archives - plain UPDATEs - and never hard-deletes.
    await check(client, "write isolation (KB-330): shop A's RENAME of shop B's product affects zero rows", async () => {
      const res = await client.query(`update shop_products set display_name = 'Hijacked' where id = $1`, [shopProductB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows affected, got ${res.rowCount}`);
      return "0 rows affected, as expected";
    });
    await check(client, "write isolation (KB-330): shop A's ARCHIVE (is_active = false) of shop B's product affects zero rows", async () => {
      const res = await client.query(`update shop_products set is_active = false, aliases = '["x"]'::jsonb where id = $1`, [shopProductB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows affected, got ${res.rowCount}`);
      return "0 rows affected, as expected";
    });
    await check(client, "write control (KB-330): shop A CAN rename and archive-flag its OWN product (1 row) - the checks above are not vacuous", async () => {
      const res = await client.query(`update shop_products set display_name = display_name, is_active = is_active where id = $1`, [shopProductA]);
      if (res.rowCount !== 1) throw new Error(`expected 1 row affected, got ${res.rowCount}`);
      return "1 row affected, as expected";
    });
    await check(client, "no hard delete (KB-330): shop A's DELETE of its OWN shop_products row affects zero rows", async () => {
      const res = await client.query(`delete from shop_products where id = $1`, [shopProductA]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows deleted, got ${res.rowCount}`);
      return "0 rows deleted, as expected";
    });
    await check(client, "no hard delete (KB-330): shop A's DELETE of shop B's shop_products row affects zero rows", async () => {
      const res = await client.query(`delete from shop_products where id = $1`, [shopProductB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows deleted, got ${res.rowCount}`);
      return "0 rows deleted, as expected";
    });

    await asSuperuser(client);
    await check(client, "write isolation sanity: shop B's product price is unchanged (5000)", async () => {
      const res = await client.query(`select price_paise from shop_products where id = $1`, [shopProductB]);
      if (Number(res.rows[0]?.price_paise) !== 5000) throw new Error(`expected 5000, got ${res.rows[0]?.price_paise}`);
      return "5000, as expected";
    });
    await check(client, "no hard delete sanity (KB-330): both products still exist, shop B's still named and active", async () => {
      const res = await client.query(`select id, display_name, is_active from shop_products where id = any($1)`, [[shopProductA, shopProductB]]);
      const b = res.rows.find((r: { id: string }) => r.id === shopProductB);
      if (res.rowCount !== 2 || b?.display_name === "Hijacked" || b?.is_active !== true) throw new Error(`unexpected state: ${JSON.stringify(res.rows)}`);
      return "both rows present, B untouched";
    });
    await asUser(client, ownerA);

    await checkRejects(client, "write isolation: shop A cannot INSERT a bills row into shop B", "42501", async () => {
      await client.query(
        `insert into bills (id, shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id)
         values (gen_random_uuid(), $1, gen_random_uuid(), 'SMUGGLED', 0, 0, 'draft', 1, 'test-device')`,
        [shopB]
      );
    });

    await check(
      client,
      "write isolation: shop A's DELETE targeting shop B's bill_items row silently affects zero rows " +
        "[not a 42501 error - unlike INSERT/UPDATE's WITH CHECK, RLS's USING clause for DELETE/SELECT " +
        "is a silent row filter, not a check that raises. Confirmed empirically here, not assumed: " +
        "the first version of this test wrongly expected an error code and failed until this was found]",
      async () => {
        const res = await client.query(`delete from bill_items where id = $1`, [billItemB]);
        if (res.rowCount !== 0) throw new Error(`expected 0 rows affected, got ${res.rowCount}`);
        return "0 rows affected, as expected - the row was invisible to shop A, not explicitly rejected";
      }
    );

    await asSuperuser(client);
    await check(
      client,
      "write isolation sanity: shop B's bill_items row survived the rejected cross-shop delete",
      async () => {
        const res = await client.query(`select 1 from bill_items where id = $1`, [billItemB]);
        if (res.rowCount !== 1) throw new Error(`expected the row to still exist, got ${res.rowCount} rows`);
        return "row survived, as expected";
      }
    );

    // --- bill_items delete: own row, draft vs. final (RLS layer vs. trigger layer) ---

    await check(client, "bill_items delete: shop A can delete their OWN line item while its bill is still draft", async () => {
      await asUser(client, ownerA);
      await client.query(`delete from bill_items where id = $1`, [billItemA]);
      return "delete succeeded on a draft bill's line item";
    });

    await client.query(
      `insert into bill_items (id, bill_id, shop_id, line_no, display_name, total_paise, price_type, source)
       values ($1, $2, $3, 2, 'Shop A Item 2', 2000, 'total', 'manual')`,
      [billItemA2, billA, shopA]
    );
    await client.query(`update bills set status = 'final', finalized_at = now() where id = $1`, [billA]);

    await checkRejects(
      client,
      "bill_items delete: shop A CANNOT delete a line item once its bill is final " +
        "[confirms the TRIGGER rejects this, not RLS - RLS still grants shop-level access " +
        "(is_shop_member passes), so the error code must be the trigger's P0001, not RLS's 42501]",
      "P0001",
      async () => {
        await client.query(`delete from bill_items where id = $1`, [billItemA2]);
      }
    );

    // --- Member management ---

    await check(client, "member management: owner A adds A2 as staff of shop A", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')`, [
        shopA,
        staffA,
      ]);
      return "insert succeeded";
    });

    await checkRejects(
      client,
      "member management: non-owner (staff A2) cannot add a new member to shop A",
      "42501",
      async () => {
        await asUser(client, staffA);
        await client.query(`insert into shop_members (shop_id, user_id, role) values ($1, $2, 'staff')`, [
          shopA,
          ownerB,
        ]);
      }
    );

    await checkRejects(
      client,
      "member management: cross-shop owner B cannot add themselves to shop A's membership",
      "42501",
      async () => {
        await asUser(client, ownerB);
        await client.query(`insert into shop_members (shop_id, user_id, role) values ($1, $2, 'manager')`, [
          shopA,
          ownerB,
        ]);
      }
    );

    // KB-110b: bill_items_insert's RLS checks only the item's OWN shop_id,
    // and the plain bill_id FK doesn't care which shop the bill belongs to.
    // bill_items_immutability reads the parent through RLS, so it sees
    // nothing for another shop's bill and lets the insert through. The
    // composite FK bill_items (bill_id, shop_id) -> bills (id, shop_id)
    // closes it structurally - 23503, whatever RLS can see.
    await checkRejects(
      client,
      "cross-shop integrity: owner B cannot attach an item (shop_id B) to a shop-A bill (KB-110b composite FK)",
      "23503",
      async () => {
        await asUser(client, ownerB);
        await client.query(
          `insert into bill_items (id, bill_id, shop_id, line_no, display_name, total_paise, price_type, source)
           values ($1, $2, $3, 99, 'smuggled', 100, 'total', 'manual')`,
          [randomUUID(), billA, shopB]
        );
      }
    );

    // --- KB-110b: push_bill (SECURITY INVOKER - RLS stays the boundary) ---

    const pushLocalId = randomUUID();
    const pushBill = (overrides: Record<string, unknown> = {}) => ({
      shop_id: shopA,
      local_id: pushLocalId,
      receipt_number: "RLS-PUSH-000001",
      receipt_number_source: "block",
      customer_name: "Cash",
      customer_mobile: null,
      subtotal_paise: 2250,
      total_paise: 2250,
      status: "final",
      schema_version: 1,
      device_id: "rls-test-device",
      created_at: "2026-09-27T09:00:00.000Z",
      finalized_at: "2026-09-27T09:00:05.000Z",
      ...overrides,
    });
    const pushItems = [
      {
        line_no: 1, shop_product_id: null, display_name: "Chini", spoken_name: "chini", qty: 500,
        unit: "gm", rate_paise: 4500, rate_unit: "kg", total_paise: 2250, price_type: "default",
        source: "fastpath", review_flags: [], was_edited: false,
        shop_id: shopB, // a smuggled shop_id in the payload - push_bill must ignore it
      },
    ];
    const callPushBill = async (bill: Record<string, unknown>, items: unknown[]) =>
      (await client.query(`select push_bill($1::jsonb, $2::jsonb) as id`, [JSON.stringify(bill), JSON.stringify(items)])).rows[0].id as string;
    const serverSnapshot = async () =>
      JSON.stringify(
        (
          await client.query(
            `select b.status, b.receipt_number_source, b.total_paise, i.shop_id, i.qty, i.unit, i.rate_paise, i.rate_unit, i.total_paise as item_total
             from bills b join bill_items i on i.bill_id = b.id where b.shop_id = $1 and b.local_id = $2`,
            [shopA, pushLocalId]
          )
        ).rows
      );

    let pushedId = "";
    let snapshotAfterFirstPush = "";
    await check(client, "push_bill: owner A pushes a final bill + cross-unit item atomically; item shop_id comes from the function", async () => {
      await asUser(client, ownerA);
      pushedId = await callPushBill(pushBill(), pushItems);
      snapshotAfterFirstPush = await serverSnapshot();
      const rows = JSON.parse(snapshotAfterFirstPush) as Array<Record<string, unknown>>;
      if (rows.length !== 1) throw new Error(`expected 1 item row, got ${rows.length}`);
      const row = rows[0]!;
      if (row.status !== "final" || row.shop_id !== shopA || row.rate_unit !== "kg" || row.receipt_number_source !== "block") {
        throw new Error(`unexpected server state: ${snapshotAfterFirstPush}`);
      }
      return `bill ${pushedId} final with 1 item, item shop_id = shop A (payload's shop B ignored), rate_unit kg`;
    });

    await check(client, "push_bill: an identical retry (lost response) is a no-op success returning the same id", async () => {
      await asUser(client, ownerA);
      const retryId = await callPushBill(pushBill(), pushItems);
      if (retryId !== pushedId) throw new Error(`retry returned ${retryId}, expected ${pushedId}`);
      if ((await serverSnapshot()) !== snapshotAfterFirstPush) throw new Error("server state changed on an identical retry");
      return "same id, server unchanged";
    });

    await checkRejects(client, "push_bill NULL-safety: a retry OMITTING receipt_number_source is a mismatch (KB409), not a silent success", "KB409", async () => {
      await asUser(client, ownerA);
      const bill = pushBill();
      delete (bill as Record<string, unknown>).receipt_number_source;
      await callPushBill(bill, pushItems);
    });

    await checkRejects(client, "push_bill NULL-safety: a retry with total_paise null is a mismatch (KB409), not a silent success", "KB409", async () => {
      await asUser(client, ownerA);
      await callPushBill(pushBill({ total_paise: null }), pushItems);
    });

    await check(client, "push_bill NULL-safety: after both rejected retries the server row is unchanged", async () => {
      await asUser(client, ownerA);
      if ((await serverSnapshot()) !== snapshotAfterFirstPush) throw new Error("server state changed after a rejected retry");
      return "unchanged";
    });

    await checkRejects(client, "push_bill: owner B cannot push a bill into shop A (bills_insert WITH CHECK)", "42501", async () => {
      await asUser(client, ownerB);
      await callPushBill(pushBill({ local_id: randomUUID(), receipt_number: "RLS-PUSH-000099" }), pushItems);
    });

    await check(client, "push_bill: owner B re-using shop A's local_id in THEIR OWN shop creates a separate shop-B bill and never touches A's", async () => {
      await asUser(client, ownerB);
      const idB = await callPushBill(pushBill({ shop_id: shopB, receipt_number: "RLS-PUSH-B-000001" }), pushItems);
      if (idB === pushedId) throw new Error("returned shop A's bill id");
      await asUser(client, ownerA);
      if ((await serverSnapshot()) !== snapshotAfterFirstPush) throw new Error("shop A's bill changed");
      return `new shop-B bill ${idB}; shop A's bill unchanged`;
    });

    await checkRejects(client, "push_bill: the anon role cannot execute it", "42501", async () => {
      await client.query("set local role anon");
      await callPushBill(pushBill({ local_id: randomUUID() }), pushItems);
    });

    // --- KB-307 / KI-38: every cross-table reference stays inside its own shop ---
    // Each table's insert RLS checks only the row's own shop_id, and a plain FK
    // check runs as the table owner (it ignores RLS) - so before the composite
    // FKs, a shop-B member could point a shop-B row at a shop-A row.

    const crossShop: Array<[string, string, unknown[]]> = [
      [
        "learning_events.bill_id -> a shop-A bill",
        `insert into learning_events (shop_id, bill_id, event_type, local_id, device_id) values ($1, $2, 'smuggled', gen_random_uuid(), 'test-device')`,
        [shopB, billA],
      ],
      [
        "bill_items.shop_product_id -> a shop-A product",
        `insert into bill_items (bill_id, shop_id, line_no, shop_product_id, display_name, total_paise, price_type, source) values ($1, $2, 50, $3, 'smuggled', 100, 'total', 'manual')`,
        [billB, shopB, shopProductA],
      ],
      [
        "learned_aliases.shop_product_id -> a shop-A product",
        `insert into learned_aliases (shop_id, alias, shop_product_id, confidence, source, local_id, device_id) values ($1, 'smuggled', $2, 0.5, 'confirmation', gen_random_uuid(), 'test-device')`,
        [shopB, shopProductA],
      ],
      [
        "price_observations.shop_product_id -> a shop-A product",
        `insert into price_observations (shop_id, shop_product_id, observed_price_paise, local_id, device_id) values ($1, $2, 100, gen_random_uuid(), 'test-device')`,
        [shopB, shopProductA],
      ],
      [
        "provisional_products.promoted_shop_product_id -> a shop-A product",
        `insert into provisional_products (shop_id, spoken_name, promoted_shop_product_id, local_id, device_id) values ($1, 'smuggled', $2, gen_random_uuid(), 'test-device')`,
        [shopB, shopProductA],
      ],
    ];
    for (const [what, sql, params] of crossShop) {
      await checkRejects(client, `cross-shop integrity (KI-38): owner B cannot insert ${what} (composite FK)`, "23503", async () => {
        await asUser(client, ownerB);
        await client.query(sql, params);
      });
    }

    await check(client, "cross-shop integrity (KI-38) sanity: the same five references inside shop B are accepted (null stays allowed)", async () => {
      await asUser(client, ownerB);
      await client.query(`insert into learning_events (shop_id, bill_id, event_type, local_id, device_id) values ($1, $2, 'ok', gen_random_uuid(), 'test-device')`, [shopB, billB]);
      await client.query(`insert into learning_events (shop_id, bill_id, event_type, local_id, device_id) values ($1, null, 'ok', gen_random_uuid(), 'test-device')`, [shopB]);
      await client.query(`insert into bill_items (bill_id, shop_id, line_no, shop_product_id, display_name, total_paise, price_type, source) values ($1, $2, 51, $3, 'ok', 100, 'total', 'manual')`, [billB, shopB, shopProductB]);
      await client.query(`insert into learned_aliases (shop_id, alias, shop_product_id, confidence, source, local_id, device_id) values ($1, 'ok', $2, 0.5, 'confirmation', gen_random_uuid(), 'test-device')`, [shopB, shopProductB]);
      await client.query(`insert into price_observations (shop_id, shop_product_id, observed_price_paise, local_id, device_id) values ($1, $2, 100, gen_random_uuid(), 'test-device')`, [shopB, shopProductB]);
      await client.query(`insert into provisional_products (shop_id, spoken_name, promoted_shop_product_id, local_id, device_id) values ($1, 'ok', $2, gen_random_uuid(), 'test-device')`, [shopB, shopProductB]);
      return "all accepted";
    });

    await checkRejects(client, "KI-38 hygiene: the anon role cannot execute copy_base_catalog at all", "42501", async () => {
      await client.query("set local role anon");
      try {
        await client.query(`select copy_base_catalog($1, 'test-device')`, [shopA]);
      } catch (err) {
        // RLS inside the function would ALSO be 42501 - only "permission denied for function" proves the revoke.
        const e = err as PgError;
        if (!/permission denied for function/.test(e.message)) {
          const wrapped = new Error(`expected "permission denied for function", got: ${e.message}`) as PgError;
          wrapped.code = "not-the-revoke";
          throw wrapped;
        }
        throw err;
      }
    });

    // --- KB-307 commit 3: every learning write stays inside the writer's own shop ---
    // learnBill.ts writes these four tables locally and sync pushes them
    // (insert for the append-only two, upsert for aliases / provisional products).

    const learningWrites: Array<[string, string, unknown[]]> = [
      ["learned_aliases", `insert into learned_aliases (shop_id, alias, shop_product_id, confidence, source, local_id, device_id) values ($1, 'smuggled', $2, 0.5, 'confirmation', gen_random_uuid(), 'test-device')`, [shopB, shopProductB]],
      ["provisional_products", `insert into provisional_products (shop_id, spoken_name, seen_count, local_id, device_id) values ($1, 'smuggled', 1, gen_random_uuid(), 'test-device')`, [shopB]],
      ["price_observations", `insert into price_observations (shop_id, shop_product_id, observed_price_paise, local_id, device_id) values ($1, $2, 100, gen_random_uuid(), 'test-device')`, [shopB, shopProductB]],
      ["learning_events", `insert into learning_events (shop_id, bill_id, event_type, local_id, device_id) values ($1, $2, 'smuggled', gen_random_uuid(), 'test-device')`, [shopB, billB]],
    ];
    for (const [table, sql, params] of learningWrites) {
      await checkRejects(client, `learning write isolation (KB-307): owner A cannot insert a ${table} row into shop B`, "42501", async () => {
        await asUser(client, ownerA);
        await client.query(sql, params);
      });
    }

    // KB-312 (KI-37): a learning_reset event has no bill - pushed with bill_id null. RLS still keys it on shop_id.
    await checkRejects(client, "KB-312 / KI-37: owner A cannot insert a BILL-LESS learning_events row (a learning_reset) into shop B", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into learning_events (shop_id, bill_id, event_type, local_id, device_id) values ($1, null, 'learning_reset', gen_random_uuid(), 'test-device')`, [shopB]);
    });
    await check(client, "KB-312 / KI-37 sanity: owner A can insert a bill-less learning_reset into their OWN shop", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into learning_events (shop_id, bill_id, event_type, local_id, device_id) values ($1, null, 'learning_reset', gen_random_uuid(), 'test-device')`, [shopA]);
      return "accepted";
    });

    // KB-329 (D78): the ignore of a price suggestion is a bill-less learning event - no schema or policy change, so the
    // existing rules must already hold for it: own shop only, append-only (no update, no delete).
    await checkRejects(client, "KB-329: owner A cannot insert a price_suggestion_ignored event into shop B", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into learning_events (shop_id, bill_id, event_type, payload, local_id, device_id) values ($1, null, 'price_suggestion_ignored', '{"shopProductId":"x","ignoredUntil":"2027-01-01T00:00:00Z"}', gen_random_uuid(), 'test-device')`, [shopB]);
    });
    await check(client, "KB-329 sanity: owner A can insert a price_suggestion_ignored event into their OWN shop", async () => {
      await asUser(client, ownerA);
      const res = await client.query(`insert into learning_events (shop_id, bill_id, event_type, payload, local_id, device_id) values ($1, null, 'price_suggestion_ignored', '{"shopProductId":"x","ignoredUntil":"2027-01-01T00:00:00Z"}', gen_random_uuid(), 'test-device')`, [shopA]);
      if (res.rowCount !== 1) throw new Error(`expected 1 row inserted, got ${res.rowCount}`);
      return "accepted";
    });
    await check(client, "KB-329: owner A cannot UPDATE or DELETE their own ignore event (append-only: zero rows each)", async () => {
      await asUser(client, ownerA);
      const upd = await client.query(`update learning_events set payload = '{}' where shop_id = $1 and event_type = 'price_suggestion_ignored'`, [shopA]);
      const del = await client.query(`delete from learning_events where shop_id = $1 and event_type = 'price_suggestion_ignored'`, [shopA]);
      if (upd.rowCount !== 0 || del.rowCount !== 0) throw new Error(`expected 0 / 0 rows, got ${upd.rowCount} / ${del.rowCount}`);
      return "0 rows updated, 0 rows deleted";
    });

    await check(client, "learning write isolation (KB-307): owner A's UPDATE of shop B's learned alias / provisional product affects zero rows", async () => {
      await asUser(client, ownerB);
      await client.query(`insert into learned_aliases (shop_id, alias, shop_product_id, confidence, source, local_id, device_id) values ($1, 'b-alias', $2, 0.5, 'confirmation', gen_random_uuid(), 'test-device')`, [shopB, shopProductB]);
      await client.query(`insert into provisional_products (shop_id, spoken_name, seen_count, local_id, device_id) values ($1, 'b-new', 1, gen_random_uuid(), 'test-device')`, [shopB]);
      await asUser(client, ownerA);
      const a1 = await client.query(`update learned_aliases set confidence = 1 where shop_id = $1`, [shopB]);
      const a2 = await client.query(`update provisional_products set seen_count = 99 where shop_id = $1`, [shopB]);
      if (a1.rowCount !== 0 || a2.rowCount !== 0) throw new Error(`expected 0 rows, got ${a1.rowCount} / ${a2.rowCount}`);
      return "0 rows affected - shop B's learning rows are invisible to shop A";
    });

    await checkRejects(client, "learning append-only (03 §5): owner B cannot UPDATE their own learning_events (no update policy)", "42501", async () => {
      await asUser(client, ownerB);
      const res = await client.query(`update learning_events set event_type = 'tampered' where shop_id = $1`, [shopB]);
      // An UPDATE with no policy filters to zero rows rather than raising - make that a failure of this check.
      if (res.rowCount === 0) {
        const e = new Error("update matched 0 rows (no update policy - rows invisible to UPDATE)") as PgError;
        e.code = "42501";
        throw e;
      }
    });

    // --- KB-307 / KI-41: a final or cancelled bill must add up, and have lines ---
    // Enforced on the TABLE (a trigger on entering final/cancelled), so it holds
    // for push_bill and for a direct insert/update alike - the client's
    // arithmetic is never trusted. subtotal = total until discounts / tax exist.

    const lines = (...totals: number[]) =>
      totals.map((t, i) => ({ line_no: i + 1, shop_product_id: null, display_name: `Line ${i + 1}`, spoken_name: null, qty: 1, unit: "piece", rate_paise: t, rate_unit: "piece", total_paise: t, price_type: "rate", source: "manual", review_flags: [], was_edited: false }));
    const freshBill = (overrides: Record<string, unknown>) => pushBill({ local_id: randomUUID(), receipt_number: `RLS-KI41-${randomUUID().slice(0, 8)}`, ...overrides });

    await checkRejects(client, "KI-41: push_bill rejects a final bill with ZERO items", "KB422", async () => {
      await asUser(client, ownerA);
      await callPushBill(freshBill({ subtotal_paise: 0, total_paise: 0 }), []);
    });
    await checkRejects(client, "KI-41: push_bill rejects item totals that don't sum to subtotal (500 + 600 vs 1000)", "KB422", async () => {
      await asUser(client, ownerA);
      await callPushBill(freshBill({ subtotal_paise: 1000, total_paise: 1000 }), lines(500, 600));
    });
    await checkRejects(client, "KI-41: push_bill rejects subtotal != total (no discounts or tax exist yet)", "KB422", async () => {
      await asUser(client, ownerA);
      await callPushBill(freshBill({ subtotal_paise: 1100, total_paise: 1000 }), lines(500, 600));
    });
    await checkRejects(client, "KI-41: push_bill rejects a CANCELLED bill whose items don't add up", "KB422", async () => {
      await asUser(client, ownerA);
      await callPushBill(freshBill({ status: "cancelled", subtotal_paise: 1000, total_paise: 1000 }), lines(500, 600));
    });
    await checkRejects(client, "KI-41: push_bill rejects a CANCELLED bill with zero items", "KB422", async () => {
      await asUser(client, ownerA);
      await callPushBill(freshBill({ status: "cancelled", subtotal_paise: 0, total_paise: 0 }), []);
    });
    await check(client, "KI-41 sanity: a bill that adds up is accepted, final and cancelled (500 + 600 = 1100)", async () => {
      await asUser(client, ownerA);
      const f = await callPushBill(freshBill({ subtotal_paise: 1100, total_paise: 1100 }), lines(500, 600));
      const c = await callPushBill(freshBill({ status: "cancelled", subtotal_paise: 1100, total_paise: 1100 }), lines(500, 600));
      const res = await client.query(`select status from bills where id = any($1::uuid[]) order by status`, [[f, c]]);
      const statuses = res.rows.map((r) => r.status).join(",");
      if (statuses !== "cancelled,final") throw new Error(`got ${statuses}`);
      return "final and cancelled both stored";
    });

    await checkRejects(client, "KI-41 (bypassing push_bill): a direct draft -> final whose items don't add up is rejected", "KB422", async () => {
      await asUser(client, ownerA);
      const id = randomUUID();
      await client.query(
        `insert into bills (id, shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id) values ($1, $2, gen_random_uuid(), 'A-DIRECT-1', 1000, 1000, 'draft', 1, 'test-device')`,
        [id, shopA],
      );
      await client.query(`insert into bill_items (bill_id, shop_id, line_no, display_name, total_paise, price_type, source) values ($1, $2, 1, 'x', 400, 'total', 'manual')`, [id, shopA]);
      await client.query(`update bills set status = 'final', finalized_at = now() where id = $1`, [id]);
    });
    await checkRejects(client, "KI-41 (bypassing push_bill): a bill INSERTED directly as final (no items) is rejected", "KB422", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into bills (shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id) values ($1, gen_random_uuid(), 'A-DIRECT-2', 0, 0, 'final', 1, 'test-device')`,
        [shopA],
      );
    });
    await checkRejects(client, "KI-41 (bypassing push_bill): a direct draft -> cancelled with no items is rejected", "KB422", async () => {
      await asUser(client, ownerA);
      const id = randomUUID();
      await client.query(
        `insert into bills (id, shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id) values ($1, $2, gen_random_uuid(), 'A-DIRECT-3', 0, 0, 'draft', 1, 'test-device')`,
        [id, shopA],
      );
      await client.query(`update bills set status = 'cancelled' where id = $1`, [id]);
    });

    // --- KB-325 (D79): bill_cancellations + cancel_bill() -------------------------------------------------------
    // Select and insert for a member of the shop only; no update, no delete; the bill must be the same shop's (composite
    // FK); cancel_bill runs as the caller (RLS), so another shop's bill is "unknown" (KB404); anon cannot execute it.
    async function finalBillFor(userId: string, shopId: string, label: string): Promise<{ id: string; localId: string }> {
      await asUser(client, userId);
      const id = randomUUID();
      const localId = randomUUID();
      await client.query(
        `insert into bills (id, shop_id, local_id, receipt_number, subtotal_paise, total_paise, status, schema_version, device_id) values ($1, $2, $3, $4, 1000, 1000, 'draft', 1, 'test-device')`,
        [id, shopId, localId, label],
      );
      await client.query(`insert into bill_items (bill_id, shop_id, line_no, display_name, total_paise, price_type, source) values ($1, $2, 1, 'x', 1000, 'total', 'manual')`, [id, shopId]);
      await client.query(`update bills set status = 'final', finalized_at = now() where id = $1`, [id]);
      return { id, localId };
    }
    const cancelCall = (shopId: string, billLocalId: string, reason = "wrong_price") =>
      client.query(`select cancel_bill($1, $2, $3, gen_random_uuid(), 'test-device', now(), null) as id`, [shopId, billLocalId, reason]);

    const cancelA = await finalBillFor(ownerA, shopA, "A-CANCEL-1");
    const cancelB = await finalBillFor(ownerB, shopB, "B-CANCEL-1");
    const cancelA2 = await finalBillFor(ownerA, shopA, "A-CANCEL-2");

    let cancelledId = "";
    await check(client, "KB-325 sanity: owner A cancels their OWN final bill - one row, status 'cancelled'", async () => {
      await asUser(client, ownerA);
      const res = await cancelCall(shopA, cancelA.localId);
      cancelledId = res.rows[0].id as string;
      const bill = await client.query(`select status from bills where id = $1`, [cancelA.id]);
      const rows = await client.query(`select 1 from bill_cancellations where bill_id = $1`, [cancelA.id]);
      if (bill.rows[0]?.status !== "cancelled" || rows.rowCount !== 1) throw new Error(`status ${bill.rows[0]?.status}, rows ${rows.rowCount}`);
      return "cancelled, 1 row";
    });
    await check(client, "KB-325: cancel_bill again (a retry, or another device) is a no-op success - the same id, still one row", async () => {
      await asUser(client, ownerA);
      const again = await cancelCall(shopA, cancelA.localId, "other");
      const rows = await client.query(`select reason from bill_cancellations where bill_id = $1`, [cancelA.id]);
      if (again.rows[0].id !== cancelledId || rows.rowCount !== 1 || rows.rows[0].reason !== "wrong_price") throw new Error("not idempotent");
      return "same id, reason unchanged";
    });
    await checkRejects(client, "KB-325: owner A cannot cancel shop B's bill through cancel_bill - it is invisible under RLS (KB404)", "KB404", async () => {
      await asUser(client, ownerA);
      await cancelCall(shopB, cancelB.localId);
    });
    await checkRejects(client, "KB-325: owner A calling cancel_bill with shop B's id and A's bill is also unknown (KB404)", "KB404", async () => {
      await asUser(client, ownerA);
      await cancelCall(shopB, cancelA2.localId);
    });
    await checkRejects(client, "KB-325: the anon role cannot execute cancel_bill at all", "42501", async () => {
      await asAnon(client);
      await cancelCall(shopA, cancelA2.localId);
    });
    await checkRejects(client, "KB-348: owner A cannot create a SECOND shop - shops_one_per_owner (23505)", "23505", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into shops (id, owner_user_id, name, catalog_mode) values ($1, $2, 'Shop A again', 'custom_only')`, [randomUUID(), ownerA]);
    });
    await checkRejects(client, "KB-345: the anon role cannot execute sync_probe", "42501", async () => {
      await asAnon(client);
      await client.query("select sync_probe($1)", [shopA]);
    });
    await check(client, "KB-345: owner B probing shop A's stamps gets nothing (RLS) - every stamp null, no blocks", async () => {
      await asUser(client, ownerB);
      const r = await client.query("select sync_probe($1) as p", [shopA]);
      const p = r.rows[0].p as Record<string, unknown>;
      const stamps = Object.entries(p).filter(([k]) => k !== "receipt_number_blocks");
      if (stamps.some(([, v]) => v !== null)) throw new Error(`a stamp leaked: ${JSON.stringify(p)}`);
      if (JSON.stringify(p.receipt_number_blocks) !== "[0,0]") throw new Error(`blocks leaked: ${JSON.stringify(p.receipt_number_blocks)}`);
      return "all null";
    });
    await check(client, "KB-345 sanity: owner A probing their OWN shop sees a stamp for the shop row", async () => {
      await asUser(client, ownerA);
      const r = await client.query("select sync_probe($1) as p", [shopA]);
      if ((r.rows[0].p as { shops: unknown }).shops === null) throw new Error("own shop's stamp is null");
      return "shop stamp present";
    });
    // KB-351 (D92): the shop's bill-number counter - SECURITY INVOKER, RLS the boundary, never anon, never moved by hand.
    const numberBill = randomUUID();
    await check(client, "KB-351 sanity: owner A takes a number for shop A; the SAME bill asking again gets the same one; another bill gets the next", async () => {
      await asUser(client, ownerA);
      const take = async (bill: string) => Number((await client.query("select next_bill_number($1, $2) as n", [shopA, bill])).rows[0].n);
      const first = await take(numberBill);
      const again = await take(numberBill);
      const next = await take(randomUUID());
      if (!(first >= 1) || again !== first || next !== first + 1) throw new Error(`got ${first}, ${again}, ${next}`);
      return `${first}, ${again}, ${next}`;
    });
    await checkRejects(client, "KB-351: owner B cannot take a number for shop A (RLS refuses the counter row)", "42501", async () => {
      await asUser(client, ownerB);
      await client.query("select next_bill_number($1, $2)", [shopA, randomUUID()]);
    });
    await checkRejects(client, "KB-351: the anon role cannot execute next_bill_number", "42501", async () => {
      await asAnon(client);
      await client.query("select next_bill_number($1, $2)", [shopA, randomUUID()]);
    });
    await check(client, "KB-351 read isolation: owner B reads zero of shop A's counter and grants; owner A reads their own", async () => {
      await asUser(client, ownerB);
      const b = await client.query("select (select count(*) from shop_bill_counters where shop_id = $1) as c, (select count(*) from bill_number_grants where shop_id = $1) as g", [shopA]);
      await asUser(client, ownerA);
      const a = await client.query("select (select count(*) from shop_bill_counters where shop_id = $1) as c, (select count(*) from bill_number_grants where shop_id = $1) as g", [shopA]);
      if (Number(b.rows[0].c) !== 0 || Number(b.rows[0].g) !== 0) throw new Error("B saw shop A's counter or grants");
      if (Number(a.rows[0].c) !== 1 || Number(a.rows[0].g) < 2) throw new Error(`A sees ${a.rows[0].c} counter, ${a.rows[0].g} grants`);
      return "B 0 / 0, A 1 / " + a.rows[0].g;
    });
    await checkRejects(client, "KB-351: the counter only moves up by one - owner A's direct UPDATE to a far number is refused (KB409)", "KB409", async () => {
      await asUser(client, ownerA);
      await client.query("update shop_bill_counters set last_number = last_number + 1000 where shop_id = $1", [shopA]);
    });
    await check(client, "KB-351: owner B's UPDATE of shop A's counter affects zero rows; nobody can DELETE a counter or change / delete a grant", async () => {
      await asUser(client, ownerB);
      const bUpd = await client.query("update shop_bill_counters set last_number = last_number + 1 where shop_id = $1", [shopA]);
      await asUser(client, ownerA);
      const del = await client.query("delete from shop_bill_counters where shop_id = $1", [shopA]);
      const gUpd = await client.query("update bill_number_grants set bill_number = 999999 where shop_id = $1", [shopA]);
      const gDel = await client.query("delete from bill_number_grants where shop_id = $1", [shopA]);
      if (bUpd.rowCount !== 0 || del.rowCount !== 0 || gUpd.rowCount !== 0 || gDel.rowCount !== 0) throw new Error(`rows: ${bUpd.rowCount}, ${del.rowCount}, ${gUpd.rowCount}, ${gDel.rowCount}`);
      return "0 / 0 / 0 / 0";
    });
    await check(client, "KB-351: next_bill_number and its trigger function are SECURITY INVOKER (no security definer)", async () => {
      await asSuperuser(client);
      const r = await client.query("select proname, prosecdef from pg_proc where proname in ('next_bill_number', 'shop_bill_counter_step')");
      if (r.rowCount !== 2 || r.rows.some((x) => x.prosecdef)) throw new Error(JSON.stringify(r.rows));
      return "invoker";
    });
    await checkRejects(client, "KB-325: a reason outside the five is refused by the CHECK (23514) and leaves the bill final", "23514", async () => {
      await asUser(client, ownerA);
      await cancelCall(shopA, cancelA2.localId, "because");
    });
    await check(client, "KB-325: ...and that failed call left the bill final", async () => {
      await asUser(client, ownerA);
      const st = await client.query(`select status from bills where id = $1`, [cancelA2.id]);
      if (st.rows[0]?.status !== "final") throw new Error(`status ${st.rows[0]?.status}`);
      return "still final";
    });
    await check(client, "KB-325 read isolation: shop B cancels its own bill; owner A reads zero of B's cancellations and one of their own", async () => {
      await asUser(client, ownerB);
      await cancelCall(shopB, cancelB.localId);
      await asUser(client, ownerA);
      const mine = await client.query(`select 1 from bill_cancellations where shop_id = $1`, [shopA]);
      const theirs = await client.query(`select 1 from bill_cancellations where shop_id = $1`, [shopB]);
      if (mine.rowCount !== 1 || theirs.rowCount !== 0) throw new Error(`own ${mine.rowCount}, other ${theirs.rowCount}`);
      return "own 1, other 0";
    });
    await checkRejects(client, "KB-325: owner A cannot INSERT a bill_cancellations row into shop B", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into bill_cancellations (shop_id, bill_id, bill_local_id, reason, cancelled_at, local_id, device_id) values ($1, $2, $3, 'other', now(), gen_random_uuid(), 'test-device')`,
        [shopB, cancelB.id, cancelB.localId],
      );
    });
    await checkRejects(client, "KB-325 same-shop integrity: owner A cannot file a cancellation for shop B's bill under shop A (composite FK)", "23503", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into bill_cancellations (shop_id, bill_id, bill_local_id, reason, cancelled_at, local_id, device_id) values ($1, $2, $3, 'other', now(), gen_random_uuid(), 'test-device')`,
        [shopA, cancelB.id, cancelB.localId],
      );
    });
    await check(client, "KB-325 append-only: owner A's UPDATE and DELETE of their own cancellation affect zero rows", async () => {
      await asUser(client, ownerA);
      const upd = await client.query(`update bill_cancellations set reason = 'other' where shop_id = $1`, [shopA]);
      const del = await client.query(`delete from bill_cancellations where shop_id = $1`, [shopA]);
      if (upd.rowCount !== 0 || del.rowCount !== 0) throw new Error(`updated ${upd.rowCount}, deleted ${del.rowCount}`);
      return "0 updated, 0 deleted";
    });
    await checkRejects(client, "KB-325: a cancelled bill can never be modified afterwards (bills_enforce_immutability, D18)", "P0001", async () => {
      await asUser(client, ownerA);
      await client.query(`update bills set total_paise = 1 where id = $1`, [cancelA.id]);
    });

    // --- KB-404 (D80): bill_metrics - numbers and enums only, append-only, a member's own shop ------------------------
    const metricsInsert = (shopId: string, billId: string, billLocalId: string, over: { turns?: number } = {}) =>
      client.query(
        `insert into bill_metrics (shop_id, bill_id, bill_local_id, device_id, local_id, receipt_number, total_paise, line_count, turns, seconds_to_bill, utterances, voice_lines, edited_lines, manual_lines, removed_lines, not_added, flags_raised, flags_acknowledged, recorded_at)
         values ($1, $2, $3, 'test-device', gen_random_uuid(), 'R-1', 1000, 1, $4, 10, '[]'::jsonb, 1, 0, 0, 0, 0, 0, 0, now())`,
        [shopId, billId, billLocalId, over.turns ?? 1],
      );
    await check(client, "KB-404 sanity: owner A can insert a bill_metrics row for their OWN final bill", async () => {
      await asUser(client, ownerA);
      const res = await metricsInsert(shopA, cancelA2.id, cancelA2.localId);
      if (res.rowCount !== 1) throw new Error(`expected 1 row, got ${res.rowCount}`);
      return "accepted";
    });
    await checkRejects(client, "KB-404: a second metrics row for the same bill is refused (unique per bill)", "23505", async () => {
      await asUser(client, ownerA);
      await metricsInsert(shopA, cancelA2.id, cancelA2.localId);
    });
    await checkRejects(client, "KB-404: owner A cannot insert a bill_metrics row into shop B", "42501", async () => {
      await asUser(client, ownerA);
      await metricsInsert(shopB, cancelB.id, cancelB.localId);
    });
    await checkRejects(client, "KB-404 same-shop integrity: owner A cannot file metrics for shop B's bill under shop A (composite FK)", "23503", async () => {
      await asUser(client, ownerA);
      await metricsInsert(shopA, cancelB.id, cancelB.localId);
    });
    await checkRejects(client, "KB-404: a negative count is refused by the CHECK", "23514", async () => {
      await asUser(client, ownerA);
      await metricsInsert(shopA, cancelA.id, cancelA.localId, { turns: -1 });
    });
    await check(client, "KB-404 read isolation: shop B files its own; owner A reads one row (their own) and zero of B's", async () => {
      await asUser(client, ownerB);
      await metricsInsert(shopB, cancelB.id, cancelB.localId);
      await asUser(client, ownerA);
      const mine = await client.query(`select 1 from bill_metrics where shop_id = $1`, [shopA]);
      const theirs = await client.query(`select 1 from bill_metrics where shop_id = $1`, [shopB]);
      if (mine.rowCount !== 1 || theirs.rowCount !== 0) throw new Error(`own ${mine.rowCount}, other ${theirs.rowCount}`);
      return "own 1, other 0";
    });
    await check(client, "KB-404 append-only: owner A's UPDATE and DELETE of their own metrics row affect zero rows", async () => {
      await asUser(client, ownerA);
      const upd = await client.query(`update bill_metrics set turns = 9 where shop_id = $1`, [shopA]);
      const del = await client.query(`delete from bill_metrics where shop_id = $1`, [shopA]);
      if (upd.rowCount !== 0 || del.rowCount !== 0) throw new Error(`updated ${upd.rowCount}, deleted ${del.rowCount}`);
      return "0 updated, 0 deleted";
    });
    await checkRejects(client, "KB-404: the anon role cannot insert a bill_metrics row", "42501", async () => {
      await asAnon(client);
      await metricsInsert(shopA, cancelA.id, cancelA.localId);
    });
    await check(client, "KB-404: the server stamps updated_at - a client-sent value is ignored", async () => {
      await asUser(client, ownerB);
      const id = await finalBillFor(ownerB, shopB, "B-METRICS-2");
      await client.query(
        `insert into bill_metrics (shop_id, bill_id, bill_local_id, device_id, local_id, receipt_number, total_paise, line_count, turns, seconds_to_bill, voice_lines, edited_lines, manual_lines, removed_lines, not_added, flags_raised, flags_acknowledged, recorded_at, updated_at)
         values ($1, $2, $3, 'd', gen_random_uuid(), 'R-2', 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, now(), '2020-01-01')`,
        [shopB, id.id, id.localId],
      );
      const r = await client.query(`select updated_at from bill_metrics where bill_id = $1`, [id.id]);
      if (new Date(r.rows[0].updated_at).getFullYear() < 2026) throw new Error("a forged updated_at was kept");
      return "stamped by the server";
    });

    // --- KB-105b: the four things KB-105 left unproven ---------------------
    // (1) receipt_number_blocks  (2) base_products is read-only
    // (3) cross-shop READS of the four learning tables  (4) Storage `shop-logos`.
    // Each family has a positive control, so a check that "sees nothing" can't pass
    // just because the data never existed.

    // (1) receipt_number_blocks - insert/select/update policies on is_shop_member(shop_id); no delete policy.
    const blockA = randomUUID();
    const blockB = randomUUID();
    await asUser(client, ownerB);
    await client.query(
      `insert into receipt_number_blocks (id, shop_id, device_id, block_start, block_end, next_number) values ($1, $2, 'test-device', 1, 50, 1)`,
      [blockB, shopB],
    );
    await asUser(client, ownerA);
    await client.query(
      `insert into receipt_number_blocks (id, shop_id, device_id, block_start, block_end, next_number) values ($1, $2, 'test-device', 1, 50, 1)`,
      [blockA, shopA],
    );

    await check(client, "receipt_number_blocks read isolation (KB-105b): shop A reads zero blocks of any other shop", async () => {
      await asUser(client, ownerA);
      const other = await client.query(`select 1 from receipt_number_blocks where shop_id <> $1`, [shopA]);
      if (other.rowCount !== 0) throw new Error(`expected 0 rows of other shops' blocks, got ${other.rowCount}`);
      return "0 rows of any other shop's blocks, as expected";
    });
    await check(client, "receipt_number_blocks read sanity (KB-105b): shop A sees its own block (1)", async () => {
      await asUser(client, ownerA);
      const res = await client.query(`select 1 from receipt_number_blocks where shop_id = $1`, [shopA]);
      if (res.rowCount !== 1) throw new Error(`expected 1 row, got ${res.rowCount}`);
      return "1 row visible, as expected";
    });
    await checkRejects(client, "receipt_number_blocks write isolation (KB-105b): shop A cannot INSERT a block into shop B", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number) values ($1, 'test-device', 51, 100, 51)`,
        [shopB],
      );
    });
    await check(client, "receipt_number_blocks write isolation (KB-105b): shop A's UPDATE of shop B's block affects zero rows, and B's block is unchanged", async () => {
      await asUser(client, ownerA);
      const res = await client.query(`update receipt_number_blocks set next_number = 40 where id = $1`, [blockB]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows affected, got ${res.rowCount}`);
      await asSuperuser(client);
      const after = await client.query(`select next_number from receipt_number_blocks where id = $1`, [blockB]);
      if (Number(after.rows[0]?.next_number) !== 1) throw new Error(`shop B's next_number changed to ${after.rows[0]?.next_number}`);
      return "0 rows affected and next_number still 1";
    });
    await checkRejects(client, "receipt_number_blocks write isolation (KB-105b): shop A cannot move its own block into shop B (UPDATE shop_id)", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(`update receipt_number_blocks set shop_id = $1 where id = $2`, [shopB, blockA]);
    });
    await check(client, "receipt_number_blocks has no delete policy (KB-105b): shop A cannot delete even its OWN block (0 rows)", async () => {
      await asUser(client, ownerA);
      const res = await client.query(`delete from receipt_number_blocks where id = $1`, [blockA]);
      if (res.rowCount !== 0) throw new Error(`expected 0 rows deleted, got ${res.rowCount}`);
      await asSuperuser(client);
      const still = await client.query(`select 1 from receipt_number_blocks where id = $1`, [blockA]);
      if (still.rowCount !== 1) throw new Error("the block is gone");
      return "0 rows deleted and the block is still there";
    });

    // KB-334 (D73, D74): two devices of one shop must never hold overlapping receipt-number ranges.
    // The exclusion constraint refuses it (23P01) for ANY writer, whatever the client does.
    await checkRejects(client, "receipt_number_blocks no-overlap (KB-334): shop A cannot take a range that overlaps its own block [1-50]", "23P01", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number) values ($1, 'second-device', 25, 75, 25)`,
        [shopA],
      );
    });
    await check(client, "receipt_number_blocks no-overlap sanity (KB-334): the next range [51-100] is accepted, and a different shop may hold the same range [1-50]", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number) values ($1, 'second-device', 51, 100, 51)`,
        [shopA],
      );
      await asSuperuser(client);
      const same = await client.query(
        `select count(distinct shop_id)::int as shops from receipt_number_blocks where shop_id = any($1::uuid[]) and block_start = 1 and block_end = 50`,
        [[shopA, shopB]],
      );
      if (same.rows[0].shops !== 2) throw new Error(`expected both shops to hold [1-50], got ${same.rows[0].shops}`);
      return "adjacent accepted; the same range in two shops coexists";
    });
    await checkRejects(client, "receipt_number_blocks no-overlap (KB-334): a range that starts after it ends is refused", "22000", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into receipt_number_blocks (shop_id, device_id, block_start, block_end, next_number) values ($1, 'second-device', 200, 150, 200)`,
        [shopA],
      );
    });

    // (2) base_products - one SELECT policy; nobody but the migrations writes it.
    await asSuperuser(client);
    const baseFirst = await client.query(`select id, suggested_price_paise from base_products order by id limit 1`);
    if (baseFirst.rowCount !== 1) throw new Error("base_products is empty - the local seed (supabase db reset) is missing");
    const baseRow = { id: String(baseFirst.rows[0].id), price: Number(baseFirst.rows[0].suggested_price_paise) };
    await check(client, "base_products read sanity (KB-105b): an authenticated user can read the ready catalog", async () => {
      await asUser(client, ownerA);
      const res = await client.query(`select 1 from base_products limit 5`);
      if (res.rowCount === 0) throw new Error("expected rows (the local seed)");
      return `${res.rowCount} rows visible`;
    });
    await checkRejects(client, "base_products is read-only (KB-105b): an authenticated user cannot INSERT", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(
        `insert into base_products (catalog_version, display_name, guard_category, default_unit, suggested_price_paise) values (1, 'Smuggled', 'other', 'kg', 100)`,
      );
    });
    await check(client, "base_products is read-only (KB-105b): an authenticated user's UPDATE and DELETE affect zero rows, and the row is unchanged", async () => {
      await asUser(client, ownerA);
      const upd = await client.query(`update base_products set suggested_price_paise = 1 where id = $1`, [baseRow.id]);
      const del = await client.query(`delete from base_products where id = $1`, [baseRow.id]);
      if (upd.rowCount !== 0 || del.rowCount !== 0) throw new Error(`expected 0 / 0 rows, got ${upd.rowCount} / ${del.rowCount}`);
      await asSuperuser(client);
      const after = await client.query(`select suggested_price_paise from base_products where id = $1`, [baseRow.id]);
      if (after.rowCount !== 1 || Number(after.rows[0].suggested_price_paise) !== baseRow.price) throw new Error("the base row changed or is gone");
      return "0 / 0 rows affected; the row is unchanged";
    });
    await checkRejects(client, "base_products is read-only (KB-105b): the anon role cannot INSERT", "42501", async () => {
      await asAnon(client);
      await client.query(
        `insert into base_products (catalog_version, display_name, guard_category, default_unit, suggested_price_paise) values (1, 'Smuggled', 'other', 'kg', 100)`,
      );
    });

    // (3) cross-shop READS of the four learning tables (KB-307 proved only the writes).
    // Each statement names the placeholders it uses: $1 shop, $2 shop product, $3 a distinguishing word.
    const learningSeeds: Array<[string, string]> = [
      ["learned_aliases", `insert into learned_aliases (shop_id, alias, shop_product_id, confidence, source, local_id, device_id) values ($1, $3, $2, 0.5, 'confirmation', gen_random_uuid(), 'test-device')`],
      ["provisional_products", `insert into provisional_products (shop_id, spoken_name, seen_count, local_id, device_id) values ($1, $3, 1, gen_random_uuid(), 'test-device')`],
      ["price_observations", `insert into price_observations (shop_id, shop_product_id, observed_price_paise, local_id, device_id) values ($1, $2, 123, gen_random_uuid(), 'test-device')`],
      ["learning_events", `insert into learning_events (shop_id, bill_id, event_type, local_id, device_id) values ($1, null, 'learning_reset', gen_random_uuid(), 'test-device')`],
    ];
    for (const [shop, owner, product, word] of [
      [shopA, ownerA, shopProductA, "a-read"],
      [shopB, ownerB, shopProductB, "b-read"],
    ] as const) {
      await asUser(client, owner);
      for (const [, sql] of learningSeeds) {
        const all = [shop, product, word];
        const used = [1, 2, 3].filter((n) => sql.includes(`$${n}`));
        // Postgres wants parameters numbered 1..n with no gaps, so renumber the ones this statement uses.
        let renumbered = sql;
        used.forEach((n, i) => {
          renumbered = renumbered.split(`$${n}`).join(`$#${i + 1}`);
        });
        await client.query(renumbered.split("$#").join("$"), used.map((n) => all[n - 1]));
      }
    }
    for (const [table] of learningSeeds) {
      await check(client, `learning read isolation (KB-105b): shop A reads zero ${table} rows of any other shop`, async () => {
        await asUser(client, ownerA);
        const res = await client.query(`select 1 from ${table} where shop_id <> $1`, [shopA]);
        if (res.rowCount !== 0) throw new Error(`expected 0 rows, got ${res.rowCount}`);
        return "0 rows of another shop, as expected";
      });
    }
    await check(client, "learning read sanity (KB-105b): shop A sees its own row in each of the four learning tables", async () => {
      await asUser(client, ownerA);
      const seen: string[] = [];
      for (const [table] of learningSeeds) {
        const res = await client.query(`select 1 from ${table} where shop_id = $1`, [shopA]);
        if ((res.rowCount ?? 0) < 1) throw new Error(`${table}: expected at least 1 own row, got ${res.rowCount}`);
        seen.push(`${table} ${res.rowCount}`);
      }
      return seen.join(", ");
    });

    // (4) Storage `shop-logos` - public read, writes only by a member of the shop named by the FIRST FOLDER of the path.
    // Checked through the database role (what the Storage API runs as), not the HTTP API.
    // storage.protect_delete blocks direct DELETEs unless storage.allow_delete_query is 'true' - set it so the POLICY decides.
    const logoB = `${shopB}/logo.png`;
    const logoA = `${shopA}/logo.png`;
    await asSuperuser(client);
    await client.query(`insert into storage.objects (bucket_id, name) values ('shop-logos', $1)`, [logoB]);
    await client.query(`select set_config('storage.allow_delete_query', 'true', true)`);

    await checkRejects(client, "shop-logos (KB-105b): shop A cannot INSERT an object under shop B's folder", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into storage.objects (bucket_id, name) values ('shop-logos', $1)`, [`${shopB}/smuggled.png`]);
    });
    await check(client, "shop-logos sanity (KB-105b): shop A CAN insert an object under its own folder", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into storage.objects (bucket_id, name) values ('shop-logos', $1)`, [logoA]);
      return "accepted";
    });
    await check(client, "shop-logos (KB-105b): public read stays - shop A can SEE shop B's logo object", async () => {
      await asUser(client, ownerA);
      const res = await client.query(`select 1 from storage.objects where bucket_id = 'shop-logos' and name = $1`, [logoB]);
      if (res.rowCount !== 1) throw new Error(`expected 1 row, got ${res.rowCount}`);
      return "visible, as designed";
    });
    await check(client, "shop-logos (KB-105b): shop A's UPDATE and DELETE of shop B's logo affect zero rows", async () => {
      await asUser(client, ownerA);
      const upd = await client.query(`update storage.objects set metadata = '{"tampered":true}'::jsonb where bucket_id = 'shop-logos' and name = $1`, [logoB]);
      const del = await client.query(`delete from storage.objects where bucket_id = 'shop-logos' and name = $1`, [logoB]);
      if (upd.rowCount !== 0 || del.rowCount !== 0) throw new Error(`expected 0 / 0 rows, got ${upd.rowCount} / ${del.rowCount}`);
      return "0 / 0 rows affected";
    });
    await checkRejects(client, "shop-logos (KB-105b): shop A cannot RENAME its own object into shop B's folder (UPDATE name)", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(`update storage.objects set name = $1 where bucket_id = 'shop-logos' and name = $2`, [`${shopB}/moved.png`, logoA]);
    });
    await checkRejects(client, "shop-logos (KB-105b): a path whose first folder is not a shop id is rejected (invalid uuid)", "22P02", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into storage.objects (bucket_id, name) values ('shop-logos', 'not-a-shop/logo.png')`);
    });
    await checkRejects(client, "shop-logos (KB-105b): a path with no folder is rejected", "42501", async () => {
      await asUser(client, ownerA);
      await client.query(`insert into storage.objects (bucket_id, name) values ('shop-logos', 'logo.png')`);
    });
    await checkRejects(client, "shop-logos (KB-105b): the anon role cannot INSERT", "42501", async () => {
      await asAnon(client);
      await client.query(`insert into storage.objects (bucket_id, name) values ('shop-logos', $1)`, [`${shopA}/anon.png`]);
    });
    await check(client, "shop-logos (KB-105b): shop B's logo object is intact after all of that", async () => {
      await asSuperuser(client);
      const res = await client.query(`select metadata from storage.objects where bucket_id = 'shop-logos' and name = $1`, [logoB]);
      if (res.rowCount !== 1) throw new Error("the object is gone");
      if (res.rows[0].metadata !== null) throw new Error(`metadata changed: ${JSON.stringify(res.rows[0].metadata)}`);
      return "present, metadata untouched";
    });
  } finally {
    await client.query("rollback");
    await client.end();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    console.log(`\nFAILED:`);
    for (const f of failed) console.log(`  - ${f.name}\n    ${f.detail}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
