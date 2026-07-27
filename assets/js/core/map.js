/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   map.js
========================================================== */

export class MapManager {

    constructor() {

        this.map = null;

        this.baseLayers = {};

        this.overlayLayers = {};

        this.currentBaseLayer = null;

    }

    initialize() {

        // Centro inicial (San Salvador Sur)
        this.map = L.map("map", {

            center: [13.6768, -89.1914],

            zoom: 13,

            zoomControl: false,

            preferCanvas: true

        });

        this.createBaseLayers();

        this.createControls();

        this.events();

        console.log("Mapa inicializado.");

    }

    /*====================================
      MAPAS BASE
    ====================================*/

    createBaseLayers() {

        const osm = L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution:
                    '&copy; OpenStreetMap Contributors',
                maxNativeZoom: 19,
                maxZoom: 22
            }
        );

        const satellite = L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
                attribution:
                    "Esri World Imagery",
                maxNativeZoom: 18,
                maxZoom: 22
            }
        );

        const topo = L.tileLayer(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            {
                attribution:
                    "OpenTopoMap",
                maxNativeZoom: 17,
                maxZoom: 22
            }
        );

        this.baseLayers = {

            "OpenStreetMap": osm,

            "Satélite": satellite,

            "Topográfico": topo

        };

        osm.addTo(this.map);

        this.currentBaseLayer = osm;

    }

    /*====================================
      CONTROLES
    ====================================*/

    createControls() {

        L.control.zoom({

            position: "topright"

        }).addTo(this.map);

        L.control.scale({

            imperial: false,

            metric: true

        }).addTo(this.map);

        L.control.layers(

            this.baseLayers,

            {},

            {

                collapsed: true,

                position: "bottomright"

            }

        ).addTo(this.map);

    }

    /*====================================
      EVENTOS
    ====================================*/

    events() {

        this.map.on("mousemove", (e) => {

            const lat = e.latlng.lat.toFixed(6);

            const lng = e.latlng.lng.toFixed(6);

            window.dispatchEvent(
                new CustomEvent("coordinates", {

                    detail: {

                        lat,

                        lng

                    }

                })
            );

        });

    }

    /*====================================
      CAPAS
    ====================================*/

    addLayer(layer, name) {

        this.overlayLayers[name] = layer;

        layer.addTo(this.map);

    }

    removeLayer(name) {

        if (!this.overlayLayers[name]) return;

        this.map.removeLayer(this.overlayLayers[name]);

    }

    setLayerOpacity(name, opacity) {

        const layer = this.overlayLayers[name];

        if (!layer) return;


        if (typeof layer.setStyle === "function") {

            // For GeoJSON lines and polygons

            layer.setStyle({

                opacity: opacity,

                fillOpacity: opacity * 0.45

            });

        } else if (typeof layer.setOpacity === "function") {

            // For individual layer markers

            layer.setOpacity(opacity);

        } else if (layer.eachLayer) {

            // For layer groups and marker clusters

            layer.eachLayer((childLayer) => {

                if (typeof childLayer.setOpacity === "function") {

                    childLayer.setOpacity(opacity);

                } else if (typeof childLayer.setStyle === "function") {

                    childLayer.setStyle({

                        opacity: opacity,

                        fillOpacity: opacity * 0.45

                    });

                }

            });

        }

    }

    zoomToLayer(layer) {

        try {

            this.map.fitBounds(layer.getBounds(), {

                padding: [40, 40]

            });

        }

        catch {

            console.warn("La capa no tiene límites.");

        }

    }

    clearLayers() {

        Object.values(this.overlayLayers).forEach(layer => {

            this.map.removeLayer(layer);

        });

        this.overlayLayers = {};

    }

    getMap() {

        return this.map;

    }

}