const CACHE_NAME = 'suivi-mission-v376';
const ASSETS = [
  './',
  './manifest.json',
  './mascotte.webp',
  './mascotte-pouce.webp',
  './mascotte-poubelle.webp',
  './mascotte-ok.webp',
  './mascotte-maj.webp',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './logo_cr.png',
  './phoenix-icon.png',
  './medaille-bronze.webp',
  './medaille-argent.webp',
  './medaille-or.webp',
  './medaille-bronze-icone.webp',
  './medaille-argent-icone.webp',
  './medaille-or-icone.webp',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
  './vendor/qrcode.min.js',
  './sw.js'
];

function cacheOne(cache, url, attempt) {
  attempt = attempt || 1;
  return cache.add(url).catch(function(err) {
    if (attempt < 3) {
      return new Promise(function(resolve) { setTimeout(resolve, 400 * attempt); })
        .then(function() { return cacheOne(cache, url, attempt + 1); });
    }
    console.warn('Cache skip apres plusieurs tentatives:', url, err);
  });
}

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(ASSETS.map(function(url) { return cacheOne(cache, url); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Page principale : réseau d'abord. Avec du réseau, le missionnaire reçoit toujours la dernière version
// dès l'ouverture ; sans réseau, ou si le réseau met plus de 3 s à répondre, ou en cas d'erreur serveur,
// on retombe sur la version en cache. La page est toujours rangée sous la même clé ('./'), quels que
// soient les paramètres de l'adresse d'ouverture (lien de QR, montre...).
var DELAI_RESEAU_MS = 3000;

function reseauDAbord(request, fin) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return new Promise(function(resolve) {
      var repondu = false;
      var minuteur;
      function repondre(resp) {
        if (repondu || !resp) return;
        repondu = true;
        clearTimeout(minuteur);
        resolve(resp);
      }
      function replier(defaut) {
        return cache.match('./', { ignoreSearch: true }).then(function(c) { repondre(c || defaut); });
      }
      minuteur = setTimeout(function() { replier(null); }, DELAI_RESEAU_MS);
      // no-cache : on revalide toujours auprès du serveur (304 très léger si rien n'a changé)
      fetch(request, { cache: 'no-cache' }).then(function(response) {
        if (response && response.ok) {
          // gardée pour la prochaine ouverture, même si le cache a déjà répondu entre-temps
          cache.put('./', response.clone()).catch(function() {});
          repondre(response);
        } else if (response && response.type === 'opaqueredirect') {
          repondre(response);
        } else {
          return replier(response);
        }
      }).catch(function() {
        return replier(Response.error());
      }).then(fin, fin);
    });
  });
}

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Vérifications de mise à jour (updates-manifest.json?t=..., taux, IK) : jamais mises en cache
  if (url.searchParams.has('t') || url.pathname.endsWith('updates-manifest.json')) return;
  if (event.request.mode === 'navigate') {
    // le service worker reste actif jusqu'à la fin de la requête réseau, pour mettre le cache à jour
    var fin;
    event.waitUntil(new Promise(function(resolve) { fin = resolve; }));
    event.respondWith(reseauDAbord(event.request, fin));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(event.request).then(function(cached) {
        var network = fetch(event.request).then(function(response) {
          if (response && response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(function() {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return cache.match('./');
          }
          return Response.error();
        });
        return cached || network;
      });
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      if (list.length) return list[0].focus();
      return clients.openWindow('./');
    })
  );
});
