/*********************
 * Instagram feed for the Desert Horology Co. page.
 *
 * Uses the Instagram API with Instagram Login (graph.instagram.com), which works for
 * Business and Creator accounts without a Facebook Page. The only required setting is a
 * long-lived user access token in INSTAGRAM_ACCESS_TOKEN (see docs/instagram-feed-setup.md).
 *
 * One fetch produces everything the page needs: the latest posts, the most-watched videos
 * (ranked by the lifetime "views" insight), and a series detected from captions.
 *
 * Long-lived tokens expire after 60 days, so this module refreshes the token about once a
 * week and persists the refreshed token to a small JSON file so it survives restarts and
 * deployments. Nothing here runs unless INSTAGRAM_ACCESS_TOKEN is set; the page falls back
 * to its manual lists when the feed is not configured.
 *********************/

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const API_BASE = (process.env.INSTAGRAM_API_BASE || 'https://graph.instagram.com').replace(/\/+$/, '');
const API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v26.0';
const FEED_LIMIT = clampInt(process.env.INSTAGRAM_FEED_LIMIT, 1, 50, 9);       // tiles in "Latest posts"
const RANK_POOL = clampInt(process.env.INSTAGRAM_RANK_POOL, 10, 100, 60);      // recent posts considered for ranking
const TOP_LIMIT = clampInt(process.env.INSTAGRAM_TOP_LIMIT, 1, 24, 6);         // videos shown in "Most watched"
const CACHE_TTL_MS = clampInt(process.env.INSTAGRAM_CACHE_TTL_MINUTES, 5, 24 * 60, 360) * 60 * 1000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;   // refresh weekly; tokens last 60 days
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;        // Meta only refreshes tokens that are at least 24 hours old
const DEFAULT_TOKEN_LIFETIME_S = 60 * 24 * 60 * 60;  // 60 days
const REQUEST_TIMEOUT_MS = 10000;
const INSIGHTS_CONCURRENCY = 4;
const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp';
const CAPTION_MAX_CHARS = 140;
const TITLE_MAX_CHARS = 100;
const SERIES_PART_RE = /\bpart\s*#?\s*(\d{1,3})\b/i;

function emptyFeed(configured) {
    return { configured, posts: [], topVideos: [], series: [], error: null, insightsError: null };
}

let feedCache = { ...emptyFeed(true), lastFetched: 0 };
let tokenState = null;
let inflightFetch = null;
let maintenanceTimer = null;
let warnedAboutTokenFile = false;

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function isConfigured() {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    return typeof token === 'string' && token.trim().length > 0;
}

const POST_URL_RE = /^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?/i;

// Accepts the links Instagram's share sheet produces (with ?igsh=... etc.) and returns the
// canonical permalink Instagram's embed script expects, or null if the link is not a post.
function normalizePostUrl(url) {
    const match = typeof url === 'string' ? url.trim().match(POST_URL_RE) : null;
    if (!match) return null;
    const kind = match[1].toLowerCase() === 'reels' ? 'reel' : match[1].toLowerCase();
    return `https://www.instagram.com/${kind}/${match[2]}/`;
}

/*********************
 * Token storage and refresh
 *********************/

// Where the auto-refreshed token is stored. Azure App Service always sets WEBSITE_SITE_NAME and
// mounts persistent storage at $HOME, so the default there survives restarts and deployments.
function tokenFilePath() {
    if (process.env.INSTAGRAM_TOKEN_FILE) return process.env.INSTAGRAM_TOKEN_FILE;
    if (process.env.WEBSITE_SITE_NAME && process.env.HOME) {
        return path.join(process.env.HOME, 'data', 'instagram-token.json');
    }
    return path.join(__dirname, '..', 'data', 'instagram-token.json');
}

// Short fingerprint of the configured token so a newly pasted INSTAGRAM_ACCESS_TOKEN replaces a
// stored one instead of being ignored. The token itself is never logged.
function fingerprint(token) {
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function loadTokenState() {
    if (tokenState) return tokenState;
    const envToken = (process.env.INSTAGRAM_ACCESS_TOKEN || '').trim();
    const seed = fingerprint(envToken);
    try {
        const saved = JSON.parse(fs.readFileSync(tokenFilePath(), 'utf8'));
        if (saved && saved.seed === seed && typeof saved.access_token === 'string' && saved.access_token) {
            tokenState = saved;
            return tokenState;
        }
    } catch (error) {
        // No stored token yet (or unreadable): start from the configured token below.
    }
    tokenState = { access_token: envToken, obtained_at: 0, expires_at: 0, last_refresh_attempt: 0, seed };
    return tokenState;
}

function saveTokenState(state) {
    const file = tokenFilePath();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
    } catch (error) {
        if (!warnedAboutTokenFile) {
            warnedAboutTokenFile = true;
            console.warn(`Could not persist the Instagram token to ${file}: ${error.message}. ` +
                'Set INSTAGRAM_TOKEN_FILE to a writable path so refreshed tokens survive restarts.');
        }
    }
}

function getJSON(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('http://') ? http : https;
        const req = client.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'camdresie.com portfolio' } }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                let data = null;
                try { data = body ? JSON.parse(body) : null; } catch (error) { data = null; }
                if (res.statusCode >= 200 && res.statusCode < 300 && data) return resolve(data);
                const apiError = data && data.error ? data.error : null;
                const err = new Error((apiError && apiError.message) || `Instagram API returned HTTP ${res.statusCode}`);
                err.status = res.statusCode;
                err.code = apiError ? apiError.code : undefined;
                reject(err);
            });
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Instagram API request timed out')));
        req.on('error', reject);
    });
}

function describeError(error) {
    if (error && error.code === 190) {
        return 'The Instagram access token is invalid or expired. Generate a new long-lived token and update INSTAGRAM_ACCESS_TOKEN.';
    }
    return (error && error.message) || 'Unknown Instagram API error';
}

function isPermissionError(error) {
    if (!error) return false;
    if (error.code === 10 || error.code === 200 || error.code === 3) return true;
    return /permission/i.test(error.message || '');
}

function describeInsightsError(error) {
    if (isPermissionError(error)) {
        return 'The access token does not include the instagram_business_manage_insights permission, so videos ' +
            'cannot be ranked by views. Generate a new token with Insights checked in the permissions dialog.';
    }
    return describeError(error);
}

// Refresh the long-lived token when it is due. Safe to call often: it is rate-limited to one
// attempt per cache window and never throws.
async function refreshTokenIfNeeded(force) {
    const state = loadTokenState();
    const now = Date.now();
    const age = state.obtained_at ? now - state.obtained_at : null;
    const due = force || !state.expires_at || age === null || age >= REFRESH_AFTER_MS;
    if (!due) return state;
    if (age !== null && age < MIN_TOKEN_AGE_MS) return state;
    if (state.last_refresh_attempt && now - state.last_refresh_attempt < CACHE_TTL_MS) return state;

    state.last_refresh_attempt = now;
    try {
        const url = `${API_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(state.access_token)}`;
        const data = await getJSON(url);
        if (data && typeof data.access_token === 'string' && data.access_token) {
            const lifetime = Number(data.expires_in) > 0 ? Number(data.expires_in) : DEFAULT_TOKEN_LIFETIME_S;
            state.access_token = data.access_token;
            state.obtained_at = now;
            state.expires_at = now + lifetime * 1000;
            console.log('Instagram access token refreshed; expires', new Date(state.expires_at).toISOString());
        }
    } catch (error) {
        console.warn('Instagram token refresh failed:', describeError(error));
    }
    saveTokenState(state);
    return state;
}

/*********************
 * Media, insights, and series
 *********************/

function truncateCaption(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= CAPTION_MAX_CHARS) return clean;
    return clean.slice(0, CAPTION_MAX_CHARS - 1).trimEnd() + '…';
}

const LEADING_JUNK_RE = /^[\s.:;,!?\-–—|]+/u;
const TRAILING_JUNK_RE = /[\s.:;,!\-–—|]+$/u;      // a closing "?" is kept
const SENTENCE_END_RE = /[.!?](\s|$)/u;
const CLAUSE_END_RE = /[.!?](\s|$)|\s[\-–—|]\s/u;
const SERIES_OF_RE = /\bof\s+\d{1,3}\b/i;          // "PART 9 of 30"
const HOOK_EMOJI_RE = /[\u{1F447}\u{1F914}]/u;      // pointing-down and thinking emoji mark comment-bait lines
const MIN_TITLE_CHARS = 4;
const MIN_TITLE_BEFORE_CUT = 12;

function captionLines(text) {
    return String(text || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
}

function stripTags(line) {
    return line.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
}

// Cut to the first sentence (or clause), trim stray punctuation, and shorten on a word boundary.
function tidyTitle(line, cutRe) {
    line = stripTags(line).replace(LEADING_JUNK_RE, '');
    const cut = line.search(cutRe);
    if (cut > MIN_TITLE_BEFORE_CUT) line = line.slice(0, cut + (line[cut] === '?' ? 1 : 0));
    line = line.replace(TRAILING_JUNK_RE, '').trim();
    if (line.length > TITLE_MAX_CHARS) {
        const shortened = line.slice(0, TITLE_MAX_CHARS - 1);
        const space = shortened.lastIndexOf(' ');
        line = (space > TITLE_MAX_CHARS / 2 ? shortened.slice(0, space) : shortened).replace(TRAILING_JUNK_RE, '') + '…';
    }
    return line;
}

// Lines like "What do you think? 👇" are comment bait, not titles.
function isHookLine(line) {
    const clean = stripTags(line);
    if (HOOK_EMOJI_RE.test(clean)) return true;
    const cut = clean.search(SENTENCE_END_RE);
    return cut >= 0 ? clean[cut] === '?' : /\?\s*$/.test(clean);
}

// First usable line of the caption: skips comment-bait questions and lines that collapse to
// nothing after `transform` (e.g. a bare "PART 9 of 30." line), falling back to the first line.
function titleFromCaption(text, transform, cutRe) {
    const lines = captionLines(text);
    let fallback = '';
    for (const raw of lines) {
        const title = tidyTitle(transform(raw), cutRe);
        if (title.length < MIN_TITLE_CHARS) continue;
        if (!fallback) fallback = title;
        if (isHookLine(transform(raw))) continue;
        return title;
    }
    return fallback;
}

// Card title for any post: first sentence of the first usable caption line, without hashtags.
function captionTitle(text) {
    return titleFromCaption(text, line => line, SENTENCE_END_RE);
}

// Episode title: like captionTitle, with the series phrase and "Part N (of M)" removed first, e.g.
// "THE QUARTZ CRISIS Part 02: The First Casualties" -> "The First Casualties".
function episodeTitle(text, nameRe) {
    return titleFromCaption(text, line => line.replace(nameRe, ' ').replace(SERIES_PART_RE, ' ').replace(SERIES_OF_RE, ' '), CLAUSE_END_RE);
}

function formatViews(n) {
    if (typeof n !== 'number' || !(n >= 0)) return '';
    const short = (value, unit, keepDecimal) =>
        (keepDecimal ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value).toString()) + unit;
    if (n >= 1e6) return short(n / 1e6, 'M', n < 1e7);
    if (n >= 1e3) return short(n / 1e3, 'K', n < 1e4);
    return String(n);
}

function normalizePost(media) {
    if (!media || typeof media.permalink !== 'string' || !media.permalink) return null;
    const type = media.media_type || 'IMAGE';
    const isVideo = type === 'VIDEO';
    // media_url is omitted for reels that use licensed audio; thumbnail_url still works for those.
    const thumbnail = isVideo
        ? (media.thumbnail_url || '')
        : (media.media_url || media.thumbnail_url || '');
    const captionRaw = String(media.caption || '');
    const captionText = captionRaw.replace(/\s+/g, ' ').trim();
    return {
        id: media.id,
        type,
        productType: media.media_product_type || '',
        isVideo,
        isCarousel: type === 'CAROUSEL_ALBUM',
        permalink: media.permalink,
        thumbnail,
        caption: truncateCaption(captionText),
        captionText,
        captionRaw,
        title: captionTitle(captionRaw),
        timestamp: media.timestamp ? new Date(media.timestamp) : null
    };
}

async function fetchMedia(state, limit) {
    const url = `${API_BASE}/${API_VERSION}/me/media?fields=${MEDIA_FIELDS}&limit=${limit}&access_token=${encodeURIComponent(state.access_token)}`;
    const data = await getJSON(url);
    return (Array.isArray(data.data) ? data.data : []).map(normalizePost).filter(Boolean);
}

// Lifetime view count for one post. "views" replaced the old plays/impressions metrics in 2025 and
// applies to every media type. Returns null when the API has no number for this post.
async function fetchViews(state, post) {
    const url = `${API_BASE}/${API_VERSION}/${encodeURIComponent(post.id)}/insights?metric=views&access_token=${encodeURIComponent(state.access_token)}`;
    const data = await getJSON(url);
    const metrics = Array.isArray(data.data) ? data.data : [];
    const metric = metrics.find(m => m && m.name === 'views') || metrics[0];
    if (!metric) return null;
    if (Array.isArray(metric.values) && metric.values.length && metric.values[0]) {
        const value = Number(metric.values[0].value);
        return Number.isFinite(value) ? value : null;
    }
    if (metric.total_value && metric.total_value.value !== undefined) {
        const value = Number(metric.total_value.value);
        return Number.isFinite(value) ? value : null;
    }
    return null;
}

// Rank the videos in the pool by lifetime views. A permission error aborts ranking (the page then
// falls back to the manual list); an error on a single post just leaves that post out.
async function rankVideos(state, media) {
    const videos = media.filter(post => post.isVideo);
    const results = [];
    let permissionError = null;

    for (let i = 0; i < videos.length && !permissionError; i += INSIGHTS_CONCURRENCY) {
        const batch = videos.slice(i, i + INSIGHTS_CONCURRENCY);
        const settled = await Promise.all(batch.map(async (post) => {
            try {
                return { post, views: await fetchViews(state, post) };
            } catch (error) {
                if (isPermissionError(error)) permissionError = error;
                return { post, views: null };
            }
        }));
        results.push(...settled);
    }
    if (permissionError) throw permissionError;

    return results
        .filter(result => typeof result.views === 'number')
        .sort((a, b) => b.views - a.views)
        .slice(0, TOP_LIMIT)
        .map(result => ({ ...result.post, views: result.views, viewsLabel: formatViews(result.views) }));
}

// Finds a series by a phrase in the caption (e.g. "Quartz Crisis") and orders it by the part
// number in the caption, falling back to posting date for episodes without one.
function detectSeries(media, matchText) {
    const needle = String(matchText || '').trim().toLowerCase();
    if (!needle) return [];
    // Also swallow a lead-in like "of the" / "the" so "Part 7 of the Quartz Crisis: X" leaves just "X".
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const nameRe = new RegExp('\\b(?:(?:of|in|from)\\s+)?(?:the\\s+)?' + escaped + '\\b', 'ig');
    return media
        .filter(post => post.captionText.toLowerCase().includes(needle))
        .map(post => {
            const match = post.captionText.match(SERIES_PART_RE);
            const part = match ? parseInt(match[1], 10) : null;
            const title = episodeTitle(post.captionRaw !== undefined ? post.captionRaw : post.captionText, nameRe);
            return { ...post, part, episodeTitle: title || post.title };
        })
        // Once the series has numbered parts, a passing mention of the phrase is not an episode.
        .filter((post, _, all) => post.part !== null || !all.some(other => other.part !== null))
        .sort((a, b) => {
            if (a.part !== null && b.part !== null) return a.part - b.part;
            if (a.part !== null) return -1;
            if (b.part !== null) return 1;
            return (a.timestamp ? a.timestamp.getTime() : 0) - (b.timestamp ? b.timestamp.getTime() : 0);
        });
}

async function fetchFeed(options) {
    const state = await refreshTokenIfNeeded(false);
    const media = await fetchMedia(state, Math.max(RANK_POOL, FEED_LIMIT));

    let topVideos = [];
    let insightsError = null;
    try {
        topVideos = await rankVideos(state, media);
    } catch (error) {
        insightsError = describeInsightsError(error);
        console.warn('Instagram insights unavailable:', insightsError);
    }

    return {
        posts: media.slice(0, FEED_LIMIT),
        topVideos,
        series: detectSeries(media, options.seriesMatch),
        insightsError
    };
}

// Returns { configured, posts, topVideos, series, error, insightsError }. Serves cached data for
// CACHE_TTL_MS, keeps stale data when a refresh fails, and never throws.
async function getFeed(options) {
    const opts = options || {};
    if (!isConfigured()) return emptyFeed(false);

    const now = Date.now();
    if (!feedCache.lastFetched || now - feedCache.lastFetched >= CACHE_TTL_MS) {
        if (!inflightFetch) {
            inflightFetch = fetchFeed(opts)
                .then(result => { feedCache = { configured: true, ...result, lastFetched: Date.now(), error: null }; })
                .catch(error => {
                    feedCache.error = describeError(error);
                    feedCache.lastFetched = Date.now();
                    console.error('Error fetching Instagram feed:', feedCache.error);
                })
                .finally(() => { inflightFetch = null; });
        }
        await inflightFetch;
    }
    return {
        configured: true,
        posts: feedCache.posts,
        topVideos: feedCache.topVideos,
        series: feedCache.series,
        error: feedCache.error,
        insightsError: feedCache.insightsError
    };
}

// Keeps the token alive even when nobody visits the page for weeks: one check at startup,
// then one a day. The timer is unref'd so it never keeps the process alive on its own.
function startTokenMaintenance() {
    if (!isConfigured() || maintenanceTimer) return;
    refreshTokenIfNeeded(false).catch(() => {});
    maintenanceTimer = setInterval(() => { refreshTokenIfNeeded(false).catch(() => {}); }, 24 * 60 * 60 * 1000);
    if (typeof maintenanceTimer.unref === 'function') maintenanceTimer.unref();
}

function resetForTests() {
    feedCache = { ...emptyFeed(true), lastFetched: 0 };
    tokenState = null;
    inflightFetch = null;
    if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
}

module.exports = {
    isConfigured,
    normalizePostUrl,
    getFeed,
    refreshTokenIfNeeded,
    startTokenMaintenance,
    tokenFilePath,
    _internal: { normalizePost, truncateCaption, captionTitle, episodeTitle, formatViews, detectSeries, resetForTests }
};
