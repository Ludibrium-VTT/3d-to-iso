---
description: Stabilizing GIF Import and Unifying Token Update Logic
---

# Objective
Stabilize the GIF import functionality and ensure consistent token update logic across the entire "3d-to-iso" module. The primary goal was to fix a bug where imported GIFs were reverting to the original token image (SVG) with incorrect suffixes (e.g., `npc_000.svg` instead of `npc_000.png`) and ensuring that all parts of the application use the same reliable update mechanism.

# Current Status
1.  **GIF Import Status**: **VERIFIED**. Logic now separates extraction from upload (using `Promise.all`), preventing race conditions. Target resolution updated to prioritize TokenDocument for immediate updates.
2.  **Isometric Renderer Status**: **VERIFIED**. "Process and Assign" now uses `assignFacings` and correctly populates the gallery. A race condition where auto-detection overwrote flags was fixed by blocking detection when `from3DApp` context is present.
3.  **Logic Centralized**: `assignFacings` in `scripts/utils.js` is the single source of truth.

# Actions Taken
*   **Refactored `IsometricRenderer`**: Uses `assignFacings` with `extraFlags` and `updateContext`.
*   **Fixed Race Condition (Gallery)**: Modified `scripts/token.js` hook to skip `detectAvailableFacings` when `options.from3DApp` is true, ensuring explicit flags from the renderer are preserved.
*   **Fixed Race Condition (GIF Import)**: Refactored `importGif` to await all uploads before calling `assignFacings`.
*   **Fixed Target Resolution**: `importGif` now correctly targets the `doc` (Token) instead of falling back to `actor`.
*   **Patched `preUpdateToken`**: Prioritizes Token-level flags over Actor-level flags.

# Key Files
*   `scripts/utils.js`: `assignFacings` (Logic Core).
*   `scripts/gif-importer.js`: `importGif` (Clean Extraction/Upload).
*   `scripts/token.js`: Hooks & Integration.
*   `scripts/isometric-renderer.js`: Renderer Logic.

# Verification
*   All import methods (GIF, Image Selection, 3D Render) result in:
    *   Correct Active Texture.
    *   Correctly Populated Gallery.
    *   Persistent Flags (Model Path, Adjustments).
    *   Working Rotation.
