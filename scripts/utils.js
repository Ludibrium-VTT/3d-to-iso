/**
 * Shared utility functions for 3D to Isometric module.
 * Centralizes logic for asset detection, string parsing, and rotation mapping.
 */

export const CARDINALS_8 = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
export const CARDINALS_16 = [
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE"
];

/**
 * Parses a file path to identify its base name and potential directional suffix.
 * @param {string} path - The full file path or filename.
 * @returns {Object} { base, suffix, ext, isNumeric, isCardinal }
 */
export function parsePath(path) {
    if (!path) return null;
    
    // Clean URL
    const cleanSrc = path.split("?")[0];
    const decodedSrc = decodeURIComponent(cleanSrc); // Handle encoded spaces/chars
    const lastDotIndex = decodedSrc.lastIndexOf(".");
    if (lastDotIndex === -1) return null;

    const fullPathWithoutExt = decodedSrc.substring(0, lastDotIndex);
    const ext = decodedSrc.substring(lastDotIndex + 1);
    const fileName = fullPathWithoutExt.split("/").pop(); // Just the filename part

    // Regex to detect suffixes
    // Matches _N, _NE, etc. (Subject to false positives if filename implies it, but standard convention expected)
    // Matches _001, _15 (Numeric)
    
    let suffix = "";
    let isCardinal = false;
    let isNumeric = false;

    // Check strict endings first
    // Sort Cardinals by length descending to ensure we match "SSW" before "S" (just in case)
    const sortedCardinals = [...CARDINALS_16].sort((a, b) => b.length - a.length);

    for (const card of sortedCardinals) {
        if (fileName.toUpperCase().endsWith(`_${card}`)) {
            suffix = fileName.substring(fileName.length - card.length); // Extract exact case used
            isCardinal = true;
            break;
        }
    }

    if (!isCardinal) {
        // Check Numeric
        // Matches _(digits) at end
        // Only 1-3 digits usually? Let's verify robustness.
        const match = fileName.match(/_(\d{1,4})$/);
        if (match) {
            suffix = match[1];
            isNumeric = true;
        }
    }

    // Base reconstruction
    let base = fullPathWithoutExt;
    if (suffix) {
        base = fullPathWithoutExt.substring(0, fullPathWithoutExt.length - (suffix.length + 1));
    }

    return {
        base,
        fileName,
        suffix,
        ext,
        isCardinal,
        isNumeric
    };
}

/**
 * Probes the server to see which directional facings exist for a given base texture.
 * Implements strict mode: if currentSrc implies a specific mode, it only looks for that mode.
 * @param {Document} doc - Actor or Tile document (for logging/flags context)
 * @param {string} currentSrc - The current texture path
 * @returns {Promise<{found: string[], changed: boolean, mode: string}>}
 */
export async function detectAvailableFacings(doc, currentSrc, options = { commit: true }) {
    if (!doc || !currentSrc) return { found: [], changed: false, mode: "cardinal" };

    const parsed = parsePath(currentSrc);
    if (!parsed) return { found: [], changed: false, mode: "cardinal" };

    // Strict Mode Determination
    let targetMode = null; // null = auto/both
    if (parsed.isCardinal) targetMode = "cardinal";
    if (parsed.isNumeric) targetMode = "numeric";

    // Debug Log
    // console.log(`3d-to-iso | Detect ${parsed.fileName} -> Mode: ${targetMode || "Auto"} (Suffix: ${parsed.suffix})`);

    // Parent Directory Resolution
    let parentDir = "";
    const lastSlash = parsed.base.lastIndexOf("/");
    if (lastSlash > -1) {
        parentDir = parsed.base.substring(0, lastSlash);
    }

    // Base Filename for matching
    // parsed.base is "path/to/token". We need "token" for browsing.
    const baseName = parsed.base.substring(lastSlash + 1); // decode not needed, parsePath decoded it
    const ext = parsed.ext;

    const foundCardinals = [];
    const foundNumbers = [];

    try {
        const result = await FilePicker.browse("data", parentDir);
        const files = result.files || [];

        for (const file of files) {
            const decodedFile = decodeURIComponent(file);
            const fileName = decodedFile.split("/").pop();

            // Must check base name match
            if (!fileName.startsWith(baseName + "_")) continue;
            // Check extension (last dot)
            if (!fileName.toLowerCase().endsWith("." + ext.toLowerCase())) continue;

            // Extract Suffix
            const fileSuffix = fileName.substring(baseName.length + 1, fileName.length - (ext.length + 1));

            // Check Cardinal
            if (CARDINALS_16.includes(fileSuffix.toUpperCase())) {
                if (targetMode === "numeric") continue; // Strict Mode Ignore
                foundCardinals.push(fileSuffix.toUpperCase());
            } 
            // Check Numeric
            else if (/^\d{1,4}$/.test(fileSuffix)) {
                if (targetMode === "cardinal") continue; // Strict Mode Ignore
                foundNumbers.push(fileSuffix);
            }
        }

    } catch (e) {
        console.warn("3D-to-ISO | Failed to browse directory for facings:", e);
    }

    let found = [];
    let mode = "cardinal";

    // Decision Logic
    if (targetMode === "cardinal") {
        found = foundCardinals;
        mode = "cardinal";
    } else if (targetMode === "numeric") {
        found = foundNumbers;
        mode = "numeric";
    } else {
        // Fallback Priority: Cardinal > Numeric
        if (foundCardinals.length > 0) {
            found = foundCardinals;
            mode = "cardinal";
        } else if (foundNumbers.length > 0) {
            found = foundNumbers;
            mode = "numeric";
        }
    }

    // Sorting
    if (mode === "numeric") {
        found.sort((a, b) => parseInt(a) - parseInt(b)); // Sort numerically
    } else {
        found.sort((a, b) => CARDINALS_16.indexOf(a) - CARDINALS_16.indexOf(b));
    }

    // Update Flags
    const currentFlags = doc.getFlag("3d-to-iso", "availableFacings") || [];
    const currentMode = doc.getFlag("3d-to-iso", "facingMode") || "cardinal";

    const changed = found.length !== currentFlags.length || 
                   !found.every((f, i) => f === currentFlags[i]) ||
                   mode !== currentMode;

    if (options.commit && changed) {
        if (found.length > 0) {
             await doc.setFlag("3d-to-iso", "availableFacings", found);
             await doc.setFlag("3d-to-iso", "facingMode", mode);
             console.log(`3d-to-iso | Detected ${found.length} facings (${mode}) for ${doc.name || doc.id}`);
        } else {
             await doc.unsetFlag("3d-to-iso", "availableFacings");
             await doc.unsetFlag("3d-to-iso", "facingMode");
        }
    }
    
    return { found, changed, mode };
}

/**
 * Calculates the correct facing suffix based on rotation and available assets.
 * @param {number} rotation - The rotation in degrees.
 * @param {string[]} availableFacings - List of available facing suffixes.
 * @param {string} mode - "cardinal" or "numeric".
 * @returns {string|null} The target facing suffix, or null if no match potential.
 */
export function getFacingFromRotation(rotation, availableFacings, mode) {
    if (!availableFacings || availableFacings.length === 0) return null;

    // Normalize rotation
    const rot = (rotation % 360 + 360) % 360;
    
    let targetFacing = "";

    if (mode === "numeric") {
        // Map 360 degrees to N frames
        // Frame 0 = South (0 deg).
        const total = availableFacings.length;
        const step = 360 / total;
        const index = Math.round(rot / step) % total;
        targetFacing = availableFacings[index];
    } else {
        // Cardinal (16-way max)
        const step = 360 / 16;
        const index = Math.floor(((rot + 11.25) % 360) / 22.5);
        targetFacing = CARDINALS_16[index];
    }

    // Find Match (Case insensitive + Spiral Search fallback)
    let match = availableFacings.find(f => f.toLowerCase() === targetFacing.toLowerCase());
    
    if (match) return match;

    // Spiral Fallback (Find nearest available)
    // Only makes sense for Cardinal actually, as Numeric is usually contiguous 
    // but we can treat availableFacings as the valid set.
    
    if (mode === "cardinal") {
        const fullCircle = CARDINALS_16;
        let currentIndex = fullCircle.indexOf(targetFacing);
        if (currentIndex === -1) currentIndex = 0; // standard fallback

        for (let i = 1; i <= 8; i++) {
            const rightIndex = (currentIndex + i) % 16;
            const leftIndex = (currentIndex - i + 16) % 16;
            
            const rightDir = fullCircle[rightIndex];
            const leftDir = fullCircle[leftIndex];
            
            const rightMatch = availableFacings.find(f => f.toUpperCase() === rightDir);
            if (rightMatch) return rightMatch;

            const leftMatch = availableFacings.find(f => f.toUpperCase() === leftDir);
            if (leftMatch) return leftMatch;
        }
    } else {
       // Numeric Fallback? Just return closest index available?
       // If strictly calculated index is missing, we might return [0]. 
       // Assume integrity.
    }

    return availableFacings[0];
}

/**
 * Generates gallery objects for the config sheet.
 * @param {string[]} availableFacings 
 * @param {string} currentSrc 
 * @returns {Array<{direction: string, src: string}>}
 */
export function generateGallery(availableFacings, currentSrc) {
    if (!currentSrc || !availableFacings || availableFacings.length === 0) return [];

    const parsed = parsePath(currentSrc);
    if (!parsed) return [];

    // Base is parsed.base (full path prefix)
    // We construct new paths
    
    // Sort Order
    let orderedFacings = [...availableFacings];
    const isCardinal = availableFacings.some(f => CARDINALS_16.includes(f.toUpperCase()));
    
    if (isCardinal) {
        // Sort by standard compass order
        orderedFacings = CARDINALS_16.reduce((acc, d) => {
             const match = availableFacings.find(f => f.toUpperCase() === d);
             if (match) acc.push(match);
             return acc;
        }, []);
    } else {
        orderedFacings.sort((a,b) => parseInt(a) - parseInt(b));
    }

    return orderedFacings.map(d => ({
        direction: d,
        src: `${parsed.base}_${d}.${parsed.ext}`
    }));
}
