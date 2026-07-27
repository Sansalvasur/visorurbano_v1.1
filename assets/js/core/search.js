/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   search.js
   ========================================================== */

export class SearchManager {
    constructor(mapManager, sidebarManager, popupManager) {
        this.mapManager = mapManager;
        this.sidebarManager = sidebarManager;
        this.popupManager = popupManager;
        this.searchInput = document.getElementById("globalSearch");
        this.searchBtn = document.getElementById("btnSearch");
        this.resultsDropdown = null;
        
        this.injectSearchStyles();
    }

    /**
     * Initializes search input and button event listeners.
     */
    initialize() {
        if (!this.searchInput) return;

        // Container structure
        const container = this.searchInput.parentElement;
        container.style.position = "relative";

        // Create results dropdown
        this.resultsDropdown = document.createElement("div");
        this.resultsDropdown.className = "search-results-dropdown";
        container.appendChild(this.resultsDropdown);

        // Input listeners
        this.searchInput.addEventListener("input", (e) => {
            const query = e.target.value.trim();
            if (query.length < 2) {
                this.clearResults();
                return;
            }
            this.search(query);
        });

        this.searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                this.clearResults();
            }
        });

        // Click outside closes results
        document.addEventListener("click", (e) => {
            if (!container.contains(e.target)) {
                this.clearResults();
            }
        });

        if (this.searchBtn) {
            this.searchBtn.addEventListener("click", () => {
                const query = this.searchInput.value.trim();
                if (query.length >= 2) {
                    this.search(query);
                }
            });
        }
    }

    /**
     * Performs a search on all searchable layers.
     */
    search(query) {
        const results = [];
        const cleanQuery = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        this.sidebarManager.layersConfig.forEach(config => {
            if (!config.searchable) return;

            const layerInstance = this.sidebarManager.layersMap.get(config.id);
            if (!layerInstance || typeof layerInstance.eachLayer !== "function") return;

            layerInstance.eachLayer(sublayer => {
                if (!sublayer.feature || !sublayer.feature.properties) return;

                const props = sublayer.feature.properties;
                // Search across all attribute values of the feature
                const match = Object.values(props).some(val => {
                    if (val === null || val === undefined) return false;
                    const stringVal = String(val).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return stringVal.includes(cleanQuery);
                });

                if (match) {
                    const title = props.nombre || props.Name || props.ID || props.id || "Elemento sin nombre";
                    const subtitle = props.canton || props.distrito || props.tipo || "";
                    
                    results.push({
                        title,
                        subtitle,
                        layerName: config.name,
                        layerId: config.id,
                        layerInstance: sublayer,
                        layerGroupConfig: config
                    });
                }
            });
        });

        this.renderResults(results);
    }

    /**
     * Renders search result list.
     */
    renderResults(results) {
        this.resultsDropdown.innerHTML = "";
        
        if (results.length === 0) {
            this.resultsDropdown.innerHTML = `
                <div class="search-result-empty">
                    No se encontraron resultados
                </div>
            `;
            this.resultsDropdown.style.display = "block";
            return;
        }

        // Limit to top 15 results for performance
        const topResults = results.slice(0, 15);

        topResults.forEach(res => {
            const item = document.createElement("div");
            item.className = "search-result-item";
            item.innerHTML = `
                <div style="display:flex; flex-direction:column;">
                    <span class="search-result-title">${res.title}</span>
                    <span class="search-result-subtitle">${res.subtitle || res.layerName}</span>
                </div>
                <span class="search-result-badge">${res.layerName}</span>
            `;

            item.addEventListener("click", () => {
                this.selectResult(res);
            });

            this.resultsDropdown.appendChild(item);
        });

        this.resultsDropdown.style.display = "block";
    }

    /**
     * Zooms and highlights selected search element.
     */
    selectResult(result) {
        this.searchInput.value = result.title;
        this.clearResults();

        // 1. Ensure the layer is active on the map
        const checkbox = document.getElementById(`chk-${result.layerId}`);
        if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
            this.sidebarManager.toggleLayerVisibility(result.layerId, true);
        }

        // 2. Zoom to the specific feature geometry
        const map = this.mapManager.getMap();
        const feature = result.layerInstance;

        if (feature.getBounds) {
            map.fitBounds(feature.getBounds(), { padding: [50, 50], maxZoom: 18 });
        } else if (feature.getLatLng) {
            map.setView(feature.getLatLng(), 18);
        }

        // 3. Highlight feature and open its popup
        setTimeout(() => {
            feature.openPopup();
            this.popupManager.showInDetailsPanel(result.layerName, feature.feature.properties);
        }, 300);
    }

    clearResults() {
        this.resultsDropdown.innerHTML = "";
        this.resultsDropdown.style.display = "none";
    }

    injectSearchStyles() {
        if (document.getElementById("custom-search-styles")) return;

        const style = document.createElement("style");
        style.id = "custom-search-styles";
        style.innerHTML = `
            .search-results-dropdown {
                position: absolute;
                top: 100%;
                left: 0;
                width: 100%;
                background: white;
                border: 1px solid var(--border);
                border-radius: 0 0 10px 10px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                max-height: 350px;
                overflow-y: auto;
                z-index: 1000;
                display: none;
                margin-top: 2px;
            }
            
            body.dark-theme .search-results-dropdown {
                background: #1e293b;
                border-color: #334155;
            }
            
            .search-result-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 15px;
                border-bottom: 1px solid #f1f5f9;
                cursor: pointer;
                transition: var(--transition);
            }
            
            body.dark-theme .search-result-item {
                border-color: #334155;
            }
            
            .search-result-item:hover {
                background: #f8fafc;
            }
            
            body.dark-theme .search-result-item:hover {
                background: #334155;
            }
            
            .search-result-item:last-child {
                border-bottom: none;
                border-radius: 0 0 10px 10px;
            }
            
            .search-result-title {
                font-size: 13.5px;
                font-weight: 600;
                color: var(--text);
            }
            
            .search-result-subtitle {
                font-size: 11.5px;
                color: var(--text-light);
                margin-top: 2px;
            }
            
            .search-result-badge {
                font-size: 10.5px;
                font-weight: 700;
                background: #e0f2fe;
                color: #0369a1;
                padding: 3px 8px;
                border-radius: 6px;
                text-transform: uppercase;
                letter-spacing: 0.3px;
            }
            
            body.dark-theme .search-result-badge {
                background: #0369a1;
                color: #e0f2fe;
            }
            
            .search-result-empty {
                padding: 15px;
                text-align: center;
                color: var(--text-light);
                font-size: 13px;
                font-style: italic;
            }
        `;
        document.head.appendChild(style);
    }
}
