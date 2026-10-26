/*********************
 * Instagram feed for the Desert Horology Co. page.
 *
 * Uses the Instagram API with Instagram Login (graph.instagram.com), which works for
 * Business and Creator accounts without a Facebook Page. The only required setting is a
 * long-lived user access token in INSTAGRAM_ACCESS_TOKEN (see docs/instagram-feed-setup.md).
 *
 * Long-lived tokens expire after 60 days, so this module refreshes the token about once a
 * week and persists the refreshed token to a small JSON file so it survives restarts and
 * deployments. Nothing here runs unless INSTAGRAM_ACCESS_TOKEN is set; the page hides its
 * "latest posts" section when the feed is not configured.
 *********************/

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const API_BASE = (process.env.INSTAGRAM_API_BASE || 'https://graph.instagram.com').replace(/\/+$/, '');
const API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v26.0';
const FEED_LIMIT = clampInt(process.env.INSTAGRAM_FEED_LIMIT, 1, 50, 9);
const CACHE_TTL_MS = clampInt(process.env.INSTAGRAM_CACHE_TTL_MINUTES, 5, 24 * 60, 360) * 60 * 1000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;   // refresh weekly; tokens last 60 days
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;        // Meta only refreshes tokens that are at least 24 hours old
const DEFAULT_TOKEN_LIFETIME_S = 60 * 24 * 60 * 60;  // 60 days
const REQUEST_TIMEOUT_MS = 10000;
const MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp';
const CAPTION_MAX_CHARS = 140;

let feedCache = { posts: [], lastFetched: 0, error: null };
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
        const raw = fs.readFileSync(tokenFilePath(), 'utf8');
        const saved = JSON.parse(raw);
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

function truncateCaption(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= CAPTION_MAX_CHARS) return clean;
    return clean.slice(0, CAPTION_MAX_CHARS - 1).trimEnd() + '…';
}

function normalizePost(media) {
    if (!media || typeof media.permalink !== 'string' || !media.permalink) return null;
    const type = media.media_type || 'IMAGE';
    const isVideo = type === 'VIDEO';
    // media_url is omitted for reels that use licensed audio; thumbnail_url still works for those.
    const thumbnail = isVideo
        ? (media.thumbnail_url || '')
        : (media.media_url || media.thumbnail_url || '');
    return {
        id: media.id,
        type,
        isVideo,
        isCarousel: type === 'CAROUSEL_ALBUM',
        permalink: media.permalink,
        thumbnail,
        caption: truncateCaption(media.caption),
        timestamp: media.timestamp ? new Date(media.timestamp) : null
    };
}

async function fetchFeed() {
    const state = await refreshTokenIfNeeded(false);
    const url = `${API_BASE}/${API_VERSION}/me/media?fields=${MEDIA_FIELDS}&limit=${FEED_LIMIT}&access_token=${encodeURIComponent(state.access_token)}`;
    const data = await getJSON(url);
    return (Array.isArray(data.data) ? data.data : []).map(normalizePost).filter(Boolean);
}

// Returns { configured, posts, error }. Serves cached posts for CACHE_TTL_MS, keeps stale posts
// when a refresh fails, and never throws.
async function getLatestPosts() {
    if (!isConfigured()) return { configured: false, posts: [], error: null };

    const now = Date.now();
    if (!feedCache.lastFetched || now - feedCache.lastFetched >= CACHE_TTL_MS) {
        if (!inflightFetch) {
            inflightFetch = fetchFeed()
                .then(posts => { feedCache = { posts, lastFetched: Date.now(), error: null }; })
                .catch(error => {
                    feedCache.error = describeError(error);
                    feedCache.lastFetched = Date.now();
                    console.error('Error fetching Instagram feed:', feedCache.error);
                })
                .finally(() => { inflightFetch = null; });
        }
        await inflightFetch;
    }
    return { configured: true, posts: feedCache.posts, error: feedCache.error };
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
    feedCache = { posts: [], lastFetched: 0, error: null };
    tokenState = null;
    inflightFetch = null;
    if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
}

module.exports = {
    isConfigured,
    getLatestPosts,
    refreshTokenIfNeeded,
    startTokenMaintenance,
    tokenFilePath,
    _internal: { normalizePost, truncateCaption, resetForTests }
};
