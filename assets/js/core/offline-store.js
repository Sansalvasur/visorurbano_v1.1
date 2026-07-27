/* ==========================================================
   SIGT — SAN SALVADOR SUR
   offline-store.js  —  Almacenamiento local (IndexedDB)

   Dos usos:
     1. "outbox": cola de registros creados sin conexión, con sus
        fotografías, esperando a subirse a la base de datos.
     2. "cache": última copia de los datos y catálogos descargados,
        para que la aplicación siga siendo útil sin señal.

   Se usa IndexedDB y no localStorage porque hay que guardar Blobs
   de fotografías, que pueden pesar varios MB.
   ========================================================== */

const DB_NAME = "sigt_offline";
const DB_VERSION = 1;
const STORE_OUTBOX = "outbox";
const STORE_CACHE = "cache";

let dbPromise = null;

function abrirDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
                db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_CACHE)) {
                db.createObjectStore(STORE_CACHE, { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    return dbPromise;
}

function tx(store, modo, fn) {
    return abrirDB().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(store, modo);
        const s = t.objectStore(store);
        let resultado;
        try { resultado = fn(s); } catch (e) { reject(e); return; }
        t.oncomplete = () => resolve(resultado?.result !== undefined ? resultado.result : resultado);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    }));
}

/* =====================================================
   COLA DE ENVÍO (registros pendientes)
===================================================== */

/**
 * Guarda una operación pendiente.
 * @param {object} op {id, tipo:'necesidad'|'referente'|'track', accion:'insert'|'update',
 *                     tabla, payload, fotos:[Blob], campoFoto, createdAt}
 */
export async function encolar(op) {
    await tx(STORE_OUTBOX, "readwrite", s => s.put(op));
    return op;
}

export async function listarPendientes() {
    const items = await tx(STORE_OUTBOX, "readonly", s => s.getAll());
    return (items || []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function contarPendientes() {
    const items = await listarPendientes();
    return items.length;
}

export async function eliminarPendiente(id) {
    await tx(STORE_OUTBOX, "readwrite", s => s.delete(id));
}

export async function actualizarPendiente(op) {
    await tx(STORE_OUTBOX, "readwrite", s => s.put(op));
}

/* =====================================================
   CACHÉ DE LECTURA
===================================================== */

export async function guardarCache(key, value) {
    try {
        await tx(STORE_CACHE, "readwrite", s => s.put({ key, value, at: Date.now() }));
    } catch (e) {
        console.warn("No se pudo guardar en caché:", key, e);
    }
}

export async function leerCache(key) {
    try {
        const row = await tx(STORE_CACHE, "readonly", s => s.get(key));
        return row ? row.value : null;
    } catch {
        return null;
    }
}

export async function fechaCache(key) {
    try {
        const row = await tx(STORE_CACHE, "readonly", s => s.get(key));
        return row ? row.at : null;
    } catch {
        return null;
    }
}

export async function limpiarTodo() {
    await tx(STORE_OUTBOX, "readwrite", s => s.clear());
    await tx(STORE_CACHE, "readwrite", s => s.clear());
}

/** IndexedDB puede no existir (modo privado antiguo, navegador viejo). */
export function soportaOffline() {
    return typeof indexedDB !== "undefined";
}
