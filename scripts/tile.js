import { IsometricRenderer } from "./isometric-renderer.js";
import { integrate3DToIso } from "./token.js"; 
import { detectAvailableFacings, getFacingFromRotation, generateGallery, isV12 } from "./utils.js";

/* -------------------------------------------- */
/*  Tile Configuration Integration              */
/* -------------------------------------------- */

// Attempt AppV2 Integration (V13+)
import { registerV12TileSupport } from "./compatibility-v12.js";

// Attempt AppV2 Integration (V13+)
Hooks.once("ready", () => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;

    // V12 or Legacy V1 Sheet Support
    // We register this unconditionally as a fallback for any non-AppV2 instance (including legacy V12)
    if (isV12()) {
        registerV12TileSupport();
    }

    // If TileConfig is an ApplicationV2, integrate it properly
    if (foundry.applications.sheets?.TileConfig) {
        integrate3DToIso(foundry.applications.sheets.TileConfig);
    }
});

/* -------------------------------------------- */
/*  Tile Rotation Logic                         */
/* -------------------------------------------- */

Hooks.on("preUpdateTile", (tileDoc, update, options, userId) => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;

    // Only proceed if rotation is changing
    if (update.rotation === undefined) return;

    const availableFacings = tileDoc.getFlag("3d-to-iso", "availableFacings");
    if (!availableFacings || availableFacings.length === 0) return;

    const mode = tileDoc.getFlag("3d-to-iso", "facingMode") || "cardinal";
    const finalFacing = getFacingFromRotation(update.rotation, availableFacings, mode);
    
    if (!finalFacing) return; 
    
    const currentSrc = tileDoc.texture.src;
    const gallery = generateGallery(availableFacings, currentSrc);
    const match = gallery.find(g => g.direction === finalFacing);

    if (match) {
        const newSrc = match.src;
        if (newSrc !== currentSrc.split("?")[0]) {
            if (!update.texture) update.texture = {};
            update.texture.src = newSrc;
        }
    }
});

/* -------------------------------------------- */
/*  Tile Asset Detection                        */
/* -------------------------------------------- */

Hooks.on("updateTile", async (tileDoc, update, options, userId) => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;

    // Skip detection if this is a rotation update
    if (update.texture?.src && update.rotation === undefined) {
         const is3d = tileDoc.getFlag("3d-to-iso", "enabled");
         if (is3d) {
             // If manual texture change, re-detect
             if (!options.from3DApp) {
                 // await tileDoc.unsetFlag("3d-to-iso", "modelPath"); // Optional, mimic token.js
             }
             detectAvailableFacings(tileDoc, update.texture.src);
         }
    }
});

