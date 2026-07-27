/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   loader.js
   ========================================================== */

import { createMarkerIcon } from "../utils/icons.js";

// Roles distintos de admin solo ven estas capas dinámicas en el panel.
// Las capas SIGT (Necesidades, Líderes comunitarios, Tracks) son aparte
// y ya son visibles para todos los roles (ver registry.js bindCapasSigt).
const CAPAS_PERMITIDAS_NO_ADMIN = ["municipio", "cantones"];

export class LayerLoader {
    constructor(mapManager, sidebarManager, popupManager, legendManager, statsManager, auth = null) {
        this.mapManager = mapManager;
        this.sidebarManager = sidebarManager;
        this.popupManager = popupManager;
        this.legendManager = legendManager;
        this.statsManager = statsManager;
        this.auth = auth;
        this.layersConfig = [];
    }

    /**
     * Reads layers.json configuration and loads all GeoJSON files.
     */
    async loadLayers() {
        try {
            // Load from root config directory with a cache buster
            const response = await fetch(`config/layers.json?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error("No se pudo cargar la configuración de capas.");
            }
            
            const configData = await response.json();
            const esAdmin = !!this.auth && typeof this.auth.esAdmin === "function" && this.auth.esAdmin();
            this.layersConfig = esAdmin
                ? configData.layers
                : configData.layers.filter(l => CAPAS_PERMITIDAS_NO_ADMIN.includes(l.id));

            console.log(`Cargando ${this.layersConfig.length} capas configuradas...`);

            // Load all layers asynchronously in parallel
            const loadPromises = this.layersConfig.map(layerConfig => this.loadSingleLayer(layerConfig));
            await Promise.all(loadPromises);

            // Initialize sidebar controls
            this.sidebarManager.initialize(this.layersConfig);
            
            // Link references in sidebar
            this.sidebarManager.setLegendManager(this.legendManager);
            this.sidebarManager.setStatsManager(this.statsManager);

            // Update legends and stats initially
            this.legendManager.update(this.layersConfig, this.sidebarManager.layersMap);
            this.statsManager.update(this.layersConfig, this.sidebarManager.layersMap);

            console.log("Todas las capas se han cargado y configurado.");

        } catch (error) {
            console.error("Error crítico cargando capas:", error);
            alert("Ocurrió un error cargando las capas del visor.");
        }
    }

    /**
     * Loads a single GeoJSON layer based on its config.
     */
    async loadSingleLayer(config) {
        try {
            const response = await fetch(`${config.file}?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} al cargar ${config.file}`);
            }

            const geojsonData = await response.json();

            // Apply filter if configured (e.g. filter by sector: PUBLICO/PRIVADO)
            if (config.filter && config.filter.field && config.filter.value) {
                geojsonData.features = geojsonData.features.filter(f => {
                    const val = String(f.properties[config.filter.field] || "").trim().toUpperCase();
                    return val === config.filter.value.trim().toUpperCase();
                });
            }
            
            // Extract attribute fields from first feature if available
            if (geojsonData.features && geojsonData.features.length > 0) {
                config.fields = Object.keys(geojsonData.features[0].properties);
            } else {
                config.fields = [];
            }
            
            // Store raw GeoJSON for stats/charts (works even for layers without toGeoJSON)
            config._rawData = geojsonData;
            
            let layerInstance = null;

            if (config.geometry === "point") {
                if (config.cluster) {
                    // Initialize MarkerCluster Group
                    layerInstance = L.markerClusterGroup({
                        showCoverageOnHover: false,
                        maxClusterRadius: 50,
                        spiderfyOnMaxZoom: true,
                        // Clean premium style for clusters matching theme
                        iconCreateFunction: (cluster) => {
                            const childCount = cluster.getChildCount();
                            let c = ' marker-cluster-';
                            if (childCount < 10) {
                                c += 'small';
                            } else if (childCount < 100) {
                                c += 'medium';
                            } else {
                                c += 'large';
                            }
                            
                            // Custom style to match the marker Color
                            const clusterColor = config.categorizedIcon
                                ? (config.categorizedIcon.clusterColor || '#546E7A')
                                : (config.markerColor || '#0B5ED7');
                            return new L.DivIcon({ 
                                html: `<div style="background-color: ${clusterColor}; border: 3px solid rgba(255,255,255,0.6); box-shadow: 0 2px 5px rgba(0,0,0,0.2);"><span>${childCount}</span></div>`, 
                                className: 'marker-cluster' + c, 
                                iconSize: new L.Point(40, 40) 
                            });
                        }
                    });

                    // Add point features as individual layers to cluster group
                    const pointsLayer = L.geoJSON(geojsonData, {
                        pointToLayer: (feature, latlng) => {
                            // Resolve icon/color: categorizedIcon takes priority over static icon
                            let iconName = config.icon;
                            let markerColor = config.markerColor;
                            if (config.categorizedIcon) {
                                const rawVal = feature.properties[config.categorizedIcon.field];
                                const fieldVal = String(rawVal || "").trim().toUpperCase();
                                const matchKey = Object.keys(config.categorizedIcon.categories).find(
                                    k => k.trim().toUpperCase() === fieldVal
                                );
                                const cat = matchKey
                                    ? config.categorizedIcon.categories[matchKey]
                                    : config.categorizedIcon.default;
                                console.log(`[CatIcon] raw="${rawVal}" fieldVal="${fieldVal}" matchKey="${matchKey}" cat=`, cat);
                                if (cat) { iconName = cat.icon; markerColor = cat.markerColor; }
                            }
                            console.log(`[Marker] icon="${iconName}" color="${markerColor}"`);
                            const marker = L.marker(latlng, {
                                icon: createMarkerIcon(iconName, markerColor)
                            });
                            if (config.popup) {
                                this.popupManager.bindPopup(marker, config.name, feature.properties);
                            }
                            return marker;
                        }
                    });
                    
                    layerInstance.addLayer(pointsLayer);

                } else {
                    // Regular point markers (no cluster)
                    if (config.id === "centros") {
                        // Create a master Group that contains the 5 subgroups
                        const masterGroup = L.layerGroup();
                        const subGroups = {
                            "0-2": L.featureGroup(),
                            "2-5": L.featureGroup(),
                            "5-8": L.featureGroup(),
                            "8-11": L.featureGroup(),
                            "11-20": L.featureGroup()
                        };
                        
                        // Add all subgroups to masterGroup initially
                        Object.values(subGroups).forEach(sg => masterGroup.addLayer(sg));

                        // Helper to get JRV value and map to range key
                        const getRangeKey = (jrv) => {
                            if (jrv <= 2) return "0-2";
                            if (jrv <= 5) return "2-5";
                            if (jrv <= 8) return "5-8";
                            if (jrv <= 11) return "8-11";
                            return "11-20";
                        };

                        // Process features and add markers to respective subgroups
                        L.geoJSON(geojsonData, {
                            pointToLayer: (feature, latlng) => {
                                let jrvCount = 0;
                                if (feature.properties) {
                                    for (const key of Object.keys(feature.properties)) {
                                        if (key.toLowerCase() === "jrv") {
                                            jrvCount = parseInt(feature.properties[key], 10) || 0;
                                            break;
                                        }
                                    }
                                }

                                const rKey = getRangeKey(jrvCount);
                                
                                // Precise diameters and font sizes matching range
                                let diameter, fontSize;
                                if (rKey === "0-2") { diameter = 18; fontSize = 10; }
                                else if (rKey === "2-5") { diameter = 26; fontSize = 12; }
                                else if (rKey === "5-8") { diameter = 34; fontSize = 14; }
                                else if (rKey === "8-11") { diameter = 44; fontSize = 16; }
                                else { diameter = 54; fontSize = 18; }

                                const html = `
                                    <div class="jrv-marker-bubble" style="
                                        width: ${diameter}px;
                                        height: ${diameter}px;
                                        background-color: #4dd0e1;
                                        border: 2px solid #006064;
                                        border-radius: 50%;
                                        color: #000;
                                        font-weight: 800;
                                        font-size: ${fontSize}px;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                                    ">
                                        ${jrvCount}
                                    </div>
                                `;

                                const marker = L.marker(latlng, {
                                    icon: new L.DivIcon({
                                        html: html,
                                        className: 'jrv-bubble-icon',
                                        iconSize: [diameter, diameter],
                                        iconAnchor: [diameter / 2, diameter / 2]
                                    })
                                });

                                if (config.popup) {
                                    this.popupManager.bindPopup(marker, config.name, feature.properties);
                                }

                                // Add to correct range subgroup
                                subGroups[rKey].addLayer(marker);
                                return marker;
                            }
                        });

                        masterGroup.subGroups = subGroups;
                        layerInstance = masterGroup;

                    } else {
                        // Standard unclustered point layers
                        layerInstance = L.geoJSON(geojsonData, {
                            pointToLayer: (feature, latlng) => {
                                const marker = L.marker(latlng, {
                                    icon: createMarkerIcon(config.icon, config.markerColor)
                                });
                                
                                if (config.popup) {
                                    this.popupManager.bindPopup(marker, config.name, feature.properties);
                                }
                                return marker;
                            }
                        });
                    }
                }

            } else {
                // For LineStrings and Polygons (Vector geometries)
                layerInstance = L.geoJSON(geojsonData, {
                    style: (feature) => {
                        // Apply categorized styles if configured
                        if (config.styleType === "categorized" && config.categorizedField && config.categories && feature && feature.properties) {
                            const val = String(feature.properties[config.categorizedField] || "").trim().toLowerCase();
                            
                            // Find matching category (case-insensitive and trim-insensitive)
                            const matchedKey = Object.keys(config.categories).find(
                                key => key.trim().toLowerCase() === val
                            );
                            
                            if (matchedKey) {
                                const catStyle = config.categories[matchedKey];
                                return {
                                    color: catStyle.color || "#1565C0",
                                    weight: catStyle.weight || 3,
                                    fillColor: catStyle.fillColor || "#90CAF9",
                                    fillOpacity: catStyle.fillOpacity !== undefined ? catStyle.fillOpacity : 0.2,
                                    dashArray: catStyle.dashArray || null
                                };
                            }
                            
                            // Fallback to defaultStyle if no match found
                            if (config.defaultStyle) {
                                return {
                                    color: config.defaultStyle.color || "#1565C0",
                                    weight: config.defaultStyle.weight || 3,
                                    fillColor: config.defaultStyle.fillColor || "#90CAF9",
                                    fillOpacity: config.defaultStyle.fillOpacity !== undefined ? config.defaultStyle.fillOpacity : 0.2,
                                    dashArray: config.defaultStyle.dashArray || null
                                };
                            }
                        }

                        // Apply custom style rules or default styles
                        return {
                            color: config.style?.color || "#1565C0",
                            weight: config.style?.weight || 3,
                            fillColor: config.style?.fillColor || "#90CAF9",
                            fillOpacity: config.style?.fillOpacity !== undefined ? config.style.fillOpacity : 0.2,
                            dashArray: config.style?.dashArray || null
                        };
                    },
                    onEachFeature: (feature, layer) => {
                        if (config.popup) {
                            this.popupManager.bindPopup(layer, config.name, feature.properties);
                        }
                    }
                });
            }

            // Register the created layer instance
            this.sidebarManager.registerLayerInstance(config.id, layerInstance);

            // Add layer to the map if configured to be visible by default
            if (config.visible) {
                this.mapManager.addLayer(layerInstance, config.name);
            }

            console.log(`Cargada correctamente: ${config.name} (${config.geometry})`);

        } catch (error) {
            console.error(`Error cargando la capa [${config.name}] desde [${config.file}]:`, error);
            // We create an empty feature group to prevent breaking the map/sidebar
            const emptyGroup = L.featureGroup();
            this.sidebarManager.registerLayerInstance(config.id, emptyGroup);
        }
    }
}
