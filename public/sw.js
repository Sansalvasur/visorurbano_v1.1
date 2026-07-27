/* ==========================================================
   SIGT — SAN SALVADOR SUR
   sw.js  —  Service Worker

   Permite abrir la aplicación sin conexión:
     - El "app shell" (HTML, CSS, JS, capas GeoJSON) se guarda al
       instalar y se sirve desde caché cuando no hay red.
     - Los mosaicos del mapa se guardan a medida que se visitan, de
       modo que las zonas ya recorridas siguen viéndose sin señal.
     - Las llamadas a Supabase NUNCA se cachean: los datos vivos los
       gestiona IndexedDB desde la aplicación.
   ========================================================== */

const VERSION = "sigt-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = `${VERSION}-tiles`;
const MAX_TILES = 800;

// Nota: el JS y CSS del proyecto se sirven ahora como bundle de Vite con
// nombre de archivo hasheado (distinto en cada build), así que no se
// pueden listar aquí de antemano. El manejador "fetch" de más abajo ya
// los cachea igual (red primero, con copia en caché) la primera vez que
// se piden con conexión, así que no hace falta precachearlos a mano.
const SHELL = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./config/layers.json",
    "./data/1°ER PROYECTO DE LUMINARIAS.geojson",
    "./data/2°DO PROYECTO DE LUMINARIAS.geojson",
    "./data/BACHES.geojson",
    "./data/CALLES DE PANCHIMALCO.geojson",
    "./data/CALLES SAN MARCOS.geojson",
    "./data/CANTONES SSS.geojson",
    "./data/CENTROS DE VOTACION.geojson",
    "./data/CENTROS EDUCATIVOS.geojson",
    "./data/COLONIAS SAN MARCOS.geojson",
    "./data/PLAN MOL 2026.geojson",
    "./data/REFERENTES ZONALES.geojson",
    "./data/RUTAS ALTERNAS SSS.geojson",
    "./data/SAN SALVADOR SUR.geojson",
    "./assets/images/logo.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        // addAll falla entero si un recurso falla: los añadimos uno a uno.
        await Promise.all(SHELL.map(url =>
            cache.add(url).catch(err => console.warn("SW: no se pudo cachear", url, err))
        ));
        self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const claves = await caches.keys();
        await Promise.all(
            claves.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
        );
        self.clients.claim();
    })());
});

/** PNG transparente de 1x1 para los mosaicos que no se pudieron cargar. */
const PIXEL_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function PIXEL_TRANSPARENTE() {
    const bin = atob(PIXEL_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function esMosaico(url) {
    return /tile\.openstreetmap\.org|tile\.opentopomap\.org|server\.arcgisonline\.com/.test(url);
}

function esApiDatos(url) {
    return /supabase\.co|supabase\.in/.test(url);
}

async function limitarCache(nombre, maximo) {
    const cache = await caches.open(nombre);
    const claves = await cache.keys();
    if (claves.length > maximo) {
        // Elimina los más antiguos (orden de inserción)
        await Promise.all(claves.slice(0, claves.length - maximo).map(k => cache.delete(k)));
    }
}

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = req.url;

    // Datos vivos: siempre a la red, nunca desde caché.
    if (esApiDatos(url)) return;

    // Mosaicos del mapa: caché primero, y si no está, red (y se guarda).
    if (esMosaico(url)) {
        event.respondWith((async () => {
            const cache = await caches.open(TILE_CACHE);
            const hit = await cache.match(req);
            if (hit) return hit;
            try {
                const res = await fetch(req);
                if (res.ok) {
                    cache.put(req, res.clone());
                    limitarCache(TILE_CACHE, MAX_TILES);
                }
                return res;
            } catch {
                // Sin señal y sin mosaico guardado: se devuelve un PNG
                // transparente. Así el mapa queda en blanco en esa zona
                // sin llenar la consola de errores ni romper Leaflet.
                return new Response(PIXEL_TRANSPARENTE(), {
                    status: 200,
                    headers: { "Content-Type": "image/png" }
                });
            }
        })());
        return;
    }

    // App shell y datos GeoJSON: red primero (para recibir cambios),
    // con respaldo en caché cuando no hay conexión.
    event.respondWith((async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
            const res = await fetch(req);
            if (res.ok && new URL(url).origin === self.location.origin) {
                cache.put(req, res.clone());
            }
            return res;
        } catch {
            const hit = await cache.match(req) || await cache.match("./index.html");
            if (hit) return hit;
            return new Response("Sin conexión", { status: 503 });
        }
    })());
});
