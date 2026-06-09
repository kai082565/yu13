const CACHE = 'yu13-v3';
const ORIGIN = self.location.origin;

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== 'config').map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 只處理同源的頁面請求，API 請求（跨域）直接放行
  if (!url.startsWith(ORIGIN)) return;
  if (e.request.method !== 'GET') return;
  // sw.js 本身不快取
  if (url.includes('/sw.js')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// 接收 admin.html 傳來的設定
self.addEventListener('message', e => {
  if (e.data?.type === 'config') {
    caches.open('config').then(c =>
      c.put('cfg', new Response(JSON.stringify(e.data)))
    );
  }
});

// 收到推播通知
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let body = '有新的訂位，點擊查看';
    try {
      const cfgRes = await caches.open('config').then(c => c.match('cfg'));
      if (cfgRes) {
        const cfg = await cfgRes.json();
        if (cfg.workerUrl) {
          const res = await fetch(`${cfg.workerUrl}/latest`, {
            headers: { 'X-Admin-Secret': cfg.adminSecret || 'yu13admin' }
          });
          const booking = await res.json();
          if (booking?.data) {
            const d = booking.data;
            body = `${d['姓名'] || ''}  ${d['日期'] || ''}  ${d['時間'] || ''}  ${d['人數'] || ''}人`;
          }
        }
      }
    } catch {}

    return self.registration.showNotification('御13 新訂位！', {
      body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag: 'booking',
      renotify: true,
      vibrate: [200, 100, 200]
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/admin'));
});
