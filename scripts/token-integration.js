/**
 * Handles integration with Foundry VTT Token/Actor configuration menus.
 */

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
