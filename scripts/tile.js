import { IsometricRenderer } from "./isometric-renderer.js";
import { integrate3DToIso } from "./token.js"; 
import { detectAvailableFacings, getFacingFromRotation, generateGallery } from "./utils.js";

/* -------------------------------------------- */
/*  Tile Configuration Integration              */
/* -------------------------------------------- */

// Attempt AppV2 Integration (V13+)
Hooks.once("ready", () => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;

    // If TileConfig is an ApplicationV2, integrate it properly
    if (foundry.applications.sheets.TileConfig) {
        integrate3DToIso(foundry.applications.sheets.TileConfig);
    }
});

/**
 * Legacy Fallback or V1 Integration 
 * If TileConfig is still V1 (likely, as Tokens were V2 first), this hook handles the jQuery injection.
 * We include the same logic here to support V1-style sheets.
 */
Hooks.on("renderTileConfig", async (app, html, data) => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;

    // Determine the root element. ApplicationV1 passed jQuery, V2 passes HTMLElement.
    // We want vanilla HTMLElement.
    const element = (html instanceof jQuery) ? html[0] : html;

    // Check if tabs exist (Legacy V1 check)
    const nav = element.querySelector("nav.sheet-tabs");
    if (!nav) return;

    const doc = app.document;
    if (!doc) return;
    
    // Check if we already injected (to prevent duplicates)
    if (element.querySelector(".tab[data-tab='isometricModel']")) return;

    // Create the Tab Button
    const tabLabel = game.i18n.localize("3D_TO_ISO.Set3DModel");
    const tabItem = document.createElement("a");
    tabItem.className = "item";
    tabItem.dataset.tab = "isometricModel";
    tabItem.innerHTML = `<i class="fa-solid fa-cube"></i> ${tabLabel}`;
    nav.appendChild(tabItem);

    // Prepare Data for the Template
    const flags = doc.flags?.["3d-to-iso"] || {};
    const availableFacings = flags.availableFacings || [];
    const src = doc.texture?.src;
    
    let gallery = [];
    if (src && availableFacings.length > 0) {
        gallery = generateGallery(availableFacings, src);
    }

    const templateData = {
        isometric: {
            enabled: flags.enabled,
            modelPath: flags.modelPath,
            hasAdjustments: !!flags.adjustments,
            gallery: gallery,
            isUnsaved: !doc.id
        }
    };

    // Render the Token Integration Template (reused)
    const content = await renderTemplate("modules/3d-to-iso/templates/token-integration.hbs", templateData);
    
    // Create Tab Content container
    const tabContent = document.createElement("div");
    tabContent.className = "tab";
    tabContent.dataset.tab = "isometricModel";
    
    // Parse content
    tabContent.innerHTML = content;

    // UI Feedback for Unsaved Tile
    if (!doc.id) {
        const btns = tabContent.querySelectorAll(".open-3d-renderer, .select-token-image");
        btns.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = "0.5";
            btn.style.cursor = "not-allowed";
            btn.title = "Please finish creating the tile before attempting to assign iso sprites to it";
        });
    }

    // Insert Content (before footer/buttons)
    const footer = element.querySelector("footer") || element.querySelector(".sheet-footer");
    if (footer) {
        footer.before(tabContent);
    } else {
        element.appendChild(tabContent);
    }

    // --- Activate Listeners ---
    
    // Open Renderer
    const openBtn = tabContent.querySelector(".open-3d-renderer");
    if (openBtn) {
        openBtn.addEventListener("click", (e) => {
            e.preventDefault();
            if (!doc.id) {
                return ui.notifications.error("Please finish creating the tile before attempting to assign iso sprites to it");
            }
            new IsometricRenderer({ tile: doc }).render(true);
        });
    }

    // File Picker for Model Path
    const filePickers = tabContent.querySelectorAll(".file-picker");
    filePickers.forEach(btn => {
        btn.addEventListener("click", ev => {
            const input = btn.closest(".form-group").querySelector("input");
            new FilePicker({
                type: "model",
                callback: (path) => {
                    input.value = path;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }).browse();
        });
    });
    
    // Setup Facings (Atomic logic from token.js session)
    const selectImgBtn = tabContent.querySelector(".select-token-image");
    if (selectImgBtn) {
        selectImgBtn.addEventListener("click", async (e) => {
            e.preventDefault();

            const currentSrc = doc.texture?.src;
            if (!currentSrc) return ui.notifications.warn("Tile has no image.");
            
            await detectAvailableFacings(doc, currentSrc);
            
            const newFlags = doc.getFlag("3d-to-iso", "availableFacings");
            if (newFlags?.length) {
                ui.notifications.info(`Setup complete. Found ${newFlags.length} facings.`);
            } else {
                 ui.notifications.warn("No facings detected.");
            }
            app.render(true); // Always render to reflect changes
        });
    }

    // Handle Tab Switching
    app.setPosition({ height: "auto" });
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

