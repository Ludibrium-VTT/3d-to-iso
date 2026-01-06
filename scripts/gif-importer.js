import { GifReader } from "../vendor/omggif.js";
import { detectAvailableFacings } from "./utils.js";

/**
 * Imports a GIF file, extracts its frames, and saves them as a sequence of PNGs.
 * @param {File} file - The GIF file object.
 * @param {Document} doc - The Token or Actor document.
 */
export async function importGif(file, doc) {
    if (!file) return;

    // 1. Read File
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // 2. Parse GIF
    let reader;
    try {
        reader = new GifReader(buffer);
    } catch (e) {
        console.error("3D-to-Iso | GIF Parsing Error:", e);
        ui.notifications.error("Failed to parse GIF file.");
        return;
    }

    const frameCount = reader.numFrames();
    if (frameCount < 1) {
        ui.notifications.warn("GIF has no frames.");
        return;
    }

    // 3. User Configuration Dialog
    // We'll peek at the first frame to guess the background color (Corner pixel: 0,0)
    // omggif reader is linear, random access is fast enough.
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = reader.width;
    tempCanvas.height = reader.height;
    const tempCtx = tempCanvas.getContext("2d");
    const tempImgData = tempCtx.createImageData(reader.width, reader.height);
    
    // Peek frame 0
    // Try-catch for safety
    let defaultColor = "#000000";
    try {
        reader.decodeAndBlitFrameRGBA(0, tempImgData.data);
        const r = tempImgData.data[0];
        const g = tempImgData.data[1];
        const b = tempImgData.data[2];
        const toHex = (c) => c.toString(16).padStart(2, "0");
        defaultColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch (e) {}
    
    // Dialog Content
    const targetFrames = 32;
    const defaultStep = Math.max(1, Math.round(frameCount / targetFrames));
    
    const content = `
    <form>
        <div class="form-group">
            <p>Detected <strong>${frameCount} frames</strong>.</p>
            <p class="notes">Import options for converting GIF to Sprite Sheet.</p>
        </div>
        <hr>
        <div class="form-group">
            <label>Remove Background</label>
            <input type="checkbox" name="removeBackground" checked>
        </div>
        <div class="form-group" title="Color to treat as transparent. Defaults to top-left pixel.">
            <label>Key Color</label>
            <input type="color" name="keyColor" value="${defaultColor}">
        </div>
        <div class="form-group" title="Sensitivity of the color match. 0 is exact match only.">
            <label>Tolerance (0.0 - 1.0)</label>
            <input type="number" name="tolerance" value="0.1" min="0" max="1" step="0.05">
        </div>
        <hr>
        <div class="form-group" title="Downsample frames to save space and improved performance.">
            <label>Sample Every Nth Frame</label>
            <input type="number" name="sampleRate" value="${defaultStep}" min="1" max="${frameCount}">
            <p class="notes">Result: ~<span id="calc-frames">${Math.ceil(frameCount / defaultStep)}</span> frames</p>
        </div>
        <script>
            (function() {
                const init = () => {
                    const doc = document;
                    const input = doc.querySelector('input[name="sampleRate"]');
                    const output = doc.querySelector('#calc-frames');
                    if (input && output) {
                        input.addEventListener('input', () => {
                            const val = parseInt(input.value) || 1;
                            output.textContent = Math.ceil(${frameCount} / val);
                        });
                    }
                };
                // Try immediate, fallback to slight delay if DOM parsing lags
                init();
                setTimeout(init, 100); 
            })();
        </script>
    </form>
    `;

    const config = await new Promise(resolve => {
        new Dialog({
            title: "Import Animated GIF",
            content: content,
            buttons: {
                 import: {
                     icon: '<i class="fas fa-file-import"></i>',
                     label: "Import",
                     callback: (html) => {
                         // Safe unwrap if jQuery
                         const root = (html.jquery) ? html[0] : html;
                         
                         resolve({
                             removeBackground: root.querySelector('[name="removeBackground"]').checked,
                             keyColor: root.querySelector('[name="keyColor"]').value,
                             tolerance: parseFloat(root.querySelector('[name="tolerance"]').value) || 0.1,
                             sampleRate: parseInt(root.querySelector('[name="sampleRate"]').value) || 1
                         });
                     }
                 },
                 cancel: {
                     icon: '<i class="fas fa-times"></i>',
                     label: "Cancel",
                     callback: () => resolve(null)
                 }
            },
            default: "import"
        }).render(true);
    });

    if (!config) return;

    // Chroma Key Helper
    // Convert hex to rgb
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    };

    const targetRgb = hexToRgb(config.keyColor);
    const toleranceSq = (config.tolerance * 255 * 3) ** 2; // Approximate distance metric squared?
    // Let's use Euclidean distance for consistency. Max distance is sqrt(255^2 * 3) ~= 441.
    // Tolerance 0.1 means distance < 44.
    const maxDist = 441.67;
    const distThreshold = config.tolerance * maxDist;
    const distThresholdSq = distThreshold * distThreshold;

    const processTransparency = (data) => {
        const tr = targetRgb.r;
        const tg = targetRgb.g;
        const tb = targetRgb.b;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // alpha is data[i+3]
            
            // Simple Euclidean distance
            const distSq = (r - tr)**2 + (g - tg)**2 + (b - tb)**2;
            
            if (distSq <= distThresholdSq) {
                data[i + 3] = 0; // Transparent
            }
        }
    };

    // 4. Prepare Canvas
    const canvas = document.createElement("canvas");
    canvas.width = reader.width;
    canvas.height = reader.height;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(reader.width, reader.height);

    // 5. Determine Save Path
    // Default: "isometric-renders/imported/{filename_without_ext}"
    const filename = file.name.replace(/\.[^/.]+$/, ""); // strip extension
    const savePath = `isometric-renders/imported/${filename}`;

    try {
        // Create directory
        // Use V13 FilePicker or fallback to global for consistency if needed, but per warning use namespace.
        // Foundry V12+ standard: FilePicker.createDirectory(source, target, options)
        // If "FilePicker" global is soft-deprecated, we should check availability.
        
        // Ensure "isometric-renders" exists
        try {
            await FilePicker.createDirectory("data", "isometric-renders");
        } catch (e) {
             // Ignore if exists, or proceed to try creating child
        }
        
        // Ensure "isometric-renders/imported" exists
        try {
            await FilePicker.createDirectory("data", "isometric-renders/imported");
        } catch (e) { }

        // Create specific folder for this gif
        try {
            await FilePicker.createDirectory("data", savePath);
        } catch (e) {
            // Already exists? That's fine.
        }
        
    } catch (e) {
        console.warn("Directory creation warning:", e);
    }

    // 6. Process Frames
    const uploadPromises = [];
    const createdFiles = []; // Track actual filenames for manual flag construction
    
    // Helper to get blob
    const getCanvasBlob = (canvas) => {
        return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    };
    
    // Calculate final frame count
    const step = config.sampleRate || 1;
    const finalFrameCount = Math.ceil(frameCount / step);
    
    ui.notifications.info(`Extracting ${finalFrameCount} frames (Sample Rate: ${step})...`);

    // We need to blit frames sequentially because GIFs often rely on previous frame disposal
    // To be safe, we clear canvas if disposal is 'restore to background' etc, but simple blit usually works for simple sprites.
    // omggif's decodeAndBlitFrameRGBA handles writing pixels to a buffer. 
    // We should put that buffer into ImageData.
    
    let savedIndex = 0;

    for (let i = 0; i < frameCount; i++) {
        // Reset pixel buffer (safe default)
        imageData.data.fill(0); 
        
        reader.decodeAndBlitFrameRGBA(i, imageData.data);
        
        // Sampling Check: Only process if it matches step
        if (i % step !== 0) continue; 
        
        // Apply Background Removal
        if (config.removeBackground) {
            processTransparency(imageData.data);
        }

        ctx.putImageData(imageData, 0, 0);

        const blob = await getCanvasBlob(canvas);
        const fileName = `${filename}_${savedIndex.toString().padStart(3, "0")}.png`;
        const fileObj = new File([blob], fileName, { type: "image/png" });

        // Queue upload
        // Fix: Use correct namespace if available, or just suppress usage of deprecated one if possible
        // Actually, the warning specifically says: "You are accessing the global 'FilePicker' which is now namespaced under..."
        // So we should use `foundry.applications.apps.FilePicker`.
        const PickerClass = foundry.applications?.apps?.FilePicker || FilePicker;

        const p = PickerClass.upload("data", savePath, fileObj, { bucket: null })
                .then(result => result.path);
        
        uploadPromises.push(p);
        
        // We can predict the path based on result, but to be safe we use what Upload returns.
        // However, result.path is usually exactly what we expect.
        // For Manual Flag Construction, we need the paths.
        // Since we are waiting on all promises, we can just grab results.
        savedIndex++;
    }

    // 7. Upload All
    ui.notifications.info(`Uploading ${uploadPromises.length} frames... please wait.`);
    const paths = await Promise.all(uploadPromises);

    if (paths.length > 0) {
        ui.notifications.info("Upload complete. Setting up token...");
        
        // 8. Auto-Setup (Manual Flag Construction to avoid Race Condition)
        // Instead of calling detectAvailableFacings (which re-scans filesystem),
        // we manually build the facing array based on what we just uploaded.
        // This guarantees we don't fail due to filesystem lag.
        
        const firstFilePath = paths[0];
        // Calculate the "facings" array. Use "Numeric" mode logic (000, 001...)
        
        // We need to construct numeric angles.
        // 360 degrees / total frames.
        const total = paths.length;
        const angleStep = 360 / total;
        
        const generatedFacings = [];
        for (let i = 0; i < total; i++) {
             // For numeric mode, we usually store just the angle? 
             // detectAvailableFacings stores { angle: x, file: y }?
             // No, detectAvailableFacings returns { found: ["0", "15", ...], mode: "numeric" }.
             
             // Wait, standard numeric format is simply the index/angle.
             // Let's check Utils logic.
             // If files are 000.png, 001.png...
             // detectAvailableFacings parses these to numbers.
             // So if we have 32 frames, we likely want to map them to 0..31 or 0..360?
             // Usually it maps to ANGLE.
             // But if the files are just indices, detectAvailableFacings might incorrectly map them if they aren't explicit angles.
             // Actually, the renderer (isometric-renderer.js) handles "Numeric" by index usually?
             // Let's look at `generateGallery`.
             
             // If we rely on standard detection, we'd need to rename files to `_angle.png`.
             // But right now we name them `_000.png`.
             // `detectAvailableFacings` likely sees these as 0, 1, 2...
             
             // So we will just supply the array of INDICES (as strings) which matches what detectAvailableFacings does for numbered files.
             generatedFacings.push(i.toString()); // "0", "1", "2"...
        }
        
        const updateData = {};
        const isActor = doc.documentName === "Actor";
        
        // Clear model path
        updateData["flags.3d-to-iso.modelPath"] = null;
        
        updateData["flags.3d-to-iso.availableFacings"] = generatedFacings;
        updateData["flags.3d-to-iso.facingMode"] = "numeric"; // Force numeric
        updateData["flags.3d-to-iso.enabled"] = true;

        // Set Texture
        const srcKey = isActor ? "prototypeToken.texture.src" : "texture.src";
        updateData[srcKey] = firstFilePath;
        
        if (isActor) {
             updateData["prototypeToken.flags.3d-to-iso.enabled"] = true;
        }
        
        await doc.update(updateData);
        ui.notifications.info("Token setup complete!");
    }
}
