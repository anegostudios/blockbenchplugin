import { parse_model_location } from "./animation_library_paths";
import { is_vs_project } from "./util";
import { VS_AnimationSound } from "./vs_shape_def";

const fs = requireNativeModule('fs');

const SOUND_EXTENSIONS = ['.ogg', '.wav', '.mp3'];

const SOUND_DEFAULTS = { vs_range: 32, vs_volume: 1, vs_pitch: 1, vs_chance: 1 } as const;

function onSoundKeyframe(dataPoint: any): boolean {
    return dataPoint?.keyframe?.channel === 'sound';
}

if (typeof KeyframeDataPoint !== 'undefined') {
    for (const [key, value] of Object.entries(SOUND_DEFAULTS)) {
        const name = key.slice(3);
        new Property(KeyframeDataPoint, 'number', key, {
            label: name[0].toUpperCase() + name.slice(1),
            exposed: true, default: value, condition: onSoundKeyframe,
        });
    }
    new Property(KeyframeDataPoint, 'boolean', 'vs_looping', {
        label: 'Looping', exposed: true, default: false, condition: onSoundKeyframe,
    });
}

function readSoundOptions(dp: KeyframeDataPointData): Partial<VS_AnimationSound> {
    const out: Partial<VS_AnimationSound> = {};

    for (const key of ['range', 'volume', 'pitch', 'chance'] as const) {
        const raw = dp[`vs_${key}`];
        if (raw === undefined || raw === null || raw === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value === SOUND_DEFAULTS[`vs_${key}`]) continue;
        out[key] = value;
    }

    if (dp.vs_looping === true) out.looping = true;
    return out;
}

function without_extension(path: string): string {
    for (const ext of SOUND_EXTENSIONS) {
        if (path.toLowerCase().endsWith(ext)) return path.slice(0, -ext.length);
    }
    return path;
}

export function sound_location_for_file(filePath: string): string | null {
    const p = filePath.replace(/\\/g, '/');
    const match = /\/assets\/([^/]+)\/(sounds\/.+)$/.exec(p);
    if (!match) return null;
    return `${match[1]}:${without_extension(match[2])}`;
}

function sound_location_for_data_point(dp: KeyframeDataPointData): string | null {
    const effect = (dp.effect || '').trim();
    if (!effect) return dp.file ? sound_location_for_file(dp.file) : null;

    if (effect.includes(':') || effect.includes('/')) return effect;

    const fromFile = sound_location_for_file(dp.file || sound_file_for_location(effect) || '');
    if (!fromFile) return effect;

    const colon = fromFile.indexOf(':');
    const domain = fromFile.slice(0, colon);
    const folder = fromFile.slice(colon + 1).split('/').slice(0, -1).join('/');
    return folder ? `${domain}:${folder}/${effect}` : `${domain}:${effect}`;
}

export function sound_from_data_point(dp: KeyframeDataPointData): VS_AnimationSound | null {
    const location = sound_location_for_data_point(dp);
    if (!location) return null;
    return { location, ...readSoundOptions(dp) };
}

function sound_file_for_location(location: string): string | null {
    const modelPath = Project?.save_path || Project?.export_path;
    if (!modelPath) return null;
    const ctx = parse_model_location(modelPath);
    if (!ctx) return null;

    const colon = location.indexOf(':');
    const domain = colon >= 0 ? location.slice(0, colon) : ctx.domain;
    const path = (colon >= 0 ? location.slice(colon + 1) : location).replace(/^sounds\//, '');
    if (!path) return null;

    const concrete = path.split('*').join('1');
    const soundsRoot = `${ctx.assetsRoot}/${domain}/sounds`;

    for (const ext of SOUND_EXTENSIONS) {
        const candidate = `${soundsRoot}/${concrete}${ext}`;
        if (fs.existsSync(candidate)) return candidate;
    }

    return find_sound_by_name(soundsRoot, concrete.split('/').pop() ?? concrete);
}

function find_sound_by_name(dir: string, name: string, depth = 0): string | null {
    if (depth > 6 || !fs.existsSync(dir)) return null;

    let entries: any[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }

    for (const entry of entries) {
        if (entry.isFile() && SOUND_EXTENSIONS.some(ext => entry.name.toLowerCase() === name.toLowerCase() + ext)) {
            return `${dir}/${entry.name}`;
        }
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = find_sound_by_name(`${dir}/${entry.name}`, name, depth + 1);
        if (found) return found;
    }
    return null;
}

export function ensure_sound_links(animator: any, relink = false): number {
    let linked = 0;
    for (const keyframe of (animator?.sound || []) as _Keyframe[]) {
        for (const dp of keyframe.data_points as any[]) {
            if (dp.file && !relink) continue;
            const file = sound_file_for_location((dp.effect || '').trim());
            if (file) {
                dp.file = file;
                linked++;
            } else if (relink) {
                delete dp.file;
            }
        }
    }
    return linked;
}

export function relink_sound_files(): number {
    let linked = 0;
    for (const animation of Blockbench.Animation.all) {
        linked += ensure_sound_links(animation.animators?.effects, true);
    }
    return linked;
}

Blockbench.on('load_project', () => {
    if (!is_vs_project(Project)) return;
    relink_sound_files();
});

export function sound_data_point(sound: VS_AnimationSound): Record<string, unknown> {
    const dp: Record<string, unknown> = { effect: sound.location };
    const file = sound_file_for_location(sound.location);
    if (file) dp.file = file;

    for (const key of ['range', 'volume', 'pitch', 'chance'] as const) {
        if (sound[key] !== undefined) dp[`vs_${key}`] = sound[key];
    }
    if (sound.looping) dp.vs_looping = true;

    return dp;
}
