import assert from "node:assert/strict";
import { test } from "node:test";
import protobuf from "protobufjs";
import { AnyListClient, AnyListError } from "../src/index.js";
import { SCHEMA } from "../src/schema.js";

const root = protobuf.parse(SCHEMA).root;
const UserData = root.lookupType("pcov.proto.PBUserDataResponse");
const OperationList = root.lookupType("pcov.proto.PBListOperationList");
const CRLF = String.fromCharCode(13, 10);

function userDataBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    UserData.encode(
      UserData.create({
        shoppingListsResponse: {
          newLists: [
            {
              identifier: "list1",
              name: "Indkøb",
              items: [
                { identifier: "a", name: "Mælk", checked: false, quantityPb: { amount: "2" } },
                { identifier: "b", name: "Rugbrød", checked: true, deprecatedQuantity: "1" },
              ],
            },
          ],
        },
      }),
    ).finish(),
  );
}

interface DecodedOps {
  operations: Array<{
    metadata: { handlerId: string };
    listId: string;
    listItemId: string;
    updatedValue: string;
    listItem: { name: string; quantityPb: { amount: string } };
  }>;
}

/** Pull the protobuf bytes out of the hand-built multipart body. */
function operationsFrom(init: RequestInit): DecodedOps {
  const bytes = Buffer.from(init.body as Uint8Array);
  const start = bytes.indexOf(CRLF + CRLF) + 4;
  const end = bytes.lastIndexOf(`${CRLF}--`);
  const header = bytes.subarray(0, start).toString("utf8");
  assert.ok(header.includes(`name="operations"${CRLF}`));
  assert.ok(!header.includes("filename="), "AnyList ignores the field when it is sent as a file");
  return OperationList.toObject(OperationList.decode(new Uint8Array(bytes.subarray(start, end)))) as unknown as DecodedOps;
}

interface Call {
  path: string;
  init: RequestInit;
}

/** A fake AnyList: hands out tokens, can reject the first data call with 401, records calls. */
function fakeAnyList(options: { failFirstWith401?: boolean } = {}) {
  const calls: Call[] = [];
  let rejected = false;
  const fetchFake = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname.slice(1);
    calls.push({ path, init });
    if (path.startsWith("auth/")) {
      return Response.json({ access_token: `at${calls.length}`, refresh_token: `rt${calls.length}` });
    }
    if (options.failFirstWith401 && !rejected) {
      rejected = true;
      return new Response("", { status: 401 });
    }
    if (path === "data/user-data/get") return new Response(userDataBytes());
    return new Response("");
  }) as typeof fetch;
  return { calls, fetch: fetchFake };
}

function newClient(fetchImpl: typeof fetch) {
  return new AnyListClient({ email: "a@example.invalid", password: "x", fetch: fetchImpl });
}

test("getLists decodes lists, items and quantities", async () => {
  const fake = fakeAnyList();
  const lists = await newClient(fake.fetch).getLists();
  assert.equal(lists.length, 1);
  assert.equal(lists[0]?.name, "Indkøb");
  assert.deepEqual(
    lists[0]?.items.map((i) => [i.name, i.checked, i.quantity]),
    [
      ["Mælk", false, "2"],
      ["Rugbrød", true, "1"],
    ],
  );
  assert.equal(fake.calls[0]?.path, "auth/token");
});

test("getListByName ignores case and surrounding spaces", async () => {
  const client = newClient(fakeAnyList().fetch);
  assert.equal((await client.getListByName("  indkøb "))?.id, "list1");
  assert.equal(await client.getListByName("findes ikke"), undefined);
});

test("addItem sends an add-shopping-list-item operation", async () => {
  const fake = fakeAnyList();
  const id = await newClient(fake.fetch).addItem("list1", { name: "Toiletpapir", quantity: "3" });
  const update = fake.calls.find((c) => c.path === "data/shopping-lists/update");
  assert.ok(update);
  const op = operationsFrom(update.init).operations[0];
  assert.equal(op?.metadata.handlerId, "add-shopping-list-item");
  assert.equal(op?.listId, "list1");
  assert.equal(op?.listItemId, id);
  assert.equal(op?.listItem.name, "Toiletpapir");
  assert.equal(op?.listItem.quantityPb.amount, "3");
  assert.match(id, /^[0-9a-f]{32}$/);
});

test("setChecked sends y/n as the updated value", async () => {
  const fake = fakeAnyList();
  const client = newClient(fake.fetch);
  await client.setChecked("list1", "a", true);
  await client.setChecked("list1", "a", false);
  const values: string[] = [];
  for (const call of fake.calls.filter((c) => c.path === "data/shopping-lists/update")) {
    const op = operationsFrom(call.init).operations[0];
    assert.equal(op?.metadata.handlerId, "set-list-item-checked");
    values.push(op?.updatedValue ?? "");
  }
  assert.deepEqual(values, ["y", "n"]);
});

test("a 401 refreshes the token and retries once", async () => {
  const fake = fakeAnyList({ failFirstWith401: true });
  const lists = await newClient(fake.fetch).getLists();
  assert.equal(lists.length, 1);
  assert.deepEqual(
    fake.calls.map((c) => c.path),
    ["auth/token", "data/user-data/get", "auth/token/refresh", "data/user-data/get"],
  );
});

test("errors carry the status but never the credentials", async () => {
  const failing = (async () => new Response("", { status: 500 })) as typeof fetch;
  const client = new AnyListClient({ email: "a@example.invalid", password: "hemmeligt", fetch: failing });
  await assert.rejects(client.getLists(), (error: unknown) => {
    assert.ok(error instanceof AnyListError);
    assert.equal(error.status, 500);
    assert.ok(!error.message.includes("hemmeligt"));
    return true;
  });
});
