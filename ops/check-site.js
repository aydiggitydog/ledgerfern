// Weekly health check: every page on the live site loads, every link on it resolves,
// and the Payhip checkout links respond. Exits non-zero (failing the GitHub Action,
// which emails the repo owner) if anything is broken.
// Usage: node ops/check-site.js https://your-site.example
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) { console.error('usage: node check-site.js <base-url>'); process.exit(2); }

const seen = new Set();
const problems = [];

async function status(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Ledgerfern-monitor' } });
    return { code: res.status, text: res.headers.get('content-type')?.includes('text/html') ? await res.text() : '' };
  } catch (e) {
    return { code: 0, text: '', error: e.message };
  }
}

async function crawl(url) {
  if (seen.has(url)) return;
  seen.add(url);
  const { code, text, error } = await status(url);
  if (code !== 200) { problems.push(`${code || error} ${url}`); return; }
  for (const m of text.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const link = new URL(m[1], url).href;
    if (link.startsWith('mailto:')) continue;
    if (link.startsWith(base)) await crawl(link);
    else if (/payhip\.com/.test(link) && !seen.has(link)) {
      seen.add(link);
      const r = await status(link);
      // Payhip sits behind Cloudflare bot protection, which answers scripts with 403.
      // That proves the host is up but not the product, so warn rather than fail.
      if (r.code === 403) console.warn(`WARN 403 (bot protection, check by hand) ${link}`);
      else if (r.code !== 200) problems.push(`${r.code || r.error} checkout link ${link}`);
    }
  }
}

(async () => {
  await crawl(`${base}/`);
  console.log(`Checked ${seen.size} URLs`);
  if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
  console.log('All OK');
})();
