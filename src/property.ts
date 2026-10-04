import { VS_Direction, VS_Face, VS_ReflectiveMode } from "./vs_shape_def";

for (const name of ['vs_code', 'vs_onActivityStopped', 'vs_onAnimationEnd', 'vs_library_ref']) {
    new Property(Blockbench.Animation, 'string', name, { exposed: false });
}

export const VS_PROJECT_PROPS = [
    new Property(ModelProject, "string", "backDropShape", { exposed: false, }),
    new Property(ModelProject, "string", "collapsedPaths", { exposed: false, }),
    new Property(ModelProject, "boolean", "allAngles", { exposed: false, }),
    new Property(ModelProject, "boolean", "entityTextureMode", { exposed: false, }),
    new Property(ModelProject, "boolean", "singleTexture", { exposed: false, }),
    new Property(ModelProject, "boolean", "vsFormatConverted", { exposed: false, }),
];

type InternalPropertyType = 'vector' | 'vector2' | 'object' | 'boolean';

function isFiniteVector(value: unknown, length: 2 | 3): boolean {
    return Array.isArray(value)
        && value.length === length
        && value.every(component => typeof component === 'number' && Number.isFinite(component));
}

function isNonEmptyRecord(value: unknown): boolean {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.keys(value).length > 0;
}

function registerOptionalInternalProperty(
    targetClass: any,
    type: InternalPropertyType,
    name: string,
    validate: (value: unknown, container?: any) => boolean,
) {
    return new Property(targetClass, type, name, {
        exposed: false,
        condition(instance: any) {
            return validate(instance?.[name], instance);
        },
        reset(instance: any) {
            delete instance[name];
        },
        merge(instance: any, data: any) {
            const value = data?.[name];
            if (!validate(value, data)) return;
            if (Array.isArray(value)) {
                instance[name] = value.slice();
            } else if (value !== null && typeof value === 'object') {
                instance[name] = structuredClone(value);
            } else {
                instance[name] = value;
            }
        },
    });
}

function registerStepParentTransformProperties(targetClass: any) {
    registerOptionalInternalProperty(
        targetClass,
        'boolean',
        'vs_step_parent_local',
        value => value === true
    );
    registerOptionalInternalProperty(
        targetClass,
        'boolean',
        'vs_has_step_parent_transform',
        value => value === true
    );

    for (const name of ['vs_step_parent_origin', 'vs_step_parent_rotation']) {
        registerOptionalInternalProperty(
            targetClass,
            'vector',
            name,
            (value, container) => container?.vs_has_step_parent_transform === true && isFiniteVector(value, 3)
        );
    }
}

const PALETTE_SLOT_OPTIONS = {
    '0': '0 - Inherit / Default',
    '1': '1',
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '7': '7',
};

function registerPaletteSlotProperty(targetClass: any) {
    const property = new Property(targetClass, 'number', 'paletteSlot', {
        default: 0,
        label: 'Palette Slot',
        exposed: true,
        options: PALETTE_SLOT_OPTIONS,
        inputs: {
            element_panel: {
                input: {
                    label: 'Palette Slot',
                    type: 'select',
                    options: PALETTE_SLOT_OPTIONS,
                },
            },
        },
    });

    return property;
}

export const VS_GROUP_PROPS = [
    new Property(Group, "string", "stepParentName", {
        default: '',
        label: "Step Parent",
        exposed: true,
        inputs: {
            element_panel: {
                input: {
                    label: 'Step Parent',
                    type: 'text'
                }
            }
        },
        onChange() {
            Canvas.updateAllBones();
            Canvas.updateAllPositions();
        },
    }),
    registerPaletteSlotProperty(Group),
];

// Blockbench-only properties (not exported to VS JSON format)
new Property(Group, "string", "clothingSlot", {
    default: '',
    label: "Clothing Slot",
    exposed: true,
    options: () => {
        const { getActiveSlotNames } = require('./attachments/presets');
        const slots = getActiveSlotNames();
        const options: {[key: string]: string} = { '': 'None' };
        slots.forEach((slot: string) => {
            options[slot] = slot;
        });
        return options;
    },
    inputs: {
        element_panel: {
            input: {
                label: 'Clothing Slot',
                type: 'select',
                options: () => {
                    const { getActiveSlotNames } = require('./attachments/presets');
                    const slots = getActiveSlotNames();
                    const options: {[key: string]: string} = { '': 'None' };
                    slots.forEach((slot: string) => {
                        options[slot] = slot;
                    });
                    return options;
                }
            }
        }
    },
    onChange() {
        try {
            if ((Interface as any).Panels?.attachments_panel?.vue) {
                (Interface as any).Panels.attachments_panel.vue.updateAttachments();
            }
        } catch (e) {
            console.warn('Could not refresh attachments panel:', e);
        }
    },
});

new Property(Group, "boolean", "backdrop");

// Blockbench-only attachment round-trip metadata. The boolean flags gate the
// vector values so their default [0, 0, 0] cannot be mistaken for authored data.
registerStepParentTransformProperties(Group);

// Internal VS round-trip values. These stay out of VS_GROUP_PROPS so they are
// saved in .bbmodel projects without being emitted as Vintage Story JSON keys.
registerOptionalInternalProperty(Group, 'vector', 'vs_group_from', value => isFiniteVector(value, 3));
registerOptionalInternalProperty(Group, 'vector', 'vs_group_to', value => isFiniteVector(value, 3));
registerOptionalInternalProperty(Group, 'boolean', 'vs_has_rotation_origin', value => value === true);
registerOptionalInternalProperty(Group, 'object', 'vs_zero_size_faces', isNonEmptyRecord);
registerOptionalInternalProperty(Group, 'vector2', 'vs_uv', value => isFiniteVector(value, 2));

export const VS_CUBE_PROPS = [
    new Property(Cube, "string", "stepParentName", {
        default: '',
        label: "Step Parent",
        exposed: true,
        inputs: {
            element_panel: {
                input: {
                    label: 'Step Parent',
                    type: 'text'
                }
            }
        },
        onChange() {
            Canvas.updateAllBones();
            Canvas.updateAllPositions();
        },
    }),
    registerPaletteSlotProperty(Cube),
    new Property(Cube, "boolean", "shade", {
        default: true,
        label: "Shade",
        exposed: true,
        inputs: {
            element_panel: {
                input: {
                    label: 'Shade',
                    type: 'checkbox'
                }
            }
        },
    }),
    new Property(Cube, "string", "climateColorMap", {
        default: '',
        label: "Climate Color Map",
        exposed: true,
        inputs: {
            element_panel: {
                input: {
                    label: 'Climate Color Map',
                    type: 'text'
                }
            }
        },
    }),
    new Property(Cube, "boolean", "gradientShade", {
        default: false,
        label: "Gradient Shade",
        exposed: true,
        inputs: {
            element_panel: {
                input: {
                    label: 'Gradient Shade',
                    type: 'checkbox'
                }
            }
        },
    }),
    new Property(Cube, "number", "renderPass", {
        default: -1,
        label: "Render Pass",
        exposed: true,
        options: {
            '-1': 'Default',
            '0': 'Opaque',
            '1': 'OpaqueNoCull',
            '2': 'BlendNoCull',
            '3': 'Transparent',
            '4': 'Liquid',
            '5': 'TopSoil',
            '6': 'Meta',
        },
        inputs: {
            element_panel: {
                input: {
                    label: 'Render Pass',
                    type: 'select',
                    options: {
                        '-1': 'Default',
                        '0': 'Opaque',
                        '1': 'OpaqueNoCull',
                        '2': 'BlendNoCull',
                        '3': 'Transparent',
                        '4': 'Liquid',
                        '5': 'TopSoil',
                        '6': 'Meta',
                    }
                }
            }
        },
    }),
    new Property(Cube, "string", "seasonColorMap", {
        default: '',
        label: "Season Color Map",
        exposed: true,
        inputs: {
            element_panel: {
                input: {
                    label: 'Season Color Map',
                    type: 'text'
                }
            }
        },
    }),
    new Property(Cube, "number", "unwrapMode", {
        default: 0,
        label: "Unwrap Mode",
        exposed: false,
    }),
    new Property(Cube, "boolean", "autoUnwrap", {
        default: false,
        label: "Auto Unwrap",
        exposed: false,
    }),
    new Property(Cube, "boolean", "disableRandomDrawOffset", {
        default: false,
        label: "Disable Random Draw Offset",
        exposed: false,
    }),
    new Property(Cube, "number", "unwrapRotation", {
        default: 0,
        label: "Unwrap Rotation",
        exposed: false,
    }),
];

// Blockbench-only properties (not exported to VS JSON format)
new Property(Cube, "string", "clothingSlot", {
    default: '',
    label: "Clothing Slot",
    exposed: true,
    options: () => {
        const { getActiveSlotNames } = require('./attachments/presets');
        const slots = getActiveSlotNames();
        const options: {[key: string]: string} = { '': 'None' };
        slots.forEach((slot: string) => {
            options[slot] = slot;
        });
        return options;
    },
    inputs: {
        element_panel: {
            input: {
                label: 'Clothing Slot',
                type: 'select',
                options: () => {
                    const { getActiveSlotNames } = require('./attachments/presets');
                    const slots = getActiveSlotNames();
                    const options: {[key: string]: string} = { '': 'None' };
                    slots.forEach((slot: string) => {
                        options[slot] = slot;
                    });
                    return options;
                }
            }
        }
    },
    onChange() {
        try {
            if ((Interface as any).Panels?.attachments_panel?.vue) {
                (Interface as any).Panels.attachments_panel.vue.updateAttachments();
            }
        } catch (e) {
            console.warn('Could not refresh attachments panel:', e);
        }
    },
});

new Property(Cube, "boolean", "backdrop");
registerStepParentTransformProperties(Cube);

registerOptionalInternalProperty(Cube, 'boolean', 'vs_has_rotation_origin', value => value === true);
registerOptionalInternalProperty(Cube, 'vector2', 'vs_uv', value => isFiniteVector(value, 2));

export const VS_TEXTURE_PROPS = [
    new Property(Texture, "string", "textureLocation", {
        default: '',
        label: "Texture Location",
        exposed: true,
        inputs: {
            element_panel: {
                input: {
                    label: 'Texture Location',
                    type: 'text'
                }
            }
        },
    }),
];

export const VS_LOCATOR_PROPS = [
    new Property(Locator, "number", "rotationX", { default: 0 }),
    new Property(Locator, "number", "rotationY", { default: 0 }),
    new Property(Locator, "number", "rotationZ", { default: 0 }),
];

export const VS_FACE_PROPS = [
    new Property(CubeFace, "number", "glow"),
    new Property(CubeFace, "number", "reflectiveMode"),
    new Property(CubeFace, "array", "windMode"),
    new Property(CubeFace, "array", "windData"),
    new Property(CubeFace, "boolean", "autoUv", { default: false }),
    new Property(CubeFace, "boolean", "snapUv", { default: false }),
];

/**
 * Extend Blockbench types with our custom properties
 */
declare global {
    interface Face {
        glow?: number;
        reflectiveMode?: VS_ReflectiveMode;
        windMode?: [number, number, number, number];
        windData?: [number, number, number, number];
        autoUv?: boolean;
        snapUv?: boolean;
    }

    interface Texture {
        textureLocation?: string;
    }

    interface ModelProject {
        backDropShape?: string;
        allAngles?: boolean;
        entityTextureMode?: boolean;
        collapsedPaths?: string;
        singleTexture?: boolean;
        vsFormatConverted?: boolean;
    }

    interface Group {
        stepParentName?: string;
        paletteSlot?: number;
        clothingSlot?: string;
        backdrop?: boolean;
        vs_step_parent_local?: boolean;
        vs_has_step_parent_transform?: boolean;
        vs_step_parent_origin?: [number, number, number];
        vs_step_parent_rotation?: [number, number, number];
        vs_group_from?: [number, number, number];
        vs_group_to?: [number, number, number];
        vs_has_rotation_origin?: boolean;
        vs_zero_size_faces?: Partial<Record<VS_Direction, VS_Face>>;
        vs_uv?: [number, number];
    }

    interface Cube {
        stepParentName?: string;
        paletteSlot?: number;
        clothingSlot?: string;
        climateColorMap?: string;
        gradientShade?: boolean;
        renderPass?: number;
        seasonColorMap?: string;
        unwrapMode?: number;
        autoUnwrap?: boolean;
        disableRandomDrawOffset?: boolean;
        unwrapRotation?: number;
        backdrop?: boolean;
        vs_step_parent_local?: boolean;
        vs_has_step_parent_transform?: boolean;
        vs_step_parent_origin?: [number, number, number];
        vs_step_parent_rotation?: [number, number, number];
        vs_has_rotation_origin?: boolean;
        vs_uv?: [number, number];
    }

    interface Locator {
        rotationX?: number;
        rotationY?: number;
        rotationZ?: number;
    }
}
