// Macro: Launch Isometric Renderer
// Type: Script

if (game.modules.get("3d-to-iso")?.active) {
    game.modules.get("3d-to-iso").api.open();
} else {
    ui.notifications.warn("Isometric 3D Model Renderer module is not active.");
}
