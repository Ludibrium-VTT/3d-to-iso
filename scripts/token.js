/**
 * Handles Token-related integration and event handling for the 3D to Isometric module.
 * This includes:
 * 1. Token Configuration sheet integration (tab and rendering).
 * 2. Dynamic texture switching based on token rotation.
 */

/* -------------------------------------------- */
/*  Token Configuration Integration             */
/* -------------------------------------------- */

Hooks.once("ready", () => {
    // V13 ApplicationV2 based TokenConfig
    const TokenConfig = foundry.applications.sheets.TokenConfig;
    if (!TokenConfig) return;

    // 1. Add the Tab definition
    const label = game.i18n.localize("3D_TO_ISO.Set3DModel");
    TokenConfig.TABS.sheet.tabs.push({ id: "isometricModel", label, icon: "fa-solid fa-cube" });

    // 2. Add the part and ensure it renders before the footer
    const footerPart = TokenConfig.PARTS.footer;
    delete TokenConfig.PARTS.footer;
    
    TokenConfig.PARTS.isometricModel = {
        template: "modules/3d-to-iso/templates/token-integration.hbs"
    };
    
    TokenConfig.PARTS.footer = footerPart;

    // 3. Override _preparePartContext to include our data
    const originalPreparePartContext = TokenConfig.prototype._preparePartContext;
    TokenConfig.prototype._preparePartContext = async function(partId, context, options) {
        if (partId === "isometricModel") {
            const actor = this.document.actor;
            return {
                ...context,
                tab: context.tabs[partId],
                isometric: {
                    modelPath: actor?.getFlag("3d-to-iso", "modelPath") || "",
                    hasAdjustments: !!actor?.getFlag("3d-to-iso", "adjustments")
                }
            };
        }
        return originalPreparePartContext.call(this, partId, context, options);
    };

    // 4. Attach event listeners for the button
    const originalOnRender = TokenConfig.prototype._onRender;
    TokenConfig.prototype._onRender = function(context, options) {
        originalOnRender.call(this, context, options);
        
        const html = this.element;
        const btn = html.querySelector(".open-3d-renderer");
        if (btn) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                const actor = this.document.actor;
                if (!actor) return ui.notifications.warn("No Actor associated with this token.");
                
                // Open our custom renderer with the actor and token targeted
                const { IsometricRenderer } = game.modules.get("3d-to-iso").api;
                new IsometricRenderer({ 
                    actor,
                    token: this.document
                }).render(true);
            });
        }
    };
});

/* -------------------------------------------- */
/*  Rotation-Based Image Switching              */
/* -------------------------------------------- */

Hooks.on("preUpdateToken", (tokenDoc, update, options, userId) => {
    // Only proceed if rotation is being updated
    if (update.rotation === undefined) return;

    // Check if this token is managed by 3d-to-iso
    const is3d = tokenDoc.getFlag("3d-to-iso", "enabled");
    if (!is3d) return;

    // Get current texture
    let currentSrc = update.texture?.src || tokenDoc.texture.src;
    if (!currentSrc) return;

    // Determine the new facing based on rotation
    const rotation = (update.rotation % 360 + 360) % 360; // Normalize 0-359
    let facing = "NE";

    // Mapping ranges (standard isometric offsets)
    // NE: 0-90 (Center 45)
    // SE: 90-180 (Center 135)
    // SW: 180-270 (Center 225)
    // NW: 270-360 (Center 315)
    if (rotation >= 0 && rotation < 90) facing = "NE";
    else if (rotation >= 90 && rotation < 180) facing = "SE";
    else if (rotation >= 180 && rotation < 270) facing = "SW";
    else if (rotation >= 270 && rotation < 360) facing = "NW";

    // Use regex to find and replace the facing suffix
    const regex = /_(NE|NW|SE|SW)(?=\.[^.]+$)/i;
    
    if (regex.test(currentSrc)) {
        const newSrc = currentSrc.replace(regex, `_${facing}`);
        
        // If the path actually changed, update it in the pending update object
        if (newSrc !== currentSrc) {
            if (!update.texture) update.texture = {};
            update.texture.src = newSrc;
            console.log(`3d-to-iso | Switching texture for ${tokenDoc.name} to ${facing} (${rotation}°)`);
        }
    }
});
