/* ==========================================================
   SIGT — SAN SALVADOR SUR
   security.js
   Utilidades de seguridad en el cliente.

   Nota importante: estas validaciones son la PRIMERA barrera
   (mejoran la experiencia y evitan basura en la BD), pero la
   autorización real vive en las políticas RLS de PostgreSQL
   (supabase/schema.sql). Un cliente nunca es fuente de verdad.
   ========================================================== */

/**
 * Escapa texto para insertarlo con innerHTML sin riesgo de XSS.
 * Los datos vienen de una base compartida: lo que escribe un usuario
 * lo ve todo el municipio, así que nada se interpola sin escapar.
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Solo permite URLs http(s) o blob (para vistas previas locales).
 * Evita inyecciones tipo javascript: en atributos src/href.
 */
export function safeUrl(url) {
    if (!url) return "";
    const clean = String(url).trim();
    if (/^(https?:|blob:)/i.test(clean)) return clean;
    return "";
}

/** Recorta y normaliza texto de formulario. */
export function cleanText(value, maxLength = 500) {
    if (value === null || value === undefined) return "";
    return String(value).trim().slice(0, maxLength);
}

/** Valida que un valor pertenezca a un catálogo permitido. */
export function isAllowed(value, allowedValues) {
    return allowedValues.includes(value);
}

/** Valida coordenadas geográficas. */
export function isValidLatLng(lat, lng) {
    return (
        Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180
    );
}

/** Valida formato de correo electrónico. */
export function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

/**
 * Verifica que un archivo sea una imagen admitida y no exceda el tamaño.
 * Se comprueba el tipo MIME real del File, no solo su extensión.
 */
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB antes de comprimir

export function validateImageFile(file) {
    if (!file) return { ok: false, error: "Archivo vacío." };
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return { ok: false, error: `Formato no permitido (${file.type || "desconocido"}). Use JPG, PNG o WEBP.` };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
        return { ok: false, error: "La imagen supera los 12 MB." };
    }
    return { ok: true };
}

/**
 * Control de sesión inactiva: cierra sesión tras un periodo sin actividad
 * del usuario. Requisito de "control de sesiones" del informe técnico.
 */
export class SessionGuard {
    constructor(onTimeout, timeoutMinutes = 30) {
        this.onTimeout = onTimeout;
        this.timeoutMs = timeoutMinutes * 60 * 1000;
        this.timerId = null;
        this._boundReset = () => this.reset();
        this._events = ["click", "keydown", "mousemove", "touchstart"];
    }

    start() {
        this._events.forEach(evt =>
            document.addEventListener(evt, this._boundReset, { passive: true })
        );
        this.reset();
    }

    reset() {
        if (this.timerId) clearTimeout(this.timerId);
        this.timerId = setTimeout(() => this.onTimeout(), this.timeoutMs);
    }

    stop() {
        if (this.timerId) clearTimeout(this.timerId);
        this.timerId = null;
        this._events.forEach(evt => document.removeEventListener(evt, this._boundReset));
    }
}
