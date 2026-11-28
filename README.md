# Kakehashi (架け橋) · Japanese Channel Finder

A single-page tool for finding Japanese YouTube and Instagram channels to
immerse in: search by interest, preview videos in place, browse a ranked
Top 100 per network, and add or subscribe in one click.

Open Settings to choose the Channel Guide or Workspace layout and a color
theme. New browsers start in Journal Light in the Discover view. To start somewhere else,
open that view and choose "Make this view my default" in Settings (or press D). Your default
view and color choice are saved separately in the browser.

- `index.html`: the whole page (vanilla JS, no build step).
- `functions/search.js`: a Cloudflare Pages Function that serves `/search`
  (channel search, reels, video and channel feeds). The page calls `search`
  relative to its own address: deploy this folder as the site root, or move
  the function to match the path where you serve the page.
- `tiktok-player/`: the isolated TikTok player wrapper. The page uses the
  maintainer's copy at `kakehashi-tiktok-player.pages.dev` unless you deploy
  your own and set `TIKTOK_PLAYER_ORIGIN` in `index.html`.

## Notes
- YouTube search and in-app channel previews require a YouTube Data API key.
  For a self-hosted website, the operator must create their own Google Cloud
  project and configure the Cloudflare Pages secret `YOUTUBE_API_KEY` and enable the YouTube Data
  API v3 in the associated Google Cloud project. Search uses the project’s
  quota. Shared rolling 25-hour caps limit the server to 90 search requests and 9,000 other API units.
  Short-video mode finds videos under four minutes, including some non-Shorts.
  For a personal installation, its operator may instead save their own
  website-restricted YouTube API key in Settings. For a shared website, set
  `ENABLE_PERSONAL_KEYS` to `false` in `index.html` so visitors use the
  operator-configured server key rather than their own keys. The browser sends
  personal keys directly to Google. The browser
  safeguard is local and cannot count usage on other devices or applications.
  Without a key, curated lists remain available and YouTube videos open on
  YouTube instead of playing in the app. Use one Google Cloud project for each
  API client.
- Instagram previews include curated public Reel links, which play only while
  Instagram makes them available and allows embedding. An optional Meta
  Business Discovery integration can find recent Reels from public professional
  accounts. Configure `INSTAGRAM_USER_ID` for the connected professional account
  and store its authorized Facebook user token in `INSTAGRAM_ACCESS_TOKEN`.
  Apply `scripts/request-budgets.sql` to the D1 database after upgrading.
  Discovery uses at most 500 calls per rolling 25 hours, which is an app limit
  rather than a guarantee of Meta quota. Personal, private, unavailable, or
  non-embeddable accounts may still need to open Instagram. Meta permissions
  and live playback must be verified for each deployment.
- Top 100 contains 100 editorial picks each for YouTube, Instagram, and
  TikTok. The order mixes topics and prioritizes accounts likely to offer
  useful Japanese for immersion. See [ranking sources and method](RANKINGS.md).

### Optional Instagram discovery setup

The curated Reel previews work without Meta credentials. To discover recent
Reels from other public professional accounts, the site operator needs their
own setup:

1. Create an Instagram professional account and connect it to a Facebook Page
   you manage. Create a Meta developer app and add Instagram API with Facebook
   Login. Meta's [IG User reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/)
   describes the account, token, and permission requirements.
2. In the [Graph API Explorer](https://developers.facebook.com/tools/explorer/),
   select your app and generate a Facebook user access token. Meta documents
   `instagram_basic` and `pages_read_engagement` for this login method;
   our test also granted `pages_show_list`.
   Our test required `instagram_manage_insights` as well: discovery returned a
   permission error without it for the tested account. Restrict authorization to
   the Page and Instagram account used for this deployment. Meta's
   [Explorer guide](https://developers.facebook.com/docs/graph-api/guides/explorer/)
   explains the permission selector and token generation. Do not paste tokens
   into public pages, client-side settings, source control, or issue reports.
3. Find your Facebook Page's numeric ID in its Page settings. In the Explorer,
   request `PAGE_ID?fields=name,instagram_business_account{id,username}`,
   replacing `PAGE_ID` with that number, to find the connected Instagram
   professional account's numeric ID. Set
   `INSTAGRAM_USER_ID` to that ID and configure
   `INSTAGRAM_ACCESS_TOKEN` as a Cloudflare Pages secret. Apply
   `scripts/request-budgets.sql` to the `KAKEHASHI_LIMITS` D1 binding.
4. Test discovery against a public professional account and test an embedded
   Reel in your deployment. Development-mode access, permissions, token expiry,
   and Meta app review can limit a deployment; follow Meta's current guidance
   before relying on it publicly. Renew or replace an expired token securely.

The Explorer token is intended for testing; do not assume it is a permanent
production credential. Without this configuration, unlisted creators may need
to be opened on Instagram, while the curated Reel previews remain available.

## License
Kakehashi's original code and documentation are under the MIT License.
See [LICENSE](LICENSE).

### Third-party data and marks
The MIT License does not cover third-party material. `top.json` and
[RANKINGS.md](RANKINGS.md) combine Wikidata (CC0) fields with editorial
ordering. Account names, video IDs and links in the page, tests and
`audit-results/` point to other people's content, which remains subject to its
owners' rights and the platforms' terms. A link does not grant permission to
reuse that content.

YouTube logos are not included. YouTube search and channel results require
them: download the official files from
[YouTube Brand Resources](https://brand.youtube/youtube-logo) and save them in
`assets/` as `youtube-logo-light.png`, `youtube-logo-dark.png`,
`youtube-icon-red.png` and `youtube-icon-white.png`, following the
[YouTube API branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines).
Without them the page keeps YouTube search and channel results off, and its
plain links to YouTube show the word "YouTube". Check logo placement on desktop
and mobile before running a public deployment.

## Releasing

See [the release checklist](RELEASING.md) for review, publishing order, and production verification.
