const PREFIX = 'sam-incendie-';
const VERSION = 'v43';
const CACHE = PREFIX + VERSION;
const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
const COEUR = ['./index.html', './manifest.json'];
const COMPLEMENTS = ['./icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png', './icons/favicon-32x32.png', CHART_URL];
// Réseau lent mais pas coupé : au-delà de ce délai on sert la copie en cache (qui reste mise à jour en arrière-plan).
const DELAI_RESEAU_MS = 8000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(COEUR.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    await Promise.all(COMPLEMENTS.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

// Ne supprime que les caches de cette application (préfixe) : le même domaine peut en héberger d'autres.
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter(n => n.startsWith(PREFIX) && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
    // Annonce la version aux pages ouvertes : celles qui ont une autre version proposent de recharger.
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach(p => p.postMessage({ type: 'sw-active', version: VERSION }));
  })());
});

// Pages (y compris dans une iframe) : le RESEAU d'abord, pour que toute correction (texte legal, contenu
// reglementaire) atteigne les visiteurs deja venus ; le cache ne sert que hors connexion.
// Autres fichiers (bibliotheque Chart.js) : le cache d'abord.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Tout service externe (dont l'API Recherche d'entreprises, donnees Sirene a jour) : toujours le reseau, jamais le cache.
  // Seule exception : la bibliotheque Chart.js.
  if (new URL(req.url).origin !== self.location.origin && req.url !== CHART_URL) return;
  const estPage = req.mode === 'navigate' || req.destination === 'document' || req.destination === 'iframe';
  if (estPage) e.respondWith(reseauPuisCache(e));
  else e.respondWith(cachePuisReseau(e));
});

function pageEnCache() {
  return caches.open(CACHE).then(c => c.match('./index.html'));
}

// La copie en cache de la page est enregistrée sous une clé unique : l'adresse demandée, paramètres compris,
// part telle quelle au serveur et n'est jamais conservée.
function reseauPuisCache(e) {
  const url = new URL(e.request.url);
  const estPagePrincipale = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  return new Promise(resolve => {
    let fini = false;
    const repondre = r => { if (!fini) { fini = true; resolve(r); } };
    const minuterie = setTimeout(async () => {
      const c = await pageEnCache();
      if (c) repondre(c);
    }, DELAI_RESEAU_MS);
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(async resp => {
        clearTimeout(minuterie);
        if (resp && resp.ok) {
          if (estPagePrincipale) {
            const copie = resp.clone();
            e.waitUntil(caches.open(CACHE).then(c => c.put('./index.html', copie)).catch(() => {}));
          }
          repondre(resp);
        } else {
          repondre((await pageEnCache()) || resp);
        }
      })
      .catch(async () => {
        clearTimeout(minuterie);
        repondre((await pageEnCache()) || Response.error());
      });
  });
}

async function cachePuisReseau(e) {
  const cache = await caches.open(CACHE);
  const enCache = await cache.match(e.request);
  const maj = fetch(e.request)
    .then(resp => {
      if (resp && resp.status === 200 && resp.type !== 'opaque') cache.put(e.request, resp.clone());
      return resp;
    })
    .catch(() => null);
  if (enCache) { e.waitUntil(maj); return enCache; }
  return (await maj) || Response.error();
}
