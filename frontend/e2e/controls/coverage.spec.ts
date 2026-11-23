import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "../fixtures";
import { CONTROL_SECTIONS, readControlRows } from "./matrix";

// Every AUTHZ_MATRIX.md 6a, 6b and 6c row needs a describeControl() call in one
// of this directory's spec files, and every call must name a row.
test("every section 6 control row has a control-visibility test", () => {
  const rows = CONTROL_SECTIONS.flatMap((section) =>
    readControlRows(section).map((name) => `${section} ${name}`),
  );

  const described = new Set<string>();
  const call = /describeControl\(\s*"(6[abc])",\s*(["'])((?:(?!\2).)+)\2/g;
  for (const file of readdirSync(__dirname)) {
    if (!file.endsWith(".spec.ts")) continue;
    const source = readFileSync(`${__dirname}/${file}`, "utf-8");
    for (const match of source.matchAll(call)) {
      described.add(`${match[1]} ${match[3]}`);
    }
  }

  expect([...described].sort()).toEqual([...rows].sort());
});
