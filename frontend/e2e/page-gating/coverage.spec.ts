import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "../fixtures";
import { readPageMatrix } from "./matrix";

// Every AUTHZ_MATRIX.md section 5 row needs a describePage() call in one of
// this directory's spec files, and every call must name a section 5 row.
test("every section 5 page row has a page-gating test", () => {
  const routes = [...readPageMatrix().keys()];
  expect(routes.length).toBeGreaterThan(0);

  const described = new Set<string>();
  for (const file of readdirSync(__dirname)) {
    if (!file.endsWith(".spec.ts")) continue;
    const source = readFileSync(`${__dirname}/${file}`, "utf-8");
    for (const match of source.matchAll(/describePage\("([^"]+)"/g)) {
      described.add(match[1]);
    }
  }

  expect([...described].sort()).toEqual([...routes].sort());
});
