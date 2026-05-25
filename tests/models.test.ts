import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Provider = {
  providerId: string;
  provider: string;
  envKey: string;
  models: string[];
};

const here = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(
  readFileSync(join(here, "..", "models.json"), "utf-8"),
) as Provider[];

const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  "opencode-go": "https://opencode.ai/zen/go/v1",
  deepseek: "https://api.deepseek.com/v1",
  neuralwatt: "https://api.neuralwatt.com/v1",
};

class AuthRequiredError extends Error {
  constructor(public status: number) {
    super(`endpoint requires auth (HTTP ${status})`);
  }
}

async function listOpenAICompatibleModels(
  baseURL: string,
  apiKey: string | undefined,
): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseURL.replace(/\/$/, "")}/models`, { headers });
  if (res.status === 401 || res.status === 403) {
    throw new AuthRequiredError(res.status);
  }
  if (!res.ok) {
    throw new Error(
      `GET ${baseURL}/models failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { data: Array<{ id: string }> };
  return body.data.map((m) => m.id);
}

async function listGoogleModels(
  apiKey: string | undefined,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
    if (apiKey) url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) {
      throw new AuthRequiredError(res.status);
    }
    if (!res.ok) {
      throw new Error(
        `Google models.list failed: ${res.status} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      models?: Array<{ name: string }>;
      nextPageToken?: string;
    };
    for (const m of body.models ?? []) {
      ids.push(m.name.replace(/^models\//, ""));
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return ids;
}

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

async function listModelsFor(provider: Provider, apiKey: string | undefined) {
  if (provider.providerId === "google") {
    return listGoogleModels(apiKey);
  }
  const baseURL = OPENAI_COMPATIBLE_BASE_URLS[provider.providerId];
  if (!baseURL) {
    throw new Error(
      `No base URL configured for providerId="${provider.providerId}"`,
    );
  }
  return listOpenAICompatibleModels(baseURL, apiKey);
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
