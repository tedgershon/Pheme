"""Configure local app servers for an explicitly selected hosted Supabase project."""

import argparse
import json
import re
import subprocess

from configure_local_env import ROOT, write_env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-ref", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9]{20}", args.project_ref):
        parser.error("Expected a Supabase project reference, not a URL or API key.")

    linked = ROOT / "supabase/.temp/project-ref"
    if not linked.exists() or linked.read_text().strip() != args.project_ref:
        raise SystemExit(
            "Link this checkout to the intended project before configuring it."
        )

    cli = ROOT / "node_modules/supabase/bin/supabase"
    if not cli.exists():
        cli = cli.with_suffix(".exe")
    result = subprocess.run(
        [
            str(cli),
            "projects",
            "api-keys",
            "--project-ref",
            args.project_ref,
            "--output",
            "json",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    keys = {
        item["name"]: item["api_key"]
        for item in json.loads(result.stdout)
        if item.get("api_key")
    }
    if not keys.get("anon") or not keys.get("service_role"):
        raise SystemExit(
            "Required hosted keys unavailable; no environment files changed."
        )

    url = f"https://{args.project_ref}.supabase.co"
    write_env(
        ROOT / "backend/.env",
        ROOT / "backend/.env.example",
        {
            "supabase_url": url,
            "supabase_key": keys["anon"],
            "supabase_service_role_key": keys["service_role"],
            # The API validates sessions through Supabase Auth, not a local JWT secret.
            "supabase_jwt_secret": "",
        },
    )
    write_env(
        ROOT / "frontend/.env.local",
        ROOT / "frontend/.env.local.example",
        {
            "NEXT_PUBLIC_SUPABASE_URL": url,
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": keys["anon"],
            "NEXT_PUBLIC_API_URL": "http://localhost:8000",
        },
    )
    print(f"Applications target {url}. Restart both application servers.")


if __name__ == "__main__":
    main()
