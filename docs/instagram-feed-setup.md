# Instagram setup for the Desert Horology Co. page

With one access token in place, the `/desert-horology` page runs itself:

- **Most watched**: the account's videos ranked by lifetime views, refreshed every 6 hours.
- **The Quartz Crisis**: every post whose caption contains the series phrase, ordered by the "Part N" in the caption.
- **Latest posts**: the newest posts, each opening in an on-page modal.

Until the token is configured, the page shows the manual lists in `data/desert-horology.json` instead (and hides the sections that are empty).

## What it uses

- The **Instagram API with Instagram Login** (`graph.instagram.com`). It works for Business and Creator accounts and does not need a Facebook Page. `@deserthorologyco` is a Business account, so it qualifies.
- A **long-lived user access token** (valid 60 days). The app refreshes it about once a week and stores the refreshed token in a small JSON file, so after setup there is nothing to maintain while the site keeps running.
- Permissions: `instagram_business_basic` (read the account's media) and `instagram_business_manage_insights` (read view counts for ranking). Reading your own account needs no App Review.

## One-time setup (about 15 minutes)

1. Go to [developers.facebook.com](https://developers.facebook.com/) and sign in with the Facebook account that manages the Instagram account. Open **My Apps** and click **Create App**.
2. When asked what the app should do, choose **Other**, then the **Business** app type. Name it something like `camdresie.com`, confirm the contact email, and create it. The app stays in development mode; that is fine for reading your own account.
3. In the app dashboard, find **Add product** (or **Add use case**), pick **Instagram**, and open **API setup with Instagram business login**. Do not use the "with Facebook login" variant.
4. Under **Generate access tokens**, click **Add account**, log in as `@deserthorologyco`, and approve. In the permissions dialog leave everything checked, including **Insights**; without it the page cannot rank by views.
5. Click **Generate token** next to the account, confirm, and copy the token. It is long-lived (60 days).
6. Put the token in the environment:
   - Locally: add `INSTAGRAM_ACCESS_TOKEN=<token>` to `.env`, run `npm start`, and open `http://localhost:5001/desert-horology`.
   - Production: Azure Portal > the `camportfolio` App Service > **Environment variables** (older portals call it **Configuration > Application settings**) > **Add** `INSTAGRAM_ACCESS_TOKEN`, then **Apply**. The app restarts.
7. Reload the page. "Most watched" now shows view counts in each card's label, the series section appears if any caption contains the series phrase, and "Latest posts" fills in. The server log prints `Instagram access token refreshed` the first time the refresh succeeds (Meta only refreshes tokens that are at least 24 hours old, so that line may wait until the next day).

## How the refresh works

- `lib/instagram.js` fetches up to 60 recent posts (`INSTAGRAM_RANK_POOL`), asks for the `views` insight on each video, and caches everything for 6 hours (`INSTAGRAM_CACHE_TTL_MINUTES`). That is roughly 60 API calls four times a day, far below Meta's limits.
- On every fetch, and once a day in the background, it checks the stored token's age. Past 7 days it calls `refresh_access_token`, which returns a fresh 60-day token.
- The refreshed token is written to `INSTAGRAM_TOKEN_FILE`. The default is `data/instagram-token.json` locally (git-ignored) and `$HOME/data/instagram-token.json` on Azure App Service, where `$HOME` is persistent storage that survives restarts and deployments.
- Pasting a new token into `INSTAGRAM_ACCESS_TOKEN` replaces the stored one automatically.

## Tuning

| Setting | Default | What it does |
|---|---|---|
| `INSTAGRAM_TOP_LIMIT` | 6 | Videos shown in "Most watched" |
| `INSTAGRAM_RANK_POOL` | 60 | Recent posts considered for ranking and series detection |
| `INSTAGRAM_FEED_LIMIT` | 9 | Tiles in "Latest posts" |
| `INSTAGRAM_CACHE_TTL_MINUTES` | 360 | Minutes between API fetches |
| `series.match` in `data/desert-horology.json` | "Quartz Crisis" | Phrase that marks a caption as part of the series |

## If something looks off

- **"Most watched" shows the manual list or nothing, and the log says the token lacks `instagram_business_manage_insights`**: regenerate the token (steps 4 and 5) with Insights checked.
- **The log says the token is invalid or expired**: the token lapsed, for example because the app was stopped for more than 60 days. Repeat steps 4 to 6.
- **A series episode is missing or out of order**: its caption needs the series phrase and a "Part N" (any of `Part 3`, `Part 03`, `part #3`). Episodes without a part number sort by date after the numbered ones.
- **A reel shows no thumbnail in "Latest posts"**: reels with licensed audio can come back without media URLs. The tile still links to the post.
- A stale cache is kept when a fetch fails, so a brief API outage never blanks the page.
