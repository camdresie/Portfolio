/*********************
 * Variables for the necessary dependencies
*********************/

require('dotenv').config();

const express = require("express");
const app = express();
const data = require("./data.json");
const RSSParser = require('rss-parser');
// Configure RSS parser to extract Goodreads custom fields
const rssParser = new RSSParser({
    customFields: {
        item: [
            ['author_name', 'author_name'],
            ['book_id', 'book_id'],
            ['user_rating', 'user_rating'],
            ['user_review', 'user_review'],
            ['book_large_image_url', 'book_large_image_url']
        ]
    }
});
// Configure RSS parser to extract Letterboxd custom fields
const letterboxdParser = new RSSParser({
    customFields: {
        item: [
            ['letterboxd:watchedDate', 'watchedDate'],
            ['letterboxd:filmTitle', 'filmTitle'],
            ['letterboxd:filmYear', 'filmYear'],
            ['letterboxd:memberRating', 'memberRating'],
            ['letterboxd:rewatch', 'rewatch'],
            ['tmdb:movieId', 'tmdbMovieId']
        ]
    }
});
const fs = require('fs');
const path = require('path');

// Simple in-memory cache for blog feed
let blogCache = { posts: [], lastFetched: 0 };
const BLOG_RSS_URL = 'https://beyond-the-backlog.ghost.io/rss/';
const BLOG_CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutes

// Cache for consuming data (books and movies)
let consumingCache = {
    books: { data: [], lastFetched: 0, error: null },
    movies: { data: [], lastFetched: 0, error: null },
    lastFullFetch: 0
};
const CONSUMING_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/*********************
 * Data fetching functions for consuming page
*********************/

// Fetch books from Goodreads RSS feed
async function fetchGoodreadsRSS() {
    try {
        const userId = process.env.GOODREADS_USER_ID;
        if (!userId || userId === 'your_goodreads_user_id') {
            throw new Error('Goodreads User ID not configured');
        }

        // Fetch both currently-reading and recently read books
        const currentlyReadingUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=currently-reading`;
        const readUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=read&per_page=10`;

        const [currentFeed, readFeed] = await Promise.all([
            rssParser.parseURL(currentlyReadingUrl),
            rssParser.parseURL(readUrl)
        ]);

        const parseBook = (item, status) => {
            // Use Goodreads custom fields
            const bookId = item.book_id || '';
            const author = item.author_name || 'Unknown Author';
            const imageUrl = item.book_large_image_url || item.book_medium_image_url || '';
            const rating = item.user_rating ? parseInt(item.user_rating) : null;
            const review = item.user_review || '';

            // Construct proper book link from book ID
            const bookLink = bookId ? `https://www.goodreads.com/book/show/${bookId}` : item.link;

            return {
                type: 'book',
                id: bookId,
                title: item.title || 'Unknown Title',
                subtitle: author,
                imageUrl: imageUrl,
                link: bookLink,
                status: status,
                timestamp: item.pubDate ? new Date(item.pubDate) : new Date(),
                rating: rating,
                review: review.trim()
            };
        };

        // Parse currently reading books (no limit)
        const currentBooks = (currentFeed.items || []).map(item => parseBook(item, 'current'));

        // Parse recently read books (limit to 10)
        const readBooks = (readFeed.items || []).slice(0, 10).map(item => parseBook(item, 'recent'));

        // Combine and return
        return [...currentBooks, ...readBooks];
    } catch (error) {
        console.error('Error fetching Goodreads RSS:', error);
        throw error;
    }
}

// Fetch movies from Letterboxd RSS feed
async function fetchLetterboxdRSS() {
    try {
        const username = process.env.LETTERBOXD_USERNAME;
        if (!username || username === 'your_letterboxd_username') {
            throw new Error('Letterboxd username not configured');
        }

        const rssUrl = `https://letterboxd.com/${username}/rss/`;
        const feed = await letterboxdParser.parseURL(rssUrl);

        const parseMovie = (item) => {
            // Extract poster image from content HTML
            let imageUrl = '';
            if (item.content) {
                const imgMatch = item.content.match(/<img[^>]+src="([^"]+)"/);
                if (imgMatch) {
                    imageUrl = imgMatch[1];
                }
            }

            // Extract review text (remove HTML tags from content)
            let review = '';
            if (item.content) {
                review = item.content
                    .replace(/<img[^>]*>/g, '') // Remove img tags
                    .replace(/<p>/g, '')
                    .replace(/<\/p>/g, '\n')
                    .replace(/<br\s*\/?>/g, '\n')
                    .replace(/<[^>]+>/g, '') // Remove all other HTML tags
                    .trim();
            }

            // Determine status: watched in last 30 days = 'current', else 'recent'
            const watchedDate = item.watchedDate ? new Date(item.watchedDate) : new Date(item.pubDate);
            const daysSinceWatch = (Date.now() - watchedDate.getTime()) / (1000 * 60 * 60 * 24);
            const status = daysSinceWatch <= 30 ? 'current' : 'recent';

            // Create unique ID from TMDB ID or generate from title/year
            const movieId = item.tmdbMovieId || `${item.filmTitle}-${item.filmYear}`.toLowerCase().replace(/\s+/g, '-');

            return {
                type: 'movie',
                id: movieId,
                title: item.filmTitle || 'Unknown Title',
                subtitle: item.filmYear ? `${item.filmYear}` : '',
                imageUrl: imageUrl,
                link: item.link || '',
                status: status,
                timestamp: watchedDate,
                rating: item.memberRating ? parseFloat(item.memberRating) : null,
                review: review,
                rewatch: item.rewatch === 'Yes',
                tmdbId: item.tmdbMovieId
            };
        };

        // Parse all movies and sort by watch date (most recent first)
        const movies = (feed.items || [])
            .map(item => parseMovie(item))
            .sort((a, b) => b.timestamp - a.timestamp);

        return movies;
    } catch (error) {
        console.error('Error fetching Letterboxd RSS:', error);
        throw error;
    }
}

// Fetch recent tracks from Last.fm API
async function fetchLastFmTracks() {
    try {
        const apiKey = process.env.LASTFM_API_KEY;
        const username = process.env.LASTFM_USERNAME;

        if (!apiKey || apiKey === 'your_lastfm_api_key' || !username || username === 'your_lastfm_username') {
            throw new Error('Last.fm credentials not configured');
        }

        const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${apiKey}&format=json&limit=10`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Last.fm API returned ${response.status}`);
        }

        const data = await response.json();

        if (!data.recenttracks || !data.recenttracks.track) {
            throw new Error('Invalid Last.fm response format');
        }

        const tracks = Array.isArray(data.recenttracks.track)
            ? data.recenttracks.track
            : [data.recenttracks.track];

        return tracks.map(track => ({
            type: 'music',
            title: track.name || 'Unknown Track',
            subtitle: track.artist?.['#text'] || track.artist || 'Unknown Artist',
            imageUrl: track.image?.[2]?.['#text'] || '', // medium size image
            link: track.url || '',
            status: track['@attr']?.nowplaying === 'true' ? 'current' : 'recent',
            timestamp: track.date?.uts ? new Date(track.date.uts * 1000) : new Date(),
            metadata: {
                nowPlaying: track['@attr']?.nowplaying === 'true',
                album: track.album?.['#text'] || ''
            }
        }));
    } catch (error) {
        console.error('Error fetching Last.fm tracks:', error);
        throw error;
    }
}

// Fetch manual data (audiobooks and podcasts) from JSON file
async function fetchManualData(type) {
    try {
        const dataPath = path.join(__dirname, 'data', 'consuming.json');

        if (!fs.existsSync(dataPath)) {
            console.warn('consuming.json not found, returning empty array');
            return [];
        }

        const fileContent = fs.readFileSync(dataPath, 'utf8');
        const data = JSON.parse(fileContent);

        const items = data[type] || [];

        // Normalize manual data to common schema
        return items.map(item => ({
            type: type === 'audiobooks' ? 'audiobook' : 'podcast',
            title: item.title || item.showName || 'Unknown',
            subtitle: item.author || item.episodeTitle || '',
            imageUrl: item.imageUrl || '',
            link: item.link || '',
            status: item.status || 'current',
            timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
            metadata: {
                progress: item.progress,
                episodeTitle: item.episodeTitle
            }
        }));
    } catch (error) {
        console.error(`Error fetching manual ${type} data:`, error);
        throw error;
    }
}

// Refresh all consuming cache data
async function refreshConsumingCache() {
    const now = Date.now();

    try {
        const books = await fetchGoodreadsRSS();
        consumingCache.books.data = books;
        consumingCache.books.error = null;
        consumingCache.books.lastFetched = now;
    } catch (error) {
        consumingCache.books.error = error.message;
        console.error('Failed to fetch books:', error);
    }

    try {
        const movies = await fetchLetterboxdRSS();
        consumingCache.movies.data = movies;
        consumingCache.movies.error = null;
        consumingCache.movies.lastFetched = now;
    } catch (error) {
        consumingCache.movies.error = error.message;
        console.error('Failed to fetch movies:', error);
    }

    consumingCache.lastFullFetch = now;
    console.log('Consuming cache refreshed at', new Date(now).toISOString());
}

/*********************
 * Sets Pug as the view engine
*********************/

app.set('view engine', 'pug');

/*********************
 * Sets up static server to supply CSS files. 
*********************/

app.use('/static', express.static('public'));
app.use(express.static('public'));

/*********************
 * Sets routes to the pages to be rendered (the home landing page, about page, and projects pages). The projects
 * pages in project.pug receive data from data.json relative to the specific project that has been selected (thisProject)
 * and then dynamically render that information on screen. 
*********************/

app.get('/', (req, res) => {
    res.render('bio', {
        pageTitle: "Cam Dresie - Group Product Manager | AI & Legal Tech Leader",
        pageDescription: "Learn about Cam Dresie's background and personal story. Group PM at Ontra with expertise in AI-powered legal technology, team leadership, and software engineering."
    });
})

app.get('/projects', (req, res) => {
    const { projects, categories, pmProjects } = data;
    res.render('index', { 
        projects, 
        categories, 
        pmProjects,
        pageTitle: "Projects - Cam Dresie | Product & Engineering Portfolio",
        pageDescription: "Explore Cam Dresie's product management and engineering projects. AI-powered legal technology solutions, team leadership initiatives, and technical implementations."
    });
})

app.get('/timeline', (req, res) => {
    res.render('timeline', {
        pageTitle: "Professional Timeline - Cam Dresie | Career Journey",
        pageDescription: "Explore Cam Dresie's professional timeline from law to product management. Journey from J.D. at Washington University to Group Product Manager at Ontra leading AI legal technology."
    });
})

app.get('/leadership', (req, res) => {
    res.render('leadership', {
        pageTitle: "Leadership Philosophy - Cam Dresie | Management Approach",
        pageDescription: "Discover Cam Dresie's leadership philosophy as a Group Product Manager. Supportive leadership approach focusing on team empowerment, growth mindset, and psychological safety."
    });
})

// Blog route - fetches Ghost RSS and renders posts
app.get('/blog', async (req, res) => {
    try {
        const now = Date.now();
        if (!blogCache.posts.length || (now - blogCache.lastFetched) > BLOG_CACHE_TTL_MS) {
            const feed = await rssParser.parseURL(BLOG_RSS_URL);
            const posts = (feed.items || []).map(item => {
                // Extract featured image from content:encoded HTML
                let imageUrl = '';
                if (item['content:encoded']) {
                    const imgMatch = item['content:encoded'].match(/<img[^>]+src="([^"]+)"/);
                    if (imgMatch) {
                        imageUrl = imgMatch[1];
                    }
                }

                return {
                    title: item.title,
                    link: item.link,
                    pubDate: item.pubDate ? new Date(item.pubDate) : null,
                    isoDate: item.isoDate || null,
                    description: item.contentSnippet || item.content || '',
                    author: item.creator || item.author || feed.title,
                    categories: item.categories || [],
                    imageUrl: imageUrl
                };
            });

            blogCache = { posts, lastFetched: now };
        }

        const formattedPosts = blogCache.posts.map(p => ({
            ...p,
            displayDate: p.pubDate ? p.pubDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''
        }));

        res.render('blog', {
            posts: formattedPosts,
            pageTitle: "Blog - Beyond the Backlog | Cam Dresie",
            pageDescription: "Latest posts from Beyond the Backlog by Cam Dresie. Product management, AI, and legal tech insights."
        });
    } catch (error) {
        console.error('Error fetching blog feed:', error);
        res.status(500).render('error', { error: { status: 500, message: 'Failed to load blog feed.' } });
    }
});

// Consuming route - shows current and recently read books
app.get('/consuming', async (req, res) => {
    try {
        const now = Date.now();

        // Check if cache needs refresh (24-hour TTL)
        if ((now - consumingCache.lastFullFetch) > CONSUMING_CACHE_TTL_MS) {
            await refreshConsumingCache();
        }

        // Separate books into currently reading and recently read
        const currentBooks = consumingCache.books.data.filter(b => b.status === 'current');
        const recentBooks = consumingCache.books.data.filter(b => b.status === 'recent');

        // Separate movies into recently watched and older
        const currentMovies = consumingCache.movies.data.filter(m => m.status === 'current');
        const recentMovies = consumingCache.movies.data.filter(m => m.status === 'recent');

        res.render('consuming', {
            currentBooks,
            recentBooks,
            booksError: consumingCache.books.error,
            currentMovies,
            recentMovies,
            moviesError: consumingCache.movies.error,
            pageTitle: "Currently Reading & Watching - Cam Dresie",
            pageDescription: "What I'm currently reading from Goodreads and watching on Letterboxd."
        });
    } catch (error) {
        console.error('Error loading consuming page:', error);
        res.status(500).render('error', {
            error: { status: 500, message: 'Failed to load reading and watching data.' }
        });
    }
});

// Book detail route - shows individual book with review
app.get('/book/:id', async (req, res) => {
    try {
        const bookId = req.params.id;
        const now = Date.now();

        // Ensure cache is fresh
        if ((now - consumingCache.lastFullFetch) > CONSUMING_CACHE_TTL_MS) {
            await refreshConsumingCache();
        }

        // Find the book in cache
        const book = consumingCache.books.data.find(b => b.id === bookId);

        if (!book) {
            return res.sendStatus(404);
        }

        res.render('book-detail', {
            book,
            pageTitle: `${book.title} - Cam Dresie's Review`,
            pageDescription: book.review ? book.review.substring(0, 160) : `My review of ${book.title} by ${book.subtitle}`
        });
    } catch (error) {
        console.error('Error loading book detail:', error);
        res.status(500).render('error', {
            error: { status: 500, message: 'Failed to load book details.' }
        });
    }
});

// Keep legacy /about route for backwards compatibility, redirect to /bio
app.get('/about', (req, res) => {
    res.redirect(301, '/bio');
})

app.get('/project/:id', (req, res) => {
  const projectId = req.params.id;
  let project;

  // Check if it's a PM project
  if (projectId.startsWith('pm-')) {
    for (const category of data.pmProjects.categories) {
      project = category.projects.find(p => p.id === projectId);
      if (project) {
        return res.render('pm-project', { 
          project,
          pageTitle: `${project.project_name} - Cam Dresie Product Management Portfolio`,
          pageDescription: project.description || project.overview
        });
      }
    }
  } else {
    // Handle engineering projects
    project = data.projects.find(p => p.id === projectId);
    if (project) {
      return res.render('project', { 
        thisProject: project,
        pageTitle: `${project.project_name} - Cam Dresie Engineering Portfolio`,
        pageDescription: project.description
      });
    }
  }

  // If no project found, return 404
  res.sendStatus(404);
});

/*********************
 * 404 Error Handler followed by a custom error handler that points 
 * to the error.pug file and renders it if an error occurs. 
*********************/

app.use((req, res, next) => {
    const err = new Error('Uh-oh! This page doesn\'t exist! Try again.');
    err.status = 404;
    next(err);
});

app.use((err, req, res, next) => {
    res.locals.error = err;
    res.render('error');
    res.status(err.status);
});

/*********************
 * The app listens on localhost:3000. The app will also run if a user enters 'npm start' in the terminal.
*********************/

app.listen(process.env.PORT || 5001, () => {
    console.log('The server is running!');
});