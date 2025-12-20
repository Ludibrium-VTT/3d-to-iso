/**
 * Handles Token-related integration and event handling for the 3D to Isometric module.
 * This includes:
 * 1. Token Configuration sheet integration (tab and rendering).
 * 2. Dynamic texture switching based on token rotation.
 */

/* -------------------------------------------- */
/*  Token Configuration Integration             */
/* -------------------------------------------- */
/*  Helpers & Asset Sniffing                    */
/* -------------------------------------------- */

/**
 * Probes the server to see which directional facings exist for a given base texture.
 * Updates the actor flags to cache these findings.
 * @param {Actor} actor 
 * @param {string} currentSrc 
 */
async function sniffAvailableFacings(actor, currentSrc) {
    if (!actor || !currentSrc) return;
    
    // Regex to remove any existing suffix
    const regex = /_(NE|NW|SE|SW|N|E|S|W)(?=\.[^.]+$)/i;
    const base = currentSrc.replace(regex, "");
    const ext = currentSrc.split('.').pop();
    
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const found = [];
    
    // Probe each potential path
    for (const d of directions) {
        const path = `${base}_${d}.${ext}`;
        try {
            const response = await fetch(path, { method: "HEAD" });
            if (response.ok) found.push(d);
        } catch (e) {
            // Silently skip if fetch fails/cors etc
        }
    }
    
    if (found.length > 0) {
        await actor.setFlag("3d-to-iso", "availableFacings", found);
        console.log(`3d-to-iso | Sniffed ${found.length} facings for ${actor.name}: ${found.join(", ")}`);
    } else {
        await actor.unsetFlag("3d-to-iso", "availableFacings");
    }
}

Hooks.once("ready", () => {
    /**
     * Reusable integration function for TokenConfig-style applications (V13 ApplicationV2)
     */
    const integrate3DToIso = (ConfigClass) => {
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
                const doc = this.document;
                const actor = this.actor || (doc?.documentName === "Actor" ? doc : doc?.actor || doc?.parent);
                return {
                    ...context,
                    tab: context.tabs[partId],
                    isometric: {
                        enabled: !!actor?.getFlag("3d-to-iso", "enabled"),
                        modelPath: actor?.getFlag("3d-to-iso", "modelPath") || "",
                        hasAdjustments: !!actor?.getFlag("3d-to-iso", "adjustments")
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
                btn.addEventListener("click", (event) => {
                    event.preventDefault();
                    const doc = this.document;
                    const actor = this.actor || (doc?.documentName === "Actor" ? doc : doc?.actor || doc?.parent);
                    if (!actor) return ui.notifications.warn("No Actor associated with this token.");
                    
                    // Open our custom renderer with the actor and token targeted
                    const { IsometricRenderer } = game.modules.get("3d-to-iso").api;
                    new IsometricRenderer({ 
                        actor,
                        token: doc
                    }).render(true);
                });
            }
        };
    };

    // Apply to standard TokenConfig
    integrate3DToIso(foundry.applications.sheets.TokenConfig);
    
    // Apply to PrototypeTokenConfig - V13 core location
    integrate3DToIso(foundry.applications.sheets.PrototypeTokenConfig);
});

/* -------------------------------------------- */
/*  Rotation-Based Image Switching              */
/* -------------------------------------------- */

Hooks.on("preUpdateToken", (tokenDoc, update, options, userId) => {
    // Only proceed if rotation is being updated
    if (update.rotation === undefined) return;

    // Check if this token is managed by 3d-to-iso
    // Check both the token document and its source actor
    const is3d = tokenDoc.getFlag("3d-to-iso", "enabled") || tokenDoc.actor?.getFlag("3d-to-iso", "enabled");
    if (!is3d) return;

    // Get current texture
    let currentSrc = update.texture?.src || tokenDoc.texture.src;
    if (!currentSrc) return;

    // Determine the new facing based on rotation
    const rotation = (update.rotation % 360 + 360) % 360; // Normalize 0-359
    // Determine the new facing based on rotation (8-direction mapping)
    // 0 is North, 90 is East, etc.
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.floor(((rotation + 22.5) % 360) / 45);
    let targetFacing = directions[index];

    // Smart Fallback: Check if the target facing is actually available
    const available = tokenDoc.actor?.getFlag("3d-to-iso", "availableFacings") || ["NE", "NW", "SE", "SW"];
    let finalFacing = targetFacing;

    if (!available.includes(targetFacing)) {
        // Find the closest available facing
        // We iterate outwards from the target index
        let found = false;
        for (let i = 1; i <= 4; i++) {
            const left = directions[(index - i + 8) % 8];
            const right = directions[(index + i) % 8];
            if (available.includes(left)) { finalFacing = left; found = true; break; }
            if (available.includes(right)) { finalFacing = right; found = true; break; }
        }
        if (!found) return; // No directional images at all?
    }

    // Matches _N, _NE, _E, etc. before the file extension
    const regex = /_(NE|NW|SE|SW|N|E|S|W)(?=\.[^.]+$)/i;
    
    if (regex.test(currentSrc)) {
        const newSrc = currentSrc.replace(regex, `_${finalFacing}`);
        
        // If the path actually changed, update it in the pending update object
        if (newSrc.toLowerCase() !== currentSrc.toLowerCase()) {
            if (!update.texture) update.texture = {};
            update.texture.src = newSrc;
            console.log(`3d-to-iso | Switching texture for ${tokenDoc.name} to ${finalFacing} (${rotation}°)`);
        }
    }
});

/**
 * Trigger asset sniffing when a token's texture is manually updated.
 */
Hooks.on("updateToken", (tokenDoc, update, options, userId) => {
    // If the texture path was changed manually
    if (update.texture?.src) {
        const actor = tokenDoc.actor;
        const is3d = tokenDoc.getFlag("3d-to-iso", "enabled") || actor?.getFlag("3d-to-iso", "enabled");
        if (is3d) {
            sniffAvailableFacings(actor, update.texture.src);
        }
    }
});
