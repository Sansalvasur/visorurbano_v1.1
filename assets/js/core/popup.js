/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   popup.js
   ========================================================== */

import { cleanAttributeName } from "../utils/helpers.js";

export class PopupManager {
    constructor(mapManager) {
        this.mapManager = mapManager;
    }

    /**
     * Binds custom popup to a Leaflet layer.
     * @param {L.Layer} layer - Leaflet vector or marker layer.
     * @param {string} layerName - Display name of the layer.
     * @param {object} properties - Feature properties.
     */
    bindPopup(layer, layerName, properties) {
        if (!properties) return;

        // Custom HTML builder for popup
        const content = this.generateContent(layerName, properties, layer);
        
        layer.bindPopup(content, {
            maxWidth: 320,
            className: 'custom-popup'
        });

        // Add event listener to populate details in the right panel when selected
        layer.on("click", () => {
            this.showInDetailsPanel(layerName, properties);
        });
    }

    /**
     * Generates HTML content for the popup.
     */
    generateContent(layerName, properties, layer) {
        let title = properties.nombre || properties.Name || properties.ID || properties.id || "Elemento";
        // If it's a number, give it a prefix
        if (!isNaN(title)) {
            title = `${layerName} #${title}`;
        }
        
        let tableRows = "";
        let imageHtml = "";
        
        // Filter and add properties to the table
        Object.entries(properties).forEach(([key, val]) => {
            if (val === null || val === undefined || val === "") return;
            
            const cleanKey = cleanAttributeName(key);
            
            // Check if key looks like an image/photo path or URL
            const isImageKey = ["foto", "imagen", "photo", "image", "url_img", "url_foto"].some(k => key.toLowerCase().includes(k));
            const isImageUrl = typeof val === "string" && (val.startsWith("http") || val.endsWith(".jpg") || val.endsWith(".png") || val.endsWith(".jpeg") || val.startsWith("data:image"));
            
            if (isImageKey || isImageUrl) {
                imageHtml = `
                    <div class="popup-image-container">
                        <img src="${val}" alt="${title}" class="popup-image" onerror="this.src='https://placehold.co/300x150?text=Sin+Imagen'">
                    </div>
                `;
            } else if (typeof val !== "object") {
                tableRows += `
                    <tr>
                        <td class="popup-label">${cleanKey}</td>
                        <td class="popup-value">${val}</td>
                    </tr>
                `;
            }
        });

        const popupHtml = `
            <div class="popup-header">
                <i class="fa-solid fa-location-dot"></i>
                <span>${title}</span>
            </div>
            <div class="popup-body">
                <table class="popup-table">
                    <tbody>
                        ${tableRows || `<tr><td colspan="2">Sin atributos disponibles</td></tr>`}
                    </tbody>
                </table>
                ${imageHtml}
            </div>
            <div class="popup-footer">
                <button class="popup-btn popup-btn-secondary" id="popup-zoom-btn">
                    <i class="fa-solid fa-magnifying-glass-plus"></i> Acercar
                </button>
            </div>
        `;

        // We wrap it in a div to attach event listeners after rendering
        const container = document.createElement("div");
        container.innerHTML = popupHtml;

        // Add event listener to the zoom button
        container.querySelector("#popup-zoom-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            if (layer.getBounds) {
                this.mapManager.getMap().fitBounds(layer.getBounds(), { padding: [50, 50] });
            } else if (layer.getLatLng) {
                this.mapManager.getMap().setView(layer.getLatLng(), 18);
            }
        });

        return container;
    }

    /**
     * Shows feature properties in the right information panel.
     */
    showInDetailsPanel(layerName, properties) {
        const infoPanel = document.getElementById("featureInfo");
        if (!infoPanel) return;

        let title = properties.nombre || properties.Name || properties.ID || properties.id || "Elemento";
        if (!isNaN(title)) title = `${layerName} #${title}`;

        let rowsHtml = "";
        let imageHtml = "";

        Object.entries(properties).forEach(([key, val]) => {
            if (val === null || val === undefined || val === "") return;
            const cleanKey = cleanAttributeName(key);
            
            const isImageKey = ["foto", "imagen", "photo", "image", "url_img", "url_foto"].some(k => key.toLowerCase().includes(k));
            
            if (isImageKey) {
                imageHtml = `
                    <div style="margin-top: 15px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border);">
                        <img src="${val}" alt="${title}" style="width:100%; display:block; max-height:220px; object-fit:cover;" onerror="this.src='https://placehold.co/300x150?text=Sin+Imagen'">
                    </div>
                `;
            } else if (typeof val !== "object") {
                rowsHtml += `
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 10px 5px; font-weight: 700; color: var(--text-light); font-size: 13px; text-transform: capitalize;">${cleanKey}</td>
                        <td style="padding: 10px 5px; color: var(--text); font-size: 13px; text-align: right; word-break: break-all;">${val}</td>
                    </tr>
                `;
            }
        });

        infoPanel.innerHTML = `
            <div style="margin-bottom: 15px;">
                <h4 style="font-size: 16px; font-weight: 700; color: var(--primary); margin-bottom: 5px;">${title}</h4>
                <span style="font-size: 12px; color: var(--text-light); text-transform: uppercase; font-weight: 600;">Capa: ${layerName}</span>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                    ${rowsHtml || `<tr><td colspan="2">Sin detalles disponibles</td></tr>`}
                </tbody>
            </table>
            ${imageHtml}
        `;

        // Activate responsive panels if on mobile
        const rightPanel = document.getElementById("infoPanel");
        if (rightPanel) {
            rightPanel.classList.add("active");
        }
    }
}
