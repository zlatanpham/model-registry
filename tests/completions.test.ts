import { describe, expect, it } from "vitest";
import {
  loadRegistry,
  probeOpenAICompatibleModel,
  resolveBaseURL,
} from "../src/providers.js";

// Live completion tests make real, billable API calls. They are opt-in:
//   RUN_LIVE_COMPLETIONS=1 npm test    (or: npm run test:live)
// Without the flag the whole suite is skipped so the default run stays cheap.
const LIVE = process.env.RUN_LIVE_COMPLETIONS === "1";

const registry = loadRegistry();

describe.skipIf(!LIVE)("live chat completions", () => {
  for (const provider of registry) {
    const baseURL = resolveBaseURL(provider);
    const apiKey = process.env[provider.envKey];

    describe(`${provider.provider} (${provider.providerId})`, () => {
      for (const model of provider.models) {
        // Skip non-OpenAI-compatible providers (e.g. google) and any
        // provider whose API key is not set in the environment.
        it.skipIf(!baseURL || !apiKey)(
          `responds for "${model}"`,
          async () => {
            const content = await probeOpenAICompatibleModel(
              baseURL!,
              apiKey,
              model,
            );
            expect(content.trim().length).toBeGreaterThan(0);
          },
          30_000,
        );
      }
    });
  }
});
