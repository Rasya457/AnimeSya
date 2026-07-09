const cheerio = require('cheerio');

async function main() {
    try {
        const query = 'Youjo Senki';
        const url = `https://x5.sokuja.uk/?s=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = await res.text();
        const $ = cheerio.load(html);
        
        console.log('HTML Length:', html.length);
        console.log('--- All Links ---');
        const links = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (href) {
                links.push({ href, text });
            }
        });
        
        console.log(links.slice(0, 50));
    } catch (e) {
        console.error('Error:', e);
    }
}

main();
