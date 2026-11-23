// Control-visibility tests for docs/AUTHZ_MATRIX.md section 6. Each spec file
// in this directory wraps a row's tests in describeControl(), and
// coverage.spec.ts fails when a 6a, 6b or 6c row has no such call.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "../fixtures";
import { REPO_ROOT } from "../support/local-stack";

export type ControlSection = "6a" | "6b" | "6c";
export const CONTROL_SECTIONS: readonly ControlSection[] = ["6a", "6b", "6c"];

/** A row's control name as tests spell it: the first cell without backticks. */
export function controlName(cell: string): string {
  return cell.replaceAll("`", "").trim();
}

/** Control names of one section 6 table, in document order. */
export function readControlRows(section: ControlSection): string[] {
  const doc = readFileSync(
    path.join(REPO_ROOT, "docs/AUTHZ_MATRIX.md"),
    "utf-8",
  );
  const heading = new RegExp(`^### ${section}\\. .*$`, "m");
  const body = doc.split(heading)[1]?.split(/^##+ /m)[0];
  if (!body) throw new Error(`AUTHZ_MATRIX.md has no section ${section}`);
  const rows: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const first = controlName(line.split("|")[1] ?? "");
    if (!first || first === "Control" || /^-+$/.test(first)) continue;
    rows.push(first);
  }
  if (rows.length === 0) throw new Error(`Section ${section} has no rows`);
  return rows;
}

/**
 * Groups one section 6 row's tests. A name that is not a row in that section
 * fails, so a renamed row cannot silently orphan its tests.
 */
export function describeControl(
  section: ControlSection,
  name: string,
  body: () => void,
) {
  test.describe(`§${section} ${name}`, () => {
    if (!readControlRows(section).includes(name)) {
      test("is a section 6 row", () => {
        throw new Error(
          `"${name}" is not a row in AUTHZ_MATRIX.md §${section}`,
        );
      });
      return;
    }
    body();
  });
}

/** Section 4b cells that a browser can observe. */
export type ControlCell = "visible" | "disabled" | "hidden";

/**
 * Asserts one cell for every locator. `visible` means rendered and enabled.
 * Callers first wait for a marker that only renders once the page knows the
 * viewer and market state, so `hidden` cannot pass on a half-loaded page.
 */
export async function expectCell(cell: ControlCell, ...controls: Locator[]) {
  for (const control of controls) {
    if (cell === "hidden") {
      await expect(control).toHaveCount(0);
    } else {
      await expect(control).toBeVisible();
      if (cell === "disabled") await expect(control).toBeDisabled();
      else await expect(control).toBeEnabled();
    }
  }
}
