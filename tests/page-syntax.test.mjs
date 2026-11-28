import test from "node:test";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

test("inline page scripts parse", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  if (!scripts.length) throw new Error("no inline script found");
  for (const [, code] of scripts) new Script(code);
});
