/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   icons.js
   ========================================================== */

/**
 * Creates a Leaflet DivIcon with FontAwesome icons and a custom pin shape.
 * @param {string} iconName - FontAwesome icon name (e.g. "lightbulb", "road", "school")
 * @param {string} markerColor - Color code for the marker background
 * @returns {L.DivIcon} Leaflet DivIcon instance
 */
export function createMarkerIcon(iconName, markerColor) {
    // Elegant Mapbox/ArcGIS-like vector pin shape
    const htmlContent = `
        <div class="custom-marker-pin" style="background-color: ${markerColor};">
            <i class="fa-solid fa-${iconName}"></i>
        </div>
    `;
    
    return L.divIcon({
        html: htmlContent,
        className: 'custom-marker-container',
        iconSize: [36, 42],
        iconAnchor: [18, 42],
        popupAnchor: [0, -36]
    });
}

/**
 * Inject the styles required for custom markers if they don't exist yet
 */
function injectMarkerStyles() {
    if (document.getElementById('custom-marker-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'custom-marker-styles';
    style.innerHTML = `
        .custom-marker-container {
            background: transparent !important;
            border: none !important;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .custom-marker-pin {
            width: 32px;
            height: 32px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            border: 2px solid white;
            box-shadow: 0 3px 8px rgba(0,0,0,0.3);
            transition: all 0.2s ease;
        }
        
        .custom-marker-pin i {
            transform: rotate(45deg);
            font-size: 13px;
        }
        
        .custom-marker-container:hover .custom-marker-pin {
            transform: rotate(-45deg) scale(1.15);
            box-shadow: 0 5px 12px rgba(0,0,0,0.4);
            z-index: 1000 !important;
        }
    `;
    document.head.appendChild(style);
}

// Automatically inject styles upon import
injectMarkerStyles();
