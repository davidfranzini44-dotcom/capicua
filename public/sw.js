// Capicúa's service worker: just enough to make the game installable.
// It never caches the game — every visit loads fresh from the network, so a
// new deploy shows up right away. Without internet, opening the app shows a
// short "no connection" page instead of the browser's error.

const OFFLINE_PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f3d2b"><title>Capicúa · Sin conexión</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: radial-gradient(90% 80% at 50% 40%, #13573c, #0b3a27);
    color: #f4efe3; font: 16px/1.4 system-ui, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
  img { width: 88px; height: 88px; border-radius: 20px; }
  h1 { margin: 16px 0 6px; font-size: 1.4rem; }
  p { margin: 0 0 20px; color: #a9c2b5; }
  button { font: inherit; font-weight: 700; border: 0; border-radius: 14px; padding: 12px 28px;
    background: #f5c542; color: #2b1d00; box-shadow: 0 4px 0 #b88a14; }
</style></head>
<body><div>
  <img src="/icons/icon-192.png" alt="">
  <h1>Sin conexión · No connection</h1>
  <p>Capicúa necesita internet para jugar.<br>Capicúa needs internet to play.</p>
  <button onclick="location.reload()">Reintentar · Retry</button>
</div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  // Only page loads; game data, Supabase and assets go straight to the network.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ),
  );
});
