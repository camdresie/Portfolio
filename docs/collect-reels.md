# Collecting reels without the API

Two files make the Desert Horology Co. page self-filling without a Meta developer account:

- `scripts/instagram-reels-snippet.js` runs in your browser on your own Reels tab and collects every reel's link, view count, and caption.
- `scripts/import-reels.js` turns that output into the page's data file.

Re-run both whenever you want new reels or fresh view counts on the page. About two minutes end to end.

## 1. Collect

1. Log in to Instagram in Chrome, Firefox, or Safari and open `https://www.instagram.com/deserthorologyco/reels/`.
2. Open the developer console. Chrome: Cmd+Option+J on a Mac, Ctrl+Shift+J on Windows. Firefox: Cmd+Option+K or Ctrl+Shift+K. Safari: turn on the Develop menu in Settings > Advanced, then Cmd+Option+C.
3. Open `scripts/instagram-reels-snippet.js`, copy the whole file, paste it into the console, and press Enter.
4. Watch the `[reels]` lines. The script scrolls until the grid stops growing, then fetches captions for the most-viewed reels. When it prints the JSON, it has also copied it to the clipboard.

If a browser refuses the paste with a warning about pasting code, type `allow pasting` first, as it asks. That protection exists because console snippets run with your login, which is exactly why this one only reads your own page.

## 2. Import

From the repo folder:

```
pbpaste | node scripts/import-reels.js
```

On Windows, save the JSON to a file instead and run `node scripts/import-reels.js reels.json`.

The command prints what it found and writes `data/desert-horology.json`:

- `featured` becomes the top reels by views (6 by default; `--top 8` for eight), each labelled with its view count.
- `series.episodes` becomes every reel whose caption contains the series phrase ("Quartz Crisis" by default, `--series "..."` to change it), ordered by the "Part N" in the caption.
- `--dry-run` shows the result without writing.
- Entries in the JSON marked `"pinned": true` always stay on the page, after the ranked ones, labelled "Cam's pick" when they have no view count (`--pin-label` changes the label). Add `"title"` or `"topic"` to an entry to override what the caption gives.

Then `npm start`, open `http://localhost:5001/desert-horology`, and commit.

## Or send me the JSON

Paste the JSON into the Claude session and the import runs there.

## Notes

- Titles come from the first usable sentence of each caption: comment-bait questions ("Which is your favorite? 👇") and bare part lines ("QUARTZ CRISIS PART 9 of 30.") are skipped. To hand-edit a title, change it in `data/desert-horology.json` and add `"keepTitle": true` to that entry; re-imports then leave it alone.
- The console script reads the grid for links and counts, then tries three ways to get captions while logged in: the media-info endpoint Instagram's own web app uses, the older post JSON view, and the reel page's meta tags. It logs which one worked. Instagram changes its site often; if a run returns no captions, the links and counts still import fine. If it returns no links at all, check that the URL ends in `/reels/` and that you are logged in.
- The grid only loads as you scroll. The script keeps scrolling until five rounds in a row add nothing; if an old reel is missing from the output, scroll to the very bottom of the Reels tab by hand first, then run it.
- When the API token is configured (see `instagram-feed-setup.md`), the page ranks videos live and ignores the imported list, so the two approaches do not conflict.
