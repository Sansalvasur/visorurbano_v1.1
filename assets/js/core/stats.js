/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   stats.js  — estadísticas + gráficos interactivos con Chart.js
   ========================================================== */

import { formatLength, formatArea } from "../utils/helpers.js";

// Paleta de colores cohesiva para los gráficos
const CHART_PALETTE = [
    "#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6",
    "#06B6D4","#F97316","#84CC16","#EC4899","#14B8A6",
    "#6366F1","#A855F7","#22C55E","#FB923C","#E11D48"
];

export class StatsManager {
    constructor(mapManager) {
        this.mapManager  = mapManager;
        this._layersConfig = [];
        this._layersMap    = new Map();
        this._chartInstance = null;   // Chart.js instance
    }

    /* -------------------------------------------------------
       Actualiza tarjetas numéricas + selectores de capa
    ------------------------------------------------------- */
    update(layersConfig, layersMap) {
        this._layersConfig = layersConfig;
        this._layersMap    = layersMap;

        this._populateLayerSelector(layersConfig, layersMap);
        this._setupChartBuilder();
    }

    /* -------------------------------------------------------
       Detalles de capas activas (lista debajo de tarjetas)
    ------------------------------------------------------- */
    renderStatsDetails(details, lineLength, polygonArea) {
        let detailsPanel = document.getElementById("statsDetailsPanel");

        if (!detailsPanel) {
            const parent = document.getElementById("statsPanel").parentElement;
            detailsPanel = document.createElement("div");
            detailsPanel.id = "statsDetailsPanel";
            detailsPanel.style.cssText = "margin-top:15px;border-top:1px solid var(--border);padding-top:15px;";
            parent.insertBefore(detailsPanel, document.getElementById("chartBuilder"));
        }

        let html = '<h4 style="font-size:12px;font-weight:700;color:var(--text-light);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;">Capas activas</h4>';

        if (Object.keys(details).length === 0) {
            html += '<p style="font-size:12px;color:var(--text-light);font-style:italic;">No hay capas activas.</p>';
            detailsPanel.innerHTML = html;
            return;
        }

        html += '<ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">';
        Object.entries(details).forEach(([name, count]) => {
            html += `
                <li style="display:flex;justify-content:space-between;font-size:13px;color:var(--text);">
                    <span style="font-weight:500;">${name}</span>
                    <span style="background:#e2e8f0;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:var(--text-light);">${count}</span>
                </li>`;
        });

        if (lineLength > 0) {
            html += `<li style="display:flex;justify-content:space-between;font-size:13px;color:var(--text);border-top:1px dashed var(--border);padding-top:6px;margin-top:4px;">
                <span style="font-weight:600;"><i class="fa-solid fa-road" style="color:var(--text-light);margin-right:5px;"></i>Longitud Total</span>
                <span style="font-weight:700;color:var(--primary);">${formatLength(lineLength)}</span>
            </li>`;
        }

        if (polygonArea > 0) {
            html += `<li style="display:flex;justify-content:space-between;font-size:13px;color:var(--text);border-top:1px dashed var(--border);padding-top:6px;margin-top:4px;">
                <span style="font-weight:600;"><i class="fa-solid fa-chart-area" style="color:var(--text-light);margin-right:5px;"></i>Área Mapeada</span>
                <span style="font-weight:700;color:var(--success);">${formatArea(polygonArea)}</span>
            </li>`;
        }

        html += '</ul>';
        detailsPanel.innerHTML = html;
    }

    /* -------------------------------------------------------
       Llenar el selector de capas
    ------------------------------------------------------- */
    _populateLayerSelector(layersConfig, layersMap) {
        const sel = document.getElementById("chartLayerSelect");
        if (!sel) return;

        // Save current selection
        const prev = sel.value;
        sel.innerHTML = '<option value="">-- Seleccionar capa --</option>';

        layersConfig.forEach(config => {
            const checkbox = document.getElementById(`chk-${config.id}`);
            const isActive = checkbox && checkbox.checked;

            // Include any active layer that has fields or raw data (not just toGeoJSON layers)
            const hasData = (config._rawData && config._rawData.features && config._rawData.features.length > 0)
                         || (config.fields && config.fields.length > 0);

            if (isActive && hasData) {
                const opt = document.createElement("option");
                opt.value       = config.id;
                opt.textContent = config.name;
                if (config.id === prev) opt.selected = true;
                sel.appendChild(opt);
            }
        });

        // Refresh field list if a layer was already selected
        if (prev && sel.value === prev) {
            this._populateFieldSelector(prev);
        } else {
            const fieldSel = document.getElementById("chartFieldSelect");
            if (fieldSel) fieldSel.innerHTML = '<option value="">-- Primero elige una capa --</option>';
        }
    }

    /* -------------------------------------------------------
       Llenar el selector de campos al cambiar de capa
    ------------------------------------------------------- */
    _populateFieldSelector(layerId) {
        const fieldSel = document.getElementById("chartFieldSelect");
        if (!fieldSel) return;

        fieldSel.innerHTML = '<option value="">-- Seleccionar campo --</option>';

        const config = this._layersConfig.find(c => c.id === layerId);
        const layer  = this._layersMap.get(layerId);

        if (!config || !layer || typeof layer.toGeoJSON !== "function") return;

        let fields = [];

        // Use pre-extracted fields if available
        if (config.fields && config.fields.length > 0) {
            fields = config.fields;
        } else {
            try {
                const geojson = layer.toGeoJSON();
                if (geojson.features && geojson.features.length > 0) {
                    fields = Object.keys(geojson.features[0].properties || {});
                }
            } catch { /* ignore */ }
        }

        fields.forEach(f => {
            const opt = document.createElement("option");
            opt.value       = f;
            opt.textContent = f;
            fieldSel.appendChild(opt);
        });
    }

    /* -------------------------------------------------------
       Conectar eventos del Chart Builder (ejecutar 1 sola vez)
    ------------------------------------------------------- */
    _chartBuilderReady = false;

    _setupChartBuilder() {
        if (this._chartBuilderReady) return;
        this._chartBuilderReady = true;

        const layerSel  = document.getElementById("chartLayerSelect");
        const fieldSel  = document.getElementById("chartFieldSelect");
        const genBtn    = document.getElementById("btnGenerateChart");
        const closeBtn  = document.getElementById("btnCloseChart");

        if (!layerSel || !fieldSel || !genBtn) return;

        // When layer changes → refresh field list
        layerSel.addEventListener("change", () => {
            this._populateFieldSelector(layerSel.value);
        });

        // Generate chart button
        genBtn.addEventListener("click", () => {
            const layerId  = layerSel.value;
            const field    = fieldSel.value;
            const chartType = document.getElementById("chartTypeSelect")?.value || "bar";

            if (!layerId || !field) {
                genBtn.style.opacity = "0.6";
                setTimeout(() => genBtn.style.opacity = "1", 600);
                return;
            }

            this._generateChart(layerId, field, chartType);
        });

        // Close chart → back to placeholder
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                const chartContent = document.getElementById("chartContent");
                const chartPlaceholder = document.getElementById("chartPlaceholder");
                if (chartContent)     chartContent.style.display = "none";
                if (chartPlaceholder) chartPlaceholder.style.display = "flex";
                if (this._chartInstance) {
                    this._chartInstance.destroy();
                    this._chartInstance = null;
                }
            });
        }
    }

    /* -------------------------------------------------------
       Generar gráfico en el panel derecho
    ------------------------------------------------------- */
    _generateChart(layerId, field, chartType) {
        const config = this._layersConfig.find(c => c.id === layerId);

        if (!config) return;

        // Prefer raw stored data (works for all layer types including layerGroup)
        let geojson;
        if (config._rawData && config._rawData.features) {
            geojson = config._rawData;
        } else {
            const layer = this._layersMap.get(layerId);
            if (!layer || typeof layer.toGeoJSON !== "function") return;
            try { geojson = layer.toGeoJSON(); } catch { return; }
        }

        const features = (geojson.features || []).filter(f =>
            f.properties && f.properties[field] !== undefined && f.properties[field] !== null
        );

        if (features.length === 0) return;

        // Build frequency map
        const freq = {};
        features.forEach(f => {
            const val = String(f.properties[field]).trim() || "(vacío)";
            freq[val] = (freq[val] || 0) + 1;
        });

        // Sort by count descending, limit to top 15
        const sorted = Object.entries(freq)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 15);

        const labels = sorted.map(([k]) => k);
        const data   = sorted.map(([, v]) => v);
        const colors = labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);

        const chartContent     = document.getElementById("chartContent");
        const chartPlaceholder = document.getElementById("chartPlaceholder");
        const titleEl          = document.getElementById("chartPanelTitle");
        const summaryEl        = document.getElementById("chartSummary");

        if (chartContent)     chartContent.style.display = "block";
        if (chartPlaceholder) chartPlaceholder.style.display = "none";
        if (titleEl)          titleEl.textContent = `${config.name} — ${field}`;

        // Open the right panel if collapsed
        const infoPanel  = document.getElementById("infoPanel");
        const container  = document.getElementById("container");
        const toggleBtn  = document.getElementById("toggleInfoPanel");
        if (infoPanel && infoPanel.classList.contains("collapsed")) {
            infoPanel.classList.remove("collapsed");
            container?.classList.remove("infopanel-collapsed");
            if (toggleBtn) {
                toggleBtn.querySelector("i").className = "fa-solid fa-chevron-right";
                toggleBtn.title = "Ocultar Gráficos";
            }
            setTimeout(() => this.mapManager.getMap().invalidateSize(), 305);
        }

        // Destroy previous chart
        if (this._chartInstance) {
            this._chartInstance.destroy();
            this._chartInstance = null;
        }

        const canvas = document.getElementById("mainChart");
        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        const borderColors = chartType === "bar"
            ? colors.map(c => c)
            : colors;

        this._chartInstance = new Chart(ctx, {
            type: chartType,
            data: {
                labels,
                datasets: [{
                    label: field,
                    data,
                    backgroundColor: colors.map(c => c + "CC"),  // 80% opacity
                    borderColor: borderColors,
                    borderWidth: chartType === "bar" ? 1 : 2,
                    borderRadius: chartType === "bar" ? 4 : 0,
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: chartType !== "bar",
                        position: "bottom",
                        labels: { font: { size: 10 }, boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const total = data.reduce((a, b) => a + b, 0);
                                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                                return ` ${ctx.parsed} (${pct}%)`;
                            }
                        }
                    }
                },
                scales: chartType === "bar" ? {
                    x: {
                        ticks: { font: { size: 9 }, maxRotation: 45 },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { font: { size: 10 } },
                        grid: { color: "#f1f5f9" }
                    }
                } : {}
            }
        });

        // Summary text
        const total = data.reduce((a, b) => a + b, 0);
        if (summaryEl) {
            summaryEl.innerHTML = `
                <strong>${total}</strong> registros · <strong>${labels.length}</strong> categorías
                ${sorted.length < Object.keys(freq).length ? ` · mostrando top ${sorted.length}` : ""}
            `;
        }
    }
}
