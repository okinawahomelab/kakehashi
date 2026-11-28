import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("only the saved default view chooses the starting layout", () => {
  assert.match(html, /getItem\("ig-starter-default-view"\) === "columns"\) document\.documentElement\.dataset\.layout/);
  assert.doesNotMatch(html, /ig-starter-layout/); // switching views must not save anything
  assert.equal(html.match(/setItem\("ig-starter-default-view"/g).length, 1);
});
