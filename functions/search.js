import { extractResults } from "../lib/social-results.js";
// Live search for /search. Instagram handles come only from the channel's own YouTube links.
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const WINDOW_SECONDS = 60;
const REQUEST_BUDGET = 120;
const UPSTREAM_TIMEOUT_MS = 8000;

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

// One atomic write per client and window, shared across Pages instances.
async function admit(context, cost) {
  const { env, request } = context;
  const ip = request.headers.get("CF-Connecting-IP");
  if (!env.KAKEHASHI_LIMITS || !ip) return json({ error: "rate limiter unavailable" }, 503);
  const now = Math.floor(Date.now() / 1000);
  const minute = Math.floor(now / WINDOW_SECONDS);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(minute + ":" + ip));
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const db = env.KAKEHASHI_LIMITS;
  let accepted;
  try {
    accepted = await db.prepare(
      "INSERT INTO request_budgets (client, minute, used) VALUES (?, ?, ?) " +
      "ON CONFLICT(client, minute) DO UPDATE SET used = used + excluded.used " +
      "WHERE used + excluded.used <= ? RETURNING used"
    ).bind(key, minute, cost, REQUEST_BUDGET).first();
  } catch {
    return json({ error: "rate limiter unavailable" }, 503);
  }
  if (Math.random() < 0.01) {
    context.waitUntil(db.prepare("DELETE FROM request_budgets WHERE minute < ?")
      .bind(minute - 1).run().catch(() => {}));
  }
  if (!accepted) {
    return json({ error: "rate limit exceeded" }, 429, {
      "retry-after": String(WINDOW_SECONDS - now % WINDOW_SECONDS)
    });
  }
}


async function youtube(path, params, key, signal) {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, { headers: { "X-Goog-Api-Key": key }, redirect: "manual", signal });
  if (!response.ok) throw new Error("YouTube API request failed");
  return response.json();
}

async function socialSearch(context, platform, query) {
  const { env } = context;
  if (platform === "instagram" && env.SOCIAL_FETCH_API_KEY) {
    // Store only a digest of normalized queries; identical searches share results
    // across locations for six hours without spending another provider credit.
    const normalized = query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    const cacheKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const now = Math.floor(Date.now() / 1000);
    const lookup = async () => {
      const cached = await env.KAKEHASHI_LIMITS.prepare(
        "SELECT items FROM instagram_search_cache WHERE query_hash = ? AND expires > ?"
      ).bind(cacheKey, Math.floor(Date.now() / 1000)).first();
      if (cached) {
        const items = JSON.parse(cached.items);
        if (Array.isArray(items)) return { items };
        if (items?.error === "instagram search credits unavailable") return { error: items.error };
      }
      return null;
    };
    try {
      const cached = await lookup();
      if (cached) return cached.error ? json(cached, 503) : json({ platform, items: cached.items });
    } catch { return json({ error: "social search cache unavailable" }, 503); }
    const token = crypto.randomUUID();
    let lease;
    try {
      lease = await env.KAKEHASHI_LIMITS.prepare(
        "INSERT INTO instagram_search_inflight (query_hash, token, expires) VALUES (?, ?, ?) " +
        "ON CONFLICT(query_hash) DO UPDATE SET token = excluded.token, expires = excluded.expires " +
        "WHERE expires <= ? RETURNING token"
      ).bind(cacheKey, token, now + 25, now).first();
      if (!lease) {
        for (let attempt = 0; attempt < 16; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const cached = await lookup();
          if (cached) return cached.error ? json(cached, 503) : json({ platform, items: cached.items });
        }
        return json({ error: "social search in progress" }, 503);
      }
    } catch { return json({ error: "social search cache unavailable" }, 503); }
    try {
    // Another request may have populated the cache between the first read and the lease.
    let filled;
    try { filled = await lookup(); } catch { return json({ error: "social search cache unavailable" }, 503); }
    if (filled) return filled.error ? json(filled, 503) : json({ platform, items: filled.items });
    const day = "social-fetch:" + Math.floor(Date.now() / 86400000);
    try {
      const accepted = await env.KAKEHASHI_LIMITS.prepare(
        "INSERT INTO social_search_quota (month, used) VALUES (?, 1) " +
        "ON CONFLICT(month) DO UPDATE SET used = used + 1 WHERE used < 50 RETURNING used"
      ).bind(day).first();
      if (!accepted) return json({ error: "social search limit reached" }, 429);
    } catch { return json({ error: "social search quota unavailable" }, 503); }
    const url = new URL("https://api.socialfetch.dev/v2/instagram/reels/search");
    url.searchParams.set("query", query);
    try {
      const response = await fetch(url, {
        headers: { "x-api-key": env.SOCIAL_FETCH_API_KEY },
        redirect: "manual", signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        if (response.status === 402) {
          const detail = await response.json().catch(() => ({}));
          if (detail?.error?.code === "insufficient_credits") {
            const error = { error: "instagram search credits unavailable" };
            // Briefly share this known provider failure with concurrent waiters.
            // A short expiry lets newly purchased credits take effect promptly.
            try {
              await env.KAKEHASHI_LIMITS.prepare(
                "INSERT INTO instagram_search_cache (query_hash, expires, items) VALUES (?, ?, ?) " +
                "ON CONFLICT(query_hash) DO UPDATE SET expires = excluded.expires, items = excluded.items"
              ).bind(cacheKey, Math.floor(Date.now() / 1000) + 20, JSON.stringify(error)).run();
            } catch { /* Return the useful error even if sharing it fails. */ }
            return json(error, 503);
          }
        }
        return json({ error: "social search unavailable" }, response.status === 429 ? 429 : 502);
      }
      const data = await response.json();
      if (!Array.isArray(data?.data?.media)) return json({ error: "social search unavailable" }, 502);
      const results = data.data.media.map(item => ({ url: item?.url, title: item?.caption }));
      const items = extractResults(platform, results);
      if (items.length) {
        try {
          await env.KAKEHASHI_LIMITS.prepare(
            "INSERT INTO instagram_search_cache (query_hash, expires, items) VALUES (?, ?, ?) " +
            "ON CONFLICT(query_hash) DO UPDATE SET expires = excluded.expires, items = excluded.items"
          ).bind(cacheKey, now + 21600, JSON.stringify(items)).run();
          if (Math.random() < 0.05) {
            context.waitUntil(env.KAKEHASHI_LIMITS.prepare(
              "DELETE FROM instagram_search_cache WHERE expires <= ?"
            ).bind(now).run().catch(() => {}));
            context.waitUntil(env.KAKEHASHI_LIMITS.prepare(
              "DELETE FROM instagram_search_inflight WHERE expires <= ?"
            ).bind(now).run().catch(() => {}));
          }
        } catch { /* Still return results if storing the cache entry fails. */ }
      }
      return json({ platform, items });
    } catch { return json({ error: "social search unavailable" }, 502); }
    } finally {
      try { await env.KAKEHASHI_LIMITS.prepare("DELETE FROM instagram_search_inflight WHERE query_hash = ? AND token = ?").bind(cacheKey, token).run(); } catch {}
    }
  }
  if (platform === "tiktok" && env.EXA_API_KEY) {
    const day = Math.floor(Date.now() / 86400000);
    try {
      const accepted = await env.KAKEHASHI_LIMITS.prepare(
        "INSERT INTO exa_search_quota (day, used) VALUES (?, 1) " +
        "ON CONFLICT(day) DO UPDATE SET used = used + 1 WHERE used < 100 RETURNING used"
      ).bind(day).first();
      if (!accepted) return json({ error: "social search limit reached" }, 429);
    } catch { return json({ error: "social search quota unavailable" }, 503); }
    try {
      const response = await fetch("https://api.exa.ai/search", {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": env.EXA_API_KEY },
        body: JSON.stringify({ query, type: "lite", numResults: 10, includeDomains: ["tiktok.com"] }),
        redirect: "manual", signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return json({ error: "social search unavailable" }, response.status === 429 ? 429 : 502);
      const data = await response.json();
      if (!Array.isArray(data.results)) return json({ error: "social search unavailable" }, 502);
      return json({ platform, items: extractResults(platform, data.results) });
    } catch { return json({ error: "social search unavailable" }, 502); }
  }
  const headers = env.SEARXNG_AUTH_TOKEN
    ? { Authorization: `Bearer ${env.SEARXNG_AUTH_TOKEN}` }
    : env.SEARXNG_ACCESS_ID && env.SEARXNG_ACCESS_SECRET
      ? { "CF-Access-Client-Id": env.SEARXNG_ACCESS_ID, "CF-Access-Client-Secret": env.SEARXNG_ACCESS_SECRET }
      : null;
  let url;
  try {
    url = new URL(env.SEARXNG_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/search" || !headers) throw new Error();
  } catch { return json({ error: "social search not configured" }, 503); }
  const day = Math.floor(Date.now() / 86400000);
  try {
    const accepted = await env.KAKEHASHI_LIMITS.prepare(
      "INSERT INTO searx_search_quota (day, used) VALUES (?, 1) " +
      "ON CONFLICT(day) DO UPDATE SET used = used + 1 WHERE used < 200 RETURNING used"
    ).bind(day).first();
    if (!accepted) return json({ error: "social search limit reached" }, 429);
  } catch { return json({ error: "social search quota unavailable" }, 503); }
  url.searchParams.set("q", `site:${platform}.com${platform === "instagram" ? "/reel/" : ""} ${query}`);
  url.searchParams.set("format", "json");
  try {
    const response = await fetch(url, {
      headers,
      redirect: "manual", signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return json({ error: "social search unavailable" }, response.status === 429 ? 429 : 502);
    const data = await response.json();
    if (!Array.isArray(data.results)) return json({ error: "social search unavailable" }, 502);
    const items = extractResults(platform, data.results);
    if (!items.length && Array.isArray(data.unresponsive_engines) && data.unresponsive_engines.length) return json({ error: "social search unavailable" }, 502);
    return json({ platform, items });
  } catch { return json({ error: "social search unavailable" }, 502); }
}

export async function onRequestGet(context) {
  const params = new URL(context.request.url).searchParams;
  const channel = params.get("feed") || "";
  const video = params.get("v") || "";
  const igHandle = (params.get("reels") || "").toLowerCase();
  const isIgHandle = /^[a-z0-9._]{1,30}$/.test(igHandle);
  const kidsVideo = params.get("kids") || "";
  const isKidsVideo = /^[A-Za-z0-9_-]{11}$/.test(kidsVideo);
  const query = (params.get("q") || "").trim().slice(0, 80);
  const social = params.get("social") || "";
  if (["q", "feed", "v", "kids", "reels"].filter(name => params.get(name)).length > 1) return json({ error: "choose one lookup" }, 400);
  if (social && (!["instagram", "tiktok"].includes(social) || !query || channel || video || igHandle || kidsVideo)) return json({ error: "invalid social search" }, 400);
  if (social && !(social === "tiktok" && context.env.EXA_API_KEY) && !(social === "instagram" && context.env.SOCIAL_FETCH_API_KEY) && !context.env.SEARXNG_URL) return json({ error: "social search not configured" }, 503);
  const isChannel = CHANNEL_ID.test(channel);
  const isVideo = /^[A-Za-z0-9_-]{11}$/.test(video);
  if (!isChannel && !isVideo && !isKidsVideo && !isIgHandle && !query) return json({ channels: [] });
  const limited = await admit(context, social ? 12 : isIgHandle ? 4 : isChannel || isVideo || isKidsVideo ? 1 : 24);
  if (limited) return limited;
  if (social) return socialSearch(context, social, query);
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  if (isIgHandle) {
    const token = context.env.INSTAGRAM_ACCESS_TOKEN;
    const igUserId = context.env.INSTAGRAM_USER_ID;
    if (!token || !/^[0-9]+$/.test(igUserId || "")) return json({ error: "Instagram discovery not configured" }, 503);
    const hour = Math.floor(Date.now() / 3600000);
    try {
      const admitted = await context.env.KAKEHASHI_LIMITS.prepare(
        "INSERT INTO instagram_discovery_quota (hour, used) " +
        "SELECT ?, 1 WHERE (SELECT COALESCE(SUM(used), 0) FROM instagram_discovery_quota WHERE hour >= ?) < 500 " +
        "ON CONFLICT(hour) DO UPDATE SET used = used + 1 RETURNING used"
      ).bind(hour, hour - 24).first();
      if (!admitted) return json({ error: "Instagram discovery limit reached" }, 429);
      context.waitUntil(context.env.KAKEHASHI_LIMITS.prepare("DELETE FROM instagram_discovery_quota WHERE hour < ?").bind(hour - 24).run().catch(() => {}));
    } catch {
      return json({ error: "Instagram quota limiter unavailable" }, 503);
    }
    const count = Math.max(1, Math.min(12, parseInt(params.get("n"), 10) || 3));
    const url = new URL("https://graph.facebook.com/v27.0/" + igUserId);
    url.searchParams.set("fields", "business_discovery.username(" + igHandle + "){media.limit(30){media_type,permalink,thumbnail_url}}" );
    try {
      const response = await fetch(url, { headers: { Authorization: "Bearer " + token }, redirect: "manual", signal });
      if (!response.ok) return json({ error: "Instagram discovery unavailable" }, 502);
      const body = await response.json();
      const posts = body.business_discovery?.media?.data;
      if (!Array.isArray(posts)) return json({ error: "Instagram discovery unavailable" }, 502);
      const entries = posts.filter(post => post.media_type === "VIDEO").map(post => {
        const id = /^https:\/\/(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]{5,20})\/?(?:\?.*)?$/.exec(post.permalink || "")?.[1];
        let thumbnail = "";
        try {
          const u = new URL(post.thumbnail_url);
          if (u.protocol === "https:" && !u.username && !u.password && !u.port && /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)) thumbnail = u.href;
        } catch {}
        return { id, thumbnail };
      }).filter(entry => entry.id).slice(0, count);
      return json({ handle: igHandle, reels: entries.map(entry => entry.id), thumbs: entries.map(entry => entry.thumbnail), ok: true });
    } catch {
      return signal.aborted ? json({ error: "upstream request timed out" }, 504) : json({ error: "Instagram discovery unavailable" }, 502);
    }
  }
  if (isVideo) {
    try {
      const url = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + video);
      const response = await fetch(url, { signal });
      const data = response.ok ? await response.json() : {};
      return json({ url: /^https:\/\/www\.youtube\.com\/(@|channel\/)/.test(data.author_url || "") ? data.author_url : "" });
    } catch {
      return signal.aborted ? json({ error: "upstream request timed out" }, 504) : json({ url: "" }, 502);
    }
  }
  const key = context.env.YOUTUBE_API_KEY;
  if (!key) return json({ error: "YouTube API key not configured" }, 503);
  // Reserve the full request cost atomically across all server instances.
  // The extra hour and margin keep this below Google's daily shared quota
  // even when the reset falls inside an hour.
  const otherUnits = isKidsVideo ? 1 : (isChannel && params.get("shorts") !== "1" ? 2 : 0);
  if (otherUnits) {
    const hour = Math.floor(Date.now() / 3600000);
    try {
      const admitted = await context.env.KAKEHASHI_LIMITS.prepare(
        "INSERT INTO youtube_other_quota (hour, used) " +
        "SELECT ?, ? WHERE (SELECT COALESCE(SUM(used), 0) FROM youtube_other_quota WHERE hour >= ?) + ? <= 9000 " +
        "ON CONFLICT(hour) DO UPDATE SET used = used + excluded.used RETURNING used"
      ).bind(hour, otherUnits, hour - 24, otherUnits).first();
      if (!admitted) return json({ error: "daily YouTube request limit reached" }, 429);
      context.waitUntil(context.env.KAKEHASHI_LIMITS.prepare("DELETE FROM youtube_other_quota WHERE hour < ?").bind(hour - 24).run().catch(() => {}));
    } catch {
      return json({ error: "YouTube quota limiter unavailable" }, 503);
    }
  }
  if (isKidsVideo) {
    try {
      const data = await youtube("videos", { part: "id,status", id: kidsVideo }, key, signal);
      const madeForKids = data.items?.[0]?.status?.madeForKids;
      if (typeof madeForKids !== "boolean") return json({ error: "video status unavailable" }, 502);
      return json({ madeForKids });
    } catch {
      return signal.aborted ? json({ error: "upstream request timed out" }, 504) : json({ error: "video status unavailable" }, 502);
    }
  }
  const usesSearchQuota = !isChannel || params.get("shorts") === "1";
  if (usesSearchQuota) {
    const hour = Math.floor(Date.now() / 3600000);
    try {
      const admitted = await context.env.KAKEHASHI_LIMITS.prepare(
        "INSERT INTO youtube_search_quota (day, used) " +
        "SELECT ?, 1 WHERE (SELECT COALESCE(SUM(used), 0) FROM youtube_search_quota WHERE day >= ?) < 90 " +
        "ON CONFLICT(day) DO UPDATE SET used = used + 1 RETURNING used"
      ).bind(hour, hour - 24).first();
      if (!admitted) return json({ error: "daily YouTube search limit reached" }, 429);
      context.waitUntil(context.env.KAKEHASHI_LIMITS.prepare("DELETE FROM youtube_search_quota WHERE day < ?").bind(hour - 24).run().catch(() => {}));
    } catch {
      return json({ error: "YouTube quota limiter unavailable" }, 503);
    }
  }
  try {
    if (isChannel) {
      const count = Math.max(1, Math.min(15, parseInt(params.get("n"), 10) || 3));
      if (params.get("shorts") === "1") {
        const data = await youtube("search", { part: "snippet", channelId: channel, type: "video", order: "date", videoDuration: "short", maxResults: count }, key, signal);
        return json({ videos: (data.items || []).filter(item => item.id?.videoId).map(item => [item.id.videoId, item.snippet?.title || "YouTube video"]) });
      }
      const data = await youtube("channels", { part: "contentDetails", id: channel }, key, signal);
      const playlist = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!playlist) return json({ videos: [] });
      const items = await youtube("playlistItems", { part: "snippet", playlistId: playlist, maxResults: count }, key, signal);
      return json({ videos: (items.items || []).filter(item => item.snippet?.resourceId?.videoId).map(item => [item.snippet.resourceId.videoId, item.snippet.title || "YouTube video"]) });
    }
    const data = await youtube("search", { part: "snippet", q: query, type: "video", videoEmbeddable: "true", relevanceLanguage: "ja", maxResults: 16 }, key, signal);
    const channels = (data.items || []).filter(item => /^[A-Za-z0-9_-]{11}$/.test(item.id?.videoId || "") && CHANNEL_ID.test(item.snippet?.channelId || "")).map(item => ({
      topic: "YouTube", tags: ["fresh"], handle: null, channelId: item.snippet.channelId,
      name: item.snippet.channelTitle || "YouTube", en: item.snippet.channelTitle || "YouTube",
      note: item.snippet.title || "YouTube video", thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
      videos: [[item.id.videoId, item.snippet.title || "YouTube video"]], found: true, fresh: true
    }));
    return json({ channels });
  } catch {
    return signal.aborted ? json({ error: "upstream request timed out" }, 504) : json({ error: "YouTube API request failed" }, 502);
  }
}
