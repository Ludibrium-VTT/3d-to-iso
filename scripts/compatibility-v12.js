import { detectAvailableFacings, generateGallery } from "./utils.js";
// import { importGif } from "./gif-importer.js";

/**
 * Registers the V12 compatibility hooks for Token Configuration.
 * This injects the Isometric tab into the legacy sheet structure.
 */
export function registerV12TokenSupport() {
    // Register for both standard TokenConfig and PrototypeTokenConfig
    const handler = async (app, html, data) => {
         // V12 passes jQuery object as html
        const element = (html instanceof jQuery) ? html[0] : html;
        
        // Check injection
        if (element.querySelector(".tab[data-tab='isometricModel']")) return;

        const nav = element.querySelector("nav.sheet-tabs");
        if (!nav) return;

        const doc = app.document || app.object; // TokenConfig: object is TokenDocument (or Actor for prototype)
         // Handle Prototype Token
        let actor = app.actor; // Usually available on TokenConfig
        if (!actor && doc) {
            if (doc.documentName === "Actor") actor = doc;
            else if (doc.actor) actor = doc.actor;
        }

        // Create Tab
        const tabLabel = game.i18n.localize("3D_TO_ISO.Set3DModel");
        const tabItem = document.createElement("a");
        tabItem.className = "item";
        tabItem.dataset.tab = "isometricModel";
        // Determine the data-group used by this application
        // Standard TokenConfig uses "main" or "primary". We must match it.
        const navGroup = nav.dataset.group;
        
        tabItem.innerHTML = `<i class="fa-solid fa-cube"></i> ${tabLabel}`;
        // Ensure the tab toggle also has the group (though usually implied by being inside the nav with that group)
        if (navGroup) tabItem.dataset.group = navGroup;
        
        nav.appendChild(tabItem);

         // Prepare Data
         // resolve target for flags
        const targetDoc = doc; 
        
        let flags = {};
        let isEnabled = false;
        let modelPath = "";
        let availableFacings = [];
        let currentSrc = "";
        let hasAdjustments = false;

        // V12 Prototype Token Check
        // If the document is an Actor, we are likely in PrototypeTokenConfig
        // But app.isPrototype is also a good check if available.
        if (doc.documentName === "Actor") {
            // Prototype Token Config
             flags = doc.prototypeToken?.flags?.["3d-to-iso"] || {};
             isEnabled = flags.enabled;
             modelPath = flags.modelPath || "";
             availableFacings = flags.availableFacings || [];
             hasAdjustments = !!flags.adjustments;
             currentSrc = doc.prototypeToken?.texture?.src;
        } else {
             // Standard Token
             flags = doc.flags?.["3d-to-iso"] || {};
             isEnabled = flags.enabled;
             modelPath = flags.modelPath || "";
             availableFacings = flags.availableFacings || [];
             hasAdjustments = !!flags.adjustments;
             currentSrc = doc.texture?.src;
        }
        
        // Fallback to Actor flags for facings if Token doesn't have them?
         if ((!availableFacings || availableFacings.length === 0) && actor) {
             const actorFlags = actor.flags?.["3d-to-iso"];
             if (actorFlags?.availableFacings) availableFacings = actorFlags.availableFacings;
         }

        let gallery = [];
        if (currentSrc && availableFacings.length > 0) {
            gallery = generateGallery(availableFacings, currentSrc);
        }

        // Remove 'active' class from template logic if it attempts to set it, let Foundry handle it
        const templateData = {
            isometric: {
                enabled: isEnabled,
                modelPath: modelPath,
                hasAdjustments: hasAdjustments,
                gallery: gallery,
                isUnsaved: false // Logic below handles button disabling
            },
            // Pass the group to the template
            tab: {
                group: navGroup || "main",
                cssClass: ""
            }
        };

        const content = await renderTemplate("modules/3d-to-iso/templates/token-integration.hbs", templateData);

        // Convert string to DOM node
         const tempDiv = document.createElement("div");
         tempDiv.innerHTML = content;
         const tabContent = tempDiv.firstElementChild;
         
         // Ensure the content matches the group
         if (navGroup) tabContent.dataset.group = navGroup;

        // Insert into .sheet-body so native Tabs controller finds it
        // We append to the END of .sheet-body (standard practice)
        const sheetBody = element.querySelector(".sheet-body");
        if (sheetBody) {
            sheetBody.appendChild(tabContent);
        } else {
            // Fallback (unlikely on standard sheets)
            const footer = element.querySelector("footer");
            if (footer) footer.before(tabContent);
            else element.appendChild(tabContent);
        }

        // Force Tabs controller to re-bind listeners to picking up our new tab
        if (app._tabs?.[0]) {
            app._tabs[0].bind(element);
        }

        // Listeners for Buttons
        // We need to verify if the entity is created (has ID)
        const hasId = (doc?.id) || (actor && actor.id);
        
        // Disable if unsaved
        if (!hasId) {
            tabContent.querySelectorAll("button").forEach(b => {
                 b.disabled = true;
                 b.style.opacity = "0.5";
            });
        }

        // Open Renderer
        const openBtn = tabContent.querySelector(".open-3d-renderer");
        if (openBtn) {
            openBtn.addEventListener("click", (e) => {
                e.preventDefault();
                if (!hasId) return ui.notifications.error("Save document first.");
                
                const { IsometricRenderer } = game.modules.get("3d-to-iso").api;
                 // Logic for passing correct target
                new IsometricRenderer({ 
                     actor: actor,
                     token: (doc.documentName === "Token") ? doc : null 
                }).render(true);
            });
        }
        
        // Setup Facings / Scan
        const selectImgBtn = tabContent.querySelector(".select-token-image");
         if (selectImgBtn) {
             selectImgBtn.addEventListener("click", (e) => {
                  e.preventDefault();
                   new FilePicker({
                       type: "image",
                       callback: async (path) => {
                           // Detect
                           // Determine target for setFlag
                           const target = (doc.documentName === "Actor") ? doc : actor; 
                           
                           if (target) {
                               await detectAvailableFacings(target, path);
                               // We also need to update the Token's texture path!
                               // Simulate update
                               const updateData = {};
                               if (doc.documentName === "Actor") updateData["prototypeToken.texture.src"] = path;
                               else updateData["texture.src"] = path;
                               
                               await doc.update(updateData);
                               
                               // Refresh app if possible, or just re-render generic
                               // app.render(true); // This might be too aggressive if user is editing other things
                           }
                       }
                   }).browse();
             });
         }
         
         // New: Import GIF Logic
         /*
        const importGifBtn = tabContent.querySelector(".import-gif-frames");
        if (importGifBtn) {
            if (!hasId) {
                  importGifBtn.disabled = true;
                  importGifBtn.style.opacity = "0.5";
                  importGifBtn.style.cursor = "not-allowed";
                  importGifBtn.title = "Please finish creating the document before attempting to assign iso sprites to it";
                  importGifBtn.style.pointerEvents = "none";
            }
            
            importGifBtn.addEventListener("click", (e) => {
                 e.preventDefault();
                 const input = document.createElement("input");
                 input.type = "file";
                 input.accept = ".gif";
                 input.onchange = (ev) => {
                      const file = ev.target.files[0];
                      if (file) {
                           const target = (doc?.documentName === "Tile") ? doc : actor;
                           if (target) importGif(file, target);
                      }
                 };
                 input.click();
            });
        }
        */
         
         // handle height
         app.setPosition({ height: "auto" });
    };

    Hooks.on("renderTokenConfig", handler);
    Hooks.on("renderPrototypeTokenConfig", handler);
}

/**
 * Registers the V12 compatibility hooks for Tile Configuration.
 */
export function registerV12TileSupport() {
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
    
        // Check existing tabs to match their group structure
        const existingTab = element.querySelector(".tab[data-tab]");
        const targetGroup = existingTab ? existingTab.dataset.group : (nav.dataset.group || "sheet");

        const templateData = {
            isometric: {
                enabled: flags.enabled,
                modelPath: flags.modelPath,
                hasAdjustments: !!flags.adjustments,
                gallery: gallery,
                isUnsaved: !doc.id
            },
             // Pass the group to the template
             tab: {
                group: targetGroup,
                cssClass: ""
            }
        };
    
        // Render the Token Integration Template (reused)
        const content = await renderTemplate("modules/3d-to-iso/templates/token-integration.hbs", templateData);
        
        // Convert string to DOM node (Template already has the .tab wrapper)
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = content;
        const tabContent = tempDiv.firstElementChild;
        
        // Final sync of data-group (if template rendered something else or empty)
        if (targetGroup) {
            tabContent.dataset.group = targetGroup;
        } else {
            delete tabContent.dataset.group;
        }
    
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
    
        // Insert Content
        // Logic from working example: html.find('.tab').last().after(tabHtml);
        // We find all tabs, grab the last one, and insert our content after it.
        const allTabs = element.querySelectorAll(".tab[data-tab]");
        if (allTabs.length > 0) {
            const lastTab = allTabs[allTabs.length - 1];
            lastTab.after(tabContent);
        } else {
             // Fallbacks if no tabs found (rare)
             const sheetBody = element.querySelector(".sheet-body") || element.querySelector(".window-content");
             if (sheetBody) {
                 sheetBody.appendChild(tabContent);
             } else {
                 const footer = element.querySelector("footer") || element.querySelector(".sheet-footer");
                 if (footer) footer.before(tabContent);
                 else element.appendChild(tabContent);
             }
        }
        
        // Force Tabs controller to re-bind listeners to picking up our new tab
        if (app._tabs?.[0]) {
            app._tabs[0].bind(element);
        }
    
        // --- Activate Listeners ---
        const { IsometricRenderer } = game.modules.get("3d-to-iso").api;

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
}
