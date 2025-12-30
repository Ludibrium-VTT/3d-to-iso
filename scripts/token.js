/**
 * Handles Token-related integration and event handling for the 3D to Isometric module.
 * This includes:
 * 1. Token Configuration sheet integration (tab and rendering).
 * 2. Dynamic texture switching based on token rotation.
 */

import { detectAvailableFacings, getFacingFromRotation, generateGallery } from "./utils.js";

/* -------------------------------------------- */
/*  Token Configuration Integration             */
/* -------------------------------------------- */


/**
 * Reusable integration function for TokenConfig-style applications (V13 ApplicationV2)
 * Now exported for use by Tiles or other Document Configs.
 */
export const integrate3DToIso = (ConfigClass) => {
    if (!ConfigClass || !ConfigClass.PARTS || !ConfigClass.TABS) return;

    // 1. Add the Tab definition
    const label = game.i18n.localize("3D_TO_ISO.Set3DModel");
    const existingTab = ConfigClass.TABS.sheet.tabs.find(t => t.id === "isometricModel");
    if (!existingTab) {
        ConfigClass.TABS.sheet.tabs.push({ id: "isometricModel", label, icon: "fa-solid fa-cube" });
    }

    // 2. Add the part and ensure it renders before the footer
    if (!ConfigClass.PARTS.isometricModel) {
        const footerPart = ConfigClass.PARTS.footer;
        delete ConfigClass.PARTS.footer;
        
        ConfigClass.PARTS.isometricModel = {
            template: "modules/3d-to-iso/templates/token-integration.hbs"
        };
        
        if (footerPart) ConfigClass.PARTS.footer = footerPart;
    }

    // 3. Override _preparePartContext to include our data
    const originalPreparePartContext = ConfigClass.prototype._preparePartContext;
    ConfigClass.prototype._preparePartContext = async function(partId, context, options) {
        if (partId === "isometricModel") {
            const doc = this.document || this.object;
            if (!doc) return originalPreparePartContext.call(this, partId, context, options);

            let actor = this.actor;
            if (!actor && doc) {
                if (doc.documentName === "Actor") actor = doc;
                else if (doc.actor) actor = doc.actor;
                else if (doc.parent && doc.parent.documentName === "Actor") actor = doc.parent;
            }
            
            const targetDoc = doc; 
            
            // Resolve flags source
            let flagDoc = targetDoc;
            
            let isEnabled = !!flagDoc.getFlag("3d-to-iso", "enabled");
            // Special case for Prototype Token
            if (doc.documentName === "Actor") {
                 isEnabled = !!doc.prototypeToken?.flags?.["3d-to-iso"]?.enabled;
            }
            
            const availableFacings = (this._pendingFacings !== undefined) 
                ? this._pendingFacings 
                : ((doc.documentName === "Actor" ? doc.getFlag("3d-to-iso", "availableFacings") : targetDoc.getFlag("3d-to-iso", "availableFacings")) || (actor?.getFlag("3d-to-iso", "availableFacings") || []));
            
            const modelPath = (doc.documentName === "Actor" ? doc.getFlag("3d-to-iso", "modelPath") : targetDoc.getFlag("3d-to-iso", "modelPath")) || (actor?.getFlag("3d-to-iso", "modelPath") || "");
            const hasAdjustments = (doc.documentName === "Actor" ? !!doc.getFlag("3d-to-iso", "adjustments") : !!targetDoc.getFlag("3d-to-iso", "adjustments")) || (actor ? !!actor.getFlag("3d-to-iso", "adjustments") : false);

            let gallery = [];
            
            // Resolve SRC
            let src = (this._pendingSrc) ? this._pendingSrc : (doc.documentName === "Actor" ? doc.prototypeToken?.texture?.src : doc.texture?.src);
            
            if (src && availableFacings.length > 0) {
                gallery = generateGallery(availableFacings, src);
            }

            return {
                ...context,
                tab: context.tabs[partId],
                isometric: {
                    enabled: isEnabled,
                    modelPath: modelPath,
                    hasAdjustments: hasAdjustments,
                    gallery: gallery,
                    isUnsaved: !((doc.id) || (actor && actor.id))
                }
            };
        }
        return originalPreparePartContext.call(this, partId, context, options);
    };

    // 4. Attach event listeners for the button
    const originalOnRender = ConfigClass.prototype._onRender;
    ConfigClass.prototype._onRender = function(context, options) {
        originalOnRender.call(this, context, options);
        
        const html = this.element;
        const btn = html.querySelector(".open-3d-renderer");
        if (btn) {
            const doc = this.document || this.object;
            // Refined Actor Resolution: Ensure we don't pick up Scene as parent
            let actor = this.actor;
            if (!actor && doc) {
                if (doc.documentName === "Actor") actor = doc;
                else if (doc.actor) actor = doc.actor;
                else if (doc.parent && doc.parent.documentName === "Actor") actor = doc.parent;
            }
            
            // Allow if Tile has ID OR if there is an Actor (for Prototype Token) which has ID
            const hasId = (doc?.id) || (actor && actor.id);
            
            if (!hasId) {
                 btn.disabled = true;
                 btn.style.opacity = "0.5";
                 btn.style.cursor = "not-allowed";
                 btn.title = "Please finish creating the document before attempting to assign iso sprites to it";
                 btn.style.pointerEvents = "none";
            }

            btn.addEventListener("click", (event) => {
                event.preventDefault();
                if (!hasId) return ui.notifications.error("Please finish creating the document before attempting to assign iso sprites to it");
                
                if (doc?.documentName === "Tile") {
                      const { IsometricRenderer } = game.modules.get("3d-to-iso").api;
                      new IsometricRenderer({ tile: doc }).render(true);
                      return;
                }

                if (!actor) return ui.notifications.warn("No Actor associated with this token.");
                
                const { IsometricRenderer } = game.modules.get("3d-to-iso").api;
                new IsometricRenderer({ 
                    actor,
                    token: doc
                }).render(true);
            });
        }
        
        // Refresh Facings
        const refreshBtn = html.querySelector(".refresh-facings");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", async (event) => {
                event.preventDefault();
                const src = (doc.documentName === "Actor") ? doc.prototypeToken?.texture?.src : doc.texture?.src;
                if (!src) return ui.notifications.warn("No texture to check.");
                
                // For Tiles, target is doc. For tokens/actors, target is actor usually.
                const targetFlagDoc = (doc.documentName === "Tile") ? doc : actor; 
                
                ui.notifications.info("Scanning for facings...");
                await detectAvailableFacings(targetFlagDoc, src);
                this.render(); // Re-render to show updated gallery
            });
        }

        // New: Setup Facings from Image Button Logic
        const selectImgBtn = html.querySelector(".select-token-image");
        if (selectImgBtn) {
            const doc = this.document || this.object;
            let actor = this.actor;
            if (!actor && doc) {
                if (doc.documentName === "Actor") actor = doc;
                else if (doc.actor) actor = doc.actor;
                else if (doc.parent && doc.parent.documentName === "Actor") actor = doc.parent;
            }
            
            const hasId = (doc?.id) || (actor && actor.id);
            if (!hasId) {
                 selectImgBtn.disabled = true;
                 selectImgBtn.style.opacity = "0.5";
                 selectImgBtn.style.cursor = "not-allowed";
                 selectImgBtn.title = "Please finish creating the document before attempting to assign iso sprites to it";
                 selectImgBtn.style.pointerEvents = "none";
            }

            selectImgBtn.addEventListener("click", async (event) => {
                event.preventDefault();
                if (!hasId) return ui.notifications.error("Please finish creating the document before attempting to assign iso sprites to it");
                
                // Atomic Update Workflow
                new FilePicker({
                    type: "image",
                    callback: async (path) => {
                        ui.notifications.info("Scanning and setting up facings...");

                        // 1. Detect Facings (No Commit)
                        // Use actor if doc is missing (Prototype Token scenario)
                        const targetDetect = (doc?.documentName === "Tile") ? doc : actor;
                         if (!targetDetect) return; // Should be handled by hasId, but safe
                         
                        const result = await detectAvailableFacings(targetDetect, path, { commit: false });
                        
                        // 2. Prepare Atomic Update Data
                        const updateData = {};
                        const isActor = doc?.documentName === "Actor" || !doc; // If no doc, assume actor prototype
                        
                        // Flags
                        updateData["flags.3d-to-iso.modelPath"] = null; // Clear explicit model path
                        
                        if (result.found && result.found.length > 0) {
                            updateData["flags.3d-to-iso.availableFacings"] = result.found;
                            updateData["flags.3d-to-iso.facingMode"] = result.mode;
                            updateData["flags.3d-to-iso.enabled"] = true;
                        } else {
                            updateData["flags.3d-to-iso.availableFacings"] = null;
                            updateData["flags.3d-to-iso.facingMode"] = null;
                        }

                        // 3. Determine Best Texture Path
                        let finalPath = path;
                        if (result.found && result.found.length > 0) {
                            // Prefer NE, then S, then first avilable
                            let bestFacing = result.found[0];
                            if (result.mode === "cardinal") {
                                const ne = result.found.find(f => f.toUpperCase() === "NE");
                                const s = result.found.find(f => f.toUpperCase() === "S");
                                if (ne) bestFacing = ne;
                                else if (s) bestFacing = s;
                            }
                            
                            // Find matching file in gallery logic
                            const gallery = generateGallery(result.found, path);
                            const match = gallery.find(g => g.direction === bestFacing);
                            if (match) finalPath = match.src;
                        }

                        // Texture Key
                        const srcKey = isActor ? "prototypeToken.texture.src" : "texture.src";
                        updateData[srcKey] = finalPath;
                        
                        // Ensure enabled on prototype if Actor
                        if (isActor) {
                            updateData["prototypeToken.flags.3d-to-iso.enabled"] = true;
                        }

                        // 4. Execute Update
                        if (doc) await doc.update(updateData);
                        else if (actor) await actor.update(updateData);
                        
                        ui.notifications.info(`Setup Complete. Found ${result.found.length} facings.`);
                        
                        // Explicitly set pending source so the UI definitely uses the new path,
                        // avoiding stale data if the document clone hasn't refreshed yet.
                        this._pendingSrc = finalPath;
                        this._pendingFacings = result.found;
                        
                        // Force re-render just in case
                        this.render(); 
                    }
                }).browse();
            });
        }

        // Live-update input
        const textureInput = html.querySelector('input[name="texture.src"], input[name="prototypeToken.texture.src"]');
        if (textureInput) {
            textureInput.addEventListener("change", async (event) => {
                const path = event.target.value;
                if (!path) return;
                
                const targetDetect = (doc?.documentName === "Tile") ? doc : actor;
                if (targetDetect) {
                    const result = await detectAvailableFacings(targetDetect, path, { commit: false });
                    this._pendingSrc = path;
                    this._pendingFacings = result.found || [];
                    this.render();
                }
            });
        }

        // Auto-detect available facings ONLY IF MISSING
        const doc = this.document || this.object;
        if (!doc) return;
        const actor = this.actor || (doc?.documentName === "Actor" ? doc : doc?.actor || doc?.parent);
        const targetDetect = (doc.documentName === "Tile") ? doc : actor;
        
        if (targetDetect) {
             const src = (doc.documentName === "Actor") ? doc.prototypeToken?.texture?.src : doc.texture?.src;
             let storedFacings = targetDetect.getFlag("3d-to-iso", "availableFacings");
             
             if (src && (!storedFacings || storedFacings.length === 0)) {
                 detectAvailableFacings(targetDetect, src).then(result => {
                     if (result.changed && this.rendered) {
                          this.render();
                     }
                 });
             }
        }
    };
};

Hooks.once("ready", () => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;

    // Apply to standard TokenConfig
    integrate3DToIso(foundry.applications.sheets.TokenConfig);
    
    // Apply to PrototypeTokenConfig - V13 core location
    integrate3DToIso(foundry.applications.sheets.PrototypeTokenConfig);
});

/* -------------------------------------------- */
/*  Rotation-Based Image Switching              */
/* -------------------------------------------- */

Hooks.on("preUpdateToken", (tokenDoc, update, options, userId) => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;

    // Only proceed if rotation is being updated
    if (update.rotation === undefined) return;

    // Check if this token is managed by 3d-to-iso
    // Check both the token document and its source actor
    const is3d = tokenDoc.getFlag("3d-to-iso", "enabled") || tokenDoc.actor?.getFlag("3d-to-iso", "enabled");
    if (!is3d) return;

    // Get current texture
    let currentSrc = update.texture?.src || tokenDoc.texture.src;
    if (!currentSrc) return;

    // Available facings
    const available = tokenDoc.actor?.getFlag("3d-to-iso", "availableFacings") || ["NE", "NW", "SE", "SW"];
    const mode = tokenDoc.actor?.getFlag("3d-to-iso", "facingMode") || "cardinal";
    
    // Get Target Facing
    const targetFacing = getFacingFromRotation(update.rotation, available, mode);
    if (!targetFacing) return;

    // Construct New Source
    // We use generateGallery to find the correct path for this specific facing
    // Or we rely on simple replacement
    const gallery = generateGallery(available, currentSrc);
    const match = gallery.find(g => g.direction === targetFacing);
    
    if (match) {
        const newSrc = match.src;
         // If the path actually changed, update it in the pending update object
        if (newSrc.toLowerCase() !== currentSrc.split("?")[0].toLowerCase()) {
            if (!update.texture) update.texture = {};
            update.texture.src = newSrc;
        }
    }
});

/**
 * Trigger asset detection when a token's texture is manually updated.
 */
Hooks.on("updateToken", async (tokenDoc, update, options, userId) => {
    if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return; 

    // If the texture path was changed manually
    // Skip detection if this update was triggered by a rotation (which includes texture.src change)
    if (update.texture?.src && update.rotation === undefined) {
        const actor = tokenDoc.actor;
        
        // Clear the model path as it's likely no longer relevant to the new image
        if (actor && !options.from3DApp) {
            await actor.unsetFlag("3d-to-iso", "modelPath");
        }

        const is3d = tokenDoc.getFlag("3d-to-iso", "enabled") || actor?.getFlag("3d-to-iso", "enabled");
        if (is3d && actor) {
            detectAvailableFacings(actor, update.texture.src);
        }
    }
});

