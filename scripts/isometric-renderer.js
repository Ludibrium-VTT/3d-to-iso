import { TransformControls } from "../vendor/TransformControls.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------- */
/*  Shaders                                     */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Post-Processing Shaders                     */
/* -------------------------------------------- */

const POST_VERTEX_SHADER = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
    }
`;

const SEPIA_FRAGMENT_SHADER = `
    uniform sampler2D tDiffuse;
    uniform float intensity;
    varying vec2 vUv;
    void main() {
        vec4 color = texture2D(tDiffuse, vUv);
        vec3 c = color.rgb;
        float r = dot(c, vec3(0.393, 0.769, 0.189));
        float g = dot(c, vec3(0.349, 0.686, 0.168));
        float b = dot(c, vec3(0.272, 0.534, 0.131));
        vec3 sepia = vec3(r, g, b);
        gl_FragColor = vec4(mix(c, sepia, intensity), color.a);
    }
`;

const PIXEL_FRAGMENT_SHADER = `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float intensity;
    varying vec2 vUv;
    void main() {
        if (intensity <= 0.01) {
            gl_FragColor = texture2D(tDiffuse, vUv);
        } else {
            float factor = mix(1.0, 32.0, intensity);
            vec2 pixels = resolution / factor;
            vec2 coord = floor(vUv * pixels) / pixels;
            gl_FragColor = texture2D(tDiffuse, coord);
        }
    }
`;

const SKETCH_FRAGMENT_SHADER = `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float intensity;
    varying vec2 vUv;
    void main() {
        vec2 texel = vec2(1.0 / resolution.x, 1.0 / resolution.y);
        float tl = texture2D(tDiffuse, vUv + texel * vec2(-1, 1)).r;
        float l  = texture2D(tDiffuse, vUv + texel * vec2(-1, 0)).r;
        float bl = texture2D(tDiffuse, vUv + texel * vec2(-1,-1)).r;
        float t  = texture2D(tDiffuse, vUv + texel * vec2( 0, 1)).r;
        float b  = texture2D(tDiffuse, vUv + texel * vec2( 0,-1)).r;
        float tr = texture2D(tDiffuse, vUv + texel * vec2( 1, 1)).r;
        float r  = texture2D(tDiffuse, vUv + texel * vec2( 1, 0)).r;
        float br = texture2D(tDiffuse, vUv + texel * vec2( 1,-1)).r;
        float x = (tl + 2.0*l + bl) - (tr + 2.0*r + br);
        float y = (tl + 2.0*t + tr) - (bl + 2.0*b + br);
        float edge = sqrt(x*x + y*y);
        
        vec4 color = texture2D(tDiffuse, vUv);
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float sketch = clamp(1.0 - (edge * 4.0), 0.0, 1.0);
        vec3 finalColor = vec3(gray * sketch);
        gl_FragColor = vec4(mix(color.rgb, finalColor, intensity), color.a);
    }
`;

/**
 * Application for rendering 3D models to static isometric images.
 */
export class IsometricRenderer extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        
        // Target Actor, Token, or Tile
        this.actor = options.actor || null;
        this.token = options.token || null;
        this.tile = options.tile || null;

        // Unified Document Accessor    
        if (this.tile) {
            this.document = this.tile;
        } else if (this.token) {
            this.document = this.token;
        } else if (this.actor) {
            this.document = this.actor;
        }

        // Default settings
        this.modelPath = options.modelPath || this.document?.getFlag("3d-to-iso", "modelPath") || "";
        this.renderMode = "cardinal";
        this.facing = "S";
        this.frameCount = 16;
        this.currentFrame = 0; // For numeric preview
        // Default resolution: 256 for Tiles, 1024 for Tokens/Actors
        this.resolution = options.resolution || ((this.tile) ? "256" : "1024");
        this.savePath = options.savePath || null;
        
        // Lighting
        this.ambientIntensity = this.document?.getFlag("3d-to-iso", "ambientIntensity") ?? 0.7;
        
        // Per-facing adjustments
        const savedAdjustments = this.document?.getFlag("3d-to-iso", "adjustments");
        this.adjustments = savedAdjustments || {
            N:  { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            NE: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            E:  { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            SE: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            S:  { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            SW: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            W:  { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 },
            NW: { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 }
        };
        
        // Adjustments/Overrides for Numeric Mode (Global or per frame?)
        if (!this.adjustments.numeric) {
            this.adjustments.numeric = { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 };
        }
        
        this.linkRotations = true; // Default to global rotation

        // Three.js instances
        this.scene = null;
        this.modelPivot = null;
        this.modelWrapper = null;
        this.camera = null;
        this.renderer = null;
        this.loader = null;
        this.currentModel = null;
        this.baseCameraDistance = 50;
        // Post-Processing
        this.effects = {
            sepia: 0,
            pixel: 0,
            sketch: 0
        };

        this.postProcessing = {
            bufferA: null,
            bufferB: null,
            quad: null,
            scene: null,
            camera: null,
            materials: {}
        };
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
        // Resolve adjustment object based on mode
        let adj = (this.renderMode === "numeric") 
            ? this.adjustments.numeric 
            : this.adjustments[this.facing];

        // Safe fallback if the specific adjustment is missing (e.g. malformed saved data or switching modes)
        if (!adj) {
            adj = { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 };
            // Auto-repair internal state
            if (this.renderMode === "numeric") this.adjustments.numeric = adj;
            else this.adjustments[this.facing] = adj;
        }

        return {
            modelPath: this.modelPath,
            renderMode: this.renderMode,
            facing: this.facing,
            frameCount: this.frameCount,
            currentFrame: this.currentFrame,
            resolution: this.resolution,
            renderMode: this.renderMode,
            frameCount: this.frameCount,
            currentFrame: this.currentFrame,
            resolution: this.resolution,
            effects: this.effects,
            ambientIntensity: this.ambientIntensity,
            linkRotations: this.linkRotations,
            adj: adj,
            actor: this.actor, // Keep for backward compat within template if needed
            document: this.document, // Expose generic document
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

    async close(options) {
        // Stop animation loop
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
            this.renderer.dispose();
        }
        
        // Traverse and dispose Scene
        const disposeObject = (obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        };

        if (this.scene) {
            this.scene.traverse(disposeObject);
            this.scene.clear();
        }
        if (this.overlayScene) {
            this.overlayScene.traverse(disposeObject);
            this.overlayScene.clear();
        }

        // Dispose Post-Processing Targets
        if (this.postProcessing) {
            if (this.postProcessing.bufferA) this.postProcessing.bufferA.dispose();
            if (this.postProcessing.bufferB) this.postProcessing.bufferB.dispose();
            Object.values(this.postProcessing.materials).forEach(m => m.dispose());
        }

        if (this.transformControl) {
            this.transformControl.dispose();
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.currentModel = null;
        
        return super.close(options);
    }

    _onRender(context, options) {
        super._onRender(context, options);
        if ( !this.element ) return;

        const container = this.element.querySelector("#three-container");
        if (!container) return;

        if (!this.renderer) {
            this._contextLost = false;
            this._initializeThreeJS(container);
        } else {
            // Re-attach existing renderer's canvas
            if (this.renderer.domElement.parentElement !== container) {
                container.appendChild(this.renderer.domElement);
            }
            // Resize to keep square within current container bounds
            const size = Math.min(container.clientWidth, container.clientHeight) - 20;
            if ( size > 0 ) this.renderer.setSize(size, size);
            this._updateCameraRotation();
        }
        this._attachEventListeners();
    }


    /* -------------------------------------------- */

    _initializeThreeJS(container) {
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
        this.renderer.autoClear = false;
        
        // Size canvas to the smallest dimension of the container to keep it square
        const size = Math.min(container.clientWidth, container.clientHeight) - 20; // 20px padding
        this.renderer.setSize(size, size);
        container.appendChild(this.renderer.domElement);

        // Context Loss Handling
        this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            console.warn("3D-to-Iso: WebGL Context Lost");
            this._contextLost = true;
            if (this.renderer) this.renderer.setAnimationLoop(null); // Stop loop
        });

        this.renderer.domElement.addEventListener("webglcontextrestored", () => {
             console.log("3D-to-Iso: WebGL Context Restored");
             this._contextLost = false;
             if (this.renderer) this._animate(); // Restart loop
        });

        // Setup Lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, this.ambientIntensity);
        this.scene.add(this.ambientLight);

        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(5, 10, 7.5);
        this.scene.add(directional);

        // Setup Scene (UI/Overlay)
        this.overlayScene = new THREE.Scene();

        // Setup Transform Controls (Add to Overlay Scene)
        this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControl.setMode('rotate'); 
        
        // Sync TransformControls... (Include the syncing logic here - I need to keep it)
        this.transformControl.addEventListener('change', (event) => {
             if (this.modelWrapper && (this.transformControl.mode === "rotate")) {
                 // Convert Radians to Degrees
                 const rx = this.modelWrapper.rotation.x * (180 / Math.PI);
                 const ry = this.modelWrapper.rotation.y * (180 / Math.PI);
                 const rz = this.modelWrapper.rotation.z * (180 / Math.PI);
                 
                 if (this.linkRotations) {
                     this._syncRotation("rx", rx);
                     this._syncRotation("ry", ry);
                     this._syncRotation("rz", rz);
                 } else {
                     const adj = (this.renderMode === "numeric") ? this.adjustments.numeric : this.adjustments[this.facing];
                     if (adj) {
                         adj.rx = rx;
                         adj.ry = ry;
                         adj.rz = rz;
                     }
                 }

                 if (this.element) {
                     const setVal = (name, val) => {
                         const inputs = this.element.querySelectorAll(`input[name="${name}"]`);
                         inputs.forEach(i => {
                             i.value = val;
                             this._updateLabel(i, name, val);
                         });
                     };
                     setVal("rx", rx);
                     setVal("ry", ry);
                     setVal("rz", rz);
                 }
             }
        });

        this.overlayScene.add(this.transformControl);
        this.transformControl.attach(this.modelWrapper);

        
        // Setup Loader
        this.loader = new THREE.GLTFLoader();
        const dracoLoader = new THREE.DRACOLoader();
        dracoLoader.setDecoderPath("modules/3d-to-iso/vendor/draco/");
        this.loader.setDRACOLoader(dracoLoader);

        // Initial render trigger
        if (this.modelPath) this._loadModel(this.modelPath);
        
        this._setupPostProcessing(size);
        
        // Start Animation Loop
        this._animate();
    }

    /* -------------------------------------------- */

    _drawThreeJSFrame(includeOverlay = true) {
        if (!this.renderer) return;

        const pp = this.postProcessing;
        if (!pp.bufferA) return; // Not ready

        // 1. Render Scene to Buffer A (Base Image)
        // We render to a buffer first so we can process it
        this.renderer.setRenderTarget(pp.bufferA);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);

        // 2. Apply Effects Chain
        // We ping-pong between A and B. 
        // 'readBuffer' is where we read from (started as A).
        // 'writeBuffer' is where we write to (starts as B).
        let readBuffer = pp.bufferA;
        let writeBuffer = pp.bufferB;

        const activeEffects = Object.entries(this.effects).filter(([k, v]) => v > 0);
        
        for (let [effectName, intensity] of activeEffects) {
            const material = pp.materials[effectName];
            if (!material) continue;

            // Update Uniforms
            if (material.uniforms.tDiffuse) material.uniforms.tDiffuse.value = readBuffer.texture;
            if (material.uniforms.intensity) material.uniforms.intensity.value = intensity;
            
            // Assign material to Quad and render
            pp.quad.material = material;

            this.renderer.setRenderTarget(writeBuffer);
            this.renderer.clear();
            this.renderer.render(pp.scene, pp.camera);

            // Swap Buffers
            const temp = readBuffer;
            readBuffer = writeBuffer;
            writeBuffer = temp;
        }

        // 3. Final Output to Screen
        // The final result is in 'readBuffer'. We need to get it to the screen.
        // We can reuse the Sepia material with 0 intensity as a "Passthrough" or "Copy" shader.
        this.renderer.setRenderTarget(null);
        this.renderer.clear();
        
        const outputMat = pp.materials.sepia;
        if (outputMat) {
             outputMat.uniforms.tDiffuse.value = readBuffer.texture;
             outputMat.uniforms.intensity.value = 0; // Ensure no effect
             pp.quad.material = outputMat;
             this.renderer.render(pp.scene, pp.camera);
        }

        // 4. Render Overlay (Handles)
        if (includeOverlay && this.overlayScene) {
             this.renderer.clearDepth(); 
             this.renderer.render(this.overlayScene, this.camera);
        }
    }

    _animate() {
        if (!this.renderer) return;
        requestAnimationFrame(() => this._animate());
        this._drawThreeJSFrame();
    }

    /* -------------------------------------------- */

    /* -------------------------------------------- */
    /*  Camera Updates                              */
    /* -------------------------------------------- */

    _updateCameraRotation() {
        if (!this.camera) return;

        // Resolve active adjustment set
        let adj = (this.renderMode === "numeric") 
            ? this.adjustments.numeric 
            : this.adjustments[this.facing];

        if (!adj) {
             adj = { rx: 0, ry: 0, rz: 0, zoom: 1, px: 0, py: 0 };
        }

        // Base Projection Angle
        const projectionType = game.settings.get("3d-to-iso", "projectionType");
        let baseXR;

        if (projectionType === "dimetric") {
            baseXR = -Math.PI / 6; 
        } else {
            // True Isometric (~35.264°)
            baseXR = -Math.atan(1 / Math.sqrt(2));
        }
        
        // Ensure negative pitch for "looking down"
        // baseXR is already negative in iso calc above.
        
        let baseYR = 0;

        if (this.renderMode === "numeric") {
            // Numeric Mode: 360 Degree Rotation
            // Goal: Clockwise rotation.
            // Frame 0 = South (Front).
            
            const step = (Math.PI * 2) / this.frameCount;
            
            // Start at South (aligned with Cardinal "S")
            const southAngle = Math.PI * 1.75;
            
            // Frame 0 = South.
            // Subsequent frames rotate Clockwise (Increasing Y angle matches Cardinal table S->SW->W).
            baseYR = southAngle + (this.currentFrame * step);
            
        } else {
            // Cardinal Mode            
            switch (this.facing) {
                case "SW": baseYR = Math.PI * 0.00; break;
                case "W":  baseYR = Math.PI * 0.25; break;
                case "NW": baseYR = Math.PI * 0.50; break; 
                case "N":  baseYR = Math.PI * 0.75; break; 
                case "NE": baseYR = Math.PI * 1.00; break;
                case "E":  baseYR = Math.PI * 1.25; break;
                case "SE": baseYR = Math.PI * 1.50; break;
                case "S":  baseYR = Math.PI * 1.75; break;
            }
        }

        // Apply Manual Offsets to MODEL, not Camera
        if (this.modelWrapper) {
            this.modelWrapper.rotation.set(
                adj.rx * Math.PI / 180,
                adj.ry * Math.PI / 180,
                adj.rz * Math.PI / 180
            );
        }

        // Setup camera position and orientation (Base Iso Only)
        // const finalXR = baseXR - (adj.rx * Math.PI / 180); <-- Old Logic
        
        const euler = new THREE.Euler(baseXR, baseYR, 0, 'YXZ');
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
            this.modelPivot.position.addScaledVector(right, adj.px);
            this.modelPivot.position.addScaledVector(up, adj.py);
        }
    }

    /* -------------------------------------------- */

    async _loadModel(path) {
        if (!path) return;
        this.modelWrapper.clear();
        this.modelWrapper.scale.set(1, 1, 1);
        this.modelWrapper.rotation.set(0, 0, 0);
        this.modelWrapper.position.set(0, 0, 0);

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
    
    /**
     * Synchronize zoom across all facings
     * @param {number} newZoom 
     */
    _syncZoom(newZoom) {
        for (let f in this.adjustments) {
            this.adjustments[f].zoom = newZoom;
        }
    }

    _syncRotation(prop, value) {
        for (let f in this.adjustments) {
            if (this.adjustments[f]) this.adjustments[f][prop] = value;
        }
    }

    /* -------------------------------------------- */

    _attachEventListeners() {
        const html = this.element;
        const container = html.querySelector("#three-container");
        
        // Helper to get current adjustment object
        const getAdj = () => (this.renderMode === "numeric") ? this.adjustments.numeric : this.adjustments[this.facing];

        // Mouse Interaction for Panning (Right Click Drag)
        let isDragging = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        container.addEventListener("contextmenu", (e) => e.preventDefault()); 
        
        // Transform Controls Keybinds (Size only)
        window.addEventListener("keydown", (e) => {
            if (!this.transformControl) return;
            switch(e.key.toLowerCase()) {
                case "+": case "=": this.transformControl.setSize(this.transformControl.size + 0.1); break;
                case "-": case "_": this.transformControl.setSize(Math.max(0.1, this.transformControl.size - 0.1)); break;
            }
        }); 

        container.addEventListener("mousedown", (e) => {
            if (e.button === 2) { 
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

            const adj = getAdj();
            adj.px += dx / 50;
            adj.py -= dy / 50; 
            this._updateCameraRotation();
        });

        window.addEventListener("mouseup", () => isDragging = false);

        // Mouse Wheel for Zoom
        container.addEventListener("wheel", (e) => {
            e.preventDefault();
            const adj = getAdj();
            const delta = e.deltaY > 0 ? 0.9 : 1.1; 
            const newZoom = Math.min(Math.max(adj.zoom * delta, 0.1), 5);
            
            // Sync all facings or just current?
            // For now, sync all 
            this._syncZoom(newZoom);
            this._updateCameraRotation();
            
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
                const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
                
                if (name.startsWith("effect.")) {
                     const effectName = name.split(".")[1];
                     this.effects[effectName] = parseFloat(value);
                     
                     // Update label
                     const display = el.parentElement.querySelector(`.display-effect-${effectName}`);
                     if (display) display.textContent = value;
                     
                     this._drawThreeJSFrame();
                } 
                else if (["rx", "ry", "rz", "zoom"].includes(name)) { // rx/ry/rz inputs removed, but safe to keep logic just in case
                    const numValue = parseFloat(value);
                    if (name === "zoom") this._syncZoom(numValue);
                    else if (this.linkRotations && ["rx", "ry", "rz"].includes(name)) {
                         this._syncRotation(name, numValue);
                    }
                    else getAdj()[name] = numValue;

                    this._updateCameraRotation();
                    // this._updateLabel(el, name, value); // No longer needed for rotations
                } else if(name === "frameCount") {
                    this.frameCount = parseInt(value);
                    this.render(); // Re-render to update max frame input
                } else if(name === "currentFrame") {
                    this.currentFrame = parseInt(value);
                    this._updateCameraRotation();
                } else if(name === "renderMode") {
                    this.renderMode = value;
                    this.render(); // Toggle UI parts
                } else if(name === "outputPrefix") {
                    this.outputPrefix = value;
                } else if(name === "linkRotations") {
                    this.linkRotations = value;
                    if (this.linkRotations) {
                        // Sync current facing rotations to all others immediately
                        const adj = getAdj();
                        this._syncRotation("rx", adj.rx);
                        this._syncRotation("ry", adj.ry);
                        this._syncRotation("rz", adj.rz);
                    }
                } else {
                    this[name] = value;
                    if (name === "modelPath") await this._loadModel(value);
                    if (name === "facing") this.render();
                }
            });

            // Live preview for sliders
            if (el.type === "range") {
                el.addEventListener("input", (event) => {
                    const name = event.target.name;
                    const value = event.target.value;
                    const numValue = parseFloat(value);
                    const adj = getAdj();

                    if (name.startsWith("effect.")) {
                        const effectName = name.split(".")[1];
                        this.effects[effectName] = numValue;
                        // Find label in the parent form-group
                        const group = el.closest(".form-group");
                        const display = group ? group.querySelector(`.display-effect-${effectName}`) : null;
                        if (display) display.textContent = `- ${value}`;
                        this._drawThreeJSFrame();
                        return;
                    }

                    if (name === "zoom") {
                         this._syncZoom(numValue);
                         const zoomInput = this.element.querySelector('input[name="zoom"]');
                         this._updateLabel(zoomInput, "zoom", numValue);
                    }
                    else if (name === "ambientIntensity") {
                        this.ambientIntensity = numValue;
                        if (this.ambientLight) this.ambientLight.intensity = numValue;
                        
                        // Find label in parent group (it's now in the label, above form-fields)
                        const group = el.closest(".form-group");
                        // We use a slightly different selector or just generic class? 
                        // The template uses specific classes: .display-ambientIntensity
                        // Note: I put a hidden span in .form-fields in Previous Step for ambient? 
                        // No, I put: <label>Ambient Light <span class="value">- {{ambientIntensity}}</span></label>
                        // And <span class="range-value display-ambientIntensity" style="display:none">...</span> in fields (leftover?)
                        // I should target the one in the label. I didn't give the label span a class like 'display-ambientIntensity' in the previous step?
                        // Let's check previous step content.
                        
                        // Previous step content for Ambient:
                        // <label>Ambient Light <span class="value">- {{ambientIntensity}}</span></label>
                        // ... <span class="range-value display-ambientIntensity" style="display:none">
                        
                        // I forgot to add a class to the span in the label for Ambient! 
                        // For effects I added `display-effect-sepia`.
                        
                        // I need to fix the template for Ambient first to add a targeting class to the label span.
                        // OR just find the .value span inside the label.
                        
                        const labelValue = group.querySelector("label .value");
                        if (labelValue) labelValue.textContent = `- ${numValue}`;
                        return;
                    }
                    
                    this._updateCameraRotation();
                });
            }
        });

        // ... File Picker, Buttons etc ...
        html.querySelector(".file-picker").addEventListener("click", () => {
             new FilePicker({
                type: "model",
                callback: async (path) => {
                    this.modelPath = path;
                    html.querySelector('input[name="modelPath"]').value = path;
                    await this._loadModel(path);
                }
            }).browse();
        });

        html.querySelector(".render-btn").addEventListener("click", () => this._onRenderAndSave());
        html.querySelector(".render-all-btn").addEventListener("click", () => this._onRenderAll());
        
        const assignBtn = html.querySelector(".assign-actor-btn");
        if (assignBtn) {
            assignBtn.addEventListener("click", () => this._onProcessAndAssign());
        }

        html.querySelector(".reset-current-btn").addEventListener("click", () => {
            const adj = getAdj();
            const currentZoom = adj.zoom;
            // Reset values in place
            adj.rx = 0; adj.ry = 0; adj.rz = 0; adj.px = 0; adj.py = 0; adj.zoom = currentZoom;
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

    async _onRenderAndSave(target = null, notify = true) {
        if (!this.currentModel) {
            ui.notifications.warn("No model loaded to render.");
            return;
        }

        const prevFacing = this.facing;
        const prevFrame = this.currentFrame;

        // Context Switching
        let suffix = "";
        let displayLabel = "";

        if (this.renderMode === "numeric") {
            const frame = (target !== null) ? parseInt(target) : this.currentFrame;
            this.currentFrame = frame;
            // Pad based on max count? standardizing on 3 digits is safest for sorting
            const isTiny = this.frameCount < 10;
            const pad = isTiny ? 1 : 3;
            suffix = frame.toString().padStart(pad, '0'); 
            displayLabel = `Frame ${frame}`;
        } else {
            const face = (target !== null) ? target : this.facing;
            this.facing = face;
            suffix = face;
            displayLabel = face;
        }

        this._updateCameraRotation();

        const targetRes = parseInt(this.resolution);
        const originalWidth = this.renderer.domElement.width;
        const originalHeight = this.renderer.domElement.height;

        // Resize renderer for high-res render
        this.renderer.setSize(targetRes, targetRes, false);
        this._setupPostProcessing(targetRes);
        this._drawThreeJSFrame(false);

        // Extract WebP
        // Using high quality (0.9) to ensure crisp pixel art or smooth gradients
        const blob = await new Promise(resolve => this.renderer.domElement.toBlob(resolve, 'image/webp', 0.95));
        
        // Restore
        this.renderer.setSize(originalWidth, originalHeight, false);
        this.facing = prevFacing;
        this.currentFrame = prevFrame;
        this._updateCameraRotation();

        // Robust filename extraction
        let baseName = "";
        
        if (this.outputPrefix && this.outputPrefix.trim().length > 0) {
            baseName = this.outputPrefix.trim();
        } else {
            // Fallback to model name
            const cleanPath = decodeURIComponent(this.modelPath.split('?')[0]);
            const modelFile = cleanPath.split('/').pop();
            const lastDot = modelFile.lastIndexOf('.');
            baseName = lastDot > -1 ? modelFile.substring(0, lastDot) : modelFile;
        }
        
        // Light sanitization
        const safeBaseName = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
        const filename = `${safeBaseName}_${suffix}.webp`;
        
        // Settings-based Path
        // Check if we are operating on a tile or token/actor
        const isTile = this.document?.documentName === "Tile";
        const settingKey = isTile ? "tileSavePath" : "tokenSavePath";
        // Priority: Explicit Override > Settings > Default
        const uploadDir = this.savePath || game.settings.get("3d-to-iso", settingKey) || "isometric-renders";
        
        const file = new File([blob], filename, { type: "image/webp" });

        try {
            const response = await FilePicker.upload("data", uploadDir, file, {}, { notify: false });
            const actualPath = typeof response === "string" ? response : response.path;
            
            return actualPath;
        } catch (err) {
            ui.notifications.error(`Upload failed: ${err.message}. Make sure the target directory exists.`);
            return null;
        }
    }

    /* -------------------------------------------- */

    async _onRenderAll() {
        if (!this.currentModel) return ui.notifications.warn("No model loaded.");
        if (this._contextLost) return ui.notifications.error("Cannot render: WebGL Context Lost. Please wait for restoration or reload.");
        
        let targets = [];
        if (this.renderMode === "numeric") {
            // Warning for high frame counts
            if (this.frameCount > 36) {
                const confirmed = await Dialog.confirm({
                    title: game.i18n.localize("3D_TO_ISO.FrameCount"),
                    content: `<p>${game.i18n.localize("3D_TO_ISO.HighFrameCountWarning")}</p>`
                });
                if (!confirmed) return;
            }

            // Generate range 0..count-1
            targets = Array.from({length: this.frameCount}, (_, i) => i);
        } else {
            targets = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        }

        const total = targets.length;
        ui.notifications.info(game.i18n.format("3D_TO_ISO.BatchProgress", { current: 0, total: targets.length }));
        
        // Track blocking state for notifications
        this._waitingForRestore = false;
        let hadContextLoss = false;
      
        let count = 0;
        const results = {}; 
        
        for (let i = 0; i < targets.length; i++) {
             const t = targets[i];

             // 1. Pause if Context Lost
             while (this._contextLost) {
                 if (!this._waitingForRestore) {
                     console.warn("3D-to-Iso: Pausing render batch for WebGL restoration...");
                     ui.notifications.warn("WebGL Context Lost. Pausing batch render...", {permanent: false});
                     this._waitingForRestore = true;
                     hadContextLoss = true;
                 }
                 await new Promise(resolve => setTimeout(resolve, 500));
             }
             
             // 2. Resume after Restore
             if (this._waitingForRestore) {
                 console.log("3D-to-Iso: Resuming render batch...");
                 ui.notifications.info("WebGL Context Restored. Resuming...", {permanent: false});
                 this._waitingForRestore = false;
                 // Allow strict 1 sec for things to settle
                 await new Promise(resolve => setTimeout(resolve, 1000));
             }

             // 3. Render
             // Pass notify=false to avoid spam
             const path = await this._onRenderAndSave(t, false);
             
             // 4. Verify Context Integrity Post-Render
             // If context was lost DURING the render, the result is likely garbage/empty.
             if (this._contextLost) {
                 console.warn(`3D-to-Iso: Context lost during frame ${t}. Retrying...`);
                 hadContextLoss = true;
                 i--; // Retry this frame
                 continue;
             }

             results[t] = path;
             count++;
             
             // Update progress every 10 frames or so to not spam UI updates but give feedback
             if (count % 10 === 0) {
                 ui.notifications.info(game.i18n.format("3D_TO_ISO.BatchProgress", { current: count, total: total }));
             }

             // Yield to main thread to prevent context loss from timeout
             // Slightly increased delay to be safer
             await new Promise(resolve => setTimeout(resolve, 20));
        }
        
        ui.notifications.info(`Render Complete! ${count}/${total} images generated.`);
        
        if (hadContextLoss) {
            ui.notifications.warn("WebGL Context was lost and restored during this process. It is recommended to Reload Foundry VTT to ensure system stability.", {permanent: true});
        }
        
        return results;
    }

    /* -------------------------------------------- */

    async _onProcessAndAssign() {
        if (!this.document) return ui.notifications.warn("No target document for this operation.");
        if (!this.modelPath) return ui.notifications.warn("No model selected.");

        // 1. Perform batch render
        const paths = await this._onRenderAll();
        // Check if we got results. Result keys might be numbers or strings.
        const keys = Object.keys(paths);
        if (!paths || keys.length === 0) return;

        // 2. Save settings to Document flags (Tile, Token, or Actor)
        await this.document.setFlag("3d-to-iso", "modelPath", this.modelPath);
        await this.document.setFlag("3d-to-iso", "adjustments", this.adjustments);
        await this.document.setFlag("3d-to-iso", "facingMode", this.renderMode); // Save Mode!

        // 3. Update the available facings flag
        if (keys.length > 0) {
            // Re-derive suffixes from logic used in _onRenderAndSave
            let storedFacings = [];
            if (this.renderMode === "numeric") {
                const isTiny = this.frameCount < 10;
                const pad = isTiny ? 1 : 3;
                storedFacings = keys.map(k => parseInt(k).toString().padStart(pad, '0'));
            } else {
                storedFacings = keys;
            }
            
            await this.document.setFlag("3d-to-iso", "availableFacings", storedFacings);
        }

        // Pick the "first" image to set as default.
        let primaryKey = keys[0];
        if (this.renderMode === "cardinal" && paths.NE) primaryKey = "NE";
        if (this.renderMode === "numeric") primaryKey = keys[0]; // Frame 0

        const primaryPath = paths[primaryKey];
        const isTile = this.document.documentName === "Tile";

        // 4. Update the document
        if (isTile) {
            await this.document.update({
                _id: this.document.id,
                "texture.src": primaryPath,
                "flags.3d-to-iso.enabled": true
            }, { from3DApp: true });
        } else {
            // Actor / Token Logic
            // If we have a specific Token instance targeted
            if (this.token && this.token instanceof TokenDocument) {
                await this.token.update({
                    "texture.src": primaryPath,
                    "flags.3d-to-iso.enabled": true
                }, { from3DApp: true });
            }
            
            // If we have an Actor, update prototype (if it's an Actor document)
            if (this.actor && this.actor.documentName === "Actor") {
                await this.actor.update({
                    "prototypeToken.texture.src": primaryPath,
                    "prototypeToken.flags.3d-to-iso.enabled": true
                });
            }
        }

        ui.notifications.info(`Successfully assigned 3D renders to ${this.document.name || this.document.id}.`);
        this.close();
    }

    /* -------------------------------------------- */

    _setupPostProcessing(size) {
        // Dispose old targets
        if (this.postProcessing.bufferA) this.postProcessing.bufferA.dispose();
        if (this.postProcessing.bufferB) this.postProcessing.bufferB.dispose();
        
        // Create Double Buffers
        const params = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
        this.postProcessing.bufferA = new THREE.WebGLRenderTarget(size, size, params);
        this.postProcessing.bufferB = new THREE.WebGLRenderTarget(size, size, params);
        
        // Setup Post Scene (Single Quad, material swapped per pass)
        this.postProcessing.scene = new THREE.Scene();
        this.postProcessing.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        const geom = new THREE.PlaneGeometry(2, 2);
        
        // --- Create Materials for each effect ---
        
        // 1. Sepia
        this.postProcessing.materials.sepia = new THREE.ShaderMaterial({
            vertexShader: POST_VERTEX_SHADER,
            fragmentShader: SEPIA_FRAGMENT_SHADER,
            uniforms: {
                tDiffuse: { value: null },
                intensity: { value: 0 }
            }
        });

        // 2. Pixel
        this.postProcessing.materials.pixel = new THREE.ShaderMaterial({
            vertexShader: POST_VERTEX_SHADER,
            fragmentShader: PIXEL_FRAGMENT_SHADER,
            uniforms: {
                tDiffuse: { value: null },
                resolution: { value: new THREE.Vector2(size, size) },
                intensity: { value: 0 }
            }
        });

        // 3. Sketch
        this.postProcessing.materials.sketch = new THREE.ShaderMaterial({
            vertexShader: POST_VERTEX_SHADER,
            fragmentShader: SKETCH_FRAGMENT_SHADER,
            uniforms: {
                tDiffuse: { value: null },
                resolution: { value: new THREE.Vector2(size, size) },
                intensity: { value: 0 }
            }
        });

        // Quad gets a dummy material initially
        this.postProcessing.quad = new THREE.Mesh(geom, this.postProcessing.materials.sepia); 
        this.postProcessing.scene.add(this.postProcessing.quad);
    }

    /* -------------------------------------------- */

    _onClose(options) {
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        if (this.transformControl) {
            this.transformControl.dispose();
            this.transformControl = null;
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
