import type { IConnectionStore, StoredConnection } from "../../src/connection-service.ts";
import type { ResolvedCredential } from "../../src/core/types.ts";
import type { IProviderLoader } from "../../src/providers/provider-loader.ts";
import type { IRunLogStore, RunLog, RunLogPage } from "../../src/server/storage/runtime-store.ts";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog-store.ts";
import { ConnectionService } from "../../src/connection-service.ts";
import { ActionPolicyService, emptyPolicyRules } from "../../src/core/action-policy.ts";
import { createMcpServer } from "../../src/mcp.ts";
import { executorModules } from "../../src/providers/registry.generated.ts";
import { ActionRunner } from "../../src/server/actions/action-runner.ts";

export const connectedServices = ["googledocs", "googledrive", "sentry"];

export const cases: { tool: string; arguments: Record<string, unknown> }[] = [
  { tool: "search_actions", arguments: { service: "googledocs", query: "create document" } },
  { tool: "search_actions", arguments: { service: "sentry", query: "list organization issues" } },
  { tool: "search_actions", arguments: { service: "googledrive", query: "share file permission" } },
  { tool: "search_actions", arguments: { query: "list organization issues" } },
  { tool: "search_actions", arguments: { service: "npm", query: "package versions" } },
];

class MemoryConnectionStore implements IConnectionStore {
  private readonly connections: StoredConnection[];

  constructor(connections: StoredConnection[]) {
    this.connections = connections;
  }

  async get(service: string, connectionName: string): Promise<StoredConnection | undefined> {
    return this.connections.find((item) => item.service === service && item.connectionName === connectionName);
  }

  async set(): Promise<StoredConnection> {
    throw new Error("read-only store");
  }

  async updateCredential(): Promise<boolean> {
    return false;
  }

  async delete(): Promise<void> {}

  async list(): Promise<StoredConnection[]> {
    return this.connections;
  }
}

class NoRunLogStore implements IRunLogStore {
  async add(_run: RunLog): Promise<{ retentionApplied: boolean }> {
    return { retentionApplied: true };
  }

  async get(): Promise<RunLog | undefined> {
    return undefined;
  }

  async list(): Promise<RunLogPage> {
    return { items: [] };
  }
}

class NoProviderLoader implements IProviderLoader {
  async loadActionExecutor(): Promise<undefined> {
    return undefined;
  }

  async loadProxyExecutor(): Promise<undefined> {
    return undefined;
  }

  async loadCredentialValidators(): Promise<undefined> {
    return undefined;
  }
}

const root = join(import.meta.dirname, "../..");
const catalog = await loadCatalog(join(root, "catalog/apps"), {
  executableServices: Object.keys(executorModules),
});

const connections: StoredConnection[] = connectedServices.map((service) => {
  const oauth = catalog.providers
    .find((provider) => provider.service === service)
    ?.auth.find((auth) => auth.type === "oauth2");
  const credential: ResolvedCredential = {
    authType: "oauth2",
    accessToken: "bench-token",
    tokenType: "Bearer",
    profile: {
      accountId: "bench@example.com",
      displayName: "Bench Account",
      grantedScopes: oauth?.type === "oauth2" ? oauth.scopes : [],
    },
    metadata: {},
  };
  return { id: `bench-${service}`, revision: "1", service, connectionName: "default", credential };
});

const providerLoader = new NoProviderLoader();
const connectionService = new ConnectionService({
  catalog,
  providerLoader,
  store: new MemoryConnectionStore(connections),
});
const server = createMcpServer({
  catalog,
  connections: connectionService,
  actions: new ActionRunner({ catalog, providerLoader, connections: connectionService, runs: new NoRunLogStore() }),
  getPolicySnapshot: async () => new ActionPolicyService().createSnapshot(emptyPolicyRules()),
});
const client = new Client({ name: "mcp-token-usage", version: "0.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

async function call(tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }> {
  const result = await client.callTool({ name: tool, arguments: args });
  return result.structuredContent as { ok: boolean; data?: unknown };
}

async function guideKeepsScopes(actionId: string | undefined): Promise<boolean> {
  if (!actionId) return false;
  const guide = await call("get_action_guide", { actionId });
  const capability = (guide.data as { capability?: Record<string, unknown> } | undefined)?.capability;
  const profile = (capability?.connection as { profile?: { grantedScopes?: unknown } } | undefined)?.profile;
  return Array.isArray(capability?.requiredScopes) && Array.isArray(profile?.grantedScopes);
}

const report = [];
for (const item of cases) {
  const byDefault = await call(item.tool, item.arguments);
  const withLimit20 =
    item.tool === "search_actions" ? await call(item.tool, { ...item.arguments, limit: 20 }) : byDefault;
  const results = Array.isArray(withLimit20.data) ? withLimit20.data : [];
  report.push({
    tool: item.tool,
    arguments: item.arguments,
    defaultChars: JSON.stringify(byDefault).length,
    defaultResults: Array.isArray(byDefault.data) ? byDefault.data.length : 0,
    limit20Chars: JSON.stringify(withLimit20).length,
    limit20Results: results.length,
    connectionChars: results.reduce(
      (sum: number, action: { capability?: { connection?: unknown } }) =>
        sum + (action.capability?.connection ? JSON.stringify(action.capability.connection).length : 0),
      0,
    ),
    firstCapability: (results[0] as { capability?: unknown } | undefined)?.capability,
    guideKeepsScopes: await guideKeepsScopes((results[0] as { id?: string } | undefined)?.id),
  });
}
await client.close();
process.stdout.write(JSON.stringify(report));
