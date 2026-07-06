const { Agent, fetch: undiciFetch } = require('undici');

async function dohResolve(hostname) {
    const url = `https://dns.google/resolve?name=${hostname}&type=A`;
    const res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
    const json = await res.json();
    const answer = (json.Answer ?? []).find(a => a.type === 1);
    return answer ? answer.data : null;
}

async function test() {
    const hostname = 'samehadaku.run';
    const ip = await dohResolve(hostname);
    console.log('Resolved IP:', ip);
    if (!ip) return;

    const agent = new Agent({
        connect: {
            lookup: (_host, opts, cb) => {
                if (opts?.all) cb(null, [{ address: ip, family: 4 }]);
                else cb(null, ip, 4);
            },
        },
    });

    const url = `https://${hostname}/?s=Boruto`;
    const res = await undiciFetch(url, {
        dispatcher: agent,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
        }
    });

    const html = await res.text();
    console.log('Status:', res.status);
    console.log('HTML Length:', html.length);
    console.log('Contains animpost:', html.includes('animpost'));
}

test().catch(console.error);
