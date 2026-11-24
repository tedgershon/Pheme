// Provisions the fixture accounts on the local stack and checks the servers
// under test use that stack. Safe to repeat: existing accounts are updated.

import {
  FIXTURE_BALANCE,
  FIXTURE_PASSWORD,
  ROLE_IDS,
  ROLES,
  type Role,
  roleEmail,
} from "./support/local-stack";
import { serviceClient, signInSession } from "./support/supabase";

async function provision(role: Role) {
  const auth = serviceClient().auth.admin;
  const id = ROLE_IDS[role];
  const attributes = {
    email: roleEmail(role),
    password: FIXTURE_PASSWORD,
    email_confirm: true,
    user_metadata: {
      andrew_id: `test-${role.replace("_", "-")}`,
      full_name: `Test ${role}`,
    },
  };
  const existing = await auth.getUserById(id);
  const { error } = existing.data.user
    ? await auth.updateUserById(id, attributes)
    : // The signup trigger creates the profile and its initial grant.
      await auth.createUser({ id, ...attributes });
  if (error) throw new Error(`Could not provision ${role}: ${error.message}`);

  // Roles and balances are setup state, written directly.
  const { error: profileError } = await serviceClient()
    .from("profiles")
    .update({ role, tartan_coin_balance: FIXTURE_BALANCE })
    .eq("id", id);
  if (profileError) {
    throw new Error(
      `Could not set the ${role} profile: ${profileError.message}`,
    );
  }
}

export default async function globalSetup() {
  for (const role of ROLES) await provision(role);

  // A backend pointed at another project rejects local tokens; fail once here
  // with a clear message instead of in every test.
  const apiURL = process.env.E2E_API_URL as string;
  const { accessToken } = await signInSession("user");
  let response: Response;
  try {
    response = await fetch(`${apiURL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error(`The backend is not reachable at ${apiURL}.`);
  }
  const profile = response.ok ? await response.json() : null;
  if (profile?.id !== ROLE_IDS.user) {
    throw new Error(
      `The backend at ${apiURL} did not accept a local fixture session (HTTP ${response.status}). ` +
        "Point it at the local Supabase stack (see frontend/README.md).",
    );
  }

  // A backend left running from another setup can accept the session but not
  // the frontend's origin; the browser then fails every API call with
  // net::ERR_FAILED. Send the preflight the browser would send.
  const origin = new URL(process.env.E2E_BASE_URL as string).origin;
  const preflight = await fetch(`${apiURL}/api/auth/me`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  if (preflight.headers.get("access-control-allow-origin") !== origin) {
    throw new Error(
      `The backend at ${apiURL} does not allow requests from ${origin} (CORS preflight HTTP ${preflight.status}). ` +
        `It is probably a server left running with other settings: stop whatever listens on port ${new URL(apiURL).port} ` +
        "so the suite starts its own, or set its CORS_ORIGINS to include that origin.",
    );
  }
}
