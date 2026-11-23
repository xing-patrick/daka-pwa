/* 打卡 · Service Worker
 *
 * 只做两件事：
 *  1. 把应用外壳缓存下来，断网也能打开（数据本来就存在 localStorage 里）
 *  2. 让「添加到主屏幕」后的 Web App 拿到独立存储上下文（iOS 上豁免 ITP 的 7 天清理）
 *
 * 故意不碰：推送、后台同步。iOS 不支持后台定时，到点提醒只能靠页面开着时的轮询。
 */

const CACHE = 'daka-shell-v1';

// 导航请求最多等这么久，超时就用缓存顶上
const NET_TIMEOUT = 2500;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，但最多等 NET_TIMEOUT 毫秒。
  // 超时就直接拿缓存（弱网、被墙时不会白屏干等），网络那条继续跑完并回写缓存，
  // 所以下次打开还是会拿到新版本。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('./index.html');

      const network = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => null);

      // 没有缓存就只能等网络
      if (!cached) return (await network) || Response.error();

      // 系统已经知道没网，就不用等了
      if (self.navigator && self.navigator.onLine === false) return cached;

      const winner = await Promise.race([
        network,
        new Promise(resolve => setTimeout(() => resolve(null), NET_TIMEOUT))
      ]);

      return winner || cached;
    })());
    return;
  }

  // 静态资源：缓存优先
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
