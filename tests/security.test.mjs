import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { onRequestGet } from "../functions/search.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../scripts/request-budgets.sql", import.meta.url), "utf8"));
  const binding = {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...values) {
          return {
            first: async () => statement.get(...values),
            run: async () => statement.run(...values)
          };
        }
      };
    }
  };
  return { db, binding };
}

function call(query, binding, ip = "192.0.2.10") {
  const request = new Request("https://example.com/search?" + query, {
    headers: { "CF-Connecting-IP": ip }
  });
  return onRequestGet({
    request, env: { KAKEHASHI_LIMITS: binding, YOUTUBE_API_KEY: "test-key" }, waitUntil() {}
  });
}

test("CSV quotes every field and neutralizes formula prefixes without changing normal names", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.slice(html.indexOf("function csvCell("), html.indexOf("function openMine("));
  const csv = runInNewContext(code + "\nmineCsv()", {
    mine: [
      { net: "yt", name: "日本語, \"例\"", url: "https://example.com", t: "2026-11-19" },
      { net: "ig", name: "  ＝1+1", url: "@example", t: "\t3" },
      { net: "yt", name: "\nNormal", url: "+value", t: "-value" }
    ]
  });
  assert.equal(csv, 'network,name,link,added\n' +
    '"yt","日本語, ""例""","https://example.com","2026-11-19"\n' +
    '"ig","\'  ＝1+1","\'@example","\'\t3"\n' +
    '"yt","\'\nNormal","\'+value","\'-value"');
});

test("SearXNG search keeps service credentials server-side and enforces its shared budget", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://search.private.example");
    assert.equal(parsed.pathname, "/search");
    assert.equal(parsed.searchParams.has("secret"), false);
    assert.equal(options.headers["CF-Access-Client-Id"], "test-id");
    assert.equal(options.headers["CF-Access-Client-Secret"], "private-test-secret");
    assert.equal(options.redirect, "manual");
    return Response.json({results:[
      {url:"https://www.instagram.com/reel/Abc_12345/",title:"Food"},
      {url:"https://instagram.com.evil.example/reel/Abc_67890/"},
      {url:"https://www.instagram.com/reel/bad/route"}
    ]});
  });
  const context = () => ({request:new Request("https://example.com/search?social=instagram&q=cooking",{headers:{"CF-Connecting-IP":"192.0.2.10"}}),env:{KAKEHASHI_LIMITS:binding,SEARXNG_URL:"https://search.private.example/search",SEARXNG_ACCESS_ID:"test-id",SEARXNG_ACCESS_SECRET:"private-test-secret"},waitUntil(){}});
  const first = await onRequestGet(context()); const body = await first.json();
  assert.equal(first.status, 200); assert.equal(body.items.length, 1);
  assert.ok(!JSON.stringify(body).includes("private-test-secret"));
  const day = Math.floor(Date.now()/86400000);
  db.prepare("UPDATE searx_search_quota SET used=200 WHERE day=?").run(day);
  assert.equal((await onRequestGet(context())).status,429); assert.equal(calls,1);
});

test("optional Exa TikTok search filters results, keeps its key secret, and enforces its quota", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, "https://api.exa.ai/search");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-api-key"], "private-exa-test-key");
    assert.equal(options.redirect, "manual");
    assert.deepEqual(JSON.parse(options.body), { query: "日本の料理", type: "lite", numResults: 10, includeDomains: ["tiktok.com"] });
    return Response.json({ results: [
      { url: "https://www.tiktok.com/@chef/video/7041096289777487106", title: "料理" },
      { url: "https://www.tiktok.com/@chef/video/7041096289777487106" },
      { url: "https://tiktok.com.evil.example/@chef/video/7041096289777487106" },
      { url: "https://www.tiktok.com/tag/food" }
    ] });
  });
  const context = { request: new Request("https://example.com/search?social=tiktok&q=" + encodeURIComponent("日本の料理"), { headers: { "CF-Connecting-IP": "192.0.2.10" } }), env: { KAKEHASHI_LIMITS: binding, EXA_API_KEY: "private-exa-test-key" }, waitUntil() {} };
  const response = await onRequestGet(context);
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.items.length, 1);
  assert.equal(body.items[0].handle, "chef");
  assert.ok(!JSON.stringify(body).includes("private-exa-test-key"));
  db.prepare("UPDATE exa_search_quota SET used=100 WHERE day=?").run(Math.floor(Date.now() / 86400000));
  assert.equal((await onRequestGet(context)).status, 429); assert.equal(calls, 1);
  assert.equal((await onRequestGet({ ...context, request: new Request("https://example.com/search?social=instagram&q=food", { headers: { "CF-Connecting-IP": "192.0.2.10" } }) })).status, 503);
});

test("Social Fetch Instagram search keeps its key private, validates links and limits shared use", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(new URL(url).origin, "https://api.socialfetch.dev");
    assert.equal(new URL(url).searchParams.get("query"), "日本語 会話");
    assert.equal(options.headers["x-api-key"], "private-social-key");
    assert.equal(options.redirect, "manual");
    return Response.json({ data: { media: [
      { url: "https://www.instagram.com/reel/Abc_12345/", caption: "会話" },
      { url: "https://www.instagram.com/reel/Abc_12345/" },
      { url: "https://instagram.com.evil.example/reel/Abc_67890/" }
    ] } });
  });
  const context = { request: new Request("https://example.com/search?social=instagram&q=" + encodeURIComponent("日本語 会話"), { headers: { "CF-Connecting-IP": "192.0.2.10" } }), env: { KAKEHASHI_LIMITS: binding, SOCIAL_FETCH_API_KEY: "private-social-key" }, waitUntil() {} };
  const response = await onRequestGet(context); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, "Abc_12345");
  assert.ok(!JSON.stringify(body).includes("private-social-key"));
  const cached = await onRequestGet(context);
  assert.deepEqual(await cached.json(), body); assert.equal(calls, 1);
  db.prepare("DELETE FROM instagram_search_cache").run();
  db.prepare("UPDATE social_search_quota SET used=50 WHERE month=?").run("social-fetch:" + Math.floor(Date.now() / 86400000));
  assert.equal((await onRequestGet(context)).status, 429); assert.equal(calls, 1);
});

test("Instagram search caches matching queries for six hours without charging quota again", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ data: { media: [{ url: "https://www.instagram.com/reel/Abc_12345/", caption: "日本語" }] } });
  });
  const context = q => ({ request: new Request("https://example.com/search?social=instagram&q=" + encodeURIComponent(q), { headers: { "CF-Connecting-IP": "192.0.2.10" } }), env: { KAKEHASHI_LIMITS: binding, SOCIAL_FETCH_API_KEY: "test-key" }, waitUntil() {} });
  assert.equal((await onRequestGet(context("猫  会話"))).status, 200);
  assert.equal((await onRequestGet(context("猫 会話"))).status, 200);
  assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT used FROM social_search_quota").get().used, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instagram_search_cache WHERE query_hash LIKE '%猫%'").get().n, 0);
  db.prepare("UPDATE instagram_search_cache SET expires=0").run();
  assert.equal((await onRequestGet(context("猫 会話"))).status, 200);
  assert.equal(calls, 2);
});

test("simultaneous matching Instagram searches share one upstream request", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 50));
    return Response.json({ data: { media: [{ url: "https://www.instagram.com/reel/Abc_12345/" }] } });
  });
  const context = ip => ({ request: new Request("https://example.com/search?social=instagram&q=cat", { headers: { "CF-Connecting-IP": ip } }), env: { KAKEHASHI_LIMITS: binding, SOCIAL_FETCH_API_KEY: "test-key" }, waitUntil() {} });
  const [a, b] = await Promise.all([onRequestGet(context("192.0.2.1")), onRequestGet(context("192.0.2.2"))]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT used FROM social_search_quota").get().used, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instagram_search_inflight").get().n, 0);
});

test("concurrent exhausted-credit searches share the helpful error and recover", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let calls = 0, exhausted = true;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 50));
    return exhausted
      ? Response.json({ error: { code: "insufficient_credits" } }, { status: 402 })
      : Response.json({ data: { media: [{ url: "https://www.instagram.com/reel/Abc_12345/" }] } });
  });
  const context = ip => ({ request: new Request("https://example.com/search?social=instagram&q=cat", { headers: { "CF-Connecting-IP": ip } }), env: { KAKEHASHI_LIMITS: binding, SOCIAL_FETCH_API_KEY: "test-key" }, waitUntil() {} });
  const [a, b] = await Promise.all([onRequestGet(context("192.0.2.1")), onRequestGet(context("192.0.2.2"))]);
  assert.equal(a.status, 503); assert.equal(b.status, 503);
  assert.deepEqual(await a.json(), { error: "instagram search credits unavailable" });
  assert.deepEqual(await b.json(), { error: "instagram search credits unavailable" });
  assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instagram_search_inflight").get().n, 0);
  assert.equal((await onRequestGet(context("192.0.2.3"))).status, 503);
  assert.equal(calls, 1);
  db.prepare("UPDATE instagram_search_cache SET expires=0").run();
  exhausted = false;
  const recovered = await onRequestGet(context("192.0.2.4"));
  assert.equal(recovered.status, 200); assert.equal((await recovered.json()).items.length, 1);
  assert.equal(calls, 2);
});

test("an expired Instagram search lease can be recovered", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cat"));
  const key = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
  db.prepare("INSERT INTO instagram_search_inflight VALUES (?, ?, ?)").run(key, "old-token", 1);
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: { media: [{ url: "https://www.instagram.com/reel/Abc_12345/" }] } }));
  const response = await onRequestGet({ request: new Request("https://example.com/search?social=instagram&q=cat", { headers: { "CF-Connecting-IP": "192.0.2.10" } }), env: { KAKEHASHI_LIMITS: binding, SOCIAL_FETCH_API_KEY: "test-key" }, waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instagram_search_inflight").get().n, 0);
});

test("Social Fetch failures and redirects fail closed", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 302, headers: { location: "https://example.invalid" } }));
  const response = await onRequestGet({ request: new Request("https://example.com/search?social=instagram&q=food", { headers: { "CF-Connecting-IP": "192.0.2.10" } }), env: { KAKEHASHI_LIMITS: binding, SOCIAL_FETCH_API_KEY: "private-key" }, waitUntil() {} });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes("private-key"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instagram_search_inflight").get().n, 0);
});

test("exhausted Social Fetch credits produce a distinct safe error without real requests", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let code = "insufficient_credits";
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code, message: "private upstream detail" } }, { status: 402 }));
  const call = q => onRequestGet({ request: new Request("https://example.com/search?social=instagram&q=" + q, { headers: { "CF-Connecting-IP": "192.0.2.10" } }), env: { KAKEHASHI_LIMITS: binding, SOCIAL_FETCH_API_KEY: "private-key" }, waitUntil() {} });
  const exhausted = await call("food");
  assert.equal(exhausted.status, 503);
  assert.deepEqual(await exhausted.json(), { error: "instagram search credits unavailable" });
  code = "payment_required";
  const other = await call("travel");
  assert.equal(other.status, 502);
  assert.deepEqual(await other.json(), { error: "social search unavailable" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM instagram_search_inflight").get().n, 0);
});

test("social search explains exhausted credits and keeps other search results", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.slice(html.indexOf("async function runSocialSearch("), html.indexOf("function profileUrl("));
  const element = () => ({ children: [], append(...x) { this.children.push(...x); }, replaceChildren() { this.children = []; }, querySelector() { return null; } });
  const host = element();
  const context = { URL, AbortSignal, location: { href: "https://example.com/app/" }, searchGen: 1, $: () => host, document: { createElement: element }, fetch: async url => url.searchParams.get("social") === "instagram" ? Response.json({ error: "instagram search credits unavailable" }, { status: 503 }) : Response.json({ items: [] }) };
  await runInNewContext(code + "\nrunSocialSearch('food', 1)", context);
  assert.match(host.children[0].children[1].textContent, /credits or spending limit/);
  assert.match(host.children[0].children[1].textContent, /Starter Reels and other searches/);
  assert.equal(host.children[1].children[1].textContent, "No public videos returned for this search.");
});

test("Exa redirects fail without sending the key to another host", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, "https://api.exa.ai/search");
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://example.invalid/" } });
  });
  const response = await onRequestGet({ request: new Request("https://example.com/search?social=tiktok&q=food", { headers: { "CF-Connecting-IP": "192.0.2.10" } }), env: { KAKEHASHI_LIMITS: binding, EXA_API_KEY: "private-test-key" }, waitUntil() {} });
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.ok(!(await response.text()).includes("private-test-key"));
});

test("social search rejects unsafe configuration, mixed and invalid requests", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  const request = query => ({request:new Request("https://example.com/search?"+query,{headers:{"CF-Connecting-IP":"192.0.2.10"}}),env:{KAKEHASHI_LIMITS:binding},waitUntil(){}});
  assert.equal((await onRequestGet(request("social=tiktok&q=food"))).status,503);
  assert.equal((await onRequestGet(request("social=tiktok&q=food&feed=UCabcdefghijklmnopqrstuv"))).status,400);
  assert.equal((await onRequestGet(request("social=other&q=food"))).status,400);
  const unsafe=request("social=tiktok&q=food"); Object.assign(unsafe.env,{SEARXNG_URL:"http://localhost/search",SEARXNG_ACCESS_ID:"id",SEARXNG_ACCESS_SECRET:"secret"});
  assert.equal((await onRequestGet(unsafe)).status,503);
});

test("upstream rate limits are not mistaken for empty search results", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  t.mock.method(globalThis, "fetch", async () => Response.json({results:[{url:"https://example.com/unrelated"}],unresponsive_engines:[["google cse","too many requests"]]}));
  const response=await onRequestGet({request:new Request("https://example.com/search?social=tiktok&q=food",{headers:{"CF-Connecting-IP":"192.0.2.10"}}),env:{KAKEHASHI_LIMITS:binding,SEARXNG_URL:"https://search.private.example/search",SEARXNG_ACCESS_ID:"id",SEARXNG_ACCESS_SECRET:"secret"},waitUntil(){}});
  assert.equal(response.status,502);
});

test("self-hosted search may use a bearer token without exposing it", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer local-test-secret");
    assert.equal(new URL(url).searchParams.has("token"), false);
    return Response.json({results:[{url:"https://www.tiktok.com/@chef/video/7041096289777487106"}]});
  });
  const response=await onRequestGet({request:new Request("https://example.com/search?social=tiktok&q=food",{headers:{"CF-Connecting-IP":"192.0.2.10"}}),env:{KAKEHASHI_LIMITS:binding,SEARXNG_URL:"https://search.private.example/search",SEARXNG_AUTH_TOKEN:"local-test-secret"},waitUntil(){}});
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.items[0].handle, "chef");
  assert.ok(!JSON.stringify(body).includes("local-test-secret"));
});

test("social search is opt-in and TikTok results use the isolated player", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const checkbox = html.match(/<input[^>]*id="socialSearch"[^>]*>/)?.[0] || "";
  assert.ok(checkbox); assert.doesNotMatch(checkbox, /\bchecked\b/);
  const code = html.slice(html.indexOf("async function runSearch("), html.indexOf("function profileUrl("));
  assert.match(code, /if \(\$\("socialSearch"\)\.checked\)\s*\{[^}]*void runSocialSearch/s);
  assert.match(code, /isolatedTikTokPlayer\(id, handle\)/);
  assert.doesNotMatch(code, /tiktok\.com\/player\/v1/);
});

test("concurrent searches share an atomic weighted budget and block before fetching", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  let fetches = 0;
  let now = 60_000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    fetches++;
    return Response.json({});
  });
  const responses = await Promise.all(Array.from({ length: 7 }, () => call("q=ramen", binding)));
  assert.deepEqual(responses.map(result => result.status).sort(), [200, 200, 200, 200, 200, 429, 429]);
  const retry = Number(responses.find(result => result.status === 429).headers.get("retry-after"));
  assert.ok(retry >= 1 && retry <= 60);
  assert.equal(fetches, 5);
  assert.equal((await call("q=ramen", binding, "192.0.2.11")).status, 200);
  assert.equal((await call("q=ramen")).status, 503);
  assert.equal((await call("q=anime", binding, "192.0.2.12")).status, 200);
  assert.equal(fetches, 7);
  now += 60_000;
  assert.equal((await call("q=ramen", binding)).status, 200);
  assert.equal(fetches, 8);
});

test("the shared deadline aborts body reads and returns 504", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    assert.equal(milliseconds, 8000);
    return controller.signal;
  });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    assert.equal(signal, controller.signal);
    return new Response(new ReadableStream({
      start(stream) {
        signal.addEventListener("abort", () => stream.error(signal.reason), { once: true });
        queueMicrotask(() => controller.abort());
      }
    }));
  });
  assert.equal((await call("feed=UCabcdefghijklmnopqrstuv", binding)).status, 504);
});

test("Instagram cards and ranking previews prefer the same curated clips without feed lookup", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const manifest = html.slice(html.indexOf("const curatedInstagramReels ="), html.indexOf("let igRequestSerial"));
  const lookup = html.slice(html.indexOf("async function reelsOf("), html.indexOf("function igPoster("));
  const { reelsOf, fetchReels } = runInNewContext(manifest + lookup + "\n({ reelsOf, fetchReels })", {
    fetch: () => assert.fail("Curated clips should skip feed lookup")
  });
  const card = await reelsOf("ryuji_foodlabo");
  assert.equal(card.ok, true);
  assert.equal(card.reels.length, 2);
  assert.equal(new Set(card.reels).size, 2);
  assert.deepEqual((await fetchReels("RYUJI_FOODLABO", 12)).reels, card.reels);
  assert.deepEqual((await fetchReels("ryuji_foodlabo", 1)).reels, card.reels.slice(0, 1));
});

test("unavailable Instagram previews offer the account without asking for a Reel link", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.slice(html.indexOf("async function playIg("), html.indexOf("function playIgEmbed("));
  assert.match(code, /Instagram preview unavailable/);
  assert.match(code, /Open Instagram/);
  assert.doesNotMatch(code, /paste|createElement\("form"\)/i);
});

test("Kikitori handoff uses the platform launcher's local origin", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.slice(html.indexOf("function kikitoriLink("), html.indexOf("function openKikitoriImport("));
  for (const [platform, host] of [["macOS", "localhost:8800"], ["Windows", "127.0.0.1:8800"], ["Linux", "127.0.0.1:8800"]]) {
    const makeLink = runInNewContext(code + "\nkikitoriLink", { URL, URLSearchParams, location: { search: "" }, navigator: { userAgentData: { platform }, userAgent: "Desktop" } });
    const link = makeLink("M7lc1UVf-VE");
    assert.equal(link.host, host);
    assert.equal(link.searchParams.get("add"), "https://www.youtube.com/watch?v=M7lc1UVf-VE");
    const native = runInNewContext(code + "\nnativeKikitoriLink", { URL, navigator: { userAgentData: { platform }, userAgent: "Desktop" } });
    assert.equal(native("M7lc1UVf-VE"), platform === "macOS" ? "kikitori://play?video=M7lc1UVf-VE" : "");
    assert.equal(native("bad&video=other"), "");
  }
});

test("search returns playable YouTube video results in order with thumbnails", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  const id = "UCabcdefghijklmnopqrstuv";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    assert.equal(options.headers["X-Goog-Api-Key"], "test-key");
    assert.equal(parsed.searchParams.has("key"), false);
    assert.equal(parsed.origin, "https://www.googleapis.com");
    assert.equal(parsed.pathname, "/youtube/v3/search");
    assert.equal(parsed.searchParams.get("type"), "video");
    assert.equal(parsed.searchParams.get("videoEmbeddable"), "true");
    return Response.json({ items: [
      { id: { videoId: "abcdefghijk" }, snippet: { channelId: id, channelTitle: "料理", title: "説明", thumbnails: { medium: { url: "https://i.ytimg.com/first.jpg" } } } },
      { id: { videoId: "12345678901" }, snippet: { channelId: "UC1234567890123456789012", channelTitle: "二番目", title: "紹介" } }
    ] });
  });
  const response = await call("q=cooking", binding);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.channels.length, 2);
  assert.deepEqual(result.channels.map(c => c.name), ["料理", "二番目"]);
  assert.equal(result.channels[0].note, "説明");
  assert.deepEqual(result.channels[0].videos, [["abcdefghijk", "説明"]]);
  assert.equal(result.channels[0].thumbnail, "https://i.ytimg.com/first.jpg");
  assert.equal(result.channels[0].channelId, id);
});

test("personal-key search returns playable video results in one request", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.slice(html.indexOf("async function personalYoutubeSearch("), html.indexOf("async function searchFetch("));
  const search = runInNewContext(code + "\npersonalYoutubeSearch", { googleYoutube: async (path, params) => { assert.equal(path, "search"); assert.equal(params.type, "video"); assert.equal(params.videoEmbeddable, "true"); return { items: [
    { id: { videoId: "abcdefghijk" }, snippet: { channelId: "UCabcdefghijklmnopqrstuv", channelTitle: "料理", title: "説明" } },
    { id: { videoId: "12345678901" }, snippet: { channelId: "UC1234567890123456789012", channelTitle: "二", title: "動画" } }
  ] }; } });
  const result = await search(new URLSearchParams("q=cooking"));
  assert.equal(result.channels.length, 2);
  assert.equal(result.channels[0].name, "料理");
  assert.equal(result.channels[0].videos[0][0], "abcdefghijk");
});

test("missing API configuration returns 503 without exposing a key", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  const response = await onRequestGet({
    request: new Request("https://example.com/search?q=cooking", { headers: { "CF-Connecting-IP": "192.0.2.2" } }),
    env: { KAKEHASHI_LIMITS: binding }, waitUntil() {}
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "YouTube API key not configured");
});

test("shared YouTube search quota stops all clients before exceeding the budget", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetches++;
    return Response.json({ items: [] });
  });
  const replies = await Promise.all(Array.from({ length: 91 }, (_, i) =>
    call("q=ramen", binding, "192.0.2." + (i + 1))));
  assert.equal(replies.filter(response => response.status === 200).length, 90);
  assert.equal(replies.filter(response => response.status === 429).length, 1);
  assert.equal(fetches, 90);
});

test("video status lookup fails closed and does not consume search quota", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  let body = { items: [{ status: { madeForKids: true } }] };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/youtube/v3/videos");
    assert.equal(parsed.searchParams.get("part"), "id,status");
    assert.equal(parsed.searchParams.get("id"), "abcdefghijk");
    assert.equal(options.headers["X-Goog-Api-Key"], "test-key");
    return Response.json(body);
  });
  let response = await call("kids=abcdefghijk", binding);
  assert.deepEqual(await response.json(), { madeForKids: true });
  body = { items: [{ status: { madeForKids: false } }] };
  response = await call("kids=abcdefghijk", binding);
  assert.deepEqual(await response.json(), { madeForKids: false });
  body = { items: [] };
  response = await call("kids=abcdefghijk", binding);
  assert.equal(response.status, 502);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM youtube_search_quota").get().n, 0);
});

test("non-search quota is shared, atomic, and reserves both feed requests", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  const hour = Math.floor(Date.now() / 3600000);
  db.prepare("INSERT INTO youtube_other_quota (hour, used) VALUES (?, ?)").run(hour, 8998);
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async url => {
    fetches++;
    if (new URL(url).pathname.endsWith("/channels")) {
      return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "uploads" } } }] });
    }
    return Response.json({ items: [] });
  });
  const results = await Promise.all([
    call("feed=UCabcdefghijklmnopqrstuv", binding, "192.0.2.1"),
    call("feed=UCabcdefghijklmnopqrstuv", binding, "192.0.2.2"),
    call("kids=abcdefghijk", binding, "192.0.2.3")
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429, 429]);
  assert.equal(fetches, 2);
  assert.equal(db.prepare("SELECT SUM(used) AS n FROM youtube_other_quota").get().n, 9000);
});

test("an older delayed search body cannot overwrite a newer search", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const code = html.slice(html.indexOf("async function runSearch("), html.indexOf("function profileUrl("));
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const status = { textContent: "", replaceChildren() {}, querySelector() { return null; } };
  const context = {
    searchGen: 0, SKIP: [], fresh: [], freshFetchedAt: 0, columnsOn: false,
    location: { href: "https://example.test/" }, URL, Date, AbortSignal,
    fetch: async () => ({ ok: false, status: 503 }),
    $: () => status, paintFresh() {},
    searchFetch: async url => url.searchParams.get("q") === "old"
      ? { ok: true, json: () => delayed }
      : { ok: true, json: async () => ({ channels: [{ name: "new", videos: [["abcdefghijk", "new"]] }] }) }
  };
  const runSearch = runInNewContext(code + "\nrunSearch", context);
  const old = runSearch("old");
  await new Promise(resolve => setImmediate(resolve));
  await runSearch("new");
  release({ channels: [{ name: "old", videos: [["abcdefghijl", "old"]] }] });
  await old;
  assert.equal(context.fresh[0].name, "new");
  assert.match(status.textContent, /new/);
});

test("optional Instagram discovery uses Meta and returns only public Reel links", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://graph.facebook.com");
    assert.equal(parsed.pathname, "/v27.0/123456");
    assert.match(parsed.searchParams.get("fields"), /business_discovery\.username\(creator\)/);
    assert.equal(parsed.searchParams.has("access_token"), false);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return Response.json({ business_discovery: { media: { data: [
      { media_type: "VIDEO", permalink: "https://www.instagram.com/reel/abcDEF123/", thumbnail_url: "https://scontent.cdninstagram.com/example.jpg" },
      { media_type: "IMAGE", permalink: "https://www.instagram.com/reel/image123/" },
      { media_type: "VIDEO", permalink: "https://evil.example/reel/attack123/" },
      { media_type: "VIDEO", permalink: "https://www.instagram.com/reel/xyzXYZ456/", thumbnail_url: "https://evil.example/image.jpg" }
    ] } } });
  });
  const request = new Request("https://example.com/search?reels=creator&n=1", { headers: { "CF-Connecting-IP": "192.0.2.10" } });
  const response = await onRequestGet({ request, env: {
    KAKEHASHI_LIMITS: binding, INSTAGRAM_USER_ID: "123456", INSTAGRAM_ACCESS_TOKEN: "test-token"
  }, waitUntil() {} });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.reels, ["abcDEF123"]);
  assert.deepEqual(result.thumbs, ["https://scontent.cdninstagram.com/example.jpg"]);
  const requestTwo = new Request("https://example.com/search?reels=creator&n=2", { headers: { "CF-Connecting-IP": "192.0.2.11" } });
  const responseTwo = await onRequestGet({ request: requestTwo, env: {
    KAKEHASHI_LIMITS: binding, INSTAGRAM_USER_ID: "123456", INSTAGRAM_ACCESS_TOKEN: "test-token"
  }, waitUntil() {} });
  assert.deepEqual((await responseTwo.json()).thumbs, ["https://scontent.cdninstagram.com/example.jpg", ""]);
});

test("Instagram previews are unavailable without a Meta token and never scrape Instagram", async t => {
  const { db, binding } = database(); t.after(() => db.close());
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(""));
  const response = await call("reels=creator", binding);
  assert.equal(response.status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("Instagram discovery uses an atomic shared quota across clients", async t => {
  const { db, binding } = database();
  t.after(() => db.close());
  const hour = Math.floor(Date.now() / 3600000);
  db.prepare("INSERT INTO instagram_discovery_quota (hour, used) VALUES (?, ?)").run(hour, 499);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ business_discovery: { media: { data: [] } } });
  });
  const query = ip => onRequestGet({
    request: new Request("https://example.com/search?reels=creator", { headers: { "CF-Connecting-IP": ip } }),
    env: { KAKEHASHI_LIMITS: binding, INSTAGRAM_USER_ID: "123456", INSTAGRAM_ACCESS_TOKEN: "test-token" },
    waitUntil() {}
  });
  const results = await Promise.all([query("192.0.2.1"), query("192.0.2.2")]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
  assert.equal(calls, 1);
});

test("the page's relative search URL has a function, and mixed lookups and cross-origin reads are refused", async () => {
  const response = await onRequestGet({ request: new Request("https://example.com/search?q=cat&feed=abc"), env: {} });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const { existsSync, readFileSync } = await import("node:fs");
  assert.ok(existsSync(new URL("../functions/search.js", import.meta.url)));
  assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /new URL\("search", location\.href\)/);
});
