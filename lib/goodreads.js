/*********************
 * Goodreads shelves for the Currently Consuming page.
 *
 * Goodreads retired its shelf RSS feeds (/review/list_rss/<id>) in late October 2026; they
 * now answer 404, and the shelf pages themselves redirect to a sign-in page. What is still
 * public is the embeddable bookshelf widget, a small script that carries the shelf as an
 * HTML string. This module fetches that script and reads the books out of it.
 *
 * Limits of the widget compared with the old feed: at most 100 books per shelf, no dates,
 * and reviews arrive as a short excerpt (the full review page needs a Goodreads sign-in).
 *********************/

const WIDGET_BASE = 'https://www.goodreads.com/review/custom_widget';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_BOOKS = 100;

// Goodreads caches a widget response per user and `widget_id` and ignores every other
// parameter while that entry lives, so two shelves requested under the same id come back
// as whichever was asked for first. The id is therefore derived from the shelf and its
// options, plus the day, so each shelf gets its own entry and a fresh one every day.
function widgetId(shelf, limit, sort) {
    let hash = 0;
    for (const char of `${shelf}|${limit}|${sort}`) {
        hash = (hash * 31 + char.charCodeAt(0)) % 1000000;
    }
    const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    return `${day}${String(hash).padStart(6, '0')}`;
}

function widgetUrl(userId, shelf, { limit, sort }) {
    const count = Math.min(Math.max(limit, 1), MAX_BOOKS);
    const params = new URLSearchParams({
        shelf,
        num_books: String(count),
        sort,
        order: 'd',
        show_author: '1',
        show_cover: '1',
        show_rating: '1',
        show_review: '1',
        show_tags: '0',
        show_title: '1',
        cover_position: 'left',
        cover_size: 'medium',
        widget_id: widgetId(shelf, count, sort)
    });
    return `${WIDGET_BASE}/${encodeURIComponent(userId)}?${params}`;
}

// Pull the HTML out of `var widget_code = '...'` and undo the JavaScript string escaping.
function extractWidgetHtml(script) {
    const match = /var\s+widget_code\s*=\s*'((?:[^'\\]|\\[\s\S])*)'/.exec(script || '');
    if (!match) return null;
    return match[1].replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (whole, esc) => {
        if (esc[0] === 'u' || esc[0] === 'x') {
            return esc.length > 1 ? String.fromCharCode(parseInt(esc.slice(1), 16)) : esc;
        }
        if (esc === 'n') return '\n';
        if (esc === 't') return '\t';
        if (esc === 'r') return '';
        return esc;   // \" \' \/ \\
    });
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
    return String(text || '').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, code) => {
        if (code[0] === '#') {
            const point = code[1] === 'x' || code[1] === 'X'
                ? parseInt(code.slice(2), 16)
                : parseInt(code.slice(1), 10);
            return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, code) ? NAMED_ENTITIES[code] : whole;
    });
}

// Text content of a widget fragment: tags dropped, entities decoded, whitespace tidied.
function textOf(html) {
    return decodeEntities(String(html || '').replace(/<[^>]*>/g, '')).replace(/[ \t]+/g, ' ').trim();
}

// Inner HTML of the first <div class="gr_custom_<name>_<widget id>"> in a book block.
// These divs hold no nested divs, so the first closing tag ends the section.
function section(block, name) {
    const match = new RegExp(`<div class="gr_custom_${name}_\\w*">([\\s\\S]*?)</div>`).exec(block);
    return match ? match[1] : '';
}

// The widget serves a 98px-wide cover (".../62122504._SX98_.jpg"); dropping the size
// suffix gives the full-size image.
function fullSizeCover(url) {
    return url.replace(/\._S[XY]\d+_(?=\.\w+$)/, '');
}

function parseBook(block, status) {
    const titleHtml = section(block, 'title');
    const coverHtml = section(block, 'book_container');

    const title = textOf(titleHtml)
        || decodeEntities((/<img[^>]*\balt="([^"]*)"/.exec(coverHtml) || [])[1] || '');
    if (!title) return null;

    const reviewId = (/\/review\/show\/(\d+)/.exec(titleHtml + coverHtml) || [])[1] || '';
    const coverSrc = decodeEntities((/<img[^>]*\bsrc="([^"]*)"/.exec(coverHtml) || [])[1] || '');
    const hasCover = /\/books\//.test(coverSrc);
    // Cover URLs end in ".../books/<upload stamp>/<book id>.<size>.jpg"
    const bookId = hasCover ? ((/\/books\/[^/]+\/(\d+)\./.exec(coverSrc) || [])[1] || '') : '';

    const author = textOf(section(block, 'author')).replace(/^by\s+/i, '') || 'Unknown Author';
    const stars = (section(block, 'rating').match(/star_active/g) || []).length;
    const review = textOf(section(block, 'review')).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');

    const reviewLink = reviewId ? `https://www.goodreads.com/review/show/${reviewId}` : '';

    return {
        type: 'book',
        id: bookId || reviewId,
        title,
        subtitle: author,
        imageUrl: hasCover ? fullSizeCover(coverSrc) : '',
        // Book pages are public; review pages need a sign-in, so they are the fallback
        link: bookId ? `https://www.goodreads.com/book/show/${bookId}` : reviewLink,
        status,
        timestamp: null,   // the widget carries no dates
        rating: stars > 0 ? stars : null,
        review,
        reviewTruncated: /(\.\.\.|…)$/.test(review),
        reviewLink
    };
}

// Parse a widget script into books. Throws when the script is not a shelf widget, or is
// for a different shelf than the one asked for.
function parseWidget(script, shelf, status) {
    const html = extractWidgetHtml(script);
    if (html === null) {
        throw new Error('Goodreads shelf widget returned an unexpected response');
    }

    const served = (/\/review\/list\/[^"?]*\?[^"]*?\bshelf=([^&"]+)/.exec(html) || [])[1];
    if (served && decodeURIComponent(decodeEntities(served)) !== shelf) {
        throw new Error(`Goodreads returned the "${served}" shelf instead of "${shelf}"`);
    }

    return html
        .split(/<div class="gr_custom_each_container_\w*">/)
        .slice(1)
        .map(block => parseBook(block, status))
        .filter(book => book && book.id);
}

async function fetchShelf(userId, shelf, { status, limit = MAX_BOOKS, sort = 'date_added' }) {
    const response = await fetch(widgetUrl(userId, shelf, { limit, sort }), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; camdresie.com bookshelf)', Accept: '*/*' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`the Goodreads shelf widget answered ${response.status}`);
    }
    return parseWidget(await response.text(), shelf, status).slice(0, limit);
}

// The widget only answers to the bare numeric id; the old RSS feed also accepted the
// profile slug ("108233429-cam-dresie"). Accept that form, a pasted profile URL, or stray
// whitespace, and reduce each to the number.
function numericUserId(value) {
    const text = String(value || '').trim();
    const match = /(?:\/user\/show\/|\/review\/list(?:_rss)?\/)(\d+)/.exec(text) || /^(\d+)/.exec(text);
    return match ? match[1] : '';
}

// Everything on the currently-reading shelf, followed by the ten most recently read books.
async function fetchBooks(rawUserId) {
    const userId = numericUserId(rawUserId);
    if (!userId) {
        throw new Error('GOODREADS_USER_ID has no numeric Goodreads user id in it');
    }
    const [currentBooks, readBooks] = await Promise.all([
        fetchShelf(userId, 'currently-reading', { status: 'current', sort: 'date_added' }),
        fetchShelf(userId, 'read', { status: 'recent', limit: 10, sort: 'date_read' })
    ]);
    return [...currentBooks, ...readBooks];
}

module.exports = { fetchBooks, fetchShelf, parseWidget, widgetUrl };
