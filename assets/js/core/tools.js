/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   tools.js
   ========================================================== */

import { formatLength, formatArea } from "../utils/helpers.js";

export class ToolManager {
    constructor(mapManager) {
        this.mapManager = mapManager;
        this.map = mapManager.getMap();
        this.drawnItems = new L.FeatureGroup();
        this.locationMarker = null;
        
        // Add layer for drawn features to map
        this.map.addLayer(this.drawnItems);
    }

    /**
     * Initializes toolbar buttons and measurement controls.
     */
    initialize() {
        this.bindToolbarButtons();
        this.setupMeasurementTools();
        this.setupCoordinatesDisplay();
    }

    /**
     * Binds events to existing header toolbar buttons and creates dark mode toggle.
     */
    bindToolbarButtons() {
        const toolbarButtons = document.querySelectorAll(".toolbar button");
        if (toolbarButtons.length >= 4) {
            const homeBtn = toolbarButtons[0];
            const fullscreenBtn = toolbarButtons[1];
            const locationBtn = toolbarButtons[2];
            const printBtn = toolbarButtons[3];

            // 1. Home button
            homeBtn.addEventListener("click", () => {
                this.map.flyTo([13.6768, -89.1914], 13);
            });

            // 2. Fullscreen button
            fullscreenBtn.addEventListener("click", () => {
                this.toggleFullscreen();
            });

            // 3. User Location
            locationBtn.addEventListener("click", () => {
                this.locateUser();
            });

            // 4. Print map
            printBtn.addEventListener("click", () => {
                window.print();
            });
        }

        // 5. Dynamic Dark Mode Toggle creation
        const toolbarContainer = document.querySelector(".toolbar");
        if (toolbarContainer && !document.getElementById("btnDarkMode")) {
            const darkModeBtn = document.createElement("button");
            darkModeBtn.id = "btnDarkMode";
            darkModeBtn.title = "Alternar Tema Oscuro";
            darkModeBtn.innerHTML = `<i class="fa-solid fa-moon"></i>`;
            toolbarContainer.appendChild(darkModeBtn);

            darkModeBtn.addEventListener("click", () => {
                document.body.classList.toggle("dark-theme");
                const isDark = document.body.classList.contains("dark-theme");
                darkModeBtn.innerHTML = isDark ? `<i class="fa-solid fa-sun"></i>` : `<i class="fa-solid fa-moon"></i>`;
            });
        }
    }

    /**
     * Toggles browser fullscreen mode.
     */
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error entering fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Locates the user using GPS/WiFi and flies to their coordinates.
     */
    locateUser() {
        if (!navigator.geolocation) {
            alert("La geolocalización no está soportada por su navegador.");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy;

                if (this.locationMarker) {
                    this.map.removeLayer(this.locationMarker);
                }

                // Create pulse circle marker
                this.locationMarker = L.circle([lat, lng], {
                    radius: Math.min(accuracy, 150),
                    color: '#0B5ED7',
                    fillColor: '#90CAF9',
                    fillOpacity: 0.35,
                    weight: 2
                }).addTo(this.map);

                this.locationMarker.bindPopup(`<b>Tu ubicación</b><br>Precisión: +/- ${Math.round(accuracy)}m`).openPopup();
                this.map.flyTo([lat, lng], 17);
            },
            (error) => {
                alert(`Error obteniendo la ubicación: ${error.message}`);
            },
            { enableHighAccuracy: true }
        );
    }

    /**
     * Sets up Leaflet.draw toolbar and calculates lengths/areas using Turf.js.
     */
    setupMeasurementTools() {
        // Configure draw control
        const drawControl = new L.Control.Draw({
            position: 'topleft',
            edit: {
                featureGroup: this.drawnItems,
                remove: true
            },
            draw: {
                polygon: {
                    allowIntersection: false,
                    showArea: true,
                    shapeOptions: {
                        color: '#dc2626',
                        fillColor: '#fca5a5',
                        fillOpacity: 0.3,
                        weight: 3
                    }
                },
                polyline: {
                    shapeOptions: {
                        color: '#dc2626',
                        weight: 4
                    }
                },
                rectangle: {
                    shapeOptions: {
                        color: '#dc2626',
                        fillColor: '#fca5a5',
                        fillOpacity: 0.3,
                        weight: 3
                    }
                },
                circle: false,
                circlemarker: false,
                marker: false
            }
        });

        this.map.addControl(drawControl);

        // Capture Draw Created events
        this.map.on(L.Draw.Event.CREATED, (e) => {
            const layer = e.layer;
            const type = e.layerType;

            this.drawnItems.addLayer(layer);

            let labelText = "";
            const geojson = layer.toGeoJSON();

            if (type === 'polyline') {
                const length = turf.length(geojson) * 1000; // in meters
                labelText = `📏 <b>Medición de Línea</b><br>Longitud: <b>${formatLength(length)}</b>`;
            } else if (type === 'polygon' || type === 'rectangle') {
                const area = turf.area(geojson); // in square meters
                const perimeter = turf.length(geojson) * 1000;
                labelText = `📐 <b>Medición de Área</b><br>Área: <b>${formatArea(area)}</b><br>Perímetro: <b>${formatLength(perimeter)}</b>`;
            }

            layer.bindPopup(labelText).openPopup();
        });
    }

    /**
     * Displays coordinates on mouse hover at the bottom right.
     */
    setupCoordinatesDisplay() {
        const coordContainer = document.createElement("div");
        coordContainer.id = "coordinatesDisplay";
        coordContainer.style.position = "absolute";
        coordContainer.style.bottom = "10px";
        coordContainer.style.left = "10px";
        coordContainer.style.background = "rgba(255, 255, 255, 0.85)";
        coordContainer.style.padding = "5px 10px";
        coordContainer.style.borderRadius = "4px";
        coordContainer.style.fontSize = "12px";
        coordContainer.style.fontWeight = "600";
        coordContainer.style.color = "var(--text)";
        coordContainer.style.border = "1px solid var(--border)";
        coordContainer.style.zIndex = "999";
        
        // Append inside map container
        const mapEl = document.getElementById("map");
        if (mapEl) {
            mapEl.style.position = "relative";
            mapEl.appendChild(coordContainer);
        }

        window.addEventListener("coordinates", (e) => {
            coordContainer.textContent = `Lat: ${e.detail.lat} | Lng: ${e.detail.lng}`;
        });
    }
}
