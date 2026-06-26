import { Agent, fetch as undiciFetch } from 'undici';
import * as cheerio from 'cheerio';

async function dohResolve(hostname: string): Promise<string | null> {
    const resolvers = [
        `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
        `https://dns.google/resolve?name=${hostname}&type=A`,
    ];
    try {
        const ip = await Promise.any(
            resolvers.map(async url => {
                const res = await fetch(url, {
                    headers: { Accept: 'application/dns-json' },
                    cache: 'no-store',
                });
                if (!res.ok) throw new Error('dns-err');
                const json = await res.json() as any;
                const answer = (json.Answer ?? []).find((a: any) => a.type === 1);
                if (!answer?.data) throw new Error('no-answer');
                return answer.data as string;
            })
        );
        return ip;
    } catch (e: any) {
        return null;
    }
}

async function fetchHtml(url: string): Promise<string> {
    const parsedUrl = new URL(url);
    const ip = await dohResolve(parsedUrl.hostname);
    if (!ip) throw new Error(`Could not resolve IP for ${parsedUrl.hostname}`);

    const agent = new Agent({
        connect: {
            lookup: (_host, opts: any, cb) => {
                if (opts?.all) cb(null, [{ address: ip, family: 4 }]);
                else cb(null, ip, 4);
            },
        },
    });

    const res = await undiciFetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        dispatcher: agent,
    });
    return res.text();
}

async function doSearch(query: string) {
    console.log(`Searching for "${query}"...`);
    const html = await fetchHtml(`https://otakudesu.blog/?s=${encodeURIComponent(query)}&post_type=anime`);
    const $ = cheerio.load(html);
    const results: any[] = [];
    $('.chivsrc li').each((_, el) => {
        const a = $(el).find('a').first();
        results.push({ title: a.text().trim(), url: a.attr('href') });
    });
    console.log(`Found ${results.length} results:`, results);
}

async function main() {
    try {
        await doSearch('solo leveling');
        await doSearch('ore dake');
        await doSearch('level up');
        await doSearch('naruto');
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

main();
