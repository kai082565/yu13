// 御13 Booking Worker
// 部署到 Cloudflare Workers，需綁定 KV namespace 名稱為 DB

const VAPID_PUBLIC = 'BEvgsRYUTa7eMhDcRQ1e__CexvjYfjlX6DvgT6DiEI6bbHUQFzpobotjuRRskL8uCy7EQv69vIm-oC1v0TFtLAA';
const VAPID_JWK = {
  kty: 'EC', crv: 'P-256',
  d: 'pUvI7Rd5Schtj2b_XyVxpW3IdBfhWgXFTiuyNscL6tg',
  x: 'S-CxFhRNrt4yENxFDV7_8J7G-Nh-OVfoO-BPoOIQjps',
  y: 'bHUQFzpobotjuRRskL8uCy7EQv69vIm-oC1v0TFtLAA',
  key_ops: ['sign']
};
const VAPID_SUBJECT = 'mailto:love02210825@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
};

function b64u(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function vapidJwt(audience) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 43200, sub: VAPID_SUBJECT })));
  const unsigned = `${h}.${p}`;
  const key = await crypto.subtle.importKey('jwk', VAPID_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64u(sig)}`;
}

async function sendPush(sub) {
  const origin = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(origin);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC}`, 'TTL': '86400', 'Urgency': 'high' }
  });
  return res.status;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const json = (d, s = 200) => new Response(JSON.stringify(d), {
      status: s, headers: { ...CORS, 'Content-Type': 'application/json' }
    });

    const secret = env.ADMIN_SECRET || 'yu13admin';
    const isAdmin = request.headers.get('X-Admin-Secret') === secret;

    // POST /submit — 收訂位
    if (url.pathname === '/submit' && request.method === 'POST') {
      const data = await request.json();
      const id = Date.now().toString();
      const booking = { id, data, created_at: new Date().toISOString() };

      // 讀取現有訂位清單，加入新訂位後一次寫回
      const existing = await env.DB.get('bookings', 'json') || [];
      existing.unshift(booking);
      await env.DB.put('bookings', JSON.stringify(existing));

      const subs = await env.DB.list({ prefix: 'sub:' });
      await Promise.all(subs.keys.map(async ({ name }) => {
        const sub = await env.DB.get(name, 'json');
        if (!sub) return;
        const status = await sendPush(sub);
        if (status === 410 || status === 404) await env.DB.delete(name);
      }));

      return json({ ok: true });
    }

    // GET /bookings — 列出所有訂位（需要管理員驗證）
    if (url.pathname === '/bookings' && request.method === 'GET') {
      if (!isAdmin) return json({ error: 'unauthorized' }, 401);
      const bookings = await env.DB.get('bookings', 'json') || [];
      return json(bookings);
    }

    // GET /latest — 最新一筆訂位（推播通知用）
    if (url.pathname === '/latest' && request.method === 'GET') {
      if (!isAdmin) return json({ error: 'unauthorized' }, 401);
      const bookings = await env.DB.get('bookings', 'json') || [];
      return json(bookings[0] || null);
    }

    // POST /bookings/delete — 刪除指定訂位
    if (url.pathname === '/bookings/delete' && request.method === 'POST') {
      if (!isAdmin) return json({ error: 'unauthorized' }, 401);
      const { ids } = await request.json();
      const bookings = await env.DB.get('bookings', 'json') || [];
      const filtered = bookings.filter(b => !ids.includes(b.id));
      await env.DB.put('bookings', JSON.stringify(filtered));
      return json({ ok: true });
    }

    // POST /subscribe — 註冊推播
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const sub = await request.json();
      const key = `sub:${sub.endpoint.slice(-40)}`;
      await env.DB.put(key, JSON.stringify(sub));
      return json({ ok: true });
    }

    // DELETE /subscribe — 取消推播
    if (url.pathname === '/subscribe' && request.method === 'DELETE') {
      const sub = await request.json();
      const key = `sub:${sub.endpoint.slice(-40)}`;
      await env.DB.delete(key);
      return json({ ok: true });
    }

    return new Response('Not Found', { status: 404, headers: CORS });
  }
};
