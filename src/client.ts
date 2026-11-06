import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import protobuf from "protobufjs";
import { SCHEMA } from "./schema.js";

const root = protobuf.parse(SCHEMA).root;
const UserData = root.lookupType("pcov.proto.PBUserDataResponse");
const ListOperation = root.lookupType("pcov.proto.PBListOperation");
const ListOperationList = root.lookupType("pcov.proto.PBListOperationList");

export interface AnyListItem {
  id: string;
  listId: string;
  name: string;
  details: string;
  quantity: string;
  checked: boolean;
  category: string;
}

export interface AnyListList {
  id: string;
  name: string;
  items: AnyListItem[];
}

export interface NewItem {
  name: string;
  details?: string;
  quantity?: string;
}

export interface AnyListOptions {
  email: string;
  password: string;
  /** Where to keep the access/refresh tokens between runs. Omit to keep them in memory only. */
  tokenFile?: string;
  /** Override for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface Tokens {
  clientId: string;
  accessToken?: string;
  refreshToken?: string;
}

/** Error from AnyList with the HTTP status and the path that failed. Never contains credentials. */
export class AnyListError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "AnyListError";
  }
}

export class AnyListClient {
  private readonly email: string;
  private readonly password: string;
  private readonly tokenFile: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private tokens: Tokens | undefined;

  constructor(options: AnyListOptions) {
    this.email = options.email;
    this.password = options.password;
    this.tokenFile = options.tokenFile;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://www.anylist.com").replace(/\/$/, "");
  }

  /** Log in (reusing saved tokens when there are any). Called automatically by the other methods. */
  async login(): Promise<void> {
    const tokens = await this.loadTokens();
    if (!tokens.accessToken || !tokens.refreshToken) {
      await this.fetchTokens(tokens);
    }
  }

  /** All lists on the account with their items (checked and unchecked). */
  async getLists(): Promise<AnyListList[]> {
    const response = await this.authed("data/user-data/get", { method: "POST" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = UserData.toObject(UserData.decode(bytes), {
      defaults: true,
      arrays: true,
    }) as {
      shoppingListsResponse?: { newLists?: RawList[] };
    };
    return (decoded.shoppingListsResponse?.newLists ?? []).map(toList);
  }

  async getListByName(name: string): Promise<AnyListList | undefined> {
    const wanted = name.trim().toLowerCase();
    return (await this.getLists()).find((l) => l.name.trim().toLowerCase() === wanted);
  }

  /** Add an item to a list and return its id. */
  async addItem(listId: string, item: NewItem): Promise<string> {
    const itemId = newId();
    await this.send([
      {
        handlerId: "add-shopping-list-item",
        listId,
        listItemId: itemId,
        listItem: {
          identifier: itemId,
          listId,
          name: item.name,
          details: item.details ?? "",
          checked: false,
          ...(item.quantity ? { quantityPb: { amount: item.quantity } } : {}),
        },
      },
    ]);
    return itemId;
  }

  async setChecked(listId: string, itemId: string, checked: boolean): Promise<void> {
    await this.setField(listId, itemId, "set-list-item-checked", checked ? "y" : "n");
  }

  async setName(listId: string, itemId: string, name: string): Promise<void> {
    await this.setField(listId, itemId, "set-list-item-name", name);
  }

  async setDetails(listId: string, itemId: string, details: string): Promise<void> {
    await this.setField(listId, itemId, "set-list-item-details", details);
  }

  async setQuantity(listId: string, itemId: string, quantity: string): Promise<void> {
    await this.setField(listId, itemId, "set-list-item-quantity", quantity);
  }

  /** Remove an item from a list for good. */
  async removeItem(listId: string, itemId: string): Promise<void> {
    await this.send([
      {
        handlerId: "remove-shopping-list-item",
        listId,
        listItemId: itemId,
        listItem: { identifier: itemId, listId },
      },
    ]);
  }

  async uncheckAll(listId: string): Promise<void> {
    await this.send([{ handlerId: "uncheck-all", listId }]);
  }

  private async setField(listId: string, itemId: string, handlerId: string, value: string) {
    await this.send([{ handlerId, listId, listItemId: itemId, updatedValue: value }]);
  }

  private async send(
    ops: Array<{
      handlerId: string;
      listId: string;
      listItemId?: string;
      updatedValue?: string;
      listItem?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    const list = ListOperationList.create({
      operations: ops.map((op) =>
        ListOperation.create({
          metadata: { operationId: newId(), handlerId: op.handlerId },
          listId: op.listId,
          listItemId: op.listItemId,
          updatedValue: op.updatedValue,
          listItem: op.listItem,
        }),
      ),
    });
    const { body, contentType } = multipartBinary("operations", ListOperationList.encode(list).finish());
    await this.authed("data/shopping-lists/update", {
      method: "POST",
      body,
      headers: { "content-type": contentType },
    });
  }

  /** Request with the bearer token; on 401 refresh once (or log in again) and retry. */
  private async authed(path: string, init: RequestInit): Promise<Response> {
    const tokens = await this.loadTokens();
    if (!tokens.accessToken) await this.fetchTokens(tokens);

    let response = await this.request(path, init, tokens);
    if (response.status === 401) {
      await this.refreshTokens(tokens);
      response = await this.request(path, init, tokens);
    }
    if (!response.ok) {
      throw new AnyListError(`AnyList answered ${response.status} for ${path}`, response.status, path);
    }
    return response;
  }

  private request(path: string, init: RequestInit, tokens: Tokens): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}/${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        "X-AnyLeaf-API-Version": "3",
        "X-AnyLeaf-Client-Identifier": tokens.clientId,
        authorization: `Bearer ${tokens.accessToken}`,
      },
      redirect: "manual",
    });
  }

  private async fetchTokens(tokens: Tokens): Promise<void> {
    const form = new FormData();
    form.append("email", this.email);
    form.append("password", this.password);
    await this.exchange("auth/token", form, tokens);
  }

  private async refreshTokens(tokens: Tokens): Promise<void> {
    if (!tokens.refreshToken) return this.fetchTokens(tokens);
    const form = new FormData();
    form.append("refresh_token", tokens.refreshToken);
    try {
      await this.exchange("auth/token/refresh", form, tokens);
    } catch (error) {
      if (error instanceof AnyListError && error.status === 401) {
        return this.fetchTokens(tokens);
      }
      throw error;
    }
  }

  private async exchange(path: string, body: FormData, tokens: Tokens): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method: "POST",
      body,
      headers: { "X-AnyLeaf-API-Version": "3" },
      redirect: "manual",
    });
    if (!response.ok) {
      throw new AnyListError(`AnyList answered ${response.status} for ${path}`, response.status, path);
    }
    const json = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token || !json.refresh_token) {
      throw new AnyListError(`AnyList sent no tokens from ${path}`, response.status, path);
    }
    tokens.accessToken = json.access_token;
    tokens.refreshToken = json.refresh_token;
    await this.saveTokens(tokens);
  }

  private async loadTokens(): Promise<Tokens> {
    if (this.tokens) return this.tokens;
    let tokens: Tokens = { clientId: newId() };
    if (this.tokenFile) {
      try {
        const saved = JSON.parse(await readFile(this.tokenFile, "utf8")) as Partial<Tokens>;
        if (saved.clientId) {
          tokens = {
            clientId: saved.clientId,
            ...(saved.accessToken ? { accessToken: saved.accessToken } : {}),
            ...(saved.refreshToken ? { refreshToken: saved.refreshToken } : {}),
          };
        }
      } catch {
        // No or unreadable token file: start fresh.
      }
    }
    this.tokens = tokens;
    return tokens;
  }

  private async saveTokens(tokens: Tokens): Promise<void> {
    if (!this.tokenFile) return;
    await mkdir(dirname(this.tokenFile), { recursive: true });
    await writeFile(this.tokenFile, JSON.stringify(tokens), { mode: 0o600 });
  }
}

interface RawItem {
  identifier: string;
  listId: string;
  name: string;
  details: string;
  checked: boolean;
  category: string;
  deprecatedQuantity: string;
  quantityPb?: { amount?: string };
}

interface RawList {
  identifier: string;
  name: string;
  items: RawItem[];
}

function toList(list: RawList): AnyListList {
  return {
    id: list.identifier,
    name: list.name,
    items: list.items.map((i) => ({
      id: i.identifier,
      listId: i.listId || list.identifier,
      name: i.name,
      details: i.details,
      quantity: i.quantityPb?.amount || i.deprecatedQuantity || "",
      checked: i.checked,
      category: i.category,
    })),
  };
}

/**
 * A multipart/form-data body with one binary field and no filename. AnyList ignores the
 * field when it arrives as a "file" (the filename="blob" that FormData adds for a Blob),
 * so the body is built by hand.
 */
function multipartBinary(field: string, bytes: Uint8Array): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = `----tiny-anylist-${randomUUID()}`;
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** AnyList ids are UUIDs without dashes. */
function newId(): string {
  return randomUUID().replaceAll("-", "");
}
