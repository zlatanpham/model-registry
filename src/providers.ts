import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Provider = {
  providerId: string;
  provider: string;
  envKey: string;
  models: string[];
};

export const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  "opencode-go": "https://opencode.ai/zen/go/v1",
  deepseek: "https://api.deepseek.com/v1",
  neuralwatt: "https://api.neuralwatt.com/v1",
};

export class AuthRequiredError extends Error {
  constructor(public status: number) {
    super(`endpoint requires auth (HTTP ${status})`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
export const REGISTRY_PATH = join(here, "..", "models.json");

export function loadRegistry(): Provider[] {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Provider[];
}

export async function listOpenAICompatibleModels(
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

export async function listGoogleModels(
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

export async function listModelsFor(
  provider: Provider,
  apiKey: string | undefined,
): Promise<string[]> {
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
