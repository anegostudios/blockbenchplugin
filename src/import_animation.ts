import * as util from "./util";
import { VS_Animation, VS_AnimationKey, VS_AnimationNumericField, VS_AnimationInterpolationField, VS_KeyFrameInterpolation } from "./vs_shape_def";
import { particle_data_point } from "./animation_particles";
import { sound_data_point } from "./animation_sounds";
import { collect_extras } from "./preserved_props";

/**
 * Creates one Blockbench animation from a VS animation definition and returns it.
 * When `path` is given the animation is associated with that library file (so the
 * ANIMATIONS panel groups it under the file and saves route back to it); `saved_name`
 * records the name it currently has on disk. Path-less animations are "inline" and
 * round-trip into the shape's own `animations[]` on export.
 */
export function create_animation(vsAnimation: VS_Animation, path?: string, saved_name?: string): _Animation {
    const FPS = util.fps;
    const animationLength = vsAnimation.quantityframes / FPS;
    const isLooping = vsAnimation.onAnimationEnd === 'Repeat';

    const animation = new Blockbench.Animation({
        name: vsAnimation.name,
        path: path || '',
        loop: isLooping ? 'loop' : (vsAnimation.onAnimationEnd === 'Hold' ? 'hold' : 'once'),
        length: animationLength,
        snapping: FPS
    }).add();

    // Associate with a library file when loaded from one (drives panel grouping + saving).
    if (path) animation.path = path;
    if (saved_name) {
        animation.saved_name = saved_name;
        animation.saved = true;
    }

    // Preserve VS-specific animation properties for round-trip fidelity
    animation.vs_code = vsAnimation.code;
    animation.vs_onActivityStopped = vsAnimation.onActivityStopped;
    animation.vs_onAnimationEnd = vsAnimation.onAnimationEnd;

    store_animation_extras(animation, vsAnimation);

    // Per-bone, per-channel sorted frame lists so bezier handle widths can be placed against the
    // correct segment (mirrors the engine's per-channel keyframe walk).
    const channelFrames = buildChannelFrames(vsAnimation);

    vsAnimation.keyframes.forEach(vsKeyframe => {
        // Particle triggers live on the effect animator (Blockbench's Effects > Particle channel)
        if (vsKeyframe.particles && vsKeyframe.particles.length > 0) {
            const effects = getEffectAnimator(animation);
            effects.addKeyframe({
                channel: 'particle',
                time: vsKeyframe.frame / FPS,
                data_points: vsKeyframe.particles.map(p => particle_data_point(p.effect, p.atAttachmentPoint)),
            });
        }

        if (vsKeyframe.sounds && vsKeyframe.sounds.length > 0) {
            getEffectAnimator(animation).addKeyframe({
                channel: 'sound',
                time: vsKeyframe.frame / FPS,
                data_points: vsKeyframe.sounds.map(s => sound_data_point(s)),
            });
        }

        if (vsKeyframe.textures) {
            getEffectAnimator(animation).addKeyframe({
                channel: 'timeline',
                time: vsKeyframe.frame / FPS,
                data_points: [{ script: `"textures": ${JSON.stringify(vsKeyframe.textures)}` }],
            });
        }

        for (const boneName in vsKeyframe.elements) {
            const transform = vsKeyframe.elements[boneName];
            let bone = Group.all.find(g => g.name === boneName);
            if (!bone) {
                const cube = Cube.all.find(c => c.name === boneName);
                if (cube) {
                    bone = new Group(cube.getSaveCopy()).sortInBefore(cube).init();
                    cube.name = `${boneName}_geo`;
                    cube.rotation = [0, 0, 0];
                    cube.stepParentName = '';
                    cube.addTo(bone);
                    Canvas.updateAllPositions();
                }
            }
            if (!bone) continue;

            const animator = animation.getBoneAnimator(bone);
            const frames = channelFrames[boneName];
            (Object.keys(IMPORT_CHANNELS) as BBImportChannel[]).forEach(channel => {
                const opts = buildChannelKeyframeOptions(transform, channel, vsKeyframe.frame, frames[channel], FPS);
                if (opts) animator.addKeyframe(opts);
            });
        }
    });

    return animation;
}

/**
 * Imports inline (shape-embedded) animations from the Vintage Story format into Blockbench.
 * These are not tied to a library file, so they round-trip back into the shape's own
 * `animations[]` on export.
 * @param {Array<object>} animations The array of animation data from the VS model file.
 */
export function import_animations(animations: Array<VS_Animation>) {
    animations.forEach(vsAnimation => create_animation(vsAnimation));
};

function getEffectAnimator(animation: _Animation): any {
    const animators = animation.animators as any;
    if (animators.effects) return animators.effects;
    animators.effects = new (EffectAnimator as any)(animation);
    return animators.effects;
}

type BBImportChannel = 'rotation' | 'position' | 'scale';

interface ImportChannelConfig {
    interp: VS_AnimationInterpolationField;
    value: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField];
    tangentIn: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField];
    tangentOut: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField];
    widthIn: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField];
    widthOut: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField];
    default: number;
}

const IMPORT_CHANNELS: Record<BBImportChannel, ImportChannelConfig> = {
    rotation: {
        interp: 'rotationInterp',
        value: ['rotationX', 'rotationY', 'rotationZ'],
        tangentIn: ['rotationTangentInX', 'rotationTangentInY', 'rotationTangentInZ'],
        tangentOut: ['rotationTangentOutX', 'rotationTangentOutY', 'rotationTangentOutZ'],
        widthIn: ['rotationTangentInWidthX', 'rotationTangentInWidthY', 'rotationTangentInWidthZ'],
        widthOut: ['rotationTangentOutWidthX', 'rotationTangentOutWidthY', 'rotationTangentOutWidthZ'],
        default: 0,
    },
    position: {
        interp: 'positionInterp',
        value: ['offsetX', 'offsetY', 'offsetZ'],
        tangentIn: ['offsetTangentInX', 'offsetTangentInY', 'offsetTangentInZ'],
        tangentOut: ['offsetTangentOutX', 'offsetTangentOutY', 'offsetTangentOutZ'],
        widthIn: ['offsetTangentInWidthX', 'offsetTangentInWidthY', 'offsetTangentInWidthZ'],
        widthOut: ['offsetTangentOutWidthX', 'offsetTangentOutWidthY', 'offsetTangentOutWidthZ'],
        default: 0,
    },
    scale: {
        interp: 'scaleInterp',
        value: ['stretchX', 'stretchY', 'stretchZ'],
        tangentIn: ['stretchTangentInX', 'stretchTangentInY', 'stretchTangentInZ'],
        tangentOut: ['stretchTangentOutX', 'stretchTangentOutY', 'stretchTangentOutZ'],
        widthIn: ['stretchTangentInWidthX', 'stretchTangentInWidthY', 'stretchTangentInWidthZ'],
        widthOut: ['stretchTangentOutWidthX', 'stretchTangentOutWidthY', 'stretchTangentOutWidthZ'],
        default: 1,
    },
};

const ANIMATION_KNOWN_KEYS = new Set([
    'name', 'code', 'quantityframes', 'onActivityStopped', 'onAnimationEnd', 'keyframes',
]);
const KEYFRAME_KNOWN_KEYS = new Set(['frame', 'elements', 'textures', 'particles', 'sounds']);
const ANIMATION_KEY_KNOWN_KEYS = new Set<string>(
    (Object.keys(IMPORT_CHANNELS) as BBImportChannel[]).flatMap(channel => {
        const cfg = IMPORT_CHANNELS[channel];
        return [cfg.interp, ...cfg.value, ...cfg.tangentIn, ...cfg.tangentOut, ...cfg.widthIn, ...cfg.widthOut];
    }) as string[]
);

function store_animation_extras(animation: _Animation, vsAnimation: VS_Animation) {
    const animationExtras = collect_extras(vsAnimation, ANIMATION_KNOWN_KEYS);
    if (animationExtras) animation.vs_extra_props = animationExtras;

    const keyframeExtras: Record<string, Record<string, unknown>> = {};
    const elementExtras: Record<string, Record<string, Record<string, unknown>>> = {};

    vsAnimation.keyframes.forEach(vsKeyframe => {
        const frame = String(vsKeyframe.frame);
        const extras = collect_extras(vsKeyframe, KEYFRAME_KNOWN_KEYS);
        if (extras) keyframeExtras[frame] = extras;

        for (const boneName in vsKeyframe.elements) {
            const elemExtras = collect_extras(vsKeyframe.elements[boneName], ANIMATION_KEY_KNOWN_KEYS);
            if (!elemExtras) continue;
            (elementExtras[boneName] = elementExtras[boneName] || {})[frame] = elemExtras;
        }
    });

    if (Object.keys(keyframeExtras).length) animation.vs_extra_keyframe_props = keyframeExtras;
    if (Object.keys(elementExtras).length) animation.vs_extra_element_props = elementExtras;
}

type ChannelFrameMap = Record<string, Record<BBImportChannel, number[]>>;

// Collects, per bone and per channel, the sorted frames that actually set that channel, matching
// the per-channel grouping the engine walks. Used to size each bezier segment for handle-width
// recovery.
function buildChannelFrames(vsAnimation: VS_Animation): ChannelFrameMap {
    const map: ChannelFrameMap = {};
    vsAnimation.keyframes.forEach(kf => {
        for (const boneName in kf.elements) {
            const transform = kf.elements[boneName];
            const entry = map[boneName] || (map[boneName] = { rotation: [], position: [], scale: [] });
            (Object.keys(IMPORT_CHANNELS) as BBImportChannel[]).forEach(channel => {
                if (IMPORT_CHANNELS[channel].value.some(k => transform[k] != null)) {
                    entry[channel].push(kf.frame);
                }
            });
        }
    });
    for (const boneName in map) {
        (Object.keys(map[boneName]) as BBImportChannel[]).forEach(channel => map[boneName][channel].sort((a, b) => a - b));
    }
    return map;
}

// Builds the Blockbench keyframe options for one channel of one VS keyframe element, restoring the
// interpolation mode and (for bezier) the exact handle value+time deltas. Returns null when the
// channel isn't present on this element.
function buildChannelKeyframeOptions(
    transform: VS_AnimationKey,
    channel: BBImportChannel,
    frame: number,
    channelFrames: number[],
    fps: number,
): KeyframeOptions | null {
    const cfg = IMPORT_CHANNELS[channel];
    if (!cfg.value.some(k => transform[k] != null)) return null;

    const value = {
        x: transform[cfg.value[0]] ?? cfg.default,
        y: transform[cfg.value[1]] ?? cfg.default,
        z: transform[cfg.value[2]] ?? cfg.default,
    };

    const bbInterp = mapInterpolation(transform[cfg.interp]);
    const opts: KeyframeOptions = {
        interpolation: bbInterp,
        time: frame / fps,
        channel,
        data_points: [{ x: value.x, y: value.y, z: value.z }],
    };

    if (bbInterp === 'bezier') {
        const { outDur, inDur } = segmentDurations(channelFrames, frame);
        const right = reconstructHandle(transform, cfg.tangentOut, cfg.widthOut, outDur, +1, fps);
        const left = reconstructHandle(transform, cfg.tangentIn, cfg.widthIn, inDur, -1, fps);
        if (right) { opts.bezier_right_value = right.value; opts.bezier_right_time = right.time; }
        if (left) { opts.bezier_left_value = left.value; opts.bezier_left_time = left.time; }
    }

    return opts;
}

// Lengths (in frames) of the segments adjacent to `frame` within a single channel's keyframe list.
function segmentDurations(frames: number[], frame: number): { outDur: number, inDur: number } {
    const i = frames.indexOf(frame);
    if (i === -1) return { outDur: 0, inDur: 0 };
    const prev = i > 0 ? frames[i - 1] : null;
    const next = i < frames.length - 1 ? frames[i + 1] : null;
    return {
        outDur: next != null ? next - frame : 0,
        inDur: prev != null ? frame - prev : 0,
    };
}

// Inverts the export: from the engine tangent slope (value-per-segment-t) plus the handle width (in
// frames) recover Blockbench's value delta and time delta (seconds): time = widthFrames/fps,
// value = tangent * widthFrames / segmentFrames. A missing width falls back to the engine's
// +/-(segmentFrames/3) default so the rebuilt BB curve matches the engine's render exactly. Returns
// null when there's no adjacent segment (a boundary handle), leaving Blockbench's own default there.
function reconstructHandle(
    transform: VS_AnimationKey,
    tangentFields: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField],
    widthFields: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField],
    segmentFrames: number,
    sign: 1 | -1,
    fps: number,
): { value: ArrayVector3, time: ArrayVector3 } | null {
    if (segmentFrames <= 0) return null;
    const defaultWidth = sign * segmentFrames / 3;
    const value: [number, number, number] = [0, 0, 0];
    const time: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        const wRaw = transform[widthFields[i]];
        const widthFrames = wRaw != null ? Number(wRaw) : defaultWidth;
        const tRaw = transform[tangentFields[i]];
        const tangent = tRaw != null ? Number(tRaw) : 0;
        time[i] = widthFrames / fps;
        value[i] = widthFrames !== 0 ? tangent * widthFrames / segmentFrames : 0;
    }
    return { value, time };
}

function mapInterpolation(interp: VS_KeyFrameInterpolation | undefined): 'linear' | 'bezier' | 'step' {
    if (interp === 'Bezier') return 'bezier';
    if (interp === 'Step') return 'step';
    return 'linear';
}

/**
 * Removes every animation from the current project. Returns the count removed.
 * Animations created in this call go onto the undo stack so the user can revert.
 */
export function clear_animations(): number {
    const all = Blockbench.Animation.all.slice();
    all.forEach(a => a.remove(true));
    return all.length;
}
