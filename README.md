# summer-anylist

A small, unofficial TypeScript client for [AnyList](https://www.anylist.com) shopping lists.
Read your lists, add items, check them off, rename them and remove them. Nothing else.

> **Unofficial.** AnyList has no public API. This client talks to the same endpoints as the AnyList web app, which
> were reverse engineered by others (see [Credits](#credits)). AnyList can change them at any time and this can
> break without warning. It is not affiliated with or endorsed by AnyList. Check AnyList's terms before relying on it.

- Node 20 or newer, ESM, built-in `fetch`. One runtime dependency (`protobufjs`).
- Small on purpose (about 300 lines): no recipes, no meal planner, no websocket.

## Use

```ts
import { AnyListClient } from "summer-anylist";

const client = new AnyListClient({
  email: process.env.ANYLIST_EMAIL!,
  password: process.env.ANYLIST_PASSWORD!,
  tokenFile: "./anylist.tokens", // optional: keeps the login between runs
});

const list = await client.getListByName("Groceries");
for (const item of list?.items ?? []) {
  console.log(item.checked ? "[x]" : "[ ]", item.name, item.quantity);
}

const id = await client.addItem(list!.id, { name: "Milk", quantity: "2" });
await client.setChecked(list!.id, id, true);
await client.removeItem(list!.id, id);
```

Methods: `getLists`, `getListByName`, `addItem`, `setChecked`, `setName`, `setDetails`, `setQuantity`,
`removeItem`, `uncheckAll`.

The client logs in on first use, refreshes the token when AnyList answers 401, and logs in again if the refresh fails.

## Credentials

Your AnyList email and password are only ever sent to `https://www.anylist.com/auth/token`. Keep them in an
environment variable or a file outside your repository, never in code. If your account signs in with Google or Apple
and has no password, set a password in the AnyList account settings first.

`tokenFile` stores the access and refresh token **in plain text** (file mode 600 where the OS supports it). Keep it out
of version control. Leave `tokenFile` out to keep tokens in memory only.

## Develop

```bash
npm install
npm test                      # unit tests against a fake AnyList, no network
npm run smoke -- ./my.env "My list"            # live, read only
npm run smoke -- ./my.env "My list" --write    # live: adds, checks and removes one test item
```

`my.env` holds `ANYLIST_EMAIL=...` and `ANYLIST_PASSWORD=...`. Run the live check against a list you do not mind
touching.

## Credits

The protobuf message definitions come from the MIT-licensed [`anylist`](https://github.com/codetheweb/anylist) package
by Max Isom, which reverse engineered the AnyList web app. This project is a separate, smaller implementation.
