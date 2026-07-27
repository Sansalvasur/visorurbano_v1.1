/* ==========================================================
   SIGT — SAN SALVADOR SUR
   registry.js  —  Registro territorial sobre el mapa del visor

   Todo ocurre en el mismo mapa del visor territorial:
     - Necesidades y líderes comunitarios se registran con la
       ubicación GPS tomada automáticamente al abrir el formulario.
     - El formulario es flotante e incluye su propio mapa para
       verificar y ajustar el punto (X/Y) arrastrando el marcador.
     - Los tracks de calles se trazan sobre el mapa principal o se
       graban en vivo siguiendo el GPS mientras se recorre la calle.
     - Los datos registrados alimentan la leyenda (calles por tipo
       de superficie, necesidades por tipo), igual que las capas
       GeoJSON categorizadas.

   Todo dato que viene de la base se escapa antes de tocar el DOM.
   ========================================================== */

import { createMarkerIcon } from "../utils/icons.js";
import {
    escapeHtml, safeUrl, cleanText, isAllowed, isValidLatLng,
    isValidEmail, validateImageFile
} from "../utils/security.js";
import {
    SUPABASE_PHOTOS_BUCKET,
    fetchCatalogos, fetchNecesidades, fetchReferentes, fetchTracks,
    fetchFotografias, toGeoJSON, geoJSONToKML, downloadFile
} from "./sigt-client.js";
import { encolar, listarPendientes, eliminarPendiente } from "./offline-store.js";
import { SyncManager } from "./sync.js";
import { activarLightbox } from "./lightbox.js";

const MAX_PHOTOS = 4;
const MAX_PHOTO_DIMENSION = 1000;
const PHOTO_QUALITY = 0.65;

export const SURFACE_TYPES = {
    tierra:     { label: "Tierra",     color: "#795548", dashArray: "6 6" },
    pavimento:  { label: "Pavimento",  color: "#0B5ED7", dashArray: null },
    asfalto:    { label: "Asfalto",    color: "#212121", dashArray: null },
    adoquin:    { label: "Adoquín",    color: "#7E57C2", dashArray: null },
    piedra:     { label: "Piedra",     color: "#607D8B", dashArray: null },
    miscelaneo: { label: "Misceláneo", color: "#D81B60", dashArray: "2 8" }
};
const SURFACES = Object.keys(SURFACE_TYPES);

const REFERENTE_STYLE = { icon: "user-tie", color: "#16A34A" };

function uid() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function fechaLocal(iso) {
    return iso ? new Date(iso).toLocaleString("es-SV") : "";
}

function comprimirImagen(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("Archivo de imagen inválido."));
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > MAX_PHOTO_DIMENSION) {
                    height = Math.round(height * (MAX_PHOTO_DIMENSION / width));
                    width = MAX_PHOTO_DIMENSION;
                } else if (height > MAX_PHOTO_DIMENSION) {
                    width = Math.round(width * (MAX_PHOTO_DIMENSION / height));
                    height = MAX_PHOTO_DIMENSION;
                }
                const canvas = document.createElement("canvas");
                canvas.width = width; canvas.height = height;
                canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                canvas.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo procesar la imagen.")),
                    "image/jpeg", PHOTO_QUALITY);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

/** Obtiene la posición GPS actual como promesa. */
function ubicacionActual(timeout = 12000) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Su navegador no soporta geolocalización."));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }),
            err => reject(new Error(err.message || "No se pudo obtener la ubicación.")),
            { enableHighAccuracy: true, timeout, maximumAge: 0 }
        );
    });
}

export class RegistryManager {
    constructor(mapManager, auth, legendManager) {
        this.mapManager = mapManager;
        this.map = mapManager.getMap();
        this.auth = auth;
        this.legendManager = legendManager;
        this.supabase = auth.getSupabaseClient();

        this.catalogos = { tipos: [], prioridades: [], estados: [], comunidades: [] };
        this.necesidades = [];
        this.referentes = [];
        this.tracks = [];
        this.fotosNecesidad = {};
        this.fotosReferente = {};

        this.necesidadLayer = L.featureGroup().addTo(this.map);
        this.referenteLayer = L.featureGroup().addTo(this.map);
        this.trackLayer = L.featureGroup().addTo(this.map);

        this.filtros = { estado: "", prioridad: "", tipo: "" };

        // Estado de captura de tracks
        this.drawHandler = null;
        this.gpsWatchId = null;
        this.gpsPath = [];
        this.gpsPreviewLine = null;

        // Estado del formulario flotante
        this.formMap = null;
        this.formMarker = null;
        this.editing = null;
        this.existingPhotos = [];
        this.pendingPhotos = [];

        // Registros creados sin conexión, aún sin subir
        this.pendientes = [];
        this.sync = null;
    }

    async initialize() {
        this.bindUI();
        this.bindModal();

        // Tocar cualquier fotografía la abre ampliada (popups y formularios)
        activarLightbox();

        // Sincronización automática: sube la cola en cuanto vuelve la señal.
        this.sync = new SyncManager(
            this.supabase,
            (estado) => this.renderEstadoConexion(estado),
            async (subidos) => {
                await this.loadAll();
                this.avisoSync(`${subidos} registro(s) sincronizado(s) con la base de datos.`);
            }
        );

        await this.loadAll();
        await this.sync.iniciar();
    }

    /* =====================================================
       UI DEL PANEL LATERAL
    ===================================================== */

    bindUI() {
        const puede = this.auth.puedeEditar();

        const alta = [
            ["btnNuevaNecesidad", () => this.nuevoPunto("necesidad")],
            ["btnNuevoReferente", () => this.nuevoPunto("referente")],
            ["btnNuevoTrack", () => this.nuevoTrack()]
        ];
        alta.forEach(([id, fn]) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            if (!puede) {
                btn.disabled = true;
                btn.title = "Su rol es de solo consulta";
            } else {
                btn.addEventListener("click", fn);
            }
        });

        document.getElementById("btnSigtRefresh")?.addEventListener("click", () => this.loadAll());
        document.getElementById("btnExportGeoJSON")?.addEventListener("click", () => this.exportar("geojson"));
        document.getElementById("btnExportKML")?.addEventListener("click", () => this.exportar("kml"));
        document.getElementById("btnExportReporte")?.addEventListener("click", () => this.exportarCSV());

        ["filtroEstado", "filtroPrioridad", "filtroTipo"].forEach(id => {
            document.getElementById(id)?.addEventListener("change", () => {
                this.filtros.estado    = document.getElementById("filtroEstado")?.value || "";
                this.filtros.prioridad = document.getElementById("filtroPrioridad")?.value || "";
                this.filtros.tipo      = document.getElementById("filtroTipo")?.value || "";
                this.renderNecesidadesMapa();
                this.renderListaNecesidades();
                this.renderResumen();
                this.actualizarLeyenda();
            });
        });

        document.getElementById("buscarNecesidad")?.addEventListener("input", () => this.renderListaNecesidades());
        document.getElementById("buscarReferente")?.addEventListener("input", () => this.renderListaReferentes());
        document.getElementById("buscarTrack")?.addEventListener("input", () => this.renderListaTracks());

        document.getElementById("sigtCaptureCancel")?.addEventListener("click", () => this.cancelarCaptura());
        document.getElementById("sigtCaptureFinish")?.addEventListener("click", () => this.finalizarGrabacionGPS());

        this.bindCapasSigt();
        this.bindWorkspace();
        this.bindDashboard();

        if (this.auth.esAdmin()) {
            document.getElementById("btnRefrescarAuditoria")?.addEventListener("click", () => this.loadAuditoria());
            document.getElementById("btnRefrescarUsuarios")?.addEventListener("click", () => this.loadUsuarios());
            document.getElementById("btnCrearUsuario")?.addEventListener("click", () => this.crearUsuario());
            // Cargar los módulos de administración al abrir su pestaña
            document.querySelector('.tab-btn[data-tab="admin"]')?.addEventListener("click", () => {
                this.loadUsuarios();
                this.loadAuditoria();
            });
        }
    }

    /* =====================================================
       CAPAS DEL SIGT: encender / apagar en el mapa
    ===================================================== */

    bindCapasSigt() {
        const capas = [
            ["chk-sigt-necesidades", () => this.necesidadLayer],
            ["chk-sigt-referentes", () => this.referenteLayer],
            ["chk-sigt-tracks", () => this.trackLayer]
        ];

        capas.forEach(([id, obtener]) => {
            const chk = document.getElementById(id);
            if (!chk) return;
            chk.addEventListener("change", (e) => {
                const capa = obtener();
                if (e.target.checked) {
                    if (!this.map.hasLayer(capa)) this.map.addLayer(capa);
                } else if (this.map.hasLayer(capa)) {
                    this.map.removeLayer(capa);
                }
                this.actualizarLeyenda();
            });
        });
    }

    capaVisible(id) {
        const chk = document.getElementById(id);
        return !chk || chk.checked;
    }

    actualizarContadoresCapas() {
        const set = (id, n) => {
            const el = document.getElementById(id);
            if (el) el.textContent = n;
        };
        set("cnt-sigt-necesidades", this.necesidadesFiltradas().length);
        set("cnt-sigt-referentes", this.referentes.length);
        set("cnt-sigt-tracks", this.tracks.length);
    }

    /* =====================================================
       PANEL DE GESTIÓN (sobre el área del mapa)
    ===================================================== */

    bindWorkspace() {
        document.getElementById("btnAbrirGestion")?.addEventListener("click", () => this.abrirGestion());
        document.getElementById("btnCerrarGestion")?.addEventListener("click", () => this.cerrarGestion());

        document.querySelectorAll(".sigt-ws-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".sigt-ws-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                const destino = tab.getAttribute("data-ws");
                document.querySelectorAll(".sigt-ws-panel").forEach(p => {
                    p.classList.toggle("active", p.id === `ws-${destino}`);
                });
            });
        });
    }

    abrirGestion() {
        const ws = document.getElementById("sigtWorkspace");
        if (!ws) return;
        ws.hidden = false;
        // Al ocupar el área del mapa, cualquier captura en curso pierde sentido
        this.cancelarCaptura();
        this.renderResumen();
    }

    cerrarGestion() {
        const ws = document.getElementById("sigtWorkspace");
        if (ws) ws.hidden = true;
        // El mapa estuvo oculto: hay que recalcular su tamaño
        setTimeout(() => this.map.invalidateSize(), 100);
    }

    /* =====================================================
       VENTANA DE DASHBOARD
    ===================================================== */

    bindDashboard() {
        document.getElementById("btnAbrirDashboard")?.addEventListener("click", () => this.abrirDashboard());
        document.getElementById("dashboardClose")?.addEventListener("click", () => this.cerrarDashboard());
        document.getElementById("dashboardCerrarBtn")?.addEventListener("click", () => this.cerrarDashboard());
        document.getElementById("dashboardExport")?.addEventListener("click", () => this.exportarCSV());

        const overlay = document.getElementById("dashboardOverlay");
        overlay?.addEventListener("click", (e) => { if (e.target === overlay) this.cerrarDashboard(); });

        ["dashboardCampo", "dashboardTipo"].forEach(id => {
            document.getElementById(id)?.addEventListener("change", () => this.renderDashboard());
        });
    }

    abrirDashboard() {
        document.getElementById("dashboardOverlay")?.classList.add("active");
        this.renderDashboard();
    }

    cerrarDashboard() {
        document.getElementById("dashboardOverlay")?.classList.remove("active");
        if (this.chart) { this.chart.destroy(); this.chart = null; }
    }

    renderDashboard() {
        const metrics = document.getElementById("dashboardMetrics");
        if (!metrics) return;

        const visibles = this.necesidadesFiltradas();
        const abiertas = visibles.filter(n => n.estado_id !== "resuelta" && n.estado_id !== "descartada").length;
        const resueltas = visibles.filter(n => n.estado_id === "resuelta").length;
        const pendientesSubir = this.pendientes.length;
        const metrosTrack = this.tracks.reduce((s, t) => s + (t.longitud_m || 0), 0);

        metrics.innerHTML = `
            <div class="sigt-metric"><h4>${visibles.length}</h4><span>Necesidades</span></div>
            <div class="sigt-metric"><h4>${abiertas}</h4><span>Abiertas</span></div>
            <div class="sigt-metric"><h4>${resueltas}</h4><span>Resueltas</span></div>
            <div class="sigt-metric"><h4>${this.referentes.length}</h4><span>Líderes</span></div>
            <div class="sigt-metric"><h4>${this.tracks.length}</h4><span>Tracks</span></div>
            <div class="sigt-metric"><h4>${metrosTrack >= 1000 ? (metrosTrack / 1000).toFixed(1) + " km" : Math.round(metrosTrack) + " m"}</h4><span>Recorrido</span></div>
            ${pendientesSubir ? `<div class="sigt-metric"><h4>${pendientesSubir}</h4><span>Por subir</span></div>` : ""}
        `;

        const campo = document.getElementById("dashboardCampo")?.value || "estado_nombre";
        const tipoGrafico = document.getElementById("dashboardTipo")?.value || "bar";

        // Conteo agrupado, conservando el color del catálogo cuando existe
        const conteo = new Map();
        visibles.forEach(n => {
            const clave = n[campo] || "Sin dato";
            if (!conteo.has(clave)) {
                conteo.set(clave, {
                    total: 0,
                    color: campo === "estado_nombre" ? n.estado_color
                         : campo === "prioridad_nombre" ? n.prioridad_color
                         : campo === "tipo_nombre" ? n.tipo_color : null
                });
            }
            conteo.get(clave).total++;
        });

        const paleta = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#F97316", "#84CC16"];
        const etiquetas = [...conteo.keys()];
        const valores = etiquetas.map(e => conteo.get(e).total);
        const colores = etiquetas.map((e, i) => conteo.get(e).color || paleta[i % paleta.length]);

        // Tabla de apoyo (útil cuando no hay Chart.js o para leer cifras exactas)
        const total = valores.reduce((a, b) => a + b, 0) || 1;
        document.getElementById("dashboardTabla").innerHTML = etiquetas.length
            ? `<table>
                 <thead><tr><th>${escapeHtml(
                     campo === "estado_nombre" ? "Estado"
                   : campo === "prioridad_nombre" ? "Prioridad"
                   : campo === "tipo_nombre" ? "Tipo" : "Comunidad")}</th>
                 <th>%</th><th>Total</th></tr></thead>
                 <tbody>${etiquetas.map((e, i) => `
                     <tr>
                         <td><span class="sigt-dash-color" style="background:${escapeHtml(colores[i])};"></span>${escapeHtml(e)}</td>
                         <td>${Math.round(valores[i] / total * 100)}%</td>
                         <td>${valores[i]}</td>
                     </tr>`).join("")}
                 </tbody>
               </table>`
            : `<p class="registry-empty">No hay necesidades que coincidan con los filtros.</p>`;

        if (typeof Chart === "undefined") return;

        const canvas = document.getElementById("dashboardChart");
        if (!canvas) return;

        if (this.chart) this.chart.destroy();
        this.chart = new Chart(canvas, {
            type: tipoGrafico,
            data: {
                labels: etiquetas,
                datasets: [{ label: "Necesidades", data: valores, backgroundColor: colores }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: tipoGrafico !== "bar", position: "bottom" } },
                scales: tipoGrafico === "bar"
                    ? { y: { beginAtZero: true, ticks: { precision: 0 } } }
                    : {}
            }
        });
    }

    /* =====================================================
       CARGA DE DATOS
    ===================================================== */

    async loadAll() {
        const cat = await fetchCatalogos(this.supabase);
        if (cat.error) console.error("Error cargando catálogos:", cat.error);
        this.catalogos = cat;

        const [nec, ref, trk] = await Promise.all([
            fetchNecesidades(this.supabase),
            fetchReferentes(this.supabase),
            fetchTracks(this.supabase)
        ]);

        const error = nec.error || ref.error || trk.error;
        if (error) {
            console.error("Error cargando datos SIGT:", error);
            this.mensaje(`⚠️ No se pudieron cargar los datos: ${escapeHtml(error.message)}`);
            return;
        }

        this.necesidades = nec.data || [];
        this.referentes = ref.data || [];
        this.tracks = trk.data || [];

        this.fotosNecesidad = await fetchFotografias(this.supabase, "necesidad_id", this.necesidades.map(n => n.id));
        this.fotosReferente = await fetchFotografias(this.supabase, "referente_id", this.referentes.map(r => r.id));

        // Añadir los registros que aún están en la cola local, para que el
        // usuario los vea en el mapa y en las listas aunque no se hayan subido.
        await this.cargarPendientes();
        this.pendientes.forEach(op => {
            const reg = this.pendienteComoRegistro(op);
            if (op.tipo === "necesidad") this.necesidades.unshift(reg);
            else if (op.tipo === "referente") this.referentes.unshift(reg);
            else if (op.tipo === "track") this.tracks.unshift(reg);
        });

        if (nec.desdeCache || ref.desdeCache || trk.desdeCache) {
            console.info("SIGT: datos servidos desde la caché local (sin conexión).");
        }

        this.poblarFiltros();
        this.renderNecesidadesMapa();
        this.renderReferentesMapa();
        this.renderTracksMapa();
        this.renderListaNecesidades();
        this.renderListaReferentes();
        this.renderListaTracks();
        this.renderResumen();
        this.actualizarLeyenda();
    }

    mensaje(html) {
        const c = document.getElementById("sigtStatus");
        if (c) c.innerHTML = `<p class="registry-empty">${html}</p>`;
    }

    /* =====================================================
       CONEXIÓN Y COLA DE SINCRONIZACIÓN
    ===================================================== */

    renderEstadoConexion({ online, pendientes, sincronizando }) {
        const c = document.getElementById("sigtConnStatus");
        if (!c) return;

        let clase, icono, texto;
        if (sincronizando) {
            clase = "sync"; icono = "fa-rotate fa-spin"; texto = "Sincronizando…";
        } else if (!online) {
            clase = "offline"; icono = "fa-cloud-arrow-down";
            texto = pendientes ? `Sin conexión · ${pendientes} por subir` : "Sin conexión · trabajando localmente";
        } else if (pendientes) {
            clase = "sync"; icono = "fa-cloud-arrow-up"; texto = `${pendientes} registro(s) por subir`;
        } else {
            clase = "online"; icono = "fa-cloud"; texto = "Conectado · todo sincronizado";
        }

        c.className = `sigt-conn ${clase}`;
        c.innerHTML = `<i class="fa-solid ${icono}"></i><span>${escapeHtml(texto)}</span>`;

        // Insignia sobre la pestaña de Registro
        const badge = document.getElementById("sigtPendingBadge");
        if (badge) {
            badge.textContent = pendientes || "";
            badge.style.display = pendientes ? "flex" : "none";
        }
    }

    avisoSync(texto) {
        const c = document.getElementById("sigtConnStatus");
        if (!c) return;
        const previo = c.innerHTML;
        c.className = "sigt-conn online";
        c.innerHTML = `<i class="fa-solid fa-circle-check"></i><span>${escapeHtml(texto)}</span>`;
        setTimeout(() => { c.innerHTML = previo; }, 4000);
    }

    hayConexion() {
        return navigator.onLine;
    }

    /**
     * Guarda un registro. Si hay señal intenta la base de datos y, si la
     * llamada falla por red, cae automáticamente a la cola local. Sin señal
     * va directo a la cola. En ambos casos el usuario no pierde el trabajo.
     * @returns {'guardado'|'encolado'}
     */
    async guardarOEncolar({ tabla, tipo, payload, campoFoto, registroId, accion = "insert" }) {
        const fotos = this.pendingPhotos.map(p => p.blob);

        const encolarOperacion = async (motivo) => {
            await encolar({
                id: uid(), tipo, tabla, accion, registroId,
                payload, fotos, campoFoto,
                createdAt: Date.now(), intentos: 0, motivo
            });
            await this.sync?.notificar();
            return "encolado";
        };

        if (!this.hayConexion()) return encolarOperacion("sin-conexion");

        try {
            let error;
            if (accion === "update") {
                ({ error } = await this.supabase.from(tabla).update(payload).eq("id", registroId));
            } else {
                ({ error } = await this.supabase.from(tabla).insert({ id: registroId, ...payload }));
            }
            if (error) throw new Error(error.message);

            if (campoFoto) await this.subirFotos(campoFoto, registroId);
            return "guardado";
        } catch (err) {
            if (this.sync?.esErrorDeRed(err)) return encolarOperacion("fallo-red");
            alert("No se pudo guardar: " + (err.message || err));
            throw err;
        }
    }

    /** Carga la cola local para mostrarla junto a los datos ya subidos. */
    async cargarPendientes() {
        try {
            this.pendientes = await listarPendientes();
        } catch {
            this.pendientes = [];
        }
    }

    /** Convierte una operación en cola al formato que usan las listas/mapa. */
    pendienteComoRegistro(op) {
        const base = { ...op.payload, id: op.registroId, _pendiente: true, created_at: new Date(op.createdAt).toISOString() };

        if (op.tipo === "necesidad") {
            const tipo = this.catalogos.tipos.find(t => t.id === op.payload.tipo_id);
            const prioridad = this.catalogos.prioridades.find(p => p.id === op.payload.prioridad_id);
            const estado = this.catalogos.estados.find(e => e.id === op.payload.estado_id);
            return {
                ...base,
                tipo_nombre: tipo?.nombre || op.payload.tipo_id,
                tipo_icono: tipo?.icono || "circle-exclamation",
                tipo_color: tipo?.color || "#64748B",
                prioridad_nombre: prioridad?.nombre || "",
                prioridad_color: prioridad?.color || "#64748B",
                estado_nombre: estado?.nombre || "",
                estado_color: estado?.color || "#64748B",
                comunidad: op.payload.comunidad_texto || ""
            };
        }
        if (op.tipo === "referente") {
            return { ...base, comunidad: op.payload.comunidad_texto || "" };
        }
        return base;   // track
    }

    /** Elimina de la cola la operación que creó ese registro. */
    async descartarPendientePorRegistro(registroId) {
        const op = this.pendientes.find(o => o.registroId === registroId);
        if (!op) return;
        if (!confirm("¿Descartar este registro pendiente? No se subirá a la base de datos.")) return;
        await eliminarPendiente(op.id);
        await this.sync?.notificar();
        await this.loadAll();
    }

    poblarFiltros() {
        const fill = (id, lista, label) => {
            const s = document.getElementById(id);
            if (!s) return;
            const actual = s.value;
            s.innerHTML = `<option value="">${label}</option>` +
                lista.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.nombre)}</option>`).join("");
            s.value = actual;
        };
        fill("filtroEstado", this.catalogos.estados, "Todos los estados");
        fill("filtroPrioridad", this.catalogos.prioridades, "Todas las prioridades");
        fill("filtroTipo", this.catalogos.tipos, "Todos los tipos");
    }

    necesidadesFiltradas() {
        return this.necesidades.filter(n =>
            (!this.filtros.estado    || n.estado_id === this.filtros.estado) &&
            (!this.filtros.prioridad || n.prioridad_id === this.filtros.prioridad) &&
            (!this.filtros.tipo      || n.tipo_id === this.filtros.tipo)
        );
    }

    /* =====================================================
       RENDER EN EL MAPA PRINCIPAL
    ===================================================== */

    /** Los registros aún no subidos se dibujan translúcidos. */
    marcarPendiente(capa, esPendiente) {
        if (!esPendiente) return capa;
        const el = capa.getElement?.();
        if (el) el.classList.add("marcador-pendiente");
        capa.on?.("add", () => capa.getElement?.()?.classList.add("marcador-pendiente"));
        return capa;
    }

    renderNecesidadesMapa() {
        this.necesidadLayer.clearLayers();
        this.necesidadesFiltradas().forEach(n => {
            const m = L.marker([n.lat, n.lng], {
                icon: createMarkerIcon(n.tipo_icono || "circle-exclamation", n.estado_color || "#64748B"),
                opacity: n._pendiente ? 0.65 : 1
            })
                .bindPopup(this.popupNecesidad(n), { maxWidth: 320, className: "custom-popup" })
                .addTo(this.necesidadLayer);
            this.marcarPendiente(m, n._pendiente);
        });
    }

    renderReferentesMapa() {
        this.referenteLayer.clearLayers();
        this.referentes.forEach(r => {
            const m = L.marker([r.lat, r.lng], {
                icon: createMarkerIcon(REFERENTE_STYLE.icon, REFERENTE_STYLE.color),
                opacity: r._pendiente ? 0.65 : 1
            })
                .bindPopup(this.popupReferente(r), { maxWidth: 320, className: "custom-popup" })
                .addTo(this.referenteLayer);
            this.marcarPendiente(m, r._pendiente);
        });
    }

    renderTracksMapa() {
        this.trackLayer.clearLayers();
        this.tracks.forEach(t => {
            const s = SURFACE_TYPES[t.tipo_superficie] || SURFACE_TYPES.pavimento;
            const latlngs = (t.coordinates || []).map(c => [c[1], c[0]]);
            if (latlngs.length < 2) return;
            L.polyline(latlngs, {
                color: s.color, weight: 5,
                dashArray: s.dashArray,
                opacity: t._pendiente ? 0.6 : 1
            })
                .bindPopup(this.popupTrack(t, s), { maxWidth: 300, className: "custom-popup" })
                .addTo(this.trackLayer);
        });
    }

    fila(label, value) {
        if (value === null || value === undefined || value === "") return "";
        return `<tr><td class="popup-label">${escapeHtml(label)}</td>
                    <td class="popup-value">${escapeHtml(value)}</td></tr>`;
    }

    galeria(fotos) {
        if (!fotos?.length) return "";
        const imgs = fotos.map(f => safeUrl(f.url)).filter(Boolean)
            .map(u => `<img src="${escapeHtml(u)}" class="registry-popup-photo" alt="Fotografía">`).join("");
        return imgs ? `<div class="registry-popup-gallery">${imgs}</div>` : "";
    }

    popupNecesidad(n) {
        const badge = (t, c) => `<span class="sigt-badge" style="background:${escapeHtml(c || "#64748B")};">${escapeHtml(t)}</span>`;
        return `
            <div class="popup-header">
                <i class="fa-solid fa-${escapeHtml(n.tipo_icono || "circle-exclamation")}"></i>
                <span>${escapeHtml(n.tipo_nombre || "Necesidad")}</span>
            </div>
            <div class="popup-body">
                <div class="sigt-badges">
                    ${badge(n.estado_nombre, n.estado_color)}
                    ${badge("Prioridad " + (n.prioridad_nombre || ""), n.prioridad_color)}
                </div>
                <table class="popup-table"><tbody>
                    ${this.fila("Descripción", n.descripcion)}
                    ${this.fila("Dirección", n.direccion)}
                    ${this.fila("Comunidad", n.comunidad)}
                    ${this.fila("Líder", n.referente_nombre)}
                    ${this.fila("Coordenadas", `${Number(n.lat).toFixed(6)}, ${Number(n.lng).toFixed(6)}`)}
                    ${this.fila("Registrado", fechaLocal(n.created_at))}
                </tbody></table>
                ${this.galeria(this.fotosNecesidad[n.id])}
            </div>`;
    }

    popupReferente(r) {
        return `
            <div class="popup-header"><i class="fa-solid fa-user-tie"></i><span>${escapeHtml(r.nombre || "Líder")}</span></div>
            <div class="popup-body">
                <table class="popup-table"><tbody>
                    ${this.fila("Cargo", r.cargo)}
                    ${this.fila("Contacto", r.contacto)}
                    ${this.fila("Comunidad", r.comunidad)}
                    ${this.fila("Observaciones", r.observaciones)}
                    ${this.fila("Coordenadas", `${Number(r.lat).toFixed(6)}, ${Number(r.lng).toFixed(6)}`)}
                    ${this.fila("Registrado", fechaLocal(r.created_at))}
                </tbody></table>
                ${this.galeria(this.fotosReferente[r.id])}
            </div>`;
    }

    popupTrack(t, s) {
        const long = t.longitud_m
            ? (t.longitud_m >= 1000 ? (t.longitud_m / 1000).toFixed(2) + " km" : Math.round(t.longitud_m) + " m")
            : "";
        return `
            <div class="popup-header"><i class="fa-solid fa-road"></i><span>${escapeHtml(t.nombre_calle || "Track")}</span></div>
            <div class="popup-body">
                <table class="popup-table"><tbody>
                    ${this.fila("Superficie", s.label)}
                    ${this.fila("Longitud", long)}
                    ${this.fila("Comunidad", t.comunidad_texto)}
                    ${this.fila("Observaciones", t.observaciones)}
                    ${this.fila("Registrado", fechaLocal(t.created_at))}
                </tbody></table>
            </div>`;
    }

    /* =====================================================
       LEYENDA: datos registrados por tipo
    ===================================================== */

    actualizarLeyenda() {
        if (!this.legendManager?.setSigtData) return;

        // Calles registradas agrupadas por tipo de superficie
        const calles = SURFACES.map(key => ({
            key,
            label: SURFACE_TYPES[key].label,
            color: SURFACE_TYPES[key].color,
            dashArray: SURFACE_TYPES[key].dashArray,
            count: this.tracks.filter(t => t.tipo_superficie === key).length
        })).filter(c => c.count > 0);

        // Necesidades agrupadas por estado (el color del ícono en el mapa
        // refleja el estado, así que la leyenda debe coincidir).
        const visibles = this.necesidadesFiltradas();
        const porEstado = new Map();
        visibles.forEach(n => {
            if (!porEstado.has(n.estado_id)) {
                porEstado.set(n.estado_id, {
                    key: n.estado_id, label: n.estado_nombre,
                    color: n.estado_color, icon: "circle", count: 0
                });
            }
            porEstado.get(n.estado_id).count++;
        });

        this.legendManager.setSigtData({
            calles,
            necesidades: [...porEstado.values()],
            referentes: this.referentes.length,
            totalTracks: this.tracks.length
        });
    }

    /* =====================================================
       LISTADOS DEL PANEL
    ===================================================== */

    itemHtml(id, titulo, sub, badgeTexto, badgeColor, extra = "", pendiente = false) {
        // Un registro pendiente aún no existe en la base: no se puede editar
        // ni borrar allí, solo descartarlo de la cola local.
        const acciones = pendiente
            ? `<button class="registry-item-btn" data-action="descartar" title="Descartar registro pendiente"><i class="fa-solid fa-trash-can"></i></button>`
            : `${this.auth.puedeEditar() ? `<button class="registry-item-btn" data-action="edit" title="Editar"><i class="fa-solid fa-pen"></i></button>` : ""}
               ${this.auth.esAdmin() ? `<button class="registry-item-btn" data-action="delete" title="Eliminar"><i class="fa-solid fa-trash"></i></button>` : ""}`;

        return `
            <div class="registry-item ${pendiente ? "pendiente" : ""}" data-id="${escapeHtml(id)}">
                <div class="registry-item-info">
                    <span class="registry-item-title">${escapeHtml(titulo)}</span>
                    ${sub ? `<span class="admin-item-sub">${escapeHtml(sub)}</span>` : ""}
                    <span class="registry-item-badges">
                        ${badgeTexto ? `<span class="registry-item-badge" style="background:${escapeHtml(badgeColor || "#64748B")};">${escapeHtml(badgeTexto)}</span>` : ""}
                        ${pendiente ? `<span class="registry-item-badge pendiente-badge"><i class="fa-solid fa-clock"></i> Por subir</span>` : ""}
                    </span>
                </div>
                <div class="registry-item-actions">
                    <button class="registry-item-btn" data-action="zoom" title="Ver en el mapa"><i class="fa-solid fa-location-crosshairs"></i></button>
                    ${pendiente ? "" : extra}
                    ${acciones}
                </div>
            </div>`;
    }

    wire(container, handlers) {
        container.querySelectorAll(".registry-item").forEach(item => {
            const id = item.getAttribute("data-id");
            Object.entries(handlers).forEach(([action, fn]) => {
                item.querySelector(`[data-action="${action}"]`)?.addEventListener("click", () => fn(id));
            });
        });
    }

    renderListaNecesidades() {
        const c = document.getElementById("listaNecesidades");
        if (!c) return;
        const q = (document.getElementById("buscarNecesidad")?.value || "").trim().toLowerCase();
        const items = this.necesidadesFiltradas().filter(n =>
            !q || [n.descripcion, n.comunidad, n.tipo_nombre, n.direccion]
                .some(v => String(v || "").toLowerCase().includes(q)));

        c.innerHTML = items.length
            ? items.map(n => this.itemHtml(n.id, n.tipo_nombre, n.comunidad || n.direccion || "",
                n.estado_nombre, n.estado_color,
                `<button class="registry-item-btn" data-action="seg" title="Seguimiento"><i class="fa-solid fa-list-check"></i></button>`,
                !!n._pendiente)).join("")
            : `<p class="registry-empty">Sin necesidades registradas.</p>`;

        this.wire(c, {
            zoom: id => this.irA(this.necesidades.find(x => x.id === id)),
            edit: id => this.formNecesidad(this.necesidades.find(x => x.id === id)),
            delete: id => this.eliminar("necesidades", id),
            seg: id => this.formSeguimiento(this.necesidades.find(x => x.id === id)),
            descartar: id => this.descartarPendientePorRegistro(id)
        });
    }

    renderListaReferentes() {
        const c = document.getElementById("listaReferentes");
        if (!c) return;
        const q = (document.getElementById("buscarReferente")?.value || "").trim().toLowerCase();
        const items = this.referentes.filter(r =>
            !q || [r.nombre, r.comunidad, r.cargo].some(v => String(v || "").toLowerCase().includes(q)));

        c.innerHTML = items.length
            ? items.map(r => this.itemHtml(r.id, r.nombre, r.cargo || r.comunidad || "",
                "Líder", "#16A34A", "", !!r._pendiente)).join("")
            : `<p class="registry-empty">Sin líderes registrados.</p>`;

        this.wire(c, {
            zoom: id => this.irA(this.referentes.find(x => x.id === id)),
            edit: id => this.formReferente(this.referentes.find(x => x.id === id)),
            delete: id => this.eliminar("referentes", id),
            descartar: id => this.descartarPendientePorRegistro(id)
        });
    }

    renderListaTracks() {
        const c = document.getElementById("listaTracks");
        if (!c) return;
        const q = (document.getElementById("buscarTrack")?.value || "").trim().toLowerCase();
        const items = this.tracks.filter(t => !q || String(t.nombre_calle || "").toLowerCase().includes(q));

        c.innerHTML = items.length
            ? items.map(t => this.itemHtml(t.id, t.nombre_calle,
                t.longitud_m ? `${Math.round(t.longitud_m)} m` : "",
                SURFACE_TYPES[t.tipo_superficie]?.label, SURFACE_TYPES[t.tipo_superficie]?.color,
                "", !!t._pendiente)).join("")
            : `<p class="registry-empty">Sin tracks registrados.</p>`;

        this.wire(c, {
            zoom: id => {
                const t = this.tracks.find(x => x.id === id);
                const coords = (t?.coordinates || []).map(c2 => [c2[1], c2[0]]);
                if (coords.length) this.map.fitBounds(L.polyline(coords).getBounds(), { padding: [40, 40] });
            },
            edit: id => this.formTrack(this.tracks.find(x => x.id === id)),
            delete: id => this.eliminar("tracks", id),
            descartar: id => this.descartarPendientePorRegistro(id)
        });
    }

    irA(item) {
        if (item) this.map.flyTo([item.lat, item.lng], 18);
    }

    renderResumen() {
        const visibles = this.necesidadesFiltradas();
        const html = `
            <div class="sigt-metrics">
                <div class="sigt-metric"><h4>${visibles.length}</h4><span>Necesidades</span></div>
                <div class="sigt-metric"><h4>${this.referentes.length}</h4><span>Líderes</span></div>
                <div class="sigt-metric"><h4>${this.tracks.length}</h4><span>Tracks</span></div>
            </div>`;

        // Se muestra tanto en el panel lateral como en la pestaña de filtros
        ["sigtStatus", "sigtResumenFiltros"].forEach(id => {
            const c = document.getElementById(id);
            if (c) c.innerHTML = html;
        });

        this.actualizarContadoresCapas();
    }

    /* =====================================================
       CAPTURA: GEOLOCALIZACIÓN AUTOMÁTICA
    ===================================================== */

    banner(texto, { finish = false } = {}) {
        const b = document.getElementById("sigtCaptureBanner");
        document.getElementById("sigtCaptureText").textContent = texto;
        document.getElementById("sigtCaptureFinish").style.display = finish ? "inline-flex" : "none";
        b.classList.add("active");
    }

    ocultarBanner() {
        document.getElementById("sigtCaptureBanner")?.classList.remove("active");
    }

    cancelarCaptura() {
        if (this.drawHandler) { this.drawHandler.disable(); this.drawHandler = null; }
        this.detenerGPS();
        this.ocultarBanner();
    }

    detenerGPS() {
        if (this.gpsWatchId !== null) {
            navigator.geolocation.clearWatch(this.gpsWatchId);
            this.gpsWatchId = null;
        }
        if (this.gpsPreviewLine) {
            this.map.removeLayer(this.gpsPreviewLine);
            this.gpsPreviewLine = null;
        }
        this.gpsPath = [];
    }

    /**
     * Alta de necesidad o líder.
     *
     * El formulario se abre de inmediato con el centro del mapa como punto
     * provisional y se geolocaliza solo, ya abierto. Antes se esperaba al
     * GPS antes de abrirlo, y cuando la señal tardaba (o no había) parecía
     * que el botón no hacía nada.
     */
    nuevoPunto(tipo) {
        if (!this.requireEdit()) return;

        const c = this.map.getCenter();
        const provisional = { lat: c.lat, lng: c.lng, precision: null };

        if (tipo === "necesidad") this.formNecesidad(null, provisional, { autoLocalizar: true });
        else this.formReferente(null, provisional, { autoLocalizar: true });
    }

    /**
     * Alta de track: centra en el GPS y ofrece trazar a mano o grabar
     * el recorrido en vivo mientras se camina o conduce la calle.
     */
    async nuevoTrack() {
        if (!this.requireEdit()) return;

        this.banner("Obteniendo su ubicación GPS…");
        try {
            const c = await ubicacionActual();
            this.map.flyTo([c.lat, c.lng], 18);
        } catch (err) {
            console.warn("GPS no disponible:", err.message);
        }
        this.ocultarBanner();

        this.abrirModal("Nuevo track de calle", `
            <p class="registry-empty" style="margin-bottom:14px;">
                Elija cómo desea registrar el recorrido de la calle.
            </p>
            <div class="sigt-actions">
                <button type="button" id="modoGPS" class="registry-add-btn">
                    <i class="fa-solid fa-satellite-dish"></i> Grabar con GPS (recorriendo la calle)
                </button>
                <button type="button" id="modoDibujo" class="registry-add-btn">
                    <i class="fa-solid fa-pen-nib"></i> Trazar sobre el mapa
                </button>
            </div>
        `, null, { hideSave: true });

        document.getElementById("modoGPS").addEventListener("click", () => {
            this.cerrarModal();
            this.iniciarGrabacionGPS();
        });
        document.getElementById("modoDibujo").addEventListener("click", () => {
            this.cerrarModal();
            this.iniciarDibujoTrack();
        });
    }

    iniciarDibujoTrack() {
        this.cancelarCaptura();
        this.banner("Haga clic para trazar la calle. Doble clic para finalizar.");

        this.drawHandler = new L.Draw.Polyline(this.map, { shapeOptions: { color: "#0B5ED7", weight: 4 } });
        this.drawHandler.enable();

        this.map.once(L.Draw.Event.CREATED, (e) => {
            this.ocultarBanner();
            this.drawHandler = null;
            const latlngs = e.layer.getLatLngs();
            if (latlngs.length < 2) { alert("El track necesita al menos dos puntos."); return; }
            this.formTrack(null, latlngs.map(ll => [ll.lng, ll.lat]));
        });
    }

    iniciarGrabacionGPS() {
        if (!navigator.geolocation) { alert("Su navegador no soporta geolocalización."); return; }

        this.cancelarCaptura();
        this.gpsPath = [];
        this.gpsPreviewLine = L.polyline([], { color: "#DC2626", weight: 5, dashArray: "4 6" }).addTo(this.map);
        this.banner("Grabando recorrido por GPS… recorra la calle y pulse Finalizar.", { finish: true });

        this.gpsWatchId = navigator.geolocation.watchPosition(
            pos => {
                const p = [pos.coords.longitude, pos.coords.latitude];
                const ultimo = this.gpsPath[this.gpsPath.length - 1];
                // Ignorar puntos casi idénticos para no inflar el recorrido
                if (ultimo && Math.abs(ultimo[0] - p[0]) < 1e-6 && Math.abs(ultimo[1] - p[1]) < 1e-6) return;

                this.gpsPath.push(p);
                this.gpsPreviewLine.setLatLngs(this.gpsPath.map(c => [c[1], c[0]]));
                this.map.panTo([p[1], p[0]]);
                document.getElementById("sigtCaptureText").textContent =
                    `Grabando por GPS… ${this.gpsPath.length} puntos capturados.`;
            },
            err => {
                alert("Error de GPS: " + err.message);
                this.cancelarCaptura();
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
    }

    finalizarGrabacionGPS() {
        const path = [...this.gpsPath];
        this.cancelarCaptura();

        if (path.length < 2) {
            alert("No se capturaron suficientes puntos. Debe moverse a lo largo de la calle.");
            return;
        }
        this.formTrack(null, path);
    }

    requireEdit() {
        if (this.auth.puedeEditar()) return true;
        alert("Su rol es de solo consulta: no puede registrar ni modificar datos.");
        return false;
    }

    /* =====================================================
       MODAL FLOTANTE
    ===================================================== */

    bindModal() {
        const overlay = document.getElementById("sigtModalOverlay");
        document.getElementById("sigtModalClose").addEventListener("click", () => this.cerrarModal());
        document.getElementById("sigtModalCancel").addEventListener("click", () => this.cerrarModal());
        overlay.addEventListener("click", e => { if (e.target === overlay) this.cerrarModal(); });
    }

    abrirModal(titulo, cuerpo, onSave, { hideSave = false } = {}) {
        document.getElementById("sigtModalTitle").textContent = titulo;
        document.getElementById("sigtModalBody").innerHTML = cuerpo;
        document.getElementById("sigtModalOverlay").classList.add("active");

        const old = document.getElementById("sigtModalSave");
        const btn = old.cloneNode(true);
        old.parentNode.replaceChild(btn, old);
        btn.style.display = hideSave ? "none" : "inline-flex";

        if (onSave) {
            btn.addEventListener("click", async () => {
                btn.disabled = true;
                try { await onSave(); } finally { btn.disabled = false; }
            });
        }
    }

    cerrarModal() {
        document.getElementById("sigtModalOverlay").classList.remove("active");
        if (this.formMap) { this.formMap.remove(); this.formMap = null; }
        this.formMarker = null;
        this.formAccuracy = null;
        this.pendingPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl));
        this.pendingPhotos = [];
        this.existingPhotos = [];
        this.editing = null;
    }

    /**
     * Mapa dentro del formulario para verificar y ajustar el punto.
     * El marcador es arrastrable y las coordenadas se muestran en vivo.
     */
    bloqueMapaFormulario(coords, precision = null, autoLocalizar = false) {
        const estadoInicial = autoLocalizar
            ? `<span class="sigt-geo-estado buscando">
                   <i class="fa-solid fa-location-crosshairs fa-fade"></i> Obteniendo su ubicación GPS…
               </span>`
            : (precision
                ? `<span class="sigt-geo-estado ok"><i class="fa-solid fa-circle-check"></i> Precisión ±${Math.round(precision)} m</span>`
                : "");

        return `
            <label class="registry-field-label">
                Ubicación <span class="sigt-coord-hint">(arrastre el marcador para ajustar)</span>
            </label>
            <div id="geoEstado">${estadoInicial}</div>
            <div id="formMap" class="sigt-form-map"></div>
            <div class="sigt-coords">
                <div>
                    <span class="sigt-coord-label">Latitud (Y)</span>
                    <input type="text" id="fldLat" class="registry-input" value="${Number(coords.lat).toFixed(6)}" readonly>
                </div>
                <div>
                    <span class="sigt-coord-label">Longitud (X)</span>
                    <input type="text" id="fldLng" class="registry-input" value="${Number(coords.lng).toFixed(6)}" readonly>
                </div>
            </div>
            <button type="button" id="btnReubicar" class="registry-export-btn">
                <i class="fa-solid fa-location-crosshairs"></i> Volver a ubicarme con GPS
            </button>`;
    }

    geoEstado(clase, icono, texto) {
        const c = document.getElementById("geoEstado");
        if (!c) return;
        c.innerHTML = `<span class="sigt-geo-estado ${clase}">
            <i class="fa-solid ${icono}"></i> ${escapeHtml(texto)}
        </span>`;
    }

    activarMapaFormulario(coords, iconName, iconColor, { autoLocalizar = false } = {}) {
        const el = document.getElementById("formMap");
        if (!el) return;

        this.formMap = L.map(el, { center: [coords.lat, coords.lng], zoom: 18, zoomControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap", maxZoom: 22, maxNativeZoom: 19
        }).addTo(this.formMap);

        this.formMarker = L.marker([coords.lat, coords.lng], {
            draggable: true,
            icon: createMarkerIcon(iconName, iconColor)
        }).addTo(this.formMap);

        const sync = (latlng) => {
            document.getElementById("fldLat").value = latlng.lat.toFixed(6);
            document.getElementById("fldLng").value = latlng.lng.toFixed(6);
        };

        // Círculo que representa la precisión del GPS
        const pintarPrecision = (lat, lng, metros) => {
            if (this.formAccuracy) this.formMap.removeLayer(this.formAccuracy);
            if (!metros) return;
            this.formAccuracy = L.circle([lat, lng], {
                radius: metros, color: "#0B5ED7", weight: 1,
                fillColor: "#0B5ED7", fillOpacity: .12, interactive: false
            }).addTo(this.formMap);
        };

        const colocar = (c, { avisar = true } = {}) => {
            this.formMarker.setLatLng([c.lat, c.lng]);
            this.formMap.setView([c.lat, c.lng], 18);
            sync(L.latLng(c.lat, c.lng));
            pintarPrecision(c.lat, c.lng, c.precision);
            if (avisar) {
                this.geoEstado("ok", "fa-circle-check",
                    c.precision ? `Ubicación GPS obtenida (±${Math.round(c.precision)} m)` : "Ubicación GPS obtenida");
            }
        };

        // Si el usuario mueve el punto a mano, la marca de precisión ya no aplica
        const marcarManual = () => {
            if (this.formAccuracy) { this.formMap.removeLayer(this.formAccuracy); this.formAccuracy = null; }
            this.geoEstado("manual", "fa-hand-pointer", "Punto ajustado manualmente");
        };

        this.formMarker.on("drag", e => sync(e.target.getLatLng()));
        this.formMarker.on("dragend", marcarManual);
        // Clic en el mapa del formulario = mover el marcador ahí
        this.formMap.on("click", e => { this.formMarker.setLatLng(e.latlng); sync(e.latlng); marcarManual(); });

        const localizar = async () => {
            this.geoEstado("buscando", "fa-location-crosshairs fa-fade", "Obteniendo su ubicación GPS…");
            try {
                colocar(await ubicacionActual());
            } catch (err) {
                this.geoEstado("error", "fa-triangle-exclamation",
                    `Sin GPS (${err.message}). Ubique el punto tocando el mapa.`);
            }
        };

        document.getElementById("btnReubicar")?.addEventListener("click", localizar);

        // El mapa nace dentro de un modal recién mostrado: hay que recalcular
        // su tamaño antes de trabajar con él.
        setTimeout(() => {
            this.formMap.invalidateSize();
            // Autogeolocalización al abrir el formulario (solo en altas nuevas;
            // al editar se respeta la ubicación ya guardada).
            if (autoLocalizar) localizar();
        }, 250);
    }

    coordsFormulario() {
        const lat = parseFloat(document.getElementById("fldLat").value);
        const lng = parseFloat(document.getElementById("fldLng").value);
        if (!isValidLatLng(lat, lng)) return null;
        return { lat, lng };
    }

    /* ---------- FOTOS ---------- */

    bloqueFotos(fotos) {
        this.existingPhotos = (fotos || []).map(f => ({ id: f.id, url: f.url }));
        return `
            <label class="registry-field-label">Fotografías (máx. ${MAX_PHOTOS})</label>
            <input type="file" id="fldFotos" accept="image/*" capture="environment" multiple class="registry-input">
            <div id="photoPreview" class="registry-photo-preview"></div>`;
    }

    activarFotos() {
        const input = document.getElementById("fldFotos");
        if (!input) return;
        input.addEventListener("change", async (e) => {
            const libres = MAX_PHOTOS - (this.existingPhotos.length + this.pendingPhotos.length);
            if (libres <= 0) {
                alert(`Solo se permiten ${MAX_PHOTOS} fotografías.`);
                e.target.value = "";
                return;
            }
            for (const file of Array.from(e.target.files).slice(0, libres)) {
                const check = validateImageFile(file);
                if (!check.ok) { alert(check.error); continue; }
                try {
                    const blob = await comprimirImagen(file);
                    this.pendingPhotos.push({ blob, previewUrl: URL.createObjectURL(blob) });
                } catch (err) { console.error(err); }
            }
            e.target.value = "";
            this.renderFotos();
        });
        this.renderFotos();
    }

    renderFotos() {
        const c = document.getElementById("photoPreview");
        if (!c) return;
        c.innerHTML =
            this.existingPhotos.map((f, i) => `
                <div class="registry-photo-thumb">
                    <img src="${escapeHtml(safeUrl(f.url))}" alt="Fotografía">
                    <button type="button" class="registry-photo-remove" data-kind="old" data-i="${i}"><i class="fa-solid fa-xmark"></i></button>
                </div>`).join("") +
            this.pendingPhotos.map((f, i) => `
                <div class="registry-photo-thumb">
                    <img src="${escapeHtml(f.previewUrl)}" alt="Fotografía nueva">
                    <button type="button" class="registry-photo-remove" data-kind="new" data-i="${i}"><i class="fa-solid fa-xmark"></i></button>
                </div>`).join("");

        c.querySelectorAll(".registry-photo-remove").forEach(btn => {
            btn.addEventListener("click", () => {
                const i = parseInt(btn.dataset.i, 10);
                if (btn.dataset.kind === "old") this.existingPhotos.splice(i, 1);
                else {
                    URL.revokeObjectURL(this.pendingPhotos[i].previewUrl);
                    this.pendingPhotos.splice(i, 1);
                }
                this.renderFotos();
            });
        });
    }

    async subirFotos(campo, registroId) {
        for (const item of this.pendingPhotos) {
            const path = `${campo}/${registroId}/${uid()}.jpg`;
            const { error } = await this.supabase.storage
                .from(SUPABASE_PHOTOS_BUCKET).upload(path, item.blob, { contentType: "image/jpeg" });
            if (error) { console.error("Error subiendo foto:", error); continue; }

            const { data } = this.supabase.storage.from(SUPABASE_PHOTOS_BUCKET).getPublicUrl(path);
            await this.supabase.from("fotografias").insert({
                [campo]: registroId, url: data.publicUrl, storage_path: path,
                created_by: this.auth.getUserId()
            });
        }

        const conservadas = this.existingPhotos.map(f => f.id);
        const previas = (campo === "necesidad_id" ? this.fotosNecesidad : this.fotosReferente)?.[registroId] || [];
        const aBorrar = previas.filter(f => !conservadas.includes(f.id)).map(f => f.id);
        if (aBorrar.length) await this.supabase.from("fotografias").delete().in("id", aBorrar);
    }

    opciones(lista, selected) {
        return lista.map(i =>
            `<option value="${escapeHtml(i.id)}" ${i.id === selected ? "selected" : ""}>${escapeHtml(i.nombre)}</option>`
        ).join("");
    }

    /* ---------- FORMULARIO: NECESIDAD ---------- */

    formNecesidad(item = null, coords = null, { autoLocalizar = false } = {}) {
        if (!this.requireEdit()) return;
        this.editing = item;

        const pos = coords || (item ? { lat: item.lat, lng: item.lng } : null);
        if (!pos) { this.nuevoPunto("necesidad"); return; }

        const fotos = item ? (this.fotosNecesidad[item.id] || []) : [];

        this.abrirModal(item ? "Editar necesidad" : "Nueva necesidad", `
            <label class="registry-field-label">Tipo de necesidad *</label>
            <select id="fldTipo" class="registry-input">${this.opciones(this.catalogos.tipos, item?.tipo_id)}</select>

            <label class="registry-field-label">Prioridad *</label>
            <select id="fldPrioridad" class="registry-input">${this.opciones(this.catalogos.prioridades, item?.prioridad_id || "media")}</select>

            <label class="registry-field-label">Estado *</label>
            <select id="fldEstado" class="registry-input">${this.opciones(this.catalogos.estados, item?.estado_id || "reportada")}</select>

            <label class="registry-field-label">Descripción</label>
            <textarea id="fldDescripcion" class="registry-input registry-textarea">${escapeHtml(item?.descripcion || "")}</textarea>

            <label class="registry-field-label">Dirección / referencia</label>
            <input type="text" id="fldDireccion" class="registry-input" value="${escapeHtml(item?.direccion || "")}">

            <label class="registry-field-label">Comunidad / Cantón</label>
            <input type="text" id="fldComunidad" class="registry-input" value="${escapeHtml(item?.comunidad || "")}">

            <label class="registry-field-label">Líder comunitario asociado</label>
            <select id="fldReferente" class="registry-input">
                <option value="">— Ninguno —</option>
                ${this.referentes.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.nombre)}</option>`).join("")}
            </select>

            ${this.bloqueMapaFormulario(pos, coords?.precision, autoLocalizar)}
            ${this.bloqueFotos(fotos)}
        `, () => this.guardarNecesidad());

        this.activarMapaFormulario(
            pos,
            item?.tipo_icono || "triangle-exclamation",
            item?.tipo_color || "#E53935",
            { autoLocalizar }
        );
        this.activarFotos();
    }

    async guardarNecesidad() {
        const tipo = document.getElementById("fldTipo").value;
        const prioridad = document.getElementById("fldPrioridad").value;
        const estado = document.getElementById("fldEstado").value;

        if (!isAllowed(tipo, this.catalogos.tipos.map(t => t.id)) ||
            !isAllowed(prioridad, this.catalogos.prioridades.map(p => p.id)) ||
            !isAllowed(estado, this.catalogos.estados.map(e => e.id))) {
            alert("Seleccione valores válidos de los catálogos.");
            return;
        }

        const coords = this.coordsFormulario();
        if (!coords) { alert("Las coordenadas no son válidas."); return; }

        const payload = {
            tipo_id: tipo, prioridad_id: prioridad, estado_id: estado,
            descripcion: cleanText(document.getElementById("fldDescripcion").value, 1000),
            direccion: cleanText(document.getElementById("fldDireccion").value, 300),
            comunidad_texto: cleanText(document.getElementById("fldComunidad").value, 200),
            referente_id: document.getElementById("fldReferente").value || null,
            lng: coords.lng, lat: coords.lat
        };

        const esEdicion = !!this.editing;
        const id = esEdicion ? this.editing.id : uid();

        let resultado;
        try {
            resultado = await this.guardarOEncolar({
                tabla: "necesidades", tipo: "necesidad",
                accion: esEdicion ? "update" : "insert",
                registroId: id,
                payload: esEdicion ? payload : { ...payload, created_by: this.auth.getUserId() },
                campoFoto: "necesidad_id"
            });
        } catch { return; }

        this.cerrarModal();
        await this.loadAll();
        if (resultado === "encolado") this.avisoGuardadoLocal();
    }

    avisoGuardadoLocal() {
        const c = document.getElementById("sigtConnStatus");
        if (c) {
            c.className = "sigt-conn offline";
            c.innerHTML = `<i class="fa-solid fa-box-archive"></i><span>Guardado en el dispositivo. Se subirá al recuperar la señal.</span>`;
        }
        setTimeout(() => this.sync?.notificar(), 4000);
    }

    /* ---------- FORMULARIO: LÍDER COMUNITARIO ---------- */

    formReferente(item = null, coords = null, { autoLocalizar = false } = {}) {
        if (!this.requireEdit()) return;
        this.editing = item;

        const pos = coords || (item ? { lat: item.lat, lng: item.lng } : null);
        if (!pos) { this.nuevoPunto("referente"); return; }

        const fotos = item ? (this.fotosReferente[item.id] || []) : [];

        this.abrirModal(item ? "Editar líder comunitario" : "Nuevo líder comunitario", `
            <label class="registry-field-label">Nombre completo *</label>
            <input type="text" id="fldNombre" class="registry-input" value="${escapeHtml(item?.nombre || "")}">

            <label class="registry-field-label">Cargo / Organización</label>
            <input type="text" id="fldCargo" class="registry-input" placeholder="Ej. Presidente ADESCO" value="${escapeHtml(item?.cargo || "")}">

            <label class="registry-field-label">Contacto / Teléfono</label>
            <input type="text" id="fldContacto" class="registry-input" placeholder="Ej. 7000-0000" value="${escapeHtml(item?.contacto || "")}">

            <label class="registry-field-label">Comunidad / Cantón</label>
            <input type="text" id="fldComunidad" class="registry-input" value="${escapeHtml(item?.comunidad || "")}">

            <label class="registry-field-label">Observaciones</label>
            <textarea id="fldObservaciones" class="registry-input registry-textarea">${escapeHtml(item?.observaciones || "")}</textarea>

            ${this.bloqueMapaFormulario(pos, coords?.precision, autoLocalizar)}
            ${this.bloqueFotos(fotos)}
        `, () => this.guardarReferente());

        this.activarMapaFormulario(
            pos, REFERENTE_STYLE.icon, REFERENTE_STYLE.color, { autoLocalizar }
        );
        this.activarFotos();
    }

    async guardarReferente() {
        const nombre = cleanText(document.getElementById("fldNombre").value, 200);
        if (!nombre) { alert("Ingrese el nombre del líder comunitario."); return; }

        const coords = this.coordsFormulario();
        if (!coords) { alert("Las coordenadas no son válidas."); return; }

        const payload = {
            nombre,
            cargo: cleanText(document.getElementById("fldCargo").value, 200),
            contacto: cleanText(document.getElementById("fldContacto").value, 100),
            comunidad_texto: cleanText(document.getElementById("fldComunidad").value, 200),
            observaciones: cleanText(document.getElementById("fldObservaciones").value, 1000),
            lng: coords.lng, lat: coords.lat
        };

        const esEdicion = !!this.editing;
        const id = esEdicion ? this.editing.id : uid();

        let resultado;
        try {
            resultado = await this.guardarOEncolar({
                tabla: "referentes", tipo: "referente",
                accion: esEdicion ? "update" : "insert",
                registroId: id,
                payload: esEdicion ? payload : { ...payload, created_by: this.auth.getUserId() },
                campoFoto: "referente_id"
            });
        } catch { return; }

        this.cerrarModal();
        await this.loadAll();
        if (resultado === "encolado") this.avisoGuardadoLocal();
    }

    /* ---------- FORMULARIO: TRACK ---------- */

    formTrack(item = null, coordinates = null) {
        if (!this.requireEdit()) return;
        this.editing = item;
        this.pendingCoordinates = coordinates;

        if (!item && !coordinates) { this.nuevoTrack(); return; }

        let longitud = null;
        if (coordinates && window.turf) {
            longitud = turf.length({ type: "Feature", geometry: { type: "LineString", coordinates } }) * 1000;
        }

        this.abrirModal(item ? "Editar track de calle" : "Nuevo track de calle", `
            ${coordinates ? `
                <div class="sigt-track-summary">
                    <i class="fa-solid fa-route"></i>
                    <span>${coordinates.length} puntos · ${longitud ? Math.round(longitud) + " m" : "longitud no calculada"}</span>
                </div>` : ""}

            <label class="registry-field-label">Nombre de la calle *</label>
            <input type="text" id="fldCalle" class="registry-input" value="${escapeHtml(item?.nombre_calle || "")}">

            <label class="registry-field-label">Tipo de superficie *</label>
            <select id="fldSuperficie" class="registry-input">
                ${SURFACES.map(s => `<option value="${s}" ${item?.tipo_superficie === s ? "selected" : ""}>${SURFACE_TYPES[s].label}</option>`).join("")}
            </select>

            <label class="registry-field-label">Comunidad / Cantón</label>
            <input type="text" id="fldComunidad" class="registry-input" value="${escapeHtml(item?.comunidad_texto || "")}">

            <label class="registry-field-label">Observaciones</label>
            <textarea id="fldObservaciones" class="registry-input registry-textarea">${escapeHtml(item?.observaciones || "")}</textarea>
        `, () => this.guardarTrack(longitud));
    }

    async guardarTrack(longitud) {
        const nombre = cleanText(document.getElementById("fldCalle").value, 200);
        const superficie = document.getElementById("fldSuperficie").value;

        if (!nombre) { alert("Ingrese el nombre de la calle."); return; }
        if (!isAllowed(superficie, SURFACES)) { alert("Tipo de superficie inválido."); return; }

        const payload = {
            nombre_calle: nombre,
            tipo_superficie: superficie,
            comunidad_texto: cleanText(document.getElementById("fldComunidad").value, 200),
            observaciones: cleanText(document.getElementById("fldObservaciones").value, 1000)
        };

        const esEdicion = !!this.editing;
        let cuerpo = payload;

        if (!esEdicion) {
            const coords = this.pendingCoordinates;
            if (!coords || coords.length < 2) { alert("El recorrido no es válido."); return; }
            cuerpo = {
                ...payload,
                coordinates: coords,
                longitud_m: longitud,
                created_by: this.auth.getUserId()
            };
        }

        let resultado;
        try {
            resultado = await this.guardarOEncolar({
                tabla: "tracks", tipo: "track",
                accion: esEdicion ? "update" : "insert",
                registroId: esEdicion ? this.editing.id : uid(),
                payload: cuerpo,
                campoFoto: null
            });
        } catch { return; }

        this.pendingCoordinates = null;
        this.cerrarModal();
        await this.loadAll();
        if (resultado === "encolado") this.avisoGuardadoLocal();
    }

    /* ---------- SEGUIMIENTO ---------- */

    async formSeguimiento(necesidad) {
        if (!necesidad) return;

        const { data: historial } = await this.supabase
            .from("seguimiento")
            .select("id, comentario, estado_id, created_at")
            .eq("necesidad_id", necesidad.id)
            .order("created_at", { ascending: false });

        const items = (historial || []).map(h => `
            <li class="admin-timeline-item">
                <span class="admin-timeline-date">${escapeHtml(fechaLocal(h.created_at))}</span>
                <p>${escapeHtml(h.comentario)}</p>
                ${h.estado_id ? `<span class="registry-item-badge" style="background:#64748B;">${escapeHtml(h.estado_id)}</span>` : ""}
            </li>`).join("") || `<li class="registry-empty">Sin registros de seguimiento.</li>`;

        this.abrirModal(`Seguimiento — ${necesidad.tipo_nombre}`, `
            ${this.auth.puedeEditar() ? `
                <label class="registry-field-label">Nuevo comentario *</label>
                <textarea id="fldComentario" class="registry-input registry-textarea" placeholder="Avance, gestión realizada…"></textarea>
                <label class="registry-field-label">Cambiar estado a</label>
                <select id="fldNuevoEstado" class="registry-input">${this.opciones(this.catalogos.estados, necesidad.estado_id)}</select>
            ` : `<p class="registry-empty">Su rol es de solo consulta.</p>`}
            <label class="registry-field-label" style="margin-top:16px;">Historial</label>
            <ul class="admin-timeline">${items}</ul>
        `, () => this.guardarSeguimiento(necesidad), { hideSave: !this.auth.puedeEditar() });
    }

    async guardarSeguimiento(necesidad) {
        if (!this.requireEdit()) return;

        const comentario = cleanText(document.getElementById("fldComentario")?.value, 1000);
        const nuevoEstado = document.getElementById("fldNuevoEstado")?.value;
        if (!comentario) { alert("Escriba un comentario de seguimiento."); return; }

        const { error } = await this.supabase.from("seguimiento").insert({
            id: uid(), necesidad_id: necesidad.id,
            estado_id: nuevoEstado || null, comentario,
            created_by: this.auth.getUserId()
        });
        if (error) { alert("No se pudo guardar el seguimiento: " + error.message); return; }

        if (nuevoEstado && nuevoEstado !== necesidad.estado_id) {
            await this.supabase.from("necesidades").update({ estado_id: nuevoEstado }).eq("id", necesidad.id);
        }

        this.cerrarModal();
        await this.loadAll();
    }

    /* =====================================================
       ELIMINAR
    ===================================================== */

    async eliminar(tabla, id) {
        if (!this.auth.esAdmin()) { alert("Solo un administrador puede eliminar registros."); return; }
        if (!confirm("¿Eliminar este registro? La acción queda asentada en la auditoría.")) return;

        const { error } = await this.supabase.from(tabla).delete().eq("id", id);
        if (error) { alert("No se pudo eliminar: " + error.message); return; }
        await this.loadAll();
    }

    /* =====================================================
       EXPORTACIÓN
    ===================================================== */

    construirFeatures() {
        const f = [];
        this.necesidadesFiltradas().forEach(n => f.push({
            type: "Feature",
            properties: {
                categoria: "necesidad", tipo_nombre: n.tipo_nombre, estado: n.estado_nombre,
                prioridad: n.prioridad_nombre, descripcion: n.descripcion, direccion: n.direccion,
                comunidad: n.comunidad, lider: n.referente_nombre, registrado: n.created_at
            },
            geometry: { type: "Point", coordinates: [n.lng, n.lat] }
        }));
        this.referentes.forEach(r => f.push({
            type: "Feature",
            properties: {
                categoria: "lider", nombre: r.nombre, cargo: r.cargo,
                contacto: r.contacto, comunidad: r.comunidad, registrado: r.created_at
            },
            geometry: { type: "Point", coordinates: [r.lng, r.lat] }
        }));
        this.tracks.forEach(t => f.push({
            type: "Feature",
            properties: {
                categoria: "track", nombre_calle: t.nombre_calle, tipo_superficie: t.tipo_superficie,
                longitud_m: t.longitud_m, observaciones: t.observaciones, registrado: t.created_at
            },
            geometry: { type: "LineString", coordinates: t.coordinates }
        }));
        return f;
    }

    exportar(formato) {
        const collection = toGeoJSON(this.construirFeatures());
        if (!collection.features.length) { alert("No hay datos para exportar."); return; }

        if (formato === "kml") {
            downloadFile("sigt_san_salvador_sur.kml",
                geoJSONToKML(collection, "SIGT San Salvador Sur"),
                "application/vnd.google-earth.kml+xml");
        } else {
            downloadFile("sigt_san_salvador_sur.geojson",
                JSON.stringify(collection, null, 2), "application/geo+json");
        }
    }

    exportarCSV() {
        const cols = ["tipo_nombre", "estado_nombre", "prioridad_nombre", "comunidad", "direccion", "descripcion", "lat", "lng", "created_at"];
        const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const csv = [cols.join(","), ...this.necesidadesFiltradas().map(n => cols.map(c => esc(n[c])).join(","))].join("\n");
        downloadFile("reporte_necesidades.csv", "﻿" + csv, "text/csv;charset=utf-8");
    }

    /* =====================================================
       ADMINISTRACIÓN (solo admin)
    ===================================================== */

    /**
     * Llama a la Edge Function que administra cuentas.
     * La clave `service_role` vive solo en el servidor: enviarla al
     * navegador daría a cualquiera control total de la base de datos.
     */
    async llamarAdminUsuarios(cuerpo) {
        const { data, error } = await this.supabase.functions.invoke("admin-usuarios", { body: cuerpo });

        if (error) {
            // El SDK envuelve los errores HTTP: se intenta leer el detalle.
            let detalle = error.message || "Error desconocido";
            try {
                const res = await error.context?.json?.();
                if (res?.error) detalle = res.error;
            } catch { /* se queda el mensaje genérico */ }

            if (/not found|404|Failed to send/i.test(detalle)) {
                detalle = "La función 'admin-usuarios' no está desplegada. " +
                          "Ejecute: npx supabase functions deploy admin-usuarios";
            }
            throw new Error(detalle);
        }

        if (data?.error) throw new Error(data.error);
        return data;
    }

    errorUsuario(msg) {
        const el = document.getElementById("usuarioFormError");
        if (el) el.textContent = msg || "";
    }

    async crearUsuario() {
        if (!this.auth.esAdmin()) { alert("Solo un administrador puede crear usuarios."); return; }

        const nombre = cleanText(document.getElementById("nuevoUsuarioNombre").value, 200);
        const email = cleanText(document.getElementById("nuevoUsuarioEmail").value, 200).toLowerCase();
        const password = document.getElementById("nuevoUsuarioPassword").value;
        const rol = document.getElementById("nuevoUsuarioRol").value;
        const btn = document.getElementById("btnCrearUsuario");

        this.errorUsuario("");

        if (!nombre) { this.errorUsuario("Ingrese el nombre completo."); return; }
        if (!isValidEmail(email)) { this.errorUsuario("El correo electrónico no es válido."); return; }
        if (!password || password.length < 8) { this.errorUsuario("La contraseña debe tener al menos 8 caracteres."); return; }
        if (!isAllowed(rol, ["consulta", "editor", "admin"])) { this.errorUsuario("Rol inválido."); return; }

        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creando…`;

        try {
            await this.llamarAdminUsuarios({
                accion: "crear", email, password, nombre_completo: nombre, rol_id: rol
            });

            document.getElementById("nuevoUsuarioNombre").value = "";
            document.getElementById("nuevoUsuarioEmail").value = "";
            document.getElementById("nuevoUsuarioPassword").value = "";
            document.getElementById("nuevoUsuarioRol").value = "consulta";

            alert(`Usuario creado.\n\nCorreo: ${email}\nEntregue la contraseña provisional al usuario y pídale que la cambie.`);
            await this.loadUsuarios();
        } catch (err) {
            this.errorUsuario(err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Crear usuario`;
        }
    }

    async loadUsuarios() {
        if (!this.auth.esAdmin()) return;
        const c = document.getElementById("listaUsuarios");
        if (!c) return;

        const { data, error } = await this.supabase
            .from("usuarios").select("id, nombre_completo, rol_id, activo").order("nombre_completo");

        if (error) { c.innerHTML = `<p class="registry-empty">No se pudo cargar: ${escapeHtml(error.message)}</p>`; return; }

        // Los correos viven en auth.users, fuera del alcance del cliente:
        // se piden a la Edge Function. Si no está desplegada, se omiten.
        let correos = {};
        try {
            const res = await this.llamarAdminUsuarios({ accion: "listar" });
            correos = res?.correos || {};
        } catch { /* la lista sigue siendo útil sin los correos */ }

        const yo = this.auth.getUserId();

        c.innerHTML = (data || []).map(u => `
            <div class="registry-item sigt-usuario-item" data-id="${escapeHtml(u.id)}">
                <div class="sigt-usuario-cabecera">
                    <div class="registry-item-info">
                        <span class="registry-item-title">${escapeHtml(u.nombre_completo || u.id)}</span>
                        ${correos[u.id] ? `<span class="sigt-usuario-correo">${escapeHtml(correos[u.id])}</span>` : ""}
                    </div>
                    <span class="registry-item-badge ${u.activo ? "" : "sigt-badge-inactivo"}"
                          style="${u.activo ? "background:#16A34A;" : ""}">
                        ${u.activo ? "Activo" : "Inactivo"}
                    </span>
                </div>
                <div class="sigt-usuario-acciones">
                    <select class="registry-input admin-role-select" data-action="rol" ${u.id === yo ? "disabled" : ""}>
                        <option value="consulta" ${u.rol_id === "consulta" ? "selected" : ""}>Consulta</option>
                        <option value="editor"   ${u.rol_id === "editor" ? "selected" : ""}>Editor</option>
                        <option value="admin"    ${u.rol_id === "admin" ? "selected" : ""}>Admin</option>
                    </select>
                    <button class="registry-item-btn" data-action="password" title="Cambiar contraseña">
                        <i class="fa-solid fa-key"></i>
                    </button>
                    <button class="registry-item-btn" data-action="toggle" title="Activar / Desactivar"
                            ${u.id === yo ? "disabled" : ""}>
                        <i class="fa-solid fa-power-off"></i>
                    </button>
                    <button class="registry-item-btn" data-action="eliminar" title="Eliminar cuenta"
                            ${u.id === yo ? "disabled" : ""}>
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>`).join("") || `<p class="registry-empty">Sin usuarios.</p>`;

        c.querySelectorAll(".registry-item").forEach(item => {
            const id = item.getAttribute("data-id");
            const usuario = (data || []).find(u => u.id === id);

            item.querySelector('[data-action="rol"]')?.addEventListener("change", async (e) => {
                const { error: err } = await this.supabase.from("usuarios").update({ rol_id: e.target.value }).eq("id", id);
                if (err) alert("No se pudo cambiar el rol: " + err.message);
            });

            item.querySelector('[data-action="toggle"]')?.addEventListener("click", async () => {
                const { error: err } = await this.supabase.from("usuarios").update({ activo: !usuario.activo }).eq("id", id);
                if (err) { alert("No se pudo actualizar: " + err.message); return; }
                this.loadUsuarios();
            });

            item.querySelector('[data-action="password"]')?.addEventListener("click", async () => {
                const nueva = prompt(`Nueva contraseña para ${usuario.nombre_completo || id}\n(mínimo 8 caracteres)`);
                if (nueva === null) return;
                if (nueva.length < 8) { alert("La contraseña debe tener al menos 8 caracteres."); return; }
                try {
                    await this.llamarAdminUsuarios({ accion: "password", id, password: nueva });
                    alert("Contraseña actualizada.");
                } catch (err) {
                    alert("No se pudo cambiar la contraseña: " + err.message);
                }
            });

            item.querySelector('[data-action="eliminar"]')?.addEventListener("click", async () => {
                if (!confirm(`¿Eliminar la cuenta de ${usuario.nombre_completo || id}?\nEsta acción no se puede deshacer.`)) return;
                try {
                    await this.llamarAdminUsuarios({ accion: "eliminar", id });
                    this.loadUsuarios();
                } catch (err) {
                    alert("No se pudo eliminar: " + err.message);
                }
            });
        });
    }

    async loadAuditoria() {
        if (!this.auth.esAdmin()) return;
        const c = document.getElementById("listaAuditoria");
        if (!c) return;

        const { data, error } = await this.supabase
            .from("auditoria").select("id, tabla, operacion, registro_id, created_at")
            .order("created_at", { ascending: false }).limit(100);

        if (error) { c.innerHTML = `<p class="registry-empty">No se pudo cargar: ${escapeHtml(error.message)}</p>`; return; }

        const color = { INSERT: "#16A34A", UPDATE: "#F59E0B", DELETE: "#DC2626" };
        c.innerHTML = (data || []).map(a => `
            <div class="registry-item">
                <div class="registry-item-info">
                    <span class="registry-item-title">${escapeHtml(a.tabla)}</span>
                    <span class="admin-item-sub">${escapeHtml(fechaLocal(a.created_at))}</span>
                </div>
                <span class="registry-item-badge" style="background:${color[a.operacion] || "#64748B"};">
                    ${escapeHtml(a.operacion)}
                </span>
            </div>`).join("") || `<p class="registry-empty">Sin movimientos registrados.</p>`;
    }
}
