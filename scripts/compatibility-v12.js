import { detectAvailableFacings, generateGallery } from "./utils.js";

/**
 * Helper to inject the Isometric tab into V12 sheets.
 * Barebones integration of Levels-style persistence.
 */
async function injectV12Tab(app, html, options = {}) {
    const element = (html instanceof jQuery) ? html[0] : html;
    
    // Find navigation
    const nav = element.querySelector("nav.sheet-tabs, nav.tabs, nav[data-group]");
    if (!nav || element.dataset.isometricInjected) return;
    element.dataset.isometricInjected = "true";

    // 1. Identify Context and Tab State
    const doc = options.doc || app.document || app.object;
    const isV13 = nav.querySelector('[data-action="tab"]') !== null;
    const group = nav.dataset.group || element.querySelector(".tab[data-tab]")?.dataset?.group;
    
    // Determine if our tab should be active
    const wasActive = app._activeTab === "isometricModel";

    // 2. Inject Tab Link (Nav Item)
    let tabItem = element.querySelector(`.item[data-tab='isometricModel']`);
    if (!tabItem) {
        tabItem = document.createElement("a");
        tabItem.className = "item";
        tabItem.dataset.tab = "isometricModel";
        if (group) tabItem.dataset.group = group;
        if (isV13) tabItem.dataset.action = "tab";
        tabItem.innerHTML = `<i class="fa-solid fa-cube"></i> ${game.i18n.localize("3D_TO_ISO.Set3DModel")}`;
        
        // Simple state sync on click
        tabItem.addEventListener("click", () => {
             app._activeTab = "isometricModel";
             if (app.tabGroups && group) app.tabGroups[group] = "isometricModel";
        });

        nav.appendChild(tabItem);
    }

    // 3. Inject Tab Content Placeholder
    let tabContent = element.querySelector(`.tab[data-tab='isometricModel']`);
    if (!tabContent) {
        tabContent = document.createElement("div");
        tabContent.className = "tab";
        tabContent.dataset.tab = "isometricModel";
        if (group) tabContent.dataset.group = group;

        const refTab = element.querySelector(`.tab[data-tab][data-group="${group}"]`) || 
                      element.querySelector(".tab[data-tab]");
        
        if (refTab) {
            const container = refTab.parentElement;
            const siblings = container.querySelectorAll(":scope > .tab[data-tab]");
            if (siblings.length > 0) siblings[siblings.length - 1].after(tabContent);
            else container.appendChild(tabContent);
        } else {
            const container = element.querySelector(".sheet-body") || (element.tagName === "FORM" ? element : element.querySelector("form")) || element;
            container.appendChild(tabContent);
        }
    }

    // 4. Proactive Activation
    if (wasActive) {
        tabItem.classList.add("active");
        tabContent.classList.add("active");
        app._activeTab = "isometricModel";
    }

    // 5. Data Preparation & Template Rendering
    const isActor = doc.documentName === "Actor";
    const src = isActor ? doc.prototypeToken?.texture?.src : doc.texture?.src;
    
    const templateData = {
        isometric: {
            enabled: doc.getFlag("3d-to-iso", "enabled"),
            modelPath: doc.getFlag("3d-to-iso", "modelPath"),
            hasAdjustments: !!doc.getFlag("3d-to-iso", "adjustments"),
            gallery: generateGallery(doc.getFlag("3d-to-iso", "availableFacings") || [], src || ""),
            isUnsaved: !doc.id
        },
        tab: { group, cssClass: wasActive ? "active" : "" }
    };

    const content = await renderTemplate("modules/3d-to-iso/templates/token-integration.hbs", templateData);
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = content;
    const realTab = tempDiv.firstElementChild;
    tabContent.innerHTML = realTab.innerHTML;
    if (realTab.className) tabContent.className = realTab.className;
    
    // Listeners
    const { IsometricRenderer } = game.modules.get("3d-to-iso").api;
    tabContent.querySelector(".open-3d-renderer")?.addEventListener("click", (e) => {
        e.preventDefault();
        const renderer = new IsometricRenderer(doc.documentName === "Token" ? { token: doc, actor: app.actor } : 
                                             doc.documentName === "Actor" ? { actor: doc } : { tile: doc });
        renderer.parentApp = app;
        renderer.render(true);
    });

    tabContent.querySelector(".select-token-image")?.addEventListener("click", (e) => {
        e.preventDefault();
        new FilePicker({
            type: "image",
            callback: async (path) => {
                await detectAvailableFacings(doc, path);
                const updateData = isActor ? { "prototypeToken.texture.src": path } : { "texture.src": path };
                await doc.update(updateData);
            }
        }).browse();
    });

    // 6. Re-bind Tab Controllers
    if (app._tabs) {
        for (let t of app._tabs) {
            t.bind(element);
            if (wasActive && (!group || t.group === group)) {
                t.activate("isometricModel", {triggerCallback: false});
            }
        }
    }
    app.setPosition({ height: "auto" });
}

export function registerV12TokenSupport() {
    Hooks.on("renderTokenConfig", (app, html) => injectV12Tab(app, html));
    Hooks.on("renderPrototypeTokenConfig", (app, html) => injectV12Tab(app, html));
}

export function registerV12TileSupport() {
    Hooks.on("renderTileConfig", (app, html) => {
        if (!game.settings.get("3d-to-iso", "enableRotationUtils")) return;
        injectV12Tab(app, html);
    });
}
