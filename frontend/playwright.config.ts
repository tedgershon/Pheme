import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { localStack, REPO_ROOT } from "./e2e/support/local-stack";

// Separate ports from the usual dev servers (3000/8000), which may point at the
// hosted project. Override both URLs to test servers you started yourself.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:8100";
process.env.E2E_API_URL = apiURL;
process.env.E2E_BASE_URL = baseURL;

const stack = localStack();

// CI and custom URLs bring their own servers; local runs start them here with
// the local stack in the environment, which overrides the apps' .env files.
const managedServers = !process.env.CI && !process.env.PLAYWRIGHT_BASE_URL;

// `pnpm e2e:prod` serves a production build instead of `next dev`, as CI does.
// The session-token checks in hygiene/ only run on a production build.
const productionBuild =
  managedServers && process.env.npm_lifecycle_event === "e2e:prod";
const frontendPort = new URL(baseURL).port;

const frontendEnv = {
  // Its own build directory, so it can run beside `pnpm dev`.
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_PUBLIC_SUPABASE_URL: stack.supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
  NEXT_PUBLIC_API_URL: apiURL,
  NEXT_PUBLIC_SENTRY_DSN: "",
  SENTRY_DSN: "",
  // A token in the shell would make the production build upload source maps.
  SENTRY_AUTH_TOKEN: "",
};

function python() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  for (const candidate of [".venv/Scripts/python.exe", ".venv/bin/python"]) {
    const found = path.join(REPO_ROOT, candidate);
    if (existsSync(found)) return found;
  }
  return "python";
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  globalSetup: "./e2e/global-setup.ts",
  // The fixture accounts are shared, so tests run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "on-failure" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: managedServers
    ? [
        // Frontend first: Playwright starts these in order and does not stop
        // the earlier ones when a later one cannot start (such as a taken port).
        productionBuild
          ? {
              command: `pnpm exec next build && pnpm exec next start --hostname localhost --port ${frontendPort}`,
              url: baseURL,
              // A server already on this port is a dev server or an older
              // build, so stop with Playwright's "already used" error instead.
              reuseExistingServer: false,
              timeout: 600_000,
              // Show the build's progress; it takes a few minutes.
              stdout: "pipe",
              env: frontendEnv,
            }
          : {
              command: `pnpm exec next dev --hostname localhost --port ${frontendPort}`,
              url: baseURL,
              reuseExistingServer: true,
              timeout: 180_000,
              env: frontendEnv,
            },
        {
          command: `"${python()}" -m uvicorn main:app --host 127.0.0.1 --port ${new URL(apiURL).port}`,
          cwd: path.join(REPO_ROOT, "backend"),
          url: `${apiURL}/`,
          reuseExistingServer: true,
          timeout: 60_000,
          env: {
            SUPABASE_URL: stack.supabaseUrl,
            SUPABASE_KEY: stack.anonKey,
            SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey,
            SUPABASE_JWT_SECRET: stack.jwtSecret,
            CORS_ORIGINS: JSON.stringify([baseURL]),
            CORS_ORIGIN_REGEX: "",
            SENTRY_DSN: "",
            SENTRY_ENVIRONMENT: "e2e",
          },
        },
      ]
    : undefined,
});
