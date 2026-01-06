const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * ApplicationV2 for configuring GIF Import settings.
 */
export class GifImportConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.frameCount = options.frameCount;
        this.defaultColor = options.defaultColor;
        this.previewUrl = options.previewUrl;
        this.resolve = options.resolve;
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "gif-importer-config",
        classes: ["gif-importer-config", "standard-form"],
        window: {
            title: "Import Animated GIF",
            icon: "fas fa-film",
            resizable: false
        },
        position: {
            width: 500,
            height: "auto"
        },
        form: {
            handler: GifImportConfig.formHandler,
            submitOnChange: false,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "modules/3d-to-iso/templates/gif-importer-config.hbs"
        }
    };

    /**
     * Wait for user input.
     * @param {number} frameCount 
     * @param {string} defaultColor 
     * @param {string} previewUrl 
     * @returns {Promise<object|null>} Configuration object or null if cancelled.
     */
    static async wait(frameCount, defaultColor, previewUrl) {
        return new Promise((resolve) => {
            new GifImportConfig({
                frameCount,
                defaultColor,
                previewUrl,
                resolve
            }).render(true);
        });
    }

    async _prepareContext(options) {
        const targetFrames = 32;
        const defaultStep = Math.max(1, Math.round(this.frameCount / targetFrames));
        const resultFrames = Math.ceil(this.frameCount / defaultStep);

        return {
            frameCount: this.frameCount,
            defaultColor: this.defaultColor,
            previewUrl: this.previewUrl,
            defaultStep: defaultStep,
            resultFrames: resultFrames
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        
        // Live Sample Rate Calculation
        const sampleInput = this.element.querySelector('input[name="sampleRate"]');
        const output = this.element.querySelector('#calc-frames');
        
        if (sampleInput && output) {
            sampleInput.addEventListener("input", () => {
                const val = parseInt(sampleInput.value) || 1;
                output.textContent = Math.ceil(this.frameCount / val);
            });
        }
    }

    static async formHandler(event, form, formData) {
        const config = {
            removeBackground: formData.object.removeBackground,
            keyColor: formData.object.keyColor,
            tolerance: formData.object.tolerance,
            sampleRate: formData.object.sampleRate
        };
        
        this.resolve(config);
    }

    _onClose(options) {
        // If resolved already (via submit), this is a no-op. 
        // If closed without submit, resolve null.
        // We can check if it's already resolved implicitly by tracking state or just resolving null (Promise ignores subsequent resolves)
        this.resolve(null); 
    }
}
