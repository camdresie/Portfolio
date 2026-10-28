/*
 * Desert Horology Co.: collect your reels' links, view counts, and captions straight from your
 * own profile page. No API, no developer account; it reads the page you are already looking at.
 *
 * How to use (about a minute):
 *   1. Log in to Instagram in your browser and open  https://www.instagram.com/deserthorologyco/reels/
 *   2. Open the developer console: Chrome  Cmd+Option+J (Mac) / Ctrl+Shift+J (Windows)
 *                                  Firefox Cmd+Option+K / Ctrl+Shift+K
 *                                  Safari  enable the Develop menu in Settings > Advanced, then Cmd+Option+C
 *   3. Paste this whole file into the console and press Enter.
 *      It scrolls the grid until every reel has loaded, reads the view counts, fetches the caption
 *      and exact count for the most-viewed ones, then prints a JSON list and copies it to the clipboard.
 *   4. In the repo, import it:   pbpaste | node scripts/import-reels.js
 *      (or save the JSON to a file and run  node scripts/import-reels.js reels.json)
 *
 * Nothing leaves your browser except Instagram's own requests to Instagram.
 * Re-run it whenever you want the page to pick up new reels or fresh view counts.
 */
(async () => {
  const MAX_SCROLLS = 80;      // stops early once the grid stops growing
  const SCROLL_WAIT_MS = 1500;
  const ENRICH_TOP = 24;       // fetch caption + exact count for this many of the most-viewed reels
  const ENRICH_WAIT_MS = 700;  // polite pause between those fetches

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = (...args) => console.log('[reels]', ...args);

  if (!/instagram\.com$/.test(location.hostname)) {
    log('Warning: this is not instagram.com. Run it on your profile\'s Reels tab.');
  }
  if (!/\/reels\/?$/.test(location.pathname)) {
    log('Tip: open the Reels tab of your profile (the URL ends in /reels/) so every card shows a play count.');
  }

  // "12.3K", "1,234", "2.1M" -> number
  function parseCount(text) {
    const match = String(text || '').match(/(\d[\d,]*(?:\.\d+)?)\s*([KMB])?\b/i);
    if (!match) return null;
    const n = parseFloat(match[1].replace(/,/g, ''));
    if (!isFinite(n)) return null;
    const unit = (match[2] || '').toUpperCase();
    const mult = unit === 'K' ? 1e3 : unit === 'M' ? 1e6 : unit === 'B' ? 1e9 : 1;
    return Math.round(n * mult);
  }

  // Every reel link currently in the grid, with the count shown on its card (if any).
  function collect(found) {
    document.querySelectorAll('a[href*="/reel/"]').forEach((a) => {
      const match = (a.getAttribute('href') || '').match(/\/reel\/([A-Za-z0-9_-]+)/);
      if (!match) return;
      const code = match[1];
      const views = parseCount(a.innerText || a.textContent || '');
      const existing = found.get(code);
      if (!existing) found.set(code, { code, views });
      else if (existing.views === null && views !== null) existing.views = views;
    });
    return found;
  }

  // Caption and exact play count from Instagram's own JSON for a post (works while logged in).
  async function fetchDetails(code) {
    const res = await fetch(`/reel/${code}/?__a=1&__d=dis`, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.indexOf('json') === -1) return null;
    const data = await res.json();
    const item = (data.items && data.items[0]) || (data.graphql && data.graphql.shortcode_media) || null;
    if (!item) return null;
    let caption = '';
    if (item.caption && typeof item.caption.text === 'string') caption = item.caption.text;
    else if (item.edge_media_to_caption && item.edge_media_to_caption.edges && item.edge_media_to_caption.edges[0]) {
      caption = item.edge_media_to_caption.edges[0].node.text || '';
    }
    const views = [item.play_count, item.ig_play_count, item.view_count, item.video_play_count, item.video_view_count]
      .find((v) => typeof v === 'number');
    const takenAt = item.taken_at || item.taken_at_timestamp || null;
    return { caption, views: typeof views === 'number' ? views : null, takenAt };
  }

  // 1. Scroll until the grid stops growing.
  const found = new Map();
  let stable = 0;
  for (let i = 0; i < MAX_SCROLLS; i++) {
    const before = collect(found).size;
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(SCROLL_WAIT_MS);
    const after = collect(found).size;
    log(`loaded ${after} reels`);
    stable = after === before ? stable + 1 : 0;
    if (stable >= 3) break;
  }
  window.scrollTo(0, 0);

  if (!found.size) {
    log('No reel links found on this page. Make sure you are on your profile\'s Reels tab and logged in.');
    return [];
  }

  // 2. Most viewed first (reels with no visible count go last).
  const reels = Array.from(found.values()).sort((a, b) => (b.views || 0) - (a.views || 0));

  // 3. Captions and exact counts for the top of the list.
  let enriched = 0;
  for (const reel of reels.slice(0, ENRICH_TOP)) {
    try {
      const details = await fetchDetails(reel.code);
      if (details) {
        reel.caption = details.caption;
        if (details.views !== null) reel.views = details.views;
        reel.takenAt = details.takenAt;
        enriched++;
      }
    } catch (error) {
      // Captions are a bonus; the link and the count from the grid are enough.
    }
    await sleep(ENRICH_WAIT_MS);
  }
  reels.sort((a, b) => (b.views || 0) - (a.views || 0));
  log(`captions fetched for ${enriched} of ${Math.min(ENRICH_TOP, reels.length)} top reels`);

  // 4. Output.
  const output = reels.map((reel) => ({
    url: `https://www.instagram.com/reel/${reel.code}/`,
    views: reel.views,
    caption: reel.caption || '',
    takenAt: reel.takenAt || null
  }));
  const json = JSON.stringify(output, null, 2);
  console.log(json);
  try {
    if (typeof copy === 'function') { copy(json); log('Copied to the clipboard. Next: pbpaste | node scripts/import-reels.js'); }
    else if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(json); log('Copied to the clipboard. Next: pbpaste | node scripts/import-reels.js'); }
    else log('Clipboard not available here: select the JSON above and copy it.');
  } catch (error) {
    log('Clipboard not available here: select the JSON above and copy it.');
  }
  return output;
})();
