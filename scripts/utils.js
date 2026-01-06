/**
 * Shared utility functions for 3D to Isometric module.
 * Centralizes logic for asset detection, string parsing, and rotation mapping.
 */
// V13 Compatibility: Resolve FilePicker implementation
// V13 Compatibility: Resolve FilePicker implementation safely
const FilePickerApp = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;

export const CARDINALS_8 = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
export const CARDINALS_16 = [
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE"
];

export function isV12() {
    return game.release.generation === 12;
}

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
 * Helper to probe image existence if browsing fails.
 */
async function checkImageExists(url) {
    try {
        const res = await fetch(url, { method: "HEAD" });
        return res.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Probes the server to see which directional facings exist for a given base texture.
 * Utilizes FilePicker.browse to avoid 404 console errors.
 * @param {Document} doc - Actor or Tile document (for logging/flags context)
 * @param {string} currentSrc - The current texture path
 * @returns {Promise<string[]>}
 */
export async function detectAvailableFacings(doc, currentSrc, options = { commit: true }) {
    if (!currentSrc) return [];

    const parsed = parsePath(currentSrc);
    if (!parsed) return [];

    // 1. Sanitize Path
    let parentDir = "";
    const lastSlash = parsed.base.lastIndexOf("/");
    // parsed.base includes the directory path structure, we want the folder.
    if (lastSlash > -1) {
        parentDir = parsed.base.substring(0, lastSlash);
    }
    
    // Explicitly handle URL origins if they leaked into parsed.base or original src
    try {
        if (currentSrc.startsWith("http") || currentSrc.startsWith("//")) {
             const urlObj = new URL(currentSrc, window.location.href);
             let cleanPath = decodeURIComponent(urlObj.pathname);
             // Strip leading slash
             if (cleanPath.startsWith("/")) cleanPath = cleanPath.substring(1);
             // Split to get dir
             const ls = cleanPath.lastIndexOf("/");
             if (ls > -1) parentDir = cleanPath.substring(0, ls);
             else parentDir = "";
        }
    } catch(e) {}

    const baseName = parsed.base.split("/").pop();
    const ext = parsed.ext;

    // Strict Mode: Match the mode of the source image
    let targetMode = null;
    if (parsed.isNumeric) targetMode = "numeric";
    else if (parsed.isCardinal) targetMode = "cardinal";

    const foundFacings = new Set();
    let detectedMode = targetMode || "cardinal"; // Default

    try {
        const result = await FilePickerApp.browse("data", parentDir);
        const files = result.files || [];

        // 2. Filter & Identify
        for (const file of files) {
            const decodedFile = decodeURIComponent(file);
            const fileName = decodedFile.split("/").pop();

            // A. Check Base Name prefix
            if (!fileName.startsWith(baseName + "_")) continue;

            // B. Check Extension
            if (!fileName.toLowerCase().endsWith("." + ext.toLowerCase())) continue;

            // C. Extract Suffix
            const suffix = fileName.substring(baseName.length + 1, fileName.length - (ext.length + 1));

            // D. Classify Suffix
            const suffixUpper = suffix.toUpperCase();
            let fileMode = null;
            
            // Is it a known Cardinal?
            if (CARDINALS_16.includes(suffixUpper)) {
                fileMode = "cardinal";
            } 
            // Is it Numeric?
            else if (/^\d{1,4}$/.test(suffix)) {
                 fileMode = "numeric";
            }

            if (!fileMode) continue;

            // Strict Filter: If we know the source mode, Ignore files of other modes
            if (targetMode && fileMode !== targetMode) continue;

            foundFacings.add(fileMode === "cardinal" ? suffixUpper : suffix);
            
            // If we didn't have a target mode (source was plain), we infer from what we find.
            // Priority: If we find numeric, switch to numeric? Or keep default?
            // Usually plain base -> Cardinal is safer default, but if only numeric exist...
            if (!targetMode) detectedMode = fileMode;
        }

    } catch (e) {
        console.warn("3D-to-ISO | Failed to browse directory:", e);
    }

    const found = Array.from(foundFacings);

    // Sort
    if (found.some(f => /^\d+$/.test(f))) {
         found.sort((a, b) => parseInt(a) - parseInt(b));
    } else {
         found.sort((a,b) => CARDINALS_16.indexOf(a) - CARDINALS_16.indexOf(b));
    }

    // Commit
    if (options.commit && doc) {
        const existing = doc.getFlag("3d-to-iso", "availableFacings") || [];
        const changed = existing.length !== found.length || !found.every(f => existing.includes(f));

        if (changed) {
            await doc.setFlag("3d-to-iso", "availableFacings", found);
            await doc.setFlag("3d-to-iso", "facingMode", detectedMode);
            console.log(`3d-to-iso | Discovered ${found.length} facings in ${parentDir} (Mode: ${detectedMode})`);
        }
    }
    
    return { found };
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

/**
 * Universal helper to assign 3D-to-ISO state to a document.
 * Handles the differences between Acotrs and Tokens, and ensures atomic updates.
 * 
 * @param {Document} doc - The target document (Actor, TokenDocument, or TileDocument)
 * @param {string} path - The base texture path to use (e.g. "path/to/token.png" or "path/to/token_000.png")
 * @param {string[]} facings - Array of available facings (e.g. ["N", "S"] or ["000", "001"])
 * @param {string} mode - "cardinal" or "numeric"
 * @param {boolean} [commit=true] - Whether to execute the update
 * @returns {Promise<object>} The update data object
 */
export async function assignFacings(doc, path, facings, mode, commit = true, extraFlags = {}, updateContext = {}) {
    if (!doc || !path) return {};

    const updateData = {};
    const isActor = doc.documentName === "Actor";

    // 1. Determine safe "best" starting texture
    // Even if we have facings, we need to pick ONE to set as the active image.
    // If 'path' itself is one of the facings, great. If not, we try to pick "S" or "0".
    
    let finalPath = path;
    const gallery = generateGallery(facings, path);
    
    if (facings && facings.length > 0) {
        let bestFacing = facings[0];
        
        // Prefer South 
        if (mode === "cardinal") {
             const s = facings.find(f => f.toUpperCase() === "S");
             const ne = facings.find(f => f.toUpperCase() === "NE"); // Fallback preference
             if (s) bestFacing = s;
             else if (ne) bestFacing = ne;
        } else {
             // For numeric, usually 0 is fine (South-ish)
             // Or whatever is first
        }
        
        // Find correct filename for this facing from gallery logic
        const match = gallery.find(g => g.direction === bestFacing);
        if (match) finalPath = match.src;
    }

    // 2. Build Flags (Flat Structure)
    // Handle modelPath: If provided in extraFlags, use it. Otherwise nullify it (default behavior for new import).
    if (extraFlags.modelPath !== undefined) {
        updateData["flags.3d-to-iso.modelPath"] = extraFlags.modelPath;
    } else {
        updateData["flags.3d-to-iso.modelPath"] = null;
    }

    updateData["flags.3d-to-iso.availableFacings"] = (facings && facings.length) ? facings : null;
    updateData["flags.3d-to-iso.facingMode"] = (facings && facings.length) ? mode : null;
    updateData["flags.3d-to-iso.enabled"] = (facings && facings.length > 0);

    // Merge other extra flags
    for (const [key, value] of Object.entries(extraFlags)) {
        if (key !== "modelPath") {
             updateData[`flags.3d-to-iso.${key}`] = value;
        }
    }

    // 3. Build Texture Update (Flat Structure)
    if (isActor) {
        updateData["prototypeToken.texture.src"] = finalPath;
        updateData["prototypeToken.flags.3d-to-iso.enabled"] = true;
    } else {
        updateData["texture.src"] = finalPath;
    }

    if (commit) {
        await doc.update(updateData, updateContext);
    }

    return updateData;
}
