/**
 * Live check against a real AnyList account. Reads the account from an env file
 * (ANYLIST_EMAIL, ANYLIST_PASSWORD) and, only with --write, adds one test item to
 * the named list, checks it, and removes it again.
 *
 *   npm run smoke -- <env-file> <list name> [--write]
 */
import { readFileSync } from "node:fs";
import { AnyListClient } from "../src/index.js";

const [envPath, listName, flag] = process.argv.slice(2);
if (!envPath || !listName) {
  console.error("usage: npm run smoke -- <env-file> <list name> [--write]");
  process.exit(2);
}

const env: Record<string, string> = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m?.[1]) env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
}

const client = new AnyListClient({
  email: env.ANYLIST_EMAIL ?? "",
  password: env.ANYLIST_PASSWORD ?? "",
  tokenFile: `${envPath}.tokens`,
});

const list = await client.getListByName(listName);
if (!list) {
  console.error(`No list called "${listName}". Lists: ${(await client.getLists()).map((l) => l.name).join(", ")}`);
  process.exit(1);
}
const open = list.items.filter((i) => !i.checked);
console.log(`${list.name}: ${list.items.length} items, ${open.length} open`);
for (const item of open) console.log(`  [ ] ${item.name}${item.quantity ? ` (${item.quantity})` : ""}`);

if (flag === "--write") {
  const name = `claude-test-${Date.now()}`;
  const id = await client.addItem(list.id, { name, quantity: "2" });
  const find = async () => (await client.getListByName(listName))?.items.find((i) => i.id === id);
  console.log("added:", (await find())?.name === name);
  await client.setChecked(list.id, id, true);
  console.log("checked:", (await find())?.checked === true);
  await client.removeItem(list.id, id);
  console.log("removed:", (await find()) === undefined);
}
