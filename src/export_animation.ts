import { VS_Animation, VS_AnimationKey, VS_AnimationNumericField, VS_AnimationInterpolationField, VS_AnimationLibrary, VS_AnimationParticle, VS_Keyframe, VS_KeyFrameInterpolation } from "./vs_shape_def";
import { sound_from_data_point } from "./animation_sounds";
import * as util from "./util";
import { is_backdrop_project } from "./util/misc";

type BBChannel = 'position' | 'rotation' | 'scale';

// Maps a Blockbench keyframe interpolation mode to the engine's mode. Linear returns null
// (the default; field omitted from JSON). The engine has no native Catmull-Rom mode, so
// catmullrom converts to Bezier with computed tangents (see computeCatmullRomTangents).
// That conversion is exact for uniformly spaced keyframes and an approximation otherwise.
function mapInterpolation(bbMode: string | undefined): { mode: VS_KeyFrameInterpolation | null, isCatmull: boolean } {
    if (!bbMode || bbMode === 'linear') return { mode: null, isCatmull: false };
    if (bbMode === 'bezier') return { mode: 'Bezier', isCatmull: false };
    if (bbMode === 'step') return { mode: 'Step', isCatmull: false };
    if (bbMode === 'catmullrom') return { mode: 'Bezier', isCatmull: true };
    return { mode: null, isCatmull: false };
}

// Converts one Blockbench bezier handle into the engine's (tangent slope + handle width) pair.
// Blockbench stores a handle as a value delta (bezier_*_value) plus a time delta in seconds
// (bezier_*_time); the engine wants a slope in value-per-segment-t plus the handle's horizontal
// extent in frames:
//   widthFrames = timeDelta * fps
//   tangent     = valueDelta * segmentFrames / widthFrames
// Width is emitted only when it differs from the engine's +/-(segmentFrames/3) default, so
// default-shaped handles stay free of extra fields and re-export byte-identically.
function applyBezierHandle(
    elem: VS_AnimationKey,
    valueDeltas: ArrayVector3 | undefined,
    timeDeltas: ArrayVector3 | undefined,
    segmentFrames: number,
    defaultWidthFrames: number,
    fps: number,
    tangentFields: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField],
    widthFields: [VS_AnimationNumericField, VS_AnimationNumericField, VS_AnimationNumericField],
) {
    if (!valueDeltas || !timeDeltas || segmentFrames <= 0) return;
    for (let i = 0; i < 3; i++) {
        const widthFrames = Number(timeDeltas[i]) * fps;
        if (widthFrames === 0) continue; // degenerate (zero-width) handle; nothing meaningful to store
        const tangent = Number(valueDeltas[i]) * segmentFrames / widthFrames;
        if (tangent !== 0) elem[tangentFields[i]] = tangent;
        if (Math.abs(widthFrames - defaultWidthFrames) > 1e-9) elem[widthFields[i]] = widthFrames;
    }
}

// Computes a Catmull-Rom keyframe's tangent in value-per-segment-t units for both segment
// sides (out into the next segment, in from the prev). The slope at frame_i is the symmetric
// finite difference `(P_{i+1} - P_{i-1}) / (frame_{i+1} - frame_{i-1})`; scaling it by each
// adjacent segment's frame duration gives the per-segment-t tangent the engine expects.
// At the boundaries (no prev, no next, single keyframe) it falls back to a one-sided difference.
function computeCatmullRomTangents(
    channelKfs: _Keyframe[],
    idx: number,
    axis: 'x' | 'y' | 'z',
    fps: number,
): { out: number, in: number } {
    const cur = channelKfs[idx];
    const prev = idx > 0 ? channelKfs[idx - 1] : null;
    const next = idx < channelKfs.length - 1 ? channelKfs[idx + 1] : null;

    const curFrame = Math.round(cur.time * fps);
    const curVal = Number(cur.data_points[0][axis]);

    let slopePerFrame = 0;
    if (prev && next) {
        const prevFrame = Math.round(prev.time * fps);
        const nextFrame = Math.round(next.time * fps);
        const span = nextFrame - prevFrame;
        if (span > 0) {
            slopePerFrame = (Number(next.data_points[0][axis]) - Number(prev.data_points[0][axis])) / span;
        }
    } else if (next) {
        const nextFrame = Math.round(next.time * fps);
        const span = nextFrame - curFrame;
        if (span > 0) slopePerFrame = (Number(next.data_points[0][axis]) - curVal) / span;
    } else if (prev) {
        const prevFrame = Math.round(prev.time * fps);
        const span = curFrame - prevFrame;
        if (span > 0) slopePerFrame = (curVal - Number(prev.data_points[0][axis])) / span;
    }

    const outDur = next ? Math.max(0, Math.round(next.time * fps) - curFrame) : 0;
    const inDur = prev ? Math.max(0, curFrame - Math.round(prev.time * fps)) : 0;
    return { out: slopePerFrame * outDur, in: slopePerFrame * inDur };
}

function applyCatmullRomToKey(
    elem: VS_AnimationKey,
    channel: BBChannel,
    channelKfs: _Keyframe[],
    idx: number,
    fps: number,
) {
    const fields = CHANNEL_FIELDS[channel];
    elem[fields.interp] = 'Bezier';

    const tx = computeCatmullRomTangents(channelKfs, idx, 'x', fps);
    const ty = computeCatmullRomTangents(channelKfs, idx, 'y', fps);
    const tz = computeCatmullRomTangents(channelKfs, idx, 'z', fps);
    if (tx.out !== 0) elem[fields.tangentOutX] = tx.out;
    if (ty.out !== 0) elem[fields.tangentOutY] = ty.out;
    if (tz.out !== 0) elem[fields.tangentOutZ] = tz.out;
    if (tx.in !== 0) elem[fields.tangentInX] = tx.in;
    if (ty.in !== 0) elem[fields.tangentInY] = ty.in;
    if (tz.in !== 0) elem[fields.tangentInZ] = tz.in;
}

interface ChannelFieldNames {
    interp: VS_AnimationInterpolationField;
    tangentInX: VS_AnimationNumericField; tangentInY: VS_AnimationNumericField; tangentInZ: VS_AnimationNumericField;
    tangentOutX: VS_AnimationNumericField; tangentOutY: VS_AnimationNumericField; tangentOutZ: VS_AnimationNumericField;
    tangentInWidthX: VS_AnimationNumericField; tangentInWidthY: VS_AnimationNumericField; tangentInWidthZ: VS_AnimationNumericField;
    tangentOutWidthX: VS_AnimationNumericField; tangentOutWidthY: VS_AnimationNumericField; tangentOutWidthZ: VS_AnimationNumericField;
}

const CHANNEL_FIELDS: Record<BBChannel, ChannelFieldNames> = {
    position: {
        interp: 'positionInterp',
        tangentInX: 'offsetTangentInX', tangentInY: 'offsetTangentInY', tangentInZ: 'offsetTangentInZ',
        tangentOutX: 'offsetTangentOutX', tangentOutY: 'offsetTangentOutY', tangentOutZ: 'offsetTangentOutZ',
        tangentInWidthX: 'offsetTangentInWidthX', tangentInWidthY: 'offsetTangentInWidthY', tangentInWidthZ: 'offsetTangentInWidthZ',
        tangentOutWidthX: 'offsetTangentOutWidthX', tangentOutWidthY: 'offsetTangentOutWidthY', tangentOutWidthZ: 'offsetTangentOutWidthZ',
    },
    rotation: {
        interp: 'rotationInterp',
        tangentInX: 'rotationTangentInX', tangentInY: 'rotationTangentInY', tangentInZ: 'rotationTangentInZ',
        tangentOutX: 'rotationTangentOutX', tangentOutY: 'rotationTangentOutY', tangentOutZ: 'rotationTangentOutZ',
        tangentInWidthX: 'rotationTangentInWidthX', tangentInWidthY: 'rotationTangentInWidthY', tangentInWidthZ: 'rotationTangentInWidthZ',
        tangentOutWidthX: 'rotationTangentOutWidthX', tangentOutWidthY: 'rotationTangentOutWidthY', tangentOutWidthZ: 'rotationTangentOutWidthZ',
    },
    scale: {
        interp: 'scaleInterp',
        tangentInX: 'stretchTangentInX', tangentInY: 'stretchTangentInY', tangentInZ: 'stretchTangentInZ',
        tangentOutX: 'stretchTangentOutX', tangentOutY: 'stretchTangentOutY', tangentOutZ: 'stretchTangentOutZ',
        tangentInWidthX: 'stretchTangentInWidthX', tangentInWidthY: 'stretchTangentInWidthY', tangentInWidthZ: 'stretchTangentInWidthZ',
        tangentOutWidthX: 'stretchTangentOutWidthX', tangentOutWidthY: 'stretchTangentOutWidthY', tangentOutWidthZ: 'stretchTangentOutWidthZ',
    },
};

function applyInterpolationToKey(
    elem: VS_AnimationKey,
    channel: BBChannel,
    kf: _Keyframe,
    interp: VS_KeyFrameInterpolation,
    channelKfs: _Keyframe[] | null,
    idx: number,
    fps: number,
) {
    const fields = CHANNEL_FIELDS[channel];
    elem[fields.interp] = interp;

    if (interp !== 'Bezier') return;

    // Handle widths are placed relative to the adjacent segment, so we need the neighbouring
    // keyframes IN THIS CHANNEL (matching the engine's per-channel keyframe walk).
    const curFrame = Math.round(kf.time * fps);
    const prev = channelKfs && idx > 0 ? channelKfs[idx - 1] : null;
    const next = channelKfs && idx >= 0 && idx < channelKfs.length - 1 ? channelKfs[idx + 1] : null;
    const outDur = next ? Math.max(0, Math.round(next.time * fps) - curFrame) : 0;
    const inDur = prev ? Math.max(0, curFrame - Math.round(prev.time * fps)) : 0;

    // The OUT handle shapes the segment to the next keyframe; the IN handle the segment from the
    // previous one. A handle with no adjacent segment affects no curve, so it's skipped.
    if (outDur > 0) {
        applyBezierHandle(elem, kf.bezier_right_value, kf.bezier_right_time, outDur, outDur / 3, fps,
            [fields.tangentOutX, fields.tangentOutY, fields.tangentOutZ],
            [fields.tangentOutWidthX, fields.tangentOutWidthY, fields.tangentOutWidthZ]);
    }
    if (inDur > 0) {
        applyBezierHandle(elem, kf.bezier_left_value, kf.bezier_left_time, inDur, -inDur / 3, fps,
            [fields.tangentInX, fields.tangentInY, fields.tangentInZ],
            [fields.tangentInWidthX, fields.tangentInWidthY, fields.tangentInWidthZ]);
    }
}

/**
 * Exports Blockbench animations to the Vintage Story animation format.
 * @returns An array of VS animations.
 */
/**
 * Converts a single Blockbench animation to the Vintage Story animation format.
 * Returns null when the animation has no exportable keyframes (or for backdrop projects).
 * When `catmullConverted` is supplied, the animation's name is appended to it if any of its
 * keyframes were converted from catmull-rom to bezier, so the caller can show one aggregated
 * notice instead of a popup per animation.
 */
export function compile_animation(animation: _Animation, catmullConverted?: string[]): VS_Animation | null {
    // Don't export animations for backdrop projects.
    if (is_backdrop_project()) return null;

    const keyframes: Record<number,VS_Keyframe> = {};
    const fps = util.fps;
    const baseFrameCount = get_base_frame_quantity(animation);
    const animators = Object.values(animation.animators || {});
    let hadCatmullConversion = false;

    animators.forEach(animator => {
        if (animator.type === 'bone' && animator.keyframes && animator.keyframes.length > 0) {
            // Skip NullObject animators; they have no corresponding VS element
            if (typeof NullObject !== 'undefined' && NullObject.all?.some((n: any) => n.uuid === animator.uuid)) {
                return;
            }
            const bone_name = animator.name;

            // Catmull-Rom -> Bezier conversion needs the prev/next keyframes in the SAME
            // channel (matching the engine's per-channel keyframe walk). Pre-sort once.
            const byChannel: Record<BBChannel, _Keyframe[]> = { position: [], rotation: [], scale: [] };
            animator.keyframes.forEach(kf => {
                if (kf.channel === 'position' || kf.channel === 'rotation' || kf.channel === 'scale') {
                    byChannel[kf.channel].push(kf);
                }
            });
            (Object.keys(byChannel) as BBChannel[]).forEach(ch => byChannel[ch].sort((a, b) => a.time - b.time));

            const scaleNeedsAllKeys = byChannel.scale.some(kf => mapInterpolation(kf.interpolation).mode !== null
                || ['x', 'y', 'z'].some(axis => Number(kf.data_points[0][axis]) !== 1));

            animator.keyframes.forEach(kf => {
                const { mode: vsInterp, isCatmull } = mapInterpolation(kf.interpolation);
                if (isCatmull) hadCatmullConversion = true;

                const frame = Math.round(kf.time * fps);
                keyframes[frame] = keyframes[frame] || { frame, elements: {} };
                keyframes[frame].elements[bone_name] = keyframes[frame].elements[bone_name] || {};
                const elem = keyframes[frame].elements[bone_name];

                const dataPoint = kf.data_points[0];
                const value = { x: Number(dataPoint.x), y: Number(dataPoint.y), z: Number(dataPoint.z) };
                const channel = kf.channel as BBChannel;
                const channelKfs = channel in byChannel ? byChannel[channel] : null;

                const applyInterp = () => {
                    if (!vsInterp) return;
                    const idx = channelKfs ? channelKfs.indexOf(kf) : -1;
                    if (isCatmull && channelKfs) {
                        applyCatmullRomToKey(elem, channel, channelKfs, idx, fps);
                    } else {
                        applyInterpolationToKey(elem, channel, kf, vsInterp, channelKfs, idx, fps);
                    }
                };

                switch (kf.channel) {
                    case 'rotation':
                        elem.rotationX = value.x;
                        elem.rotationY = value.y;
                        elem.rotationZ = value.z;
                        applyInterp();
                        break;
                    case 'position':
                        elem.offsetX = value.x;
                        elem.offsetY = value.y;
                        elem.offsetZ = value.z;
                        applyInterp();
                        break;
                    case 'scale':
                        if (scaleNeedsAllKeys || value.x !== 1) elem.stretchX = value.x;
                        if (scaleNeedsAllKeys || value.y !== 1) elem.stretchY = value.y;
                        if (scaleNeedsAllKeys || value.z !== 1) elem.stretchZ = value.z;
                        applyInterp();
                        break;
                }
            });
        }

        // Process effect animators for texture swap and particle keyframes
        if (animator.type === 'effect' && animator.keyframes && animator.keyframes.length > 0) {
            animator.keyframes.forEach(kf => {
                if (kf.channel === 'timeline') {
                    const script = kf.data_points[0]?.script;
                    if (script) {
                        const textures = parseTextureSwapScript(script);
                        if (textures) {
                            const frame = Math.round(kf.time * fps);
                            keyframes[frame] = keyframes[frame] || { frame, elements: {} };
                            keyframes[frame].textures = textures;
                        }
                    }
                }
                if (kf.channel === 'particle') {
                    kf.data_points.forEach(dp => {
                        const effect = (dp.effect || '').trim();
                        if (!effect) return;
                        const frame = Math.round(kf.time * fps);
                        keyframes[frame] = keyframes[frame] || { frame, elements: {} };
                        const particle: VS_AnimationParticle = { effect };
                        const locator = (dp.locator || '').trim();
                        if (locator) particle.atAttachmentPoint = locator;
                        (keyframes[frame].particles = keyframes[frame].particles || []).push(particle);
                    });
                }
                if (kf.channel === 'sound') {
                    kf.data_points.forEach(dp => {
                        const sound = sound_from_data_point(dp);
                        if (!sound) return;
                        const frame = Math.round(kf.time * fps);
                        keyframes[frame] = keyframes[frame] || { frame, elements: {} };
                        (keyframes[frame].sounds = keyframes[frame].sounds || []).push(sound);
                    });
                }
            });
        }
    });

    normalize_terminal_keyframe(keyframes, baseFrameCount);

    // Wraps all animation elements into oneLiner wrappers (after all animators are processed)
    for(const keyframe of Object.values(keyframes)) {
        const wrapped_elements = {};
        for (const [element, content] of Object.entries(keyframe.elements)) {
            wrapped_elements[element] = new oneLiner(content);
        }
        keyframe.elements = wrapped_elements;
        if (keyframe.particles) {
            keyframe.particles = keyframe.particles.map(p => new oneLiner(p));
        }
        if (keyframe.sounds) {
            keyframe.sounds = keyframe.sounds.map(s => new oneLiner(s));
        }
    }

    // Use preserved VS values if available, otherwise compute defaults
    const storedCode = animation.vs_code;
    const storedOnActivityStopped = animation.vs_onActivityStopped;
    const storedOnAnimationEnd = animation.vs_onAnimationEnd;

    // Map the Blockbench loop mode to onAnimationEnd. A stored value from import is only kept
    // while it still agrees with the current loop mode (it can be a superset, e.g. EaseOut maps
    // to 'once'); once the user changes the loop mode in Blockbench, the loop mode wins.
    const loopToEnd: Record<_Animation['loop'], VS_Animation['onAnimationEnd'][]> = {
        loop: ["Repeat"],
        hold: ["Hold"],
        once: ["Stop", "EaseOut"],
    };
    const validEnds = loopToEnd[animation.loop] ?? loopToEnd.once;
    const onAnimationEnd = storedOnAnimationEnd && validEnds.includes(storedOnAnimationEnd) ? storedOnAnimationEnd : validEnds[0];

    const vsAnimation : VS_Animation = {
        name: animation.name,
        code: storedCode || animation.name.toLowerCase().replace(/ /g, ''),
        quantityframes: get_frame_quantity(animation, keyframes),
        onActivityStopped: storedOnActivityStopped || "EaseOut",
        onAnimationEnd,
        keyframes: Object.values(keyframes).sort((a, b) => a.frame - b.frame)
    };

    if (vsAnimation.quantityframes === 0 && vsAnimation.keyframes.length > 0) {
        const frame0 = vsAnimation.keyframes.find(kf => kf.frame === 0);
        if (frame0) {
            const frame1 = JSON.parse(JSON.stringify(frame0));
            frame1.frame = 1;
            vsAnimation.keyframes.push(frame1);
            vsAnimation.quantityframes = 1;
        }
    }

    // For looping animations, insert a virtual end frame copying frame 0
    // so VS can interpolate back to the start. QuantityFrames is a frame count,
    // so the last valid frame is quantityframes - 1.
    if (vsAnimation.onAnimationEnd === "Repeat" && vsAnimation.quantityframes > 0) {
        const lastFrame = vsAnimation.quantityframes - 1;
        const hasLastFrame = vsAnimation.keyframes.some(kf => kf.frame === lastFrame);
        if (!hasLastFrame) {
            const frame0 = vsAnimation.keyframes.find(kf => kf.frame === 0);
            if (frame0) {
                const virtualFrame = JSON.parse(JSON.stringify(frame0));
                virtualFrame.frame = lastFrame;
                delete virtualFrame.sounds;
                delete virtualFrame.particles;
                vsAnimation.keyframes.push(virtualFrame);
                vsAnimation.keyframes.sort((a, b) => a.frame - b.frame);
            }
        }
    }

    if (vsAnimation.keyframes.length === 0) return null;
    if (hadCatmullConversion && catmullConverted) catmullConverted.push(animation.name);
    return vsAnimation;
}

/**
 * Compiles the given Blockbench animations into a VS animation library structure
 * (`{ code?, name?, animations[] }`), the on-disk format for a standalone animation
 * library file consumed by the engine's `Shape.AnimationLibraries` references.
 */
export function compile_animation_library(animations: _Animation[], code?: string, name?: string): VS_AnimationLibrary {
    const catmullConverted: string[] = [];
    const compiled = animations
        .map(a => compile_animation(a, catmullConverted))
        .filter((a): a is VS_Animation => a !== null);
    if (catmullConverted.length > 0) display_catmull_conversion_notice(catmullConverted);

    const library: VS_AnimationLibrary = { animations: compiled };
    if (code) library.code = code;
    if (name) library.name = name;
    return library;
}

/**
 * Returns the length of an animation in frames so it is compatible with VS. Displays a warning to the user if necessary.
 * @param animation The BB animation object.
 * @param keyframes Keyframes
 */
function get_frame_quantity(animation: _Animation, keyframes: Record<number,VS_Keyframe>): number {
    // VS uses QuantityFrames as a frame count.
    // A 60-frame animation should export with QuantityFrames = 60 and a last valid frame of 59.
    const quantityframes = get_base_frame_quantity(animation);
    const keyframe_frames = Object.keys(keyframes).map(kf => parseInt(kf));
    if (keyframe_frames.length === 0) {
        return quantityframes;
    }
    const max_keyframe = Math.max(...keyframe_frames);
    if (max_keyframe >= quantityframes) {
        display_animation_length_warning(animation.name);
        return max_keyframe + 1;
    }
    return quantityframes;
}

function get_base_frame_quantity(animation: _Animation): number {
    return Math.max(1, Math.round(animation.length * util.fps));
}

function normalize_terminal_keyframe(
    keyframes: Record<number,VS_Keyframe>,
    quantityframes: number
) {
    const terminalFrame = quantityframes;
    const lastExportableFrame = quantityframes - 1;
    const terminalKeyframe = keyframes[terminalFrame];

    if (!terminalKeyframe) {
        return;
    }

    const previousKeyframe = keyframes[lastExportableFrame];
    if (previousKeyframe) {
        if (keyframe_contents_match(previousKeyframe, terminalKeyframe)) {
            delete keyframes[terminalFrame];
            return;
        }
        return;
    }

    const shiftedKeyframe = clone_keyframe(terminalKeyframe);
    shiftedKeyframe.frame = lastExportableFrame;
    keyframes[lastExportableFrame] = shiftedKeyframe;
    delete keyframes[terminalFrame];
}

function keyframe_contents_match(a: VS_Keyframe, b: VS_Keyframe): boolean {
    return stable_keyframe_content(a) === stable_keyframe_content(b);
}

function stable_keyframe_content(keyframe: VS_Keyframe): string {
    return JSON.stringify({
        elements: sort_nested_object(keyframe.elements),
        textures: keyframe.textures ? sort_nested_object(keyframe.textures) : undefined,
        particles: keyframe.particles ? sort_nested_object(keyframe.particles) : undefined,
        sounds: keyframe.sounds ? sort_nested_object(keyframe.sounds) : undefined
    });
}

function sort_nested_object(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sort_nested_object);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, nestedValue]) => [key, sort_nested_object(nestedValue)])
        );
    }
    return value;
}

function clone_keyframe(keyframe: VS_Keyframe): VS_Keyframe {
    return JSON.parse(JSON.stringify(keyframe)) as VS_Keyframe;
}

/**
 * Parses a Blockbench effect timeline script for texture swap data.
 * Expected format: "textures": { "slot": "path", ... }
 * Returns a Record<string, string> mapping texture codes to asset paths, or null if not a texture swap.
 */
function parseTextureSwapScript(script: string): Record<string, string> | null {
    try {
        // The script content is a JSON fragment like: "textures": { "mouth": "entity/mouth/*_smile" }
        // Wrap in braces to make it valid JSON
        const trimmed = script.trim();
        const json = JSON.parse('{' + trimmed + '}');
        if (json.textures && typeof json.textures === 'object') {
            return json.textures;
        }
    } catch {
        // Not valid JSON texture swap data, ignore
    }
    return null;
}

function display_animation_length_warning(animation_name: string) {
    Blockbench.showMessageBox({
        title: 'Animation Length Warning',
        message:
            `The animation "${animation_name}" has keyframes on or past the last frame. ` +
            `This may not animate correctly in Vintage Story. ` +
            `Consider moving the keyframes away from the last frame if you experience issues.`
    });
}

function display_catmull_conversion_notice(animation_names: string[]) {
    const animationList = animation_names.length === 1
        ? `"${animation_names[0]}"`
        : animation_names.map(name => `"${name}"`).join(', ');

    Blockbench.showMessageBox({
        title: 'Catmull-Rom Converted to Bezier',
        message:
            `The following animation(s) had catmull-rom keyframes: ${animationList}\n\n` +
            `Vintage Story has no native catmull-rom mode, so these keyframes were exported ` +
            `as bezier with tangents computed from neighbouring keyframes. The curve is ` +
            `preserved (exact for uniform keyframe spacing, close otherwise). No action needed.`
    });
}

