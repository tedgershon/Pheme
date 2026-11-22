// Connection details for the disposable local Supabase stack used by the
// browser suite. The suite writes users, markets, bets and balances, so it must
// never reach the shared hosted project or production: everything here is read
// from the local CLI and checked against the loopback Docker API before use.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "../../..");

// The Docker project's API port from supabase/config.toml.
const LOCAL_API_URL = "http://127.0.0.1:45321";

export interface LocalStack {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
}

function assertLocal(url: string): string {
  if (url !== LOCAL_API_URL) {
    throw new Error(
      `Browser tests only run against the local Docker Supabase (${LOCAL_API_URL}); got ${url || "nothing"}. ` +
        "Start it with `npx --no-install supabase start` from the repository root.",
    );
  }
  return url;
}

function readStatus(): LocalStack {
  const bin = path.join(REPO_ROOT, "node_modules/supabase/bin/supabase");
  const cli = existsSync(bin) ? bin : `${bin}.exe`;
  let output: string;
  try {
    output = execFileSync(cli, ["status", "-o", "json"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Could not read the local Supabase status. Run `npm ci` and `npx --no-install supabase start` from the repository root.",
    );
  }
  // The CLI can print update notices around the JSON document.
  const status = JSON.parse(output.slice(output.indexOf("{")));
  const stack = {
    supabaseUrl: assertLocal(status.API_URL ?? ""),
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    jwtSecret: status.JWT_SECRET,
  };
  for (const [key, value] of Object.entries(stack)) {
    if (!value) throw new Error(`Local Supabase status is missing ${key}.`);
  }
  return stack;
}

/**
 * Local stack credentials. The first call (in the Playwright runner) asks the
 * CLI and stores the result in the environment so worker processes and the
 * web servers inherit it without running the CLI again.
 */
export function localStack(): LocalStack {
  const env = process.env;
  if (
    env.E2E_SUPABASE_URL &&
    env.E2E_SUPABASE_ANON_KEY &&
    env.E2E_SUPABASE_SERVICE_ROLE_KEY &&
    env.E2E_SUPABASE_JWT_SECRET
  ) {
    return {
      supabaseUrl: assertLocal(env.E2E_SUPABASE_URL),
      anonKey: env.E2E_SUPABASE_ANON_KEY,
      serviceRoleKey: env.E2E_SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: env.E2E_SUPABASE_JWT_SECRET,
    };
  }
  const stack = readStatus();
  env.E2E_SUPABASE_URL = stack.supabaseUrl;
  env.E2E_SUPABASE_ANON_KEY = stack.anonKey;
  env.E2E_SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  env.E2E_SUPABASE_JWT_SECRET = stack.jwtSecret;
  return stack;
}

export type Role = "user" | "admin" | "super_admin";

export const ROLES: readonly Role[] = ["user", "admin", "super_admin"];

// The same stable identities as the backend API fixtures (#11).
export const ROLE_IDS: Record<Role, string> = JSON.parse(
  readFileSync(
    path.join(REPO_ROOT, "backend/tests/fixture_identities.json"),
    "utf-8",
  ),
);

export function roleEmail(role: Role): string {
  return `test-${role.replace("_", "-")}@andrew.cmu.edu`;
}

// Local-only password for the disposable fixture accounts.
export const FIXTURE_PASSWORD = "pheme-e2e-fixture-password";

export const FIXTURE_BALANCE = 1000;
