/* ==========================================================
   SIGT — SAN SALVADOR SUR
   sync.js  —  Sincronización automática

   Cuando el dispositivo no tiene conexión, los registros se guardan
   en una cola local (IndexedDB). En cuanto vuelve la señal, esta
   clase los sube a la base de datos sin que el usuario haga nada.

   Detección de conectividad:
     - eventos online/offline del navegador,
     - reintento periódico (el navegador puede reportar "online"
       estando conectado a una red sin salida real a internet),
     - y un intento inmediato al arrancar la aplicación.
   ========================================================== */

import {
    listarPendientes, eliminarPendiente, actualizarPendiente, contarPendientes
} from "./offline-store.js";
import { SUPABASE_PHOTOS_BUCKET } from "./sigt-client.js";

const REINTENTO_MS = 60000;   // reintento periódico mientras haya pendientes
const MAX_INTENTOS = 5;

export class SyncManager {
    /**
     * @param {object} supabase cliente de Supabase
     * @param {function} onCambio callback({online, pendientes, sincronizando})
     * @param {function} onSincronizado callback tras subir algo (para recargar datos)
     */
    constructor(supabase, onCambio, onSincronizado) {
        this.supabase = supabase;
        this.onCambio = onCambio || (() => {});
        this.onSincronizado = onSincronizado || (() => {});
        this.sincronizando = false;
        this.timerId = null;
    }

    async iniciar() {
        window.addEventListener("online", () => {
            this.notificar();
            this.sincronizar();
        });
        window.addEventListener("offline", () => this.notificar());

        this.timerId = setInterval(() => {
            if (navigator.onLine) this.sincronizar();
        }, REINTENTO_MS);

        await this.notificar();
        if (navigator.onLine) await this.sincronizar();
    }

    detener() {
        if (this.timerId) clearInterval(this.timerId);
        this.timerId = null;
    }

    async notificar() {
        const pendientes = await contarPendientes();
        this.onCambio({
            online: navigator.onLine,
            pendientes,
            sincronizando: this.sincronizando
        });
        return pendientes;
    }

    /**
     * Sube todos los registros pendientes, en el orden en que se crearon.
     * Si algo falla por red, se deja en la cola para el siguiente intento.
     */
    async sincronizar() {
        // El cerrojo se toma ANTES de cualquier await. Si se pusiera después
        // de leer la cola, dos disparos casi simultáneos (evento "online" y
        // el reintento periódico) pasarían ambos el control y subirían cada
        // registro por duplicado.
        if (this.sincronizando || !navigator.onLine) return;
        this.sincronizando = true;

        let subidos = 0;

        try {
            const pendientes = await listarPendientes();
            if (!pendientes.length) return;

            await this.notificar();

            for (const op of pendientes) {
                if (op.fallido) continue;   // requiere intervención del usuario

                try {
                    await this.subirOperacion(op);
                    await eliminarPendiente(op.id);
                    subidos++;
                } catch (err) {
                    const esRed = this.esErrorDeRed(err);
                    console.warn(`Sincronización pendiente (${op.tipo}):`, err?.message || err);

                    if (esRed) {
                        // Sin señal: se corta el ciclo y se reintenta más tarde.
                        break;
                    }

                    // Error de datos (no de red): se reintenta unas veces y,
                    // si insiste, se marca para que el usuario lo revise.
                    op.intentos = (op.intentos || 0) + 1;
                    op.ultimoError = err?.message || String(err);
                    if (op.intentos >= MAX_INTENTOS) op.fallido = true;
                    await actualizarPendiente(op);
                }
            }
        } finally {
            this.sincronizando = false;
        }

        await this.notificar();
        if (subidos > 0) await this.onSincronizado(subidos);
    }

    esErrorDeRed(err) {
        const msg = String(err?.message || err || "").toLowerCase();
        return !navigator.onLine ||
            msg.includes("failed to fetch") ||
            msg.includes("networkerror") ||
            msg.includes("network request failed") ||
            msg.includes("load failed");
    }

    /** Sube un registro pendiente y sus fotografías. */
    async subirOperacion(op) {
        const { tabla, payload, accion, registroId } = op;

        if (accion === "update") {
            const { error } = await this.supabase.from(tabla).update(payload).eq("id", registroId);
            if (error) throw new Error(error.message);
        } else {
            const { error } = await this.supabase.from(tabla).insert({ id: registroId, ...payload });
            if (error) throw new Error(error.message);
        }

        // Fotografías asociadas (si las hay)
        if (op.fotos?.length && op.campoFoto) {
            for (let i = 0; i < op.fotos.length; i++) {
                const blob = op.fotos[i];
                const path = `${op.campoFoto}/${registroId}/${registroId}-${i}-${Date.now()}.jpg`;

                const { error: errUp } = await this.supabase.storage
                    .from(SUPABASE_PHOTOS_BUCKET)
                    .upload(path, blob, { contentType: "image/jpeg" });
                if (errUp) throw new Error(errUp.message);

                const { data } = this.supabase.storage.from(SUPABASE_PHOTOS_BUCKET).getPublicUrl(path);
                const { error: errFoto } = await this.supabase.from("fotografias").insert({
                    [op.campoFoto]: registroId,
                    url: data.publicUrl,
                    storage_path: path,
                    created_by: payload.created_by || null
                });
                if (errFoto) throw new Error(errFoto.message);
            }
        }
    }
}
