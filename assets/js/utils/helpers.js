/* ==========================================================
   VISOR URBANO SAN SALVADOR SUR
   helpers.js
   ========================================================== */

/**
 * Formats an area in square meters into a human-readable string (km², m²).
 * @param {number} squareMeters - The area in square meters.
 * @returns {string} Formatted area string.
 */
export function formatArea(squareMeters) {
    if (squareMeters === undefined || squareMeters === null || isNaN(squareMeters)) {
        return "0 m²";
    }
    if (squareMeters >= 1000000) {
        return (squareMeters / 1000000).toFixed(2) + " km²";
    } else if (squareMeters >= 10000) {
        // Option to display in hectares
        return (squareMeters / 10000).toFixed(2) + " ha";
    } else {
        return squareMeters.toFixed(2) + " m²";
    }
}

/**
 * Formats a length in meters into a human-readable string (km, m).
 * @param {number} meters - The length in meters.
 * @returns {string} Formatted length string.
 */
export function formatLength(meters) {
    if (meters === undefined || meters === null || isNaN(meters)) {
        return "0 m";
    }
    if (meters >= 1000) {
        return (meters / 1000).toFixed(2) + " km";
    } else {
        return meters.toFixed(2) + " m";
    }
}

/**
 * Normalizes property keys to look clean in popup tables.
 * Replaces underscores/hyphens and capitalizes words.
 * @param {string} name - Raw attribute/property name.
 * @returns {string} Clean name.
 */
export function cleanAttributeName(name) {
    if (!name) return "";
    
    // Ignore internal keys
    const ignored = ["objectid", "id", "fid", "shape_leng", "shape_area"];
    if (ignored.includes(name.toLowerCase())) {
        return name.toUpperCase();
    }
    
    return name
        .replace(/_/g, " ")
        .replace(/-/g, " ")
        .trim()
        .toLowerCase()
        .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Capitalizes the first letter of each word in a string.
 * @param {string} str - Input string.
 * @returns {string} Capitalized string.
 */
export function capitalizeWords(str) {
    if (!str) return "";
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
