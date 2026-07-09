const cheerio = require('cheerio');

const SOKUJA_MIRRORS = [
    'https://x5.sokuja.uk',
    'https://sokuja.net',
    'https://x3.sokuja.uk',
];

const HTML_HDRS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://x5.sokuja.uk/',
};

async function fetchSingleUrl(url) {
    const res = await fetch(url, { headers: HTML_HDRS, cache: 'no-store' });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return res.text();
}

function cleanSokujCardTitle(raw) {
    return raw
        .replace(/^\d{1,3}(?=[A-Za-z])/, '')                  // rank badge nempel di depan
        .replace(/(?<=\S)(TV|Movie|OVA|ONA|Special)$/i, '')   // type badge nempel di belakang
        .trim();
}

async function sokujSearch(query) {
    for (const base of SOKUJA_MIRRORS) {
        try {
            console.log(`Searching Sokuja on ${base} for "${query}"...`);
            const html = await fetchSingleUrl(`${base}/?s=${encodeURIComponent(query)}`);
            const $ = cheerio.load(html);
            const seen = new Set();
            const results = [];

            const pushResult = (href, title, thumb) => {
                const norm = href.split('?')[0].replace(/\/$/, '') + '/';
                if (seen.has(norm) || !title) return;
                seen.add(norm);
                results.push({ title: cleanSokujCardTitle(title), url: norm, thumb });
            };

            $('a[href*="/anime/"]').each((_, el) => {
                const a = $(el);
                const href = (a.attr('href') ?? '').split('?')[0];
                if (!/\/anime\/[^/]+/.test(href)) return;
                const full = href.startsWith('http') ? href : `${base}${href}`;
                const title = (
                    a.attr('title') ||
                    a.attr('aria-label') ||
                    a.find('h1,h2,h3,h4,[class*="title"],[class*="name"]').first().text() ||
                    a.text()
                ).trim();
                const thumb = a.find('img').attr('src') ?? a.find('img').attr('data-src') ?? '';
                pushResult(full, title, thumb);
            });

            if (results.length > 0) return results;
        } catch (e) {
            console.warn(`Search failed on ${base}:`, e.message);
        }
    }
    return [];
}

async function sokujEpisodes(animeUrl) {
    const base = new URL(animeUrl).origin;
    let html;
    try {
        console.log(`Fetching episodes from ${animeUrl}...`);
        html = await fetchSingleUrl(animeUrl);
    } catch (e) {
        console.error('Failed to fetch anime page:', e.message);
        return [];
    }

    const animeSlugCore = (() => {
        try {
            const m = new URL(animeUrl).pathname.match(/^\/anime\/(.+?)-subtitle-indonesia\/?$/);
            return m ? m[1] : null;
        } catch { return null; }
    })();
    console.log('Parsed animeSlugCore:', animeSlugCore);

    const $ = cheerio.load(html);
    const entries = [];
    const seen = new Set();

    const pushEp = (href, label) => {
        if (!href || seen.has(href)) return;
        if (/^\/anime\/|^\/(tag|genre|jadwal|blog|cara-|page)\//.test(href)) return;
        if (!/-episode-\d|-eps-\d/i.test(href) && !/-subtitle-indonesia\/?$/.test(href)) return;
        if (animeSlugCore && !href.includes(animeSlugCore)) return;
        const full = href.startsWith('http') ? href : `${base}${href}`;
        if (full === animeUrl.replace(/\/$/, '') || full === animeUrl) return;
        seen.add(href);
        const urlEpMatch = href.match(/-(?:episode|eps)-(\d+(?:\.\d+)?)(?=-|\/|$)/i);
        const epNum = urlEpMatch ? parseFloat(urlEpMatch[1]) : 1;
        entries.push({ episode: epNum, title: label || `Episode ${epNum}`, url: full });
    };

    $('a').each((_, el) => {
        const a = $(el);
        pushEp(a.attr('href') ?? '', a.text().trim());
    });

    return entries;
}

// Simple similarity
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

function titleSimilarity(a, b) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1.0;
    const dist = levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    return 1 - dist / maxLen;
}

async function main() {
    const title = 'Aishiteru Game wo Owarasetai';
    const altTitles = ['I Want to End This Love Game', 'I Want to End the "I Love You" Game'];
    const titles = [title, ...altTitles];
    
    const searchResults = await sokujSearch(title);
    
    let best = null;
    for (const r of searchResults) {
        let score = 0;
        for (const t of titles) {
            const s = titleSimilarity(t, r.title);
            if (s > score) score = s;
        }
        console.log(`Candidate: "${r.title}" | Score: ${score} | URL: ${r.url}`);
        if (!best || score > best.score) best = { result: r, score };
    }
    
    console.log('BEST MATCH:', best);
    
    if (best && best.score >= 0.45) {
        const episodes = await sokujEpisodes(best.result.url);
        console.log('Episodes Found:', episodes.slice(0, 5));
    }
}

main();
