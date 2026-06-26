async function test() {
  try {
    const res = await fetch('https://megaplay.buzz/stream/mal/52299/1/sub', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    console.log('Status:', res.status);
    const html = await res.text();
    console.log('HTML Length:', html.length);
    console.log('Sample HTML (first 2000 chars):');
    console.log(html.slice(0, 2000));
    
    // Look for script tags or sources
    console.log('\nLooking for patterns:');
    const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
    console.log('Found scripts:', scripts.length);
    for (const script of scripts) {
      if (script.includes('file') || script.includes('source') || script.includes('m3u8') || script.includes('player')) {
        console.log('--- Matching Script ---');
        console.log(script.slice(0, 500));
      }
    }
  } catch (e) {
    console.error(e);
  }
}

test();
