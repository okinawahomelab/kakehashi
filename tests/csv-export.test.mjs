import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("CSV export leaves out fresh-search (session-only) channels", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const src = html.slice(html.indexOf("function csvCell("), html.indexOf("function openMine("));
  const mine = [
    { net: "yt", name: "Kept", url: "u1", t: "d", transient: 0 },
    { net: "yt", name: "Fresh", url: "u2", t: "d", transient: 123 },
  ];
  const csv = new Function("mine", src + "return mineCsv();")(mine);
  assert.match(csv, /Kept/);
  assert.doesNotMatch(csv, /Fresh|u2/);
});
