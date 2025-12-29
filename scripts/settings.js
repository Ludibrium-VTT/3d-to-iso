Hooks.once("init", () => {
    game.settings.register("3d-to-iso", "tokenSavePath", {
        name: "Token Save Path",
        hint: "Directory where token isometric renders will be saved.",
        scope: "world",
        config: true,
        type: String,
        default: "isometric-renders/tokens",
        filePicker: "folder"
    });

    game.settings.register("3d-to-iso", "tileSavePath", {
        name: "Tile Save Path",
        hint: "Directory where tile isometric renders will be saved.",
        scope: "world",
        config: true,
        type: String,
        default: "isometric-renders/tiles",
        filePicker: "folder"
    });

    game.settings.register("3d-to-iso", "projectionType", {
        name: "Projection Type",
        hint: "Select the projection method. True Isometric uses ~35.26° (standard engineering), Dimetric uses 30° (common in pixel art/games).",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "isometric": "True Isometric (35.264°)",
            "dimetric": "Dimetric (30°)"
        },
        default: "isometric"
    });
});

/* -------------------------------------------- */
/*  Settings Footer                             */
/* -------------------------------------------- */

Hooks.on("renderSettingsConfig", (app, html, data) => {
    // 1. Define Footer Content
    const footerContent = `
    <div class="form-group settings-footer" style="flex: 100%; text-align: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-border-light-2);">
        <p style="margin-bottom: 5px;">Developed by <a href="https://github.com/Ludibrium-VTT" target="_blank">Ludibrium VTT</a></p>
        <p style="margin: 0;">
            <a href="https://discord.gg/2Naz5966Up" target="_blank" style="margin-right: 10px;"><i class="fab fa-discord"></i> Discord</a>
            <a href="https://www.patreon.com/cw/LudibriumVTT" target="_blank"><i class="fab fa-patreon"></i> Patreon</a>
        </p>
    </div>
    `;

    // 2. Helper to handle jQuery vs HTMLElement
    const el = (html instanceof jQuery) ? html[0] : html;

    // 3. Find the Anchor
    // We append after the last setting of this module.
    // Changing "projectionType" to the actual last setting key if it changes.
    const lastSettingKey = "3d-to-iso.projectionType";
    const lastInput = el.querySelector(`[name="${lastSettingKey}"]`);

    if (lastInput) {
        const formGroup = lastInput.closest(".form-group");
        if (formGroup) {
            // Create wrapper
            const div = document.createElement("div");
            div.innerHTML = footerContent;
            formGroup.after(div.firstElementChild);
        }
    }
});
