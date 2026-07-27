/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   sidebar.js
   ========================================================== */

export class SidebarManager {
    constructor(mapManager) {
        this.mapManager = mapManager;
        this.layersConfig = [];
        this.layersMap = new Map(); // tracks layer instances
        this.legendManager = null;
        this.statsManager = null;
    }

    setLegendManager(legendManager) {
        this.legendManager = legendManager;
    }

    setStatsManager(statsManager) {
        this.statsManager = statsManager;
    }

    /**
     * Initializes the layers sidebar panel.
     * @param {Array} layersConfig - Config objects array.
     */
    initialize(layersConfig) {
        this.layersConfig = layersConfig;
        const listContainer = document.getElementById("layerList");
        if (!listContainer) return;
        
        listContainer.innerHTML = "";

        this.layersConfig.forEach(layer => {
            const item = this.createLayerItem(layer);
            listContainer.appendChild(item);
        });

        // Initialize tabs switching
        this.setupTabs();
    }

    /**
     * Attaches click events to tab buttons to switch panel visibility.
     */
    setupTabs() {
        const tabButtons = document.querySelectorAll(".sidebar-tabs .tab-btn");
        const tabContents = document.querySelectorAll("#sidebar .tab-content");
        const sidebar = document.getElementById("sidebar");
        const container = document.getElementById("container");
        const esMovil = () => window.matchMedia("(max-width: 768px)").matches;

        tabButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const tabTarget = btn.getAttribute("data-tab");
                const yaActiva = btn.classList.contains("active");
                const cerrado = sidebar?.classList.contains("collapsed");

                // Switch active button styling
                tabButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                // Show/hide corresponding tab content
                tabContents.forEach(content => {
                    const contentId = content.getAttribute("id");
                    if (contentId === `tab-${tabTarget}`) {
                        content.classList.add("active");
                    } else {
                        content.classList.remove("active");
                    }
                });

                // En móvil la barra de pestañas queda fija abajo y el panel es
                // un cajón: al tocar una pestaña se abre, y al volver a tocar
                // la que ya estaba activa se cierra para despejar el mapa.
                if (esMovil() && sidebar && container) {
                    const debeCerrar = yaActiva && !cerrado;
                    sidebar.classList.toggle("collapsed", debeCerrar);
                    container.classList.toggle("sidebar-collapsed", debeCerrar);
                    this.actualizarTiradorSidebar(debeCerrar);
                    setTimeout(() => this.mapManager.getMap()?.invalidateSize(), 320);
                }
            });
        });
    }

    /** Mantiene el icono del tirador coherente con el estado del cajón. */
    actualizarTiradorSidebar(cerrado) {
        const btn = document.getElementById("toggleSidebar");
        if (!btn) return;
        const icon = btn.querySelector("i");
        if (icon) icon.className = cerrado ? "fa-solid fa-chevron-right" : "fa-solid fa-chevron-left";
        btn.title = cerrado ? "Mostrar panel" : "Ocultar panel";
    }

    /**
     * Registers a loaded layer instance to associate with the UI.
     * @param {string} id - Layer identifier.
     * @param {L.Layer} layerInstance - Leaflet layer instance.
     */
    registerLayerInstance(id, layerInstance) {
        this.layersMap.set(id, layerInstance);
    }

    /**
     * Creates DOM structure for a single layer control item.
     */
    createLayerItem(layer) {
        const item = document.createElement("div");
        item.className = "layer-item";
        item.setAttribute("data-id", layer.id);

        const isChecked = layer.visible ? "checked" : "";
        
        // Build option list for labeling select dropdown from extracted fields
        const fields = layer.fields || [];
        let selectOptions = "";
        fields.forEach(field => {
            const isDefault = ["nombre", "name", "id", "canton", "proyecto"].some(f => field.toLowerCase() === f) ? "selected" : "";
            selectOptions += `<option value="${field}" ${isDefault}>${field}</option>`;
        });

        // Dynamic ranges checklist for Centros de Votacion layer
        let sublayersHtml = "";
        if (layer.id === "centros") {
            const sublayerDisplay = layer.visible ? "flex" : "none";
            sublayersHtml = `
                <div class="layer-sublayers" id="sub-${layer.id}" style="margin-left: 24px; margin-top: 8px; display: ${sublayerDisplay}; flex-direction: column; gap: 8px; border-left: 2px solid #e2e8f0; padding-left: 10px; margin-bottom: 8px;">
                    <div class="sublayer-row" style="display: flex; align-items: center; justify-content: space-between;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer; color: var(--text); user-select: none;">
                            <input type="checkbox" class="sublayer-checkbox" data-range="0-2" checked>
                            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #4dd0e1; border: 1.5px solid #006064; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"></span>
                            <span>0 - 2 JRVs</span>
                        </label>
                    </div>
                    <div class="sublayer-row" style="display: flex; align-items: center; justify-content: space-between;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer; color: var(--text); user-select: none;">
                            <input type="checkbox" class="sublayer-checkbox" data-range="2-5" checked>
                            <span style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: #4dd0e1; border: 1.5px solid #006064; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"></span>
                            <span>2 - 5 JRVs</span>
                        </label>
                    </div>
                    <div class="sublayer-row" style="display: flex; align-items: center; justify-content: space-between;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer; color: var(--text); user-select: none;">
                            <input type="checkbox" class="sublayer-checkbox" data-range="5-8" checked>
                            <span style="display: inline-block; width: 18px; height: 18px; border-radius: 50%; background: #4dd0e1; border: 1.5px solid #006064; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"></span>
                            <span>5 - 8 JRVs</span>
                        </label>
                    </div>
                    <div class="sublayer-row" style="display: flex; align-items: center; justify-content: space-between;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer; color: var(--text); user-select: none;">
                            <input type="checkbox" class="sublayer-checkbox" data-range="8-11" checked>
                            <span style="display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: #4dd0e1; border: 1.5px solid #006064; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"></span>
                            <span>8 - 11 JRVs</span>
                        </label>
                    </div>
                    <div class="sublayer-row" style="display: flex; align-items: center; justify-content: space-between;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer; color: var(--text); user-select: none;">
                            <input type="checkbox" class="sublayer-checkbox" data-range="11-20" checked>
                            <span style="display: inline-block; width: 26px; height: 26px; border-radius: 50%; background: #4dd0e1; border: 1.5px solid #006064; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"></span>
                            <span>11 - 20 JRVs</span>
                        </label>
                    </div>
                </div>
            `;
        }

        item.innerHTML = `
            <div class="layer-row">
                <div class="layer-title-container">
                    <input type="checkbox" class="layer-checkbox" id="chk-${layer.id}" ${isChecked}>
                    <span class="layer-name">${layer.name}</span>
                </div>
                <div class="layer-actions">
                    <button class="layer-btn" id="opt-${layer.id}" title="Opciones de Capa">
                        <i class="fa-solid fa-sliders"></i>
                    </button>
                    <button class="layer-btn" id="zoom-${layer.id}" title="Enfocar en mapa">
                        <i class="fa-solid fa-expand"></i>
                    </button>
                </div>
            </div>
            ${sublayersHtml}
            <div class="layer-controls-expanded" id="exp-${layer.id}" style="display: none;">
                <div class="opacity-control">
                    <span>Opacidad:</span>
                    <input type="range" class="opacity-slider" id="sld-${layer.id}" min="0" max="1" step="0.05" value="1">
                    <span id="val-${layer.id}">100%</span>
                </div>
                <div class="labels-control" style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed #f1f5f9; padding-top: 8px;">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-light); cursor: pointer; user-select: none;">
                        <input type="checkbox" class="label-checkbox-toggle" id="lblchk-${layer.id}">
                        <span>Mostrar etiquetas</span>
                    </label>
                    <select class="label-field-select" id="lblsel-${layer.id}" style="display: none; width: 100%; height: 28px; font-size: 11px; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border); background: white; color: var(--text); outline: none;">
                        ${selectOptions || '<option value="">Sin campos</option>'}
                    </select>
                </div>
            </div>
        `;

        // Checkbox toggle logic
        const checkbox = item.querySelector(`#chk-${layer.id}`);
        checkbox.addEventListener("change", (e) => {
            const visible = e.target.checked;
            this.toggleLayerVisibility(layer.id, visible);
            
            // Toggle sublayers list container
            const subContainer = item.querySelector(`.layer-sublayers`);
            if (subContainer) {
                subContainer.style.display = visible ? "flex" : "none";
            }
        });

        // Sublayers checklists event logic
        if (layer.id === "centros") {
            const subCheckboxes = item.querySelectorAll(".sublayer-checkbox");
            subCheckboxes.forEach(subChk => {
                subChk.addEventListener("change", (e) => {
                    const rangeKey = e.target.getAttribute("data-range");
                    const rangeVisible = e.target.checked;
                    this.toggleSubLayerVisibility(layer.id, rangeKey, rangeVisible);
                });
            });
        }

        // Opacity slider toggle logic
        const optBtn = item.querySelector(`#opt-${layer.id}`);
        const expandedControls = item.querySelector(`#exp-${layer.id}`);
        optBtn.addEventListener("click", () => {
            const isHidden = expandedControls.style.display === "none";
            expandedControls.style.display = isHidden ? "flex" : "none";
            optBtn.classList.toggle("active", isHidden);
        });

        // Opacity slider event logic
        const slider = item.querySelector(`#sld-${layer.id}`);
        const valText = item.querySelector(`#val-${layer.id}`);
        slider.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            valText.textContent = `${Math.round(val * 100)}%`;
            this.mapManager.setLayerOpacity(layer.name, val);
        });

        // Labels controls logic
        const labelChk = item.querySelector(`#lblchk-${layer.id}`);
        const labelSel = item.querySelector(`#lblsel-${layer.id}`);
        
        if (labelChk && labelSel) {
            labelChk.addEventListener("change", (e) => {
                const showLabels = e.target.checked;
                labelSel.style.display = showLabels ? "block" : "none";
                this.updateLayerLabels(layer.id, showLabels, labelSel.value);
            });

            labelSel.addEventListener("change", (e) => {
                if (labelChk.checked) {
                    this.updateLayerLabels(layer.id, true, e.target.value);
                }
            });
        }

        // Zoom button logic
        const zoomBtn = item.querySelector(`#zoom-${layer.id}`);
        zoomBtn.addEventListener("click", () => {
            const layerInstance = this.layersMap.get(layer.id);
            if (layerInstance) {
                if (!checkbox.checked) {
                    checkbox.checked = true;
                    this.toggleLayerVisibility(layer.id, true);
                    const subContainer = item.querySelector(`.layer-sublayers`);
                    if (subContainer) subContainer.style.display = "flex";
                }
                this.mapManager.zoomToLayer(layerInstance);
            }
        });

        return item;
    }

    /**
     * Toggles visibility of a specific sub-layer range for voting centers.
     */
    toggleSubLayerVisibility(id, rangeKey, visible) {
        const masterGroup = this.layersMap.get(id);
        if (!masterGroup || !masterGroup.subGroups) return;

        const subGroup = masterGroup.subGroups[rangeKey];
        if (!subGroup) return;

        if (visible) {
            if (!masterGroup.hasLayer(subGroup)) {
                masterGroup.addLayer(subGroup);
            }
        } else {
            if (masterGroup.hasLayer(subGroup)) {
                masterGroup.removeLayer(subGroup);
            }
        }

        // Update stats / legends
        if (this.legendManager) {
            this.legendManager.update(this.layersConfig, this.layersMap);
        }
        if (this.statsManager) {
            this.statsManager.update(this.layersConfig, this.layersMap);
        }
    }

    /**
     * Updates or binds permanent text labels recursively (handles subgroups for range filtering).
     */
    updateLayerLabels(id, show, field) {
        const layerInstance = this.layersMap.get(id);
        if (!layerInstance) return;

        const processLayer = (layer) => {
            if (typeof layer.eachLayer === "function") {
                layer.eachLayer(sub => {
                    if (sub.feature) {
                        if (sub.getTooltip()) {
                            sub.unbindTooltip();
                        }
                        if (show && sub.feature.properties && field) {
                            const val = sub.feature.properties[field];
                            if (val !== undefined && val !== null && val !== "") {
                                const geomType = sub.feature.geometry ? sub.feature.geometry.type : "";
                                const direction = geomType.includes("Point") ? "top" : "center";
                                sub.bindTooltip(String(val), {
                                    permanent: true,
                                    direction: direction,
                                    className: "map-label-tooltip"
                                });
                            }
                        }
                    } else {
                        // It's a subgroup, recurse
                        processLayer(sub);
                    }
                });
            }
        };

        processLayer(layerInstance);
    }

    /**
     * Toggles layer visibility on the map.
     */
    toggleLayerVisibility(id, visible) {
        const layerConfig = this.layersConfig.find(l => l.id === id);
        const layerInstance = this.layersMap.get(id);
        
        if (!layerConfig || !layerInstance) return;

        if (visible) {
            this.mapManager.addLayer(layerInstance, layerConfig.name);
        } else {
            this.mapManager.removeLayer(layerConfig.name);
        }
        
        // Update stats, legends
        if (this.legendManager) {
            this.legendManager.update(this.layersConfig, this.layersMap);
        }
        if (this.statsManager) {
            this.statsManager.update(this.layersConfig, this.layersMap);
        }
    }
}
