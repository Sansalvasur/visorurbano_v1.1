/* ==========================================================
   SIGT — SAN SALVADOR SUR
   sigt-client.js
   Capa de acceso a datos compartida por el visor público y el
   panel administrativo.

   Todas las consultas van por el SDK de Supabase (PostgREST),
   que envía SIEMPRE los valores como parámetros: no se concatena
   SQL en el cliente, por lo que no hay superficie de inyección
   SQL desde aquí. La autorización la aplica Postgres vía RLS.
   ========================================================== */

import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_PHOTOS_BUCKET,
    SUPABASE_CLIENT_URL,
    isSupabaseConfigured
} from "../../../config/supabase.js";
import { guardarCache, leerCache } from "./offline-store.js";

let clientPromise = null;

/**
 * Carga el SDK de forma perezosa. Si la red falla, solo se desactiva
 * la parte de datos: el mapa base y las capas GeoJSON siguen vivos.
 */
export async function getSupabase() {
    if (!isSupabaseConfigured()) return null;
    if (!clientPromise) {
        clientPromise = (async () => {
            const { createClient } = await import(/* @vite-ignore */ SUPABASE_CLIENT_URL);
            return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: false
                }
            });
        })();
    }
    return clientPromise;
}

export { SUPABASE_PHOTOS_BUCKET, isSupabaseConfigured };

/* =====================================================
   CATÁLOGOS
===================================================== */

/**
 * Ejecuta una consulta y guarda el resultado en caché. Si la red falla,
 * devuelve la última copia guardada para que el trabajo en campo continúe.
 */
async function consultarConCache(clave, consulta) {
    try {
        const res = await consulta();
        if (res.error) throw new Error(res.error.message);
        await guardarCache(clave, res.data || []);
        return { data: res.data || [], error: null, desdeCache: false };
    } catch (err) {
        const cache = await leerCache(clave);
        if (cache) {
            console.warn(`Sin conexión: "${clave}" se lee de la caché local.`);
            return { data: cache, error: null, desdeCache: true };
        }
        return { data: [], error: err, desdeCache: false };
    }
}

export async function fetchCatalogos(supabase) {
    const [tipos, prioridades, estados, comunidades] = await Promise.all([
        consultarConCache("cat_tipos", () => supabase.from("catalogo_necesidades").select("*").eq("activo", true).order("nombre")),
        consultarConCache("cat_prioridades", () => supabase.from("prioridades").select("*").order("orden")),
        consultarConCache("cat_estados", () => supabase.from("estados").select("*").order("orden")),
        consultarConCache("cat_comunidades", () => supabase.from("comunidades").select("*").order("nombre"))
    ]);

    return {
        tipos: tipos.data,
        prioridades: prioridades.data,
        estados: estados.data,
        comunidades: comunidades.data,
        error: tipos.error || prioridades.error || estados.error || comunidades.error || null,
        desdeCache: tipos.desdeCache || prioridades.desdeCache || estados.desdeCache
    };
}

/* =====================================================
   LECTURA PÚBLICA (visor)
===================================================== */

export async function fetchNecesidades(supabase) {
    return consultarConCache("necesidades",
        () => supabase.from("v_necesidades").select("*").order("created_at", { ascending: false }));
}

export async function fetchReferentes(supabase) {
    return consultarConCache("referentes",
        () => supabase.from("v_referentes").select("*").order("created_at", { ascending: false }));
}

export async function fetchTracks(supabase) {
    return consultarConCache("tracks",
        () => supabase.from("tracks").select("*").order("created_at", { ascending: false }));
}

/** Fotos de un conjunto de registros, agrupadas por id del registro padre. */
export async function fetchFotografias(supabase, campo, ids) {
    if (!ids.length) return {};

    const clave = `fotos_${campo}`;
    let data;

    try {
        const res = await supabase
            .from("fotografias")
            .select("id, url, descripcion, " + campo)
            .in(campo, ids);
        if (res.error) throw new Error(res.error.message);
        data = res.data || [];
        await guardarCache(clave, data);
    } catch {
        data = (await leerCache(clave)) || [];
    }

    return data.reduce((acc, foto) => {
        const key = foto[campo];
        if (!key) return acc;
        (acc[key] = acc[key] || []).push(foto);
        return acc;
    }, {});
}

/* =====================================================
   SESIÓN Y PERFIL
===================================================== */

export async function getSessionAndProfile(supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { session: null, perfil: null };

    // El perfil se guarda en caché para poder entrar sin conexión: la
    // sesión (JWT) ya vive en el almacenamiento local del SDK, pero el
    // rol vive en la base y sin señal no se puede consultar.
    const claveCache = `perfil_${session.user.id}`;

    try {
        const { data: perfil, error } = await supabase
            .from("usuarios")
            .select("id, nombre_completo, rol_id, activo")
            .eq("id", session.user.id)
            .maybeSingle();

        if (error) throw new Error(error.message);
        if (perfil) await guardarCache(claveCache, perfil);
        return { session, perfil };
    } catch (err) {
        const perfilCache = await leerCache(claveCache);
        if (perfilCache) {
            console.warn("Sin conexión: se usa el perfil guardado localmente.");
            return { session, perfil: perfilCache, desdeCache: true };
        }
        return { session, perfil: null, sinConexion: true };
    }
}

export function puedeEditar(perfil) {
    return !!perfil && perfil.activo && (perfil.rol_id === "admin" || perfil.rol_id === "editor");
}

export function esAdmin(perfil) {
    return !!perfil && perfil.activo && perfil.rol_id === "admin";
}

/* =====================================================
   EXPORTACIÓN GIS (GeoJSON / KML)
===================================================== */

export function toGeoJSON(features) {
    return { type: "FeatureCollection", features };
}

function kmlEscape(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Convierte un FeatureCollection GeoJSON a KML (Point y LineString),
 * para abrirlo en Google Earth o importarlo a QGIS.
 */
export function geoJSONToKML(collection, documentName = "SIGT") {
    const placemarks = (collection.features || []).map(f => {
        const props = f.properties || {};
        const name = kmlEscape(props.nombre || props.nombre_calle || props.tipo_nombre || "Registro");
        const descLines = Object.entries(props)
            .filter(([k, v]) => v !== null && v !== undefined && v !== "" && k !== "fotos")
            .map(([k, v]) => `${kmlEscape(k)}: ${kmlEscape(v)}`);
        const description = kmlEscape(descLines.join("\n"));

        let geometry = "";
        if (f.geometry?.type === "Point") {
            const [lng, lat] = f.geometry.coordinates;
            geometry = `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
        } else if (f.geometry?.type === "LineString") {
            const coords = f.geometry.coordinates.map(c => `${c[0]},${c[1]},0`).join(" ");
            geometry = `<LineString><coordinates>${coords}</coordinates></LineString>`;
        }

        return `    <Placemark>
      <name>${name}</name>
      <description>${description}</description>
      ${geometry}
    </Placemark>`;
    }).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${kmlEscape(documentName)}</name>
${placemarks}
  </Document>
</kml>`;
}

export function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
