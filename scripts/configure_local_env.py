"""Copy running local Supabase credentials into ignored app environment files."""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write_env(path, template, updates):
    text = (path if path.exists() else template).read_text(encoding="utf-8")
    for key, value in updates.items():
        pattern = rf"(?im)^{re.escape(key)}=.*$"
        line = f"{key}={value}"
        if re.search(pattern, text):
            text = re.sub(pattern, lambda _, replacement=line: replacement, text)
        else:
            text += f"\n{line}\n"
    path.write_text(text, encoding="utf-8")
    print(f"Configured {path.relative_to(ROOT)} (credentials hidden).")


def main():
    cli = ROOT / "node_modules/supabase/bin/supabase"
    if not cli.exists():
        cli = cli.with_suffix(".exe")
    result = subprocess.run(
        [str(cli), "status", "-o", "json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    status = json.loads(result.stdout)
    if status.get("API_URL") != "http://127.0.0.1:45321":
        raise SystemExit(
            "Expected the local Pheme API on port 45321; refusing to write credentials."
        )
    for key in ("ANON_KEY", "SERVICE_ROLE_KEY", "JWT_SECRET"):
        if not status.get(key):
            raise SystemExit(f"Local status is missing {key}; no files changed.")
    write_env(
        ROOT / "backend/.env",
        ROOT / "backend/.env.example",
        {
            "supabase_url": status["API_URL"],
            "supabase_key": status["ANON_KEY"],
            "supabase_service_role_key": status["SERVICE_ROLE_KEY"],
            "supabase_jwt_secret": status["JWT_SECRET"],
        },
    )
    write_env(
        ROOT / "frontend/.env.local",
        ROOT / "frontend/.env.local.example",
        {
            "NEXT_PUBLIC_SUPABASE_URL": status["API_URL"],
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": status["ANON_KEY"],
            "NEXT_PUBLIC_API_URL": "http://localhost:8000",
        },
    )


if __name__ == "__main__":
    main()
