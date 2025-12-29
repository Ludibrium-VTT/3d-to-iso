# 3D to Isometric

**3D to Iso** is a Foundry VTT module that bridges the gap between 3D assets and isometric gameplay. It allows you to import 3D models (GLB/GLTF), apply stylistic shaders, and render them into a series of isometric sprites. These sprites can be used for Tokens or Tiles, and the module automatically handles sprite switching based on token rotation, simulating a 3D presence in an isometric scene.

This module is designed to work seamlessly with **Isometric Perspective** and other isometric tools.

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
4. Select a 3D model using the file picker.
5. Adjust the model's orientation, lighting, and style settings.
6. Click **"Process and Assign"**. The module will automatically generate sprites for all directions and assign them to the token.

### For Tiles
1. Create a Tile and open its configuration.
2. **Ensure the Tile is Saved**: The renderer requires a saved document to function. (Unsaved tiles from the Create Tile tool will show disabled buttons with a warning).
3. Go to the **Iso3D** tab and follow the same rendering process.
4. The Tile will now rotate visually when its rotation property is changed!

## Planned Features
- **Scene Lighting Baking**: Future updates aim to allow baking scene lighting directly into the isometric tiles, enabling assets to settle perfectly into the environment's illumination.
- **Expanded Shader Library**: More stylistic filters and rendering styles to suit various campaign themes.

---
*Developed by Ludibrium VTT.*
