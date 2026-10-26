# Instagram "Latest posts" setup for the Desert Horology Co. page

The `/desert-horology` page has two kinds of content:

- **Curated reels** (the "Most watched" and series sections) come from `data/desert-horology.json`. They need no credentials: paste a reel link into a `url` field and the page renders Instagram's official embed for it.
- **Latest posts** (an auto-updating grid of the newest posts) comes from the Instagram API. It is optional and stays hidden until `INSTAGRAM_ACCESS_TOKEN` is set.

This document covers the second part.

## What it uses

- The **Instagram API with Instagram Login** (`graph.instagram.com`). It works for Business and Creator accounts and does not need a Facebook Page. The `@deserthorologyco` account is a Business account, so it qualifies.
- A **long-lived user access token** (valid 60 days). The app refreshes it automatically about once a week and stores the refreshed token in a small JSON file, so after the first setup there is nothing to maintain as long as the site keeps running.
- Permission: `instagram_business_basic` (read the account's own media). Reading your own account does not require App Review.

## One-time setup (about 15 minutes)

1. Go to [developers.facebook.com](https://developers.facebook.com/), sign in with the Facebook account that manages the Instagram account, and open **My Apps > Create App**.
2. Pick the **Business** app type (choose "Other" if asked for a use case), give it a name such as `camdresie.com`, and create it.
3. In the app dashboard, add the **Instagram** product, then open **API setup with Instagram business login**.
4. Under **Generate access tokens**, click **Add account**, log in as `@deserthorologyco`, and approve the request. Then click **Generate token** next to the account and copy the token. This is a long-lived token (60 days).
5. Put the token in the environment:
   - Locally: add `INSTAGRAM_ACCESS_TOKEN=<token>` to `.env` and restart `npm start`.
   - Production: Azure Portal > the `camportfolio` App Service > **Configuration** > **Application settings** > add `INSTAGRAM_ACCESS_TOKEN`, save, and let the app restart.
6. Open `/desert-horology`. The "Latest posts" section appears below the curated reels. The server log prints `Instagram access token refreshed` the first time the refresh succeeds (Meta only refreshes tokens that are at least 24 hours old, so this may take until the next day).

## How the refresh works

- `lib/instagram.js` fetches `GET /me/media` (fields: id, caption, media type, media URL, permalink, thumbnail, timestamp) and caches the result for 6 hours (`INSTAGRAM_CACHE_TTL_MINUTES`).
- Every time the feed is fetched, and once a day in the background, it checks the stored token's age. When the token is more than 7 days old it calls `GET /refresh_access_token?grant_type=ig_refresh_token`, which returns a fresh 60-day token.
- The refreshed token is written to `INSTAGRAM_TOKEN_FILE`. The default is `data/instagram-token.json` locally (git-ignored) and `$HOME/data/instagram-token.json` on Azure App Service, where `$HOME` is persistent storage that survives restarts and deployments.
- If you ever paste a new token into `INSTAGRAM_ACCESS_TOKEN`, it replaces the stored one automatically.

## If the section disappears

- The page logs the reason on the server. `The Instagram access token is invalid or expired` means the token lapsed (for example the app was stopped for more than 60 days). Repeat steps 4 and 5 to generate a new one.
- A stale cache is kept when a refresh fails, so a brief API outage never blanks the section.
- Reels that use licensed audio come back without a media URL. Their thumbnail still renders, so they appear in the grid as normal.

## Possible next step: rank by views

The same API can return per-post insights (views, reach) with the `instagram_business_manage_insights` permission. With that enabled, the "Most watched" section could be ranked automatically instead of curated by hand. That is not built yet.
