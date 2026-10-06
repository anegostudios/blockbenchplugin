/**
 * Interfaces that define the structure of Vintage Story shape files.
 * Remember to run 'npm run gen_schema' after modifying this file to generate the updated JSON schema for validation.
 */

export interface VS_Shape {
    editor?: VS_EditorSettings | undefined,
    textureWidth?: number,
    textureHeight?: number,
    textureSizes?: Record<string, [number,number]>,
    textures: Record<string, string>,
    elements: Array<VS_Element>,
    animations?: Array<VS_Animation>,
    animationLibraries?: Array<string>,
}

/**
 * Standalone animation library file format. Mirrors the C# AnimationLibrary class.
 * Library files live under `assets/<domain>/animations/<path>.json` and are referenced
 * from a Shape's `animationLibraries` property. The host shape merges library animations
 * into its own `Animations[]` at load time, keyed by `Animation.code`.
 */
export interface VS_AnimationLibrary {
    code?: string,
    name?: string,
    animations: Array<VS_Animation>,
}

export interface VS_EditorSettings {
    backDropShape?: string,
    collapsedPaths?: string,
    allAngles?: boolean,
    entityTextureMode?: boolean,
    singleTexture?: boolean,
}

/**
 * Json Attributes also include
 * ScaleX, ScaleY, ScaleZ
 * but they are not used by any VS shape files currently.
 */
export interface VS_Element {
    name: string,
    from: [number, number, number],
    to: [number, number, number],
    unwrapMode?: number,
    unwrapRotation?: number,
    autoUnwrap?: boolean,
    disableRandomDrawOffset?: boolean,
    climateColorMap?: string,
    gradientShade?: boolean,
    renderPass?: number,
    paletteSlot?: number,
    seasonColorMap?: string,
    shade?: boolean,
    uv?: [number,number],
    rotationOrigin?: [number,number,number]
    rotationX?: number,
    rotationY?: number,
    rotationZ?: number,
    faces?: Partial<Record<VS_Direction,VS_Face>>,
    stepParentName?: string,
    attachmentpoints?: Array<VS_AttachmentPoint>,
    children?: Array<VS_Element>,
}

export enum VS_Direction{ NORTH ="north", EAST = "east", SOUTH =  "south", WEST = "west", UP = "up", DOWN = "down"}

export interface VS_Face {
    texture: string,
    enabled?: boolean,
    glow?: number,
    reflectiveMode?: VS_ReflectiveMode,
    uv?: [number,number,number,number],
    rotation?: number,
    autoUv?: boolean,
    snapUv?: boolean,
    windMode?: [number,number,number,number],
    windData?: [number,number,number,number],
}

export enum VS_ReflectiveMode{NONE = 0, WEAK = 1, MEDIUM = 2, STRONG = 3, SPARKLY = 4, MILD = 5}

/**
 * Json Attributes also include
 * Version
 * but they are not used by any VS shape files currently.
 */
export interface VS_Animation {
    name: string,
    code: string,
    quantityframes: number,
    onActivityStopped: VS_OnActivityStopped,
    onAnimationEnd: VS_OnAnimationEnd,
    easeAnimationSpeed?: boolean,
    keyframes: Array<VS_Keyframe>
}

export type VS_OnActivityStopped = "PlayTillEnd" | "Rewind" | "Stop" | "EaseOut"

export type VS_OnAnimationEnd = "Hold" | "Repeat" | "Stop" | "EaseOut"

export interface VS_Keyframe {
    frame: number,
    elements: Record<string, VS_AnimationKey>,
    textures?: Record<string, string>,
    particles?: Array<VS_AnimationParticle>,
    sounds?: Array<VS_AnimationSound>,
}

export interface VS_AnimationSound {
    location: string,
    range?: number,
    volume?: number,
    pitch?: number,
    chance?: number,
    looping?: boolean,
}

/**
 * A one-shot particle effect trigger on a keyframe. Read by GlintMod's snowstorm
 * particle system (SnowstormAnimationParticles); the base game ignores it.
 */
export interface VS_AnimationParticle {
    /** Snowstorm particle effect identifier, e.g. "bruister_feathers" */
    effect: string,
    /** Attachment point (Blockbench locator) the effect spawns at; entity center when omitted */
    atAttachmentPoint?: string,
}

/**
 * Per-channel interpolation mode for the OUTGOING segment from this keyframe to
 * the next. Linear is the default and matches the engine's legacy behaviour.
 * Bezier is a cubic bezier defined by a tangent slope plus a handle width per axis;
 * Step holds the previous value until the next keyframe.
 */
export type VS_KeyFrameInterpolation = "Linear" | "Bezier" | "Step"

/**
 * Json Attributes also include
 * OriginX, OriginY, OriginZ
 * but they are not used by any VS shape files currently.
 */
export interface VS_AnimationKey {
    offsetX?: number,
    offsetY?: number,
    offsetZ?: number,
    rotationX?: number,
    rotationY?: number,
    rotationZ?: number,
    rotShortestDistanceX?: boolean,
    rotShortestDistanceY?: boolean,
    rotShortestDistanceZ?: boolean,
    stretchX?: number,
    stretchY?: number,
    stretchZ?: number,

    positionInterp?: VS_KeyFrameInterpolation,
    rotationInterp?: VS_KeyFrameInterpolation,
    scaleInterp?: VS_KeyFrameInterpolation,

    // Cubic bezier handle tangent slopes in value-per-segment-t units. Non-null only when
    // the corresponding channel uses bezier interpolation.
    offsetTangentInX?: number,
    offsetTangentInY?: number,
    offsetTangentInZ?: number,
    offsetTangentOutX?: number,
    offsetTangentOutY?: number,
    offsetTangentOutZ?: number,

    rotationTangentInX?: number,
    rotationTangentInY?: number,
    rotationTangentInZ?: number,
    rotationTangentOutX?: number,
    rotationTangentOutY?: number,
    rotationTangentOutZ?: number,

    stretchTangentInX?: number,
    stretchTangentInY?: number,
    stretchTangentInZ?: number,
    stretchTangentOutX?: number,
    stretchTangentOutY?: number,
    stretchTangentOutZ?: number,

    // Horizontal extent (in frames) of each bezier handle, mirroring Blockbench's
    // bezier_*_time. Together with the tangent slope this pins the cubic control point so
    // non-1/3 handle widths survive. Out-widths >= 0, in-widths <= 0. Omitted when equal to
    // the +/-1/3-of-segment default (the engine then falls back to the glTF Hermite curve).
    offsetTangentInWidthX?: number,
    offsetTangentInWidthY?: number,
    offsetTangentInWidthZ?: number,
    offsetTangentOutWidthX?: number,
    offsetTangentOutWidthY?: number,
    offsetTangentOutWidthZ?: number,

    rotationTangentInWidthX?: number,
    rotationTangentInWidthY?: number,
    rotationTangentInWidthZ?: number,
    rotationTangentOutWidthX?: number,
    rotationTangentOutWidthY?: number,
    rotationTangentOutWidthZ?: number,

    stretchTangentInWidthX?: number,
    stretchTangentInWidthY?: number,
    stretchTangentInWidthZ?: number,
    stretchTangentOutWidthX?: number,
    stretchTangentOutWidthY?: number,
    stretchTangentOutWidthZ?: number,
}

export type VS_AnimationNumericField = {
    [K in keyof VS_AnimationKey]-?: VS_AnimationKey[K] extends number | undefined ? K : never;
}[keyof VS_AnimationKey];

export type VS_AnimationInterpolationField = 'positionInterp' | 'rotationInterp' | 'scaleInterp';

/**
 * In VS shape files, attachment point numeric values are stored as strings.
 * Other numeric values in VS_Element (like from, to, rotation) are stored as actual numbers.
 */
export interface VS_AttachmentPoint {
    code: string,
    posX: string,
    posY: string,
    posZ: string,
    rotationX: string,
    rotationY: string,
    rotationZ: string,
}
