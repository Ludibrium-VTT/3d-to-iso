const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Application for rendering 3D models to static isometric images.
 */
export class IsometricRenderer extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.modelPath = "";
        this.facing = "NE";
        this.resolution = "1024";
        
        // Three.js instances
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.loader = null;
        this.currentModel = null;
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
            width: 600,
            height: 700
        }
    };

    static PARTS = {
        renderer: {
            template: "modules/3d-to-iso/templates/isometric-renderer.hbs"
        }
    };

    /* -------------------------------------------- */

    async _prepareContext(options) {
        return {
            modelPath: this.modelPath,
            facing: this.facing,
            resolution: this.resolution
        };
    }

    /* -------------------------------------------- */

    _onRender(context, options) {
        if (!this.renderer) {
            this._initializeThreeJS();
        }
        this._attachEventListeners();
    }

    /* -------------------------------------------- */

    _initializeThreeJS() {
        const container = this.element.querySelector("#three-container");
        if (!container) return;

        // Setup Scene
        this.scene = new THREE.Scene();

        // Setup Camera (Orthographic)
        const aspect = container.clientWidth / container.clientHeight;
        const d = 5;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
        this._updateCameraRotation();
        this.scene.add(this.camera);

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(container.clientWidth, container.clientHeight);
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

        // Start Animation Loop (Preview Only)
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
        // Isometric Angles
        const xRotation = Math.atan(1 / Math.sqrt(2));
        let yRotation = 0;

        switch (this.facing) {
            case "NE": yRotation = Math.PI * 0.25; break; // 45 deg
            case "NW": yRotation = Math.PI * 0.75; break; // 135 deg
            case "SW": yRotation = Math.PI * 1.25; break; // 225 deg (-135)
            case "SE": yRotation = Math.PI * 1.75; break; // 315 deg (-45)
        }

        // We rotate the camera object or the scene group? 
        // Best to position camera on a sphere and look at origin.
        const distance = 20;
        this.camera.position.x = distance * Math.sin(yRotation) * Math.cos(xRotation);
        this.camera.position.y = distance * Math.sin(xRotation);
        this.camera.position.z = distance * Math.cos(yRotation) * Math.cos(xRotation);
        this.camera.lookAt(0, 0, 0);
    }

    /* -------------------------------------------- */

    async _loadModel(path) {
        if (!path) return;
        if (this.currentModel) this.scene.remove(this.currentModel);

        try {
            const gltf = await new Promise((resolve, reject) => {
                this.loader.load(path, resolve, undefined, reject);
            });

            this.currentModel = gltf.scene;
            this.scene.add(this.currentModel);

            // Center and Scale
            const box = new THREE.Box3().setFromObject(this.currentModel);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            this.currentModel.position.x += (this.currentModel.position.x - center.x);
            this.currentModel.position.y += (this.currentModel.position.y - center.y);
            this.currentModel.position.z += (this.currentModel.position.z - center.z);

            // Auto-scale to fit
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 5 / maxDim; // Fit within the 'd=5' orthographic bounds
            this.currentModel.scale.setScalar(scale);

        } catch (err) {
            ui.notifications.error(`Failed to load model: ${err.message}`);
        }
    }

    /* -------------------------------------------- */

    _attachEventListeners() {
        const html = this.element;
        
        // Input changes
        html.querySelectorAll("input, select").forEach(el => {
            el.addEventListener("change", async (event) => {
                const name = event.target.name;
                const value = event.target.value;
                this[name] = value;

                if (name === "modelPath") {
                    await this._loadModel(value);
                } else if (name === "facing") {
                    this._updateCameraRotation();
                }
            });
        });

        // File Picker
        html.querySelector(".file-picker").addEventListener("click", (event) => {
            const fp = new FilePicker({
                type: "model", // Custom type or just generic? GLB/GLTF
                callback: async (path) => {
                    this.modelPath = path;
                    html.querySelector('input[name="modelPath"]').value = path;
                    await this._loadModel(path);
                }
            });
            fp.browse();
        });

        // Render Button
        html.querySelector(".render-btn").addEventListener("click", () => this._onRenderAndSave());
    }

    /* -------------------------------------------- */

    async _onRenderAndSave() {
        if (!this.currentModel) {
            ui.notifications.warn("No model loaded to render.");
            return;
        }

        const targetRes = parseInt(this.resolution);
        const originalWidth = this.renderer.domElement.width;
        const originalHeight = this.renderer.domElement.height;

        // Resize renderer for high-res render
        this.renderer.setSize(targetRes, targetRes, false);
        this.renderer.render(this.scene, this.camera);

        // Extract PNG
        const blob = await new Promise(resolve => this.renderer.domElement.toBlob(resolve, 'image/png'));
        
        // Restore renderer size
        this.renderer.setSize(originalWidth, originalHeight, false);

        // Prep file for upload
        const filename = `render_${Date.now()}.png`;
        const file = new File([blob], filename, { type: "image/png" });
        const path = "isometric-renders";

        // Upload to Foundry
        try {
            // Ensure folder exists (hackish check but FilePicker.upload handles some of this)
            await FilePicker.upload("data", path, file);
            ui.notifications.info(`Saved render to ${path}/${filename}`);
        } catch (err) {
            // Possibly folder doesn't exist? Try to create or just error
            ui.notifications.error(`Upload failed: ${err.message}`);
        }
    }

    /* -------------------------------------------- */

    _onClose(options) {
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        // Dispose scene objects, geometries, materials...
        if (this.currentModel) {
            this.currentModel.traverse(child => {
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
        open: () => new IsometricRenderer().render(true)
    };
});
