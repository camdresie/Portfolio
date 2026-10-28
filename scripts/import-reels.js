#!/usr/bin/env node
/*
 * Import the JSON produced by scripts/instagram-reels-snippet.js into data/desert-horology.json.
 *
 *   pbpaste | node scripts/import-reels.js                 macOS: straight from the clipboard
 *   node scripts/import-reels.js reels.json                from a file
 *   node scripts/import-reels.js reels.json --top 8        show 8 reels in "Most watched" (default 6)
 *   node scripts/import-reels.js reels.json --series "Quartz Crisis"
 *                                                           phrase that marks a series episode
 *                                                           (default: series.match in the data file)
 *   node scripts/import-reels.js reels.json --dry-run      print what would change, write nothing
 *   node scripts/import-reels.js reels.json --pin-label "Cam's pick"
 *                                                           label for pinned reels without a view count
 *
 * "Most watched" becomes the top reels by views, each labelled with its count, followed by any
 * input entry marked  "pinned": true  that did not make the cut. Series episodes are detected from
 * captions that contain the series phrase and ordered by the "Part N" in the caption. Input entries
 * may also carry  "title"  and  "topic"  to override what is derived from the caption.
 *
 * Hand-edited titles survive re-imports: add  "keepTitle": true  to an entry in the data file and
 * its title is kept whenever that post is imported again (matched by post code).
 * Everything else in the data file (intro copy, tagline, handle) is left as it is.
 */
const fs = require('fs');
const path = require('path');
const instagram = require('../lib/instagram');
const { captionTitle, detectSeries, formatViews } = instagram._internal;

function parseArgs(argv) {
    const options = { top: 6, dryRun: false, series: null, pinLabel: "Cam's pick", data: path.join(__dirname, '..', 'data', 'desert-horology.json'), input: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--top') options.top = parseInt(argv[++i], 10);
        else if (arg === '--series') options.series = argv[++i];
        else if (arg === '--pin-label') options.pinLabel = argv[++i];
        else if (arg === '--data') options.data = path.resolve(argv[++i]);
        else if (arg === '--help' || arg === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\s?/, '')); process.exit(0); }
        else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
        else options.input = arg;
    }
    if (!Number.isFinite(options.top) || options.top < 1) throw new Error('--top must be a positive number');
    return options;
}

function readInput(inputPath) {
    const raw = inputPath ? fs.readFileSync(inputPath, 'utf8') : fs.readFileSync(0, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('No input: pipe the snippet output in, or pass a JSON file path.');
    // Tolerate the "[reels] ..." console lines if the whole console was copied.
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    const parsed = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed);
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.reels) ? parsed.reels : null);
    if (!list) throw new Error('Expected a JSON array of reels.');
    return list;
}

function toPost(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const url = instagram.normalizePostUrl(entry.url || (entry.code ? `https://www.instagram.com/reel/${entry.code}/` : ''));
    if (!url) return null;
    const captionRaw = typeof entry.caption === 'string' ? entry.caption : '';
    const views = Number(entry.views);
    let timestamp = null;
    if (entry.takenAt) {
        const n = Number(entry.takenAt);
        timestamp = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(entry.takenAt);
        if (isNaN(timestamp.getTime())) timestamp = null;
    }
    return {
        permalink: url,
        code: url.split('/')[4],
        captionRaw,
        captionText: captionRaw.replace(/\s+/g, ' ').trim(),
        title: (typeof entry.title === 'string' && entry.title.trim()) || captionTitle(captionRaw),
        topic: typeof entry.topic === 'string' && entry.topic.trim() ? entry.topic.trim() : null,
        pinned: entry.pinned === true,
        views: Number.isFinite(views) && views >= 0 ? views : null,
        timestamp
    };
}

function byViewsDesc(a, b) {
    if (a.views === null && b.views === null) return 0;
    if (a.views === null) return 1;
    if (b.views === null) return -1;
    return b.views - a.views;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const data = JSON.parse(fs.readFileSync(options.data, 'utf8'));
    const seriesMatch = options.series || (data.series && (data.series.match || data.series.name)) || '';

    // Merge entries that point at the same post (a /p/ link and a /reel/ link share the code).
    const byCode = new Map();
    for (const entry of readInput(options.input)) {
        const post = toPost(entry);
        if (!post) continue;
        const existing = byCode.get(post.code);
        if (!existing) { byCode.set(post.code, post); continue; }
        byCode.set(post.code, {
            ...existing,
            permalink: existing.permalink.includes('/reel/') ? existing.permalink : post.permalink,
            captionRaw: existing.captionRaw || post.captionRaw,
            captionText: existing.captionText || post.captionText,
            title: existing.captionRaw ? existing.title : (post.title || existing.title),
            topic: existing.topic || post.topic,
            pinned: existing.pinned || post.pinned,
            views: existing.views !== null ? existing.views : post.views,
            timestamp: existing.timestamp || post.timestamp
        });
    }
    const posts = Array.from(byCode.values());
    if (!posts.length) throw new Error('No valid instagram.com/reel/... links in the input.');

    // Top N by views, then pinned entries that did not make the cut. With no view counts at all
    // (links pasted by hand), the input order is kept.
    const withViews = posts.filter(post => post.views !== null).sort(byViewsDesc);
    const topRanked = (withViews.length ? withViews : posts).slice(0, options.top);
    const pinned = posts.filter(post => post.pinned && !topRanked.includes(post)).sort(byViewsDesc);
    // Titles the owner edited by hand (marked keepTitle) win over anything derived from captions.
    const keptTitles = new Map();
    for (const list of [data.featured || [], (data.series && data.series.episodes) || []]) {
        for (const entry of list) {
            const url = instagram.normalizePostUrl(entry && entry.url);
            if (url && entry.keepTitle === true && entry.title) keptTitles.set(url.split('/')[4], entry.title);
        }
    }
    const withKeptTitle = (post, title) => keptTitles.has(post.code)
        ? { title: keptTitles.get(post.code), keepTitle: true }
        : { title };

    const featured = [...topRanked, ...pinned].map(post => ({
        ...withKeptTitle(post, post.title),
        topic: post.topic || (post.views !== null ? `${formatViews(post.views)} views` : (post.pinned ? options.pinLabel : 'Reel')),
        url: post.permalink
    }));
    const episodes = detectSeries(posts, seriesMatch).map(post => ({
        part: post.part,
        ...withKeptTitle(post, post.episodeTitle),
        url: post.permalink
    }));

    console.log(`Read ${posts.length} reels (${posts.filter(p => p.views !== null).length} with view counts, ${posts.filter(p => p.captionRaw).length} with captions).`);
    console.log(`\nMost watched (top ${options.top}${pinned.length ? ` + ${pinned.length} pinned` : ''}):`);
    featured.forEach((item, i) => console.log(`  ${i + 1}. ${item.topic.padEnd(12)} ${item.title || '(no caption)'}\n     ${item.url}`));
    console.log(`\nSeries "${seriesMatch}": ${episodes.length} episode(s)`);
    episodes.forEach(ep => console.log(`  Part ${ep.part === null ? '??' : String(ep.part).padStart(2, '0')}  ${ep.title}\n     ${ep.url}`));

    if (options.dryRun) { console.log('\nDry run: nothing written.'); return; }

    data.featured = featured;
    data.series = data.series || {};
    if (options.series) data.series.match = options.series;
    data.series.episodes = episodes;
    fs.writeFileSync(options.data, JSON.stringify(data, null, 2) + '\n');
    console.log(`\nWrote ${path.relative(process.cwd(), options.data)}. Start the site (npm start) and open /desert-horology to check it, then commit.`);
}

try {
    main();
} catch (error) {
    console.error('import-reels:', error.message);
    process.exit(1);
}
