import { writeFileSync } from "node:fs";
import {
  AuthRequiredError,
  listModelsFor,
  loadRegistry,
  REGISTRY_PATH,
  type Provider,
} from "../src/providers.js";

type Result =
  | { kind: "ok"; added: string[]; stale: string[] }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; error: unknown };

async function syncProvider(provider: Provider): Promise<Result> {
  let live: string[];
  try {
    live = await listModelsFor(provider, undefined);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return {
        kind: "skipped",
        reason: `/models requires auth (HTTP ${err.status}) — sync supports only open endpoints`,
      };
    }
    return { kind: "error", error: err };
  }

  const known = new Set(provider.models);
  const liveSet = new Set(live);
  const added = live.filter((m) => !known.has(m));
  const stale = provider.models.filter((m) => !liveSet.has(m));
  provider.models = [...provider.models, ...added];
  return { kind: "ok", added, stale };
}

function summarize(provider: Provider, result: Result): void {
  const tag = `[${provider.providerId}]`;
  if (result.kind === "skipped") {
    console.log(`${tag} skipped — ${result.reason}`);
    return;
  }
  if (result.kind === "error") {
    console.log(`${tag} error — ${(result.error as Error).message ?? result.error}`);
    return;
  }
  if (result.added.length === 0 && result.stale.length === 0) {
    console.log(`${tag} up to date (${provider.models.length} models)`);
    return;
  }
  if (result.added.length > 0) {
    console.log(`${tag} added ${result.added.length}:`);
    for (const m of result.added) console.log(`    + ${m}`);
  }
  if (result.stale.length > 0) {
    console.log(
      `${tag} stale in models.json but missing from /models (kept — review manually):`,
    );
    for (const m of result.stale) console.log(`    ? ${m}`);
  }
}

async function main(): Promise<void> {
  const registry = loadRegistry();
  const results: Array<{ provider: Provider; result: Result }> = [];

  for (const provider of registry) {
    const result = await syncProvider(provider);
    summarize(provider, result);
    results.push({ provider, result });
  }

  const anyChange = results.some(
    (r) => r.result.kind === "ok" && r.result.added.length > 0,
  );

  if (anyChange) {
    writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    const totalAdded = results.reduce(
      (sum, r) =>
        sum + (r.result.kind === "ok" ? r.result.added.length : 0),
      0,
    );
    console.log(
      `\nWrote ${REGISTRY_PATH} — ${totalAdded} new model(s) added across all providers. Review the diff before committing.`,
    );
  } else {
    console.log("\nNo new models to add. models.json unchanged.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
