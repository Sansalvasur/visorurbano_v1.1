/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   colors.js
   ========================================================== */

/**
 * Converts a hex color string to rgba format.
 * @param {string} hex - HEX color string (e.g. "#1565C0")
 * @param {number} alpha - Opacity value from 0 to 1
 * @returns {string} rgba color string
 */
export function hexToRgba(hex, alpha = 1) {
    if (!hex) return "rgba(0, 0, 0, 0)";
    
    // Normalize short hex codes (e.g. #FFF)
    let cleanHex = hex.replace("#", "");
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split("").map(char => char + char).join("");
    }
    
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Default color palette for the GIS layers
 */
export const LayerColors = {
    municipio: "#1565C0",
    cantones: "#43A047",
    calles: "#616161",
    rutas: "#FB8C00",
    luminarias: "#FDD835",
    baches: "#E53935",
    centros: "#3949AB",
    planmol: "#00897B",
    primary: "#0B5ED7",
    secondary: "#1f2937"
};
