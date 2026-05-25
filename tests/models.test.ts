import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuthRequiredError,
  listModelsFor,
  loadRegistry,
} from "../src/providers.js";

const registry = loadRegistry();

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function closestMatches(target: string, candidates: string[], n = 3): string[] {
  const lower = target.toLowerCase();
  return candidates
    .map((c) => ({ c, d: editDistance(lower, c.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(({ c }) => c);
}

for (const provider of registry) {
  describe(`${provider.provider} (${provider.providerId})`, () => {
    const apiKey = process.env[provider.envKey];

    let available: string[] = [];
    let listError: unknown;
    let authSkip = false;
    const missing: string[] = [];

    beforeAll(async () => {
      try {
        available = await listModelsFor(provider, apiKey);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          authSkip = true;
        } else {
          listError = err;
        }
      }
    });

    afterAll(() => {
      if (missing.length === 0) return;
      const lines = [
        ``,
        `─── ${provider.provider} (${provider.providerId}): ${missing.length}/${provider.models.length} model(s) missing from /models ───`,
        ...missing.map((m) => {
          const suggestions = closestMatches(m, available, 3);
          return `  ✗ ${m}\n      did you mean: ${suggestions.join(", ") || "(no candidates)"}`;
        }),
        ``,
        `  Full list from ${provider.providerId}/models (${available.length}):`,
        ...available.map((m) => `    • ${m}`),
        ``,
      ];
      console.warn(lines.join("\n"));
    });

    for (const modelId of provider.models) {
      it(`exposes "${modelId}"`, (ctx) => {
        if (authSkip) {
          console.warn(
            `[${provider.providerId}] skipped — set ${provider.envKey} in .env to list models`,
          );
          ctx.skip();
        }
        if (listError) throw listError;
        if (!available.includes(modelId)) {
          missing.push(modelId);
          const suggestions = closestMatches(modelId, available, 3);
          expect.fail(`not in ${provider.providerId}/models — did you mean: ${suggestions.join(", ") || "(no candidates)"}`);
        }
      });
    }
  });
}
