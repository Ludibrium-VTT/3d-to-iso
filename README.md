# 3D to Isometric

**3D to Iso** is a Foundry VTT module that bridges the gap between 3D assets and isometric gameplay. It allows you to import 3D models (GLB/GLTF), apply stylistic shaders, and render them into a series of isometric sprites. These sprites can be used for Tokens or Tiles, and the module automatically handles sprite switching based on token rotation, simulating a 3D presence in an isometric scene.

This module is designed to work seamlessly with **Isometric Perspective** and other isometric tools.
> [!NOTE]
> **Foundry V13 & V12 Compatibility**
> While this module is primarily designed for Foundry V13, compatibility patches have been introduced to support Foundry V12. Please note that V12 support is a secondary focus and some advanced features may be optimized for V13.

## Key Features

- **3D Model Import**: Load `.glb` or `.gltf` models directly into your Token or Tile configuration. More model formats will be added in future, but I've kept it simple for now.
- **Isometric Rendering**: Converts 3D models into pre-rendered 2D isometric sprites.
- **Automatic Facing Integration**: Generated sprites are automatically assigned to directional facings. Rotating your token in-game instantly swaps to the correct sprite, creating a seamless pseudo-3D effect.
- **Renderer Studio**: A dedicated interface to fine-tune your assets before rendering:
  - **Camera Controls**: Zoom, Pan, and Rotate your model to get the perfect angle.
  - **Global & Per-Facing Adjustments**: Use "Link Rotations" to orient the entire model globally, or tweak specific facings individually.
  - **Lighting Control**: Adjust the ambient light intensity to match your scene's mood.
  - **Shaders**: Apply post-processing effects like **Sepia**, **Pixelation**, and **Sketch** styles to match your aesthetic.
  - **Output Resolution**: Customizable resolution options (Default 256px for Tiles, 1024px for Tokens).
- **Numeric & Cardinal Modes**: Support for standard 8-way cardinal facings or high-fidelity numeric rotation sequences.

## Configuration
Before using the module, please configure the global settings in **Game Settings > Configure Settings > Module Settings > 3D to Iso**:

- **File Output Path**: Specify the folder where generated isometric sprites will be saved (e.g., `worlds/my-world/iso-tokens`).
- **Projection Type**: Choose between **True Isometric** (Standard 35.264°) or **Dimetric** (Often used in pixel art, ~30° or 2:1 pixel ratio) to match your game's aesthetic and other art assets you might want to use.

## How to Use

### For Tokens
1. Open the **Token Configuration** (or Prototype Token Config).
2. Navigate to the **Iso3D** tab.
3. Click **"Open 3D Renderer"**.
4. Select a 3D model using the file picker (or the asset browser if you have 3D Canvas Token Collection installed).
5. Adjust the model's orientation, lighting, and style settings.
6. Click **"Process and Assign"**. The module will automatically generate sprites for all directions and assign them to the token.

### For Tiles
1. Create a Tile and open its configuration.
2. **Ensure the Tile is Saved**: The renderer requires a saved document to function. (Unsaved tiles from the Create Tile tool will show disabled buttons with a warning).
3. Go to the **Iso3D** tab and follow the same rendering process.
4. The Tile will now rotate visually when its rotation property is changed!

### Adjusting the Pivot Point
Sometimes a 3D model's origin point is not at its feet or center of mass, causing it to "wobble" or float off-center when rotated isometrically. Use the **Pivot Tool** to fix this:
1. Click the **Set Pivot** button (Crosshair icon) in the renderer toolbar.
2. The view will switch to a top-down alignment and the model will reset to neutral rotation.
3. A draggable **Pivot Handle** will appear at the center of the screen.
4. Drag the handle to the location on the model that should be the center (usually between the feet).
5. Click the **Set Pivot** button again to confirm. The model will now rotate around this new point.

## Standalone Usage
If you prefer not to have `3d-to-iso` manage your token art automatically (or if you have disabled "Enable Rotation & Management Utils" in settings), you can still use the renderer to generate assets.

### Accessing via Macro
You can launch the renderer programmatically using a macro. You can also pass options like `resolution` or `modelPath` directly if you want to override defaults or don't have a configured document.

```javascript
const { IsometricRenderer } = game.modules.get("3d-to-iso").api;

new IsometricRenderer({
    resolution: "512",                     // Optional: Override default resolution
    modelPath: "path/to/my_model.glb",     // Optional: Pre-load a specific model
    savePath: "custom-iso-folder"          // Optional: Override default save location
}).render(true);
```

### Save Locations
When running in standalone mode (without a target Token/Tile), the renderer will save images to the default locations configured in the module settings:
- **Tokens**: `[World Path]/isometric-renders/tokens`
- **Tiles**: `[World Path]/isometric-renders/tiles`

## Using External Sprites
You don't have to use the built-in renderer! If you have sprites from other sources (like Blender renders, HeroForge exports, or pixel art packs), you can import them directly.

### File Naming Convention
For the module to automatically detect and assign sprites to the correct facing, your files must follow a specific naming schema. The module supports two modes:

**1. Cardinal Mode (Standard)**
Append the direction abbreviation to the filename, preceded by an underscore.
- **Example**: `Fighter_N.png`, `Fighter_NE.png`, `Fighter_SW.png`.
- **Supported Suffixes**: `_N`, `_NE`, `_E`, `_SE`, `_S`, `_SW`, `_W`, `_NW`. (Also supports `_NNE`, `_SSW`, etc. for 16-way).

**2. Numeric Mode (High Fidelity)**
Append the frame number or angle index to the filename.
- **Example**: `Goblin_000.png`, `Goblin_001.png` ... `Goblin_031.png`.
- **Note**: The module will automatically detect the sequence and map it to a 360-degree rotation.

### How to Import
1. Place all your sprite files in the same folder.
2. Open the Token or Tile configuration.
3. Go to the **Iso3D** tab.
4. Click **"Select Token Image"** (or "Select Tile Image").
5. Choose **ANY** one of the sprite files in the folder (e.g., `Fighter_S.png`).
6. The module will automatically scan the folder for all matching siblings (`Fighter_N.png`, etc.) and set them up for rotation.

### Importing Animated GIFs
You can also import animated GIFs (compatible with Hero Forge spinning GIFs) and automatically convert them into a sprite sequence.
1. Click **"Import Animated GIF"** in the **Iso3D** tab.
2. Select your GIF file.
3. A configuration dialog will appear:
   - **Key Color**: Configure the background color to remove. The tool automatically attempts to detect the background color from the top-left pixel.
   - **Tolerance**: Adjusts how strictly colors must match the Key Color to be removed.
     - *Tip*: If parts of your token art are becoming transparent, **lower the tolerance** or change the Key Color to something that doesn't appear on your character.
   - **Sample Every Nth Frame**: Allows you to skip frames to reduce file size and total frame count.
     - *Example*: If you have a 60-frame GIF, setting this to `2` will result in 30 frames (every second frame is kept). This is great for high-framerate source material where you don't need 60 images for a token rotation. By default this is set to make a 32 frame image set from a 160 frame Hero Forge GIF.
4. Click **Import**. The module will extract the frames, remove the background, upload them to your server, and configure the token.

---

## Recommended Modules
It is highly recommended to install this module alongside the following asset libraries, which provide a vast collection of 3D models perfect for use with this renderer:

- **[3D Canvas Token Collection](https://foundryvtt.com/packages/canvas3dtokencompendium)**: A comprehensive collection of 3D tokens.
- **[3D Canvas Mapmaking Collection](https://foundryvtt.com/packages/canvas3dcompendium)**: A wide variety of environment and prop assets.

If you're using the 3D Canvas assets, make sure that your use is permitted by the [licenses](https://wiki.theripper93.com/levels-3d-preview/canvas3dcompendium#licensecredits) for the various assets you are using.

The module automatically integrates with these libraries, providing a unified **Asset Browser** that intelligently displays Tokens or Map Assets depending on whether you are editing a Token or a Tile.

## Troubleshooting

### I can't click on my token after rotating it!
This is a known interaction issue in Foundry VTT when a token's image is updated.
**Fix**: Simply move your mouse off the token and then back onto it. This forces Foundry to re-calculate the hit area.

### The Renderer crashed / Screen went black
Rendering high-resolution 3D models can be intensive. If you are generating many assets in quick succession, you may overwhelm the browser's WebGL context.
**Fix**: If a crash occurs, refresh your browser page to reset the WebGL context. The module will keep getting updated to improve stability on this one over time.

### Old sprites are showing up for some angles
If you re-generate an asset and save it over an existing file, the browser might cache the old images.
**Fix**: Clear your browser cache or try a hard refresh (Ctrl+F5) to see the updated sprites.

## Planned Features
- **Scene Lighting Baking**: Future updates aim to allow baking scene lighting directly into the isometric tiles, enabling assets to settle perfectly into the environment's illumination.
- **Expanded Shader Library**: More stylistic filters and rendering styles to suit various campaign themes.

---
*Developed by Ludibrium VTT.*
