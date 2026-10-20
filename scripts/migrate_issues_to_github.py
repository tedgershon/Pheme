#!/usr/bin/env python3
"""
One-time migration: turn the old `issues/*.md` frontmatter files into
real GitHub Issues, using the `gh` CLI.

Run this from inside your Pheme checkout, which still has the old `issues/`
folder sitting in it:

    cd Pheme
    gh auth login                       # if not already authenticated
    python scripts/migrate_issues_to_github.py --dry-run
    python scripts/migrate_issues_to_github.py

With no --repo flag, `gh` infers the target repo from this checkout's git
remote (i.e. Pheme itself). Pass --repo owner/repo explicitly only if you're
running this somewhere that isn't the Pheme checkout.

By default this skips issues/archive/ (status: done, already shipped) since
those don't need to become open GitHub Issues. Pass --include-done to create
them as closed issues instead, if you want the history preserved there too.

This is meant to run exactly once. Delete this script and the issues/
folder once you've confirmed the migration looks right.

Requires: pip install pyyaml
"""

import argparse
import subprocess
import sys
from pathlib import Path

import yaml

SKIP_FILES = {"README.md", "agent-prompt-template.md", "iteration-loop.md", "roadmap.md"}


def parse_issue_file(path: Path):
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    frontmatter = yaml.safe_load(parts[1]) or {}
    body = parts[2].strip()
    return frontmatter, body


def build_labels(frontmatter):
    labels = []
    status = frontmatter.get("status", "open")
    if status == "in-progress":
        labels.append("in-progress")
    else:
        labels.append("ready")
    if frontmatter.get("depends_on"):
        labels.append("blocked")
    return labels


def build_body(frontmatter, body, source_path):
    footer_lines = [f"\n---\n_Migrated from `{source_path}`._"]
    if frontmatter.get("depends_on"):
        footer_lines.append(f"Depends on (old id): {frontmatter['depends_on']}")
    if frontmatter.get("parallel_with"):
        footer_lines.append(f"Parallel with (old id): {frontmatter['parallel_with']}")
    return body + "\n".join(footer_lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=None,
                         help="owner/repo, e.g. tedgershon/Pheme. Optional: if omitted, "
                              "gh infers it from this checkout's git remote.")
    parser.add_argument("--issues-dir", default="issues", help="path to the old issues/ folder")
    parser.add_argument("--include-done", action="store_true",
                         help="also migrate issues/archive/ as closed issues")
    parser.add_argument("--dry-run", action="store_true", help="print what would be created, don't call gh")
    args = parser.parse_args()

    issues_dir = Path(args.issues_dir)
    if not issues_dir.exists():
        sys.exit(f"No such directory: {issues_dir}")

    files = sorted(p for p in issues_dir.glob("*.md") if p.name not in SKIP_FILES)
    if args.include_done:
        archive_dir = issues_dir / "archive"
        if archive_dir.exists():
            files += sorted(archive_dir.glob("*.md"))

    if not files:
        print("No issue files found.")
        return

    mapping = []
    for path in files:
        parsed = parse_issue_file(path)
        if parsed is None:
            print(f"Skipping {path} (no frontmatter)")
            continue
        frontmatter, body = parsed
        title = frontmatter.get("title", path.stem)
        is_done = frontmatter.get("status") == "done"
        labels = ["done"] if is_done else build_labels(frontmatter)
        full_body = build_body(frontmatter, body, path)

        print(f"{'[closed] ' if is_done else ''}{title}  (labels: {', '.join(labels)})")

        if args.dry_run:
            continue

        repo_flag = ["--repo", args.repo] if args.repo else []

        cmd = ["gh", "issue", "create", *repo_flag, "--title", title, "--body", full_body]
        for label in labels:
            cmd += ["--label", label]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  failed: {result.stderr.strip()}", file=sys.stderr)
            continue
        issue_url = result.stdout.strip()
        print(f"  created: {issue_url}")
        mapping.append((frontmatter.get("id", path.stem), issue_url))

        if is_done:
            issue_number = issue_url.rstrip("/").split("/")[-1]
            subprocess.run(["gh", "issue", "close", issue_number, *repo_flag],
                            capture_output=True, text=True)

    if mapping and not args.dry_run:
        print("\nOld id -> new issue (save this if anything still references the old ids):")
        for old_id, url in mapping:
            print(f"  {old_id}: {url}")
        print("\nDone. Once this looks right:")
        print("  git rm -r issues/ scripts/migrate_issues_to_github.py")


if __name__ == "__main__":
    main()