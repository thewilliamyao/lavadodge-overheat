// LavaDodge TURN credentials Worker (Cloudflare).
// The game asks this Worker for short-lived TURN relay credentials so online 2-player works
// on networks that block direct device-to-device connections. The long-term TURN key stays
// here as Worker secrets (TURN_KEY_ID, TURN_KEY_API_TOKEN) and never reaches the browser.

const ALLOWED = ['https://thewilliamyao.github.io'];
const isAllowed = o => ALLOWED.includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o);

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': isAllowed(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    // Only hand out credentials to the game's own pages.
    if (!isAllowed(origin)) return new Response('forbidden', { status: 403, headers: cors });

    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 4 * 3600 }), // 4 hours: longer than any play session
    });
    if (!r.ok) return new Response('turn error', { status: 502, headers: cors });
    const { iceServers } = await r.json();
    // Port 53 URLs time out in browsers; drop them.
    const servers = (Array.isArray(iceServers) ? iceServers : [iceServers]).map(s => ({
      ...s, urls: [].concat(s.urls).filter(u => !/:53(\?|$)/.test(u)),
    }));
    return Response.json({ iceServers: servers }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
  },
};
