const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Application for rendering 3D models to static isometric images.
 */
export class IsometricRenderer extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        
        // Target Actor and Token (if launched from a config sheet)
        this.actor = options.actor || null;
        this.token = options.token || null;

        // Default settings
        this.modelPath = this.actor?.getFlag("3d-to-iso", "modelPath") || "";
        this.facing = "NE";
        this.resolution = "1024";
        
        // Per-facing adjustments
        const savedAdjustments = this.actor?.getFlag("3d-to-iso", "adjustments");
        this.adjustments = savedAdjustments || {
            NE: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            NW: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            SE: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            SW: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 }
        };
        
        // Three.js instances
        this.scene = null;
        this.modelPivot = null;
        this.modelWrapper = null;
        this.camera = null;
        this.renderer = null;
        this.loader = null;
        this.currentModel = null;
        this.baseCameraDistance = 50;
    }

    static DEFAULT_OPTIONS = {
        id: "isometric-renderer",
        tag: "form",
        classes: ["isometric-renderer"],
        window: {
            title: "Isometric 3D Model Renderer",
            resizable: true,
            icon: "fas fa-cube"
        },
        position: {
            width: 650,
            height: 900
        }
    };

    static PARTS = {
        renderer: {
            template: "modules/3d-to-iso/templates/isometric-renderer.hbs"
        }
    };

    /* -------------------------------------------- */

    async _prepareContext(options) {
        const adj = this.adjustments[this.facing];
        return {
            modelPath: this.modelPath,
            facing: this.facing,
            resolution: this.resolution,
            adj: adj,
            actor: this.actor,
            displayValues: {
                rx: adj.rx.toFixed(0),
                ry: adj.ry.toFixed(0),
                rz: adj.rz.toFixed(0),
                zoom: adj.zoom.toFixed(1),
                px: adj.px.toFixed(1),
                py: adj.py.toFixed(1)
            }
        };
    }

    /* -------------------------------------------- */

    _onRender(context, options) {
        const container = this.element.querySelector("#three-container");
        if (!container) return;

        if (!this.renderer) {
            this._initializeThreeJS();
        } else {
            // Re-attach existing renderer's canvas
            container.appendChild(this.renderer.domElement);
            // Resize to keep square within new container bounds
            const size = Math.min(container.clientWidth, container.clientHeight) - 20;
            this.renderer.setSize(size, size);
            // Ensure model is still in scene (it should be)
            this._updateCameraRotation();
        }
        this._attachEventListeners();
    }

    /* -------------------------------------------- */

    _initializeThreeJS() {
        const container = this.element.querySelector("#three-container");
        if (!container) return;

        // Setup Scene
        this.scene = new THREE.Scene();

        // Setup Model Container
        this.modelPivot = new THREE.Group();
        this.modelWrapper = new THREE.Group();
        this.modelPivot.add(this.modelWrapper);
        this.scene.add(this.modelPivot);

        // Setup Camera (Orthographic) - ALWAYS SQUARE for 1:1 render output
        const d = 5;
        // Using very large near/far planes to prevent any clipping in orthographic view
        this.camera = new THREE.OrthographicCamera(-d, d, d, -d, -1000, 1000);
        this.baseCameraDistance = 50; 
        this._updateCameraRotation();
        this.scene.add(this.camera);

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        // Size canvas to the smallest dimension of the container to keep it square
        const size = Math.min(container.clientWidth, container.clientHeight) - 20; // 20px padding
        this.renderer.setSize(size, size);
        container.appendChild(this.renderer.domElement);

        // Setup Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(5, 10, 7.5);
        this.scene.add(directional);

        // Setup Loader
        this.loader = new THREE.GLTFLoader();
        const dracoLoader = new THREE.DRACOLoader();
        dracoLoader.setDecoderPath("modules/3d-to-iso/vendor/draco/");
        this.loader.setDRACOLoader(dracoLoader);

        // Initial render trigger
        if (this.modelPath) this._loadModel(this.modelPath);
        
        // Start Animation Loop
        this._animate();
    }

    /* -------------------------------------------- */

    _animate() {
        if (!this.renderer) return;
        requestAnimationFrame(() => this._animate());
        this.renderer.render(this.scene, this.camera);
    }

    /* -------------------------------------------- */

    _updateCameraRotation() {
        if (!this.camera) return;

        const adj = this.adjustments[this.facing];

        // Base Isometric Angles
        const baseXR = -Math.atan(1 / Math.sqrt(2));
        let baseYR = 0;

        switch (this.facing) {
            case "NE": baseYR = Math.PI * 0.25; break;
            case "NW": baseYR = Math.PI * 0.75; break;
            case "SW": baseYR = Math.PI * 1.25; break;
            case "SE": baseYR = Math.PI * 1.75; break;
        }

        // Apply Manual Offsets
        const finalXR = baseXR - (adj.rx * Math.PI / 180);
        const finalYR = baseYR + (adj.ry * Math.PI / 180);
        const finalZR = adj.rz * Math.PI / 180;
        
        // Setup camera position and orientation
        const euler = new THREE.Euler(finalXR, finalYR, finalZR, 'YXZ');
        this.camera.position.set(0, 0, this.baseCameraDistance);
        this.camera.position.applyEuler(euler);
        this.camera.quaternion.setFromEuler(euler);

        // Explicitly set Orthographic zoom
        this.camera.zoom = adj.zoom;
        this.camera.updateProjectionMatrix();

        // Apply Panning to the Model Pivot (Screen-Space Pan)
        if (this.modelPivot) {
            // Reset position
            this.modelPivot.position.set(0, 0, 0);
            
            // Calculate screen-space axes based on camera orientation
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
            
            // Move model along those axes
            // Sensitivity adjustment: roughly match mouse pixel deltas to world units
            this.modelPivot.position.addScaledVector(right, adj.px);
            this.modelPivot.position.addScaledVector(up, adj.py);
        }
    }

    /* -------------------------------------------- */

    async _loadModel(path) {
        if (!path) return;
        this.modelWrapper.clear();

        try {
            const gltf = await new Promise((resolve, reject) => {
                this.loader.load(path, resolve, undefined, reject);
            });

            this.currentModel = gltf.scene;
            this.modelWrapper.add(this.currentModel);

            // Compute precise bounding box including all children
            this.currentModel.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(this.modelWrapper);
            
            const center = new THREE.Vector3();
            const size = new THREE.Vector3();
            box.getCenter(center);
            box.getSize(size);

            // Shift currentModel within modelWrapper so the center of its geometry is at (0,0,0)
            this.currentModel.position.sub(center);

            // Auto-scale modelWrapper to fit comfortably in ortho view
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = (maxDim > 0) ? 6 / maxDim : 1; 
            this.modelWrapper.scale.setScalar(scale);

            // Force immediate update of camera and projection
            this._updateCameraRotation();

        } catch (err) {
            console.error(err);
            ui.notifications.error(`Failed to load model: ${err.message}`);
        }
    }

    /* -------------------------------------------- */

    _attachEventListeners() {
        const html = this.element;
        const container = html.querySelector("#three-container");
        
        // Mouse Interaction for Panning (Right Click Drag)
        let isDragging = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        container.addEventListener("contextmenu", (e) => e.preventDefault()); // Prevent actual context menu

        container.addEventListener("mousedown", (e) => {
            if (e.button === 2) { // Right Click
                isDragging = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            
            const dx = e.clientX - lastMouseX;
            const dy = e.clientY - lastMouseY;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;

            // Update state (sensitivity tuning: / 50)
            const adj = this.adjustments[this.facing];
            adj.px += dx / 50;
            adj.py -= dy / 50; // Invert Y for screen-to-world mapping

            this._updateCameraRotation();
        });

        window.addEventListener("mouseup", () => {
            isDragging = false;
        });

        // Mouse Wheel for Zoom
        container.addEventListener("wheel", (e) => {
            e.preventDefault();
            const adj = this.adjustments[this.facing];
            const delta = e.deltaY > 0 ? 0.9 : 1.1; // Multiplicative zoom for smoother feel
            
            // Apply zoom with clamping (matching slider limits 0.1 to 5)
            const newZoom = Math.min(Math.max(adj.zoom * delta, 0.1), 5);
            adj.zoom = newZoom;

            this._updateCameraRotation();

            // Sync Slider and Label
            const zoomInput = html.querySelector('input[name="zoom"]');
            if (zoomInput) {
                zoomInput.value = adj.zoom;
                this._updateLabel(zoomInput, "zoom", adj.zoom);
            }
        }, { passive: false });

        // Input changes
        html.querySelectorAll("input, select").forEach(el => {
            el.addEventListener("change", async (event) => {
                const name = event.target.name;
                const value = event.target.value;
                
                if (["rx", "ry", "rz", "zoom"].includes(name)) {
                    this.adjustments[this.facing][name] = parseFloat(value);
                    this._updateCameraRotation();
                    // Update label in UI
                    this._updateLabel(el, name, value);
                } else {
                    this[name] = value;
                    if (name === "modelPath") await this._loadModel(value);
                    if (name === "facing") {
                        this.render(); // Re-render Application to update sliders
                    }
                }
            });

            // Live preview for sliders
            if (el.type === "range") {
                el.addEventListener("input", (event) => {
                    const name = event.target.name;
                    const value = event.target.value;
                    this.adjustments[this.facing][name] = parseFloat(value);
                    this._updateCameraRotation();
                    this._updateLabel(el, name, value);
                });
            }
        });

        // File Picker
        html.querySelector(".file-picker").addEventListener("click", (event) => {
            new FilePicker({
                type: "model",
                callback: async (path) => {
                    this.modelPath = path;
                    html.querySelector('input[name="modelPath"]').value = path;
                    await this._loadModel(path);
                }
            }).browse();
        });

        // Buttons
        html.querySelector(".render-btn").addEventListener("click", () => this._onRenderAndSave());
        html.querySelector(".render-all-btn").addEventListener("click", () => this._onRenderAll());
        
        const assignBtn = html.querySelector(".assign-actor-btn");
        if (assignBtn) {
            assignBtn.addEventListener("click", () => this._onProcessAndAssign());
        }

        html.querySelector(".reset-current-btn").addEventListener("click", () => {
            this.adjustments[this.facing] = { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 };
            this._updateCameraRotation();
            this.render();
        });
        html.querySelector(".reset-all-btn").addEventListener("click", () => {
            for (let f in this.adjustments) {
                this.adjustments[f] = { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 };
            }
            this._updateCameraRotation();
            this.render();
        });
    }

    /* -------------------------------------------- */

    _updateLabel(el, name, value) {
        const label = el.closest(".form-group").querySelector("label");
        let text = "";
        switch (name) {
            case "zoom": text = `${game.i18n.localize("3D_TO_ISO.Zoom")} (${parseFloat(value).toFixed(1)}x)`; break;
            default: text = `${game.i18n.localize("3D_TO_ISO.Rotation" + name.toUpperCase().slice(-1))} (${parseFloat(value).toFixed(0)}°)`; break;
        }
        label.textContent = text;
    }

    /* -------------------------------------------- */

    async _onRenderAndSave(facing = this.facing) {
        if (!this.currentModel) {
            ui.notifications.warn("No model loaded to render.");
            return;
        }

        const prevFacing = this.facing;
        this.facing = facing;
        this._updateCameraRotation();

        const targetRes = parseInt(this.resolution);
        const originalWidth = this.renderer.domElement.width;
        const originalHeight = this.renderer.domElement.height;

        // Resize renderer for high-res render
        this.renderer.setSize(targetRes, targetRes, false);
        this.renderer.render(this.scene, this.camera);

        // Extract PNG
        const blob = await new Promise(resolve => this.renderer.domElement.toBlob(resolve, 'image/png'));
        
        // Restore
        this.renderer.setSize(originalWidth, originalHeight, false);
        this.facing = prevFacing;
        this._updateCameraRotation();

        // Robust filename extraction
        const cleanPath = decodeURIComponent(this.modelPath.split('?')[0]);
        const modelFile = cleanPath.split('/').pop();
        const lastDot = modelFile.lastIndexOf('.');
        let baseName = lastDot > -1 ? modelFile.substring(0, lastDot) : modelFile;
        
        // Light sanitization: only remove truly illegal characters for most file systems
        // Preserve spaces, parentheses, etc. for a "perfect match" with the source
        const safeBaseName = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
        const filename = `${safeBaseName}_${facing}.png`;
        const uploadDir = "isometric-renders";
        const file = new File([blob], filename, { type: "image/png" });

        try {
            const response = await FilePicker.upload("data", uploadDir, file);
            const actualPath = typeof response === "string" ? response : response.path;
            
            ui.notifications.info(`Saved ${facing} render to ${actualPath}`);
            return actualPath;
        } catch (err) {
            ui.notifications.error(`Upload failed: ${err.message}. Make sure the 'isometric-renders' directory exists.`);
            return null;
        }
    }

    /* -------------------------------------------- */

    async _onRenderAll() {
        if (!this.currentModel) return ui.notifications.warn("No model loaded.");
        
        const facings = ["NE", "NW", "SE", "SW"];
        ui.notifications.info(game.i18n.format("3D_TO_ISO.BatchProgress", { current: 0, total: 4 }));
        
        const results = {};
        for (let i = 0; i < facings.length; i++) {
            const path = await this._onRenderAndSave(facings[i]);
            results[facings[i]] = path;
            ui.notifications.info(game.i18n.format("3D_TO_ISO.BatchProgress", { current: i + 1, total: 4 }));
        }
        
        ui.notifications.info("Batch render complete.");
        return results;
    }

    /* -------------------------------------------- */

    async _onProcessAndAssign() {
        if (!this.actor) return ui.notifications.warn("No target actor for this operation.");
        if (!this.modelPath) return ui.notifications.warn("No model selected.");

        // 1. Perform batch render
        const paths = await this._onRenderAll();
        if (!paths || !paths.NE) return;

        // 2. Save settings to Actor flags (Base Prototype)
        await this.actor.setFlag("3d-to-iso", "modelPath", this.modelPath);
        await this.actor.setFlag("3d-to-iso", "adjustments", this.adjustments);

        // 3. Update active token instance if we have one
        if (this.token && this.token instanceof TokenDocument) {
            await this.token.update({
                "texture.src": paths.NE,
                "flags.3d-to-iso.enabled": true
            });
        }

        // 4. Update prototype token on the base actor
        await this.actor.update({
            "prototypeToken.texture.src": paths.NE,
            "prototypeToken.flags.3d-to-iso.enabled": true
        });

        ui.notifications.info(`Successfully assigned 3D renders to ${this.actor.name}.`);
        this.close();
    }

    /* -------------------------------------------- */

    _onClose(options) {
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        if (this.modelWrapper) {
            this.modelWrapper.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
        }
    }
}

// Hook to add to sidebar or create macro
Hooks.once("init", () => {
    game.modules.get("3d-to-iso").api = {
        open: () => new IsometricRenderer().render(true),
        IsometricRenderer: IsometricRenderer
    };
});
