# Releasing and deploying Kakehashi

## Before a release
- Run `node --test tests/*.test.mjs` (needs `node:sqlite`).
- Have someone other than the author review the change, including security,
  privacy and third-party data.
- Check desktop and mobile browsers: a new browser starts in Journal Light
  in the Discover view, the theme and saved default view survive reload, and the changed features work.
- Scan for secrets.

## Publishing the source
- Push only the reviewed commit to `main` of the public repository, which
  starts empty, then check that the remote `main` shows the same commit ID:
  `git push <public-repository-url> <reviewed-sha>:refs/heads/main` and
  `git ls-remote <public-repository-url> refs/heads/main`.

## Deploying
- Deploy to Cloudflare Pages with `functions/` alongside the page.
- For a shared website, set `ENABLE_PERSONAL_KEYS` to `false` in `index.html`.
- Store your own `YOUTUBE_API_KEY` as a Pages secret, from the one Google Cloud
  project you use for this API client, and add the YouTube logo files described
  in the README.
- Bind a D1 database as `KAKEHASHI_LIMITS` and apply
  `scripts/request-budgets.sql`, again after each upgrade. Use a separate
  database for previews. The function relies on Cloudflare's connecting IP
  header, so keep it behind Pages.
- Test a successful lookup, the 429 response and the timeout path.

## Request limits
Each client has 120 units per minute: a YouTube search costs 24, a social
search 12, an Instagram creator lookup 4, other lookups 1. The shared server
project is capped at 90 YouTube searches and 9,000 other API units in a rolling
25 hours. Over-budget requests return 429; without a working database binding,
upstream requests return 503. YouTube and Meta calls time out after 8 seconds,
social search providers after 15.
