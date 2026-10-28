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
 *
 * "Most watched" becomes the top reels by views, each labelled with its count. Series episodes are
 * detected from captions that contain the series phrase and ordered by the "Part N" in the caption.
 * Everything else in the data file (intro copy, tagline, handle) is left as it is.
 */
const fs = require('fs');
const path = require('path');
const instagram = require('../lib/instagram');
const { captionTitle, detectSeries, formatViews } = instagram._internal;

function parseArgs(argv) {
    const options = { top: 6, dryRun: false, series: null, data: path.join(__dirname, '..', 'data', 'desert-horology.json'), input: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--top') options.top = parseInt(argv[++i], 10);
        else if (arg === '--series') options.series = argv[++i];
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
        captionRaw,
        captionText: captionRaw.replace(/\s+/g, ' ').trim(),
        title: (typeof entry.title === 'string' && entry.title.trim()) || captionTitle(captionRaw),
        views: Number.isFinite(views) && views >= 0 ? views : null,
        timestamp
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const data = JSON.parse(fs.readFileSync(options.data, 'utf8'));
    const seriesMatch = options.series || (data.series && (data.series.match || data.series.name)) || '';

    const byUrl = new Map();
    for (const entry of readInput(options.input)) {
        const post = toPost(entry);
        if (!post) continue;
        const existing = byUrl.get(post.permalink);
        if (!existing || (existing.views === null && post.views !== null) || (!existing.captionRaw && post.captionRaw)) {
            byUrl.set(post.permalink, { ...existing, ...post });
        }
    }
    const posts = Array.from(byUrl.values());
    if (!posts.length) throw new Error('No valid instagram.com/reel/... links in the input.');

    const ranked = posts
        .slice()
        .sort((a, b) => {
            if (a.views === null && b.views === null) return 0;
            if (a.views === null) return 1;
            if (b.views === null) return -1;
            return b.views - a.views;
        });
    const featured = ranked.slice(0, options.top).map(post => ({
        title: post.title,
        topic: post.views !== null ? `${formatViews(post.views)} views` : 'Reel',
        url: post.permalink
    }));
    const episodes = detectSeries(posts, seriesMatch).map(post => ({
        part: post.part,
        title: post.episodeTitle,
        url: post.permalink
    }));

    console.log(`Read ${posts.length} reels (${posts.filter(p => p.views !== null).length} with view counts, ${posts.filter(p => p.captionRaw).length} with captions).`);
    console.log(`\nMost watched (top ${options.top}):`);
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
