import { fps, get_texture_location, is_vs_project } from "./util";
import { parseTextureSwapScript } from "./export_animation";

const swaps = new Map<string, Texture>();
let overriding: Record<string, Texture> = {};
let applied = '';
let refreshing = false;

function active_overrides(): Record<string, string> {
    const overrides: Record<string, string> = {};
    for (const animation of Blockbench.Animation.all.filter(a => a.playing)) {
        const frames = Math.round(animation.length * fps);
        const frame = animation.loop === 'loop' ? Math.round(animation.time * fps) % frames : Math.min(Math.round(animation.time * fps), frames - 1);
        const keyframes = ((animation.animators.effects?.timeline ?? []) as _Keyframe[]).filter(kf => Math.round(kf.time * fps) <= frame).sort((a, b) => b.time - a.time);
        const latest = keyframes.map(kf => parseTextureSwapScript((kf.data_points[0] as { script?: string }).script ?? '')).find(textures => textures && Object.keys(textures).length);
        Object.assign(overrides, latest);
    }
    return overrides;
}

function swap_file(base: Texture, location: string): string {
    if (!location.includes('*')) return get_texture_location(Project!.save_path || Project!.export_path, location);
    const name = location.replace(/^.*\//, '').replace('*', base.path!.replace(/^.*[\\/]/, '').replace(/\.png$/i, ''));
    return `${base.path!.replace(/[^\\/]*$/, '')}${name}.png`;
}

function apply(overrides: Record<string, string>) {
    const key = JSON.stringify(overrides);
    if (key === applied) return;
    applied = key;
    overriding = {};
    for (const [code, location] of Object.entries(overrides)) {
        const base = Texture.all.find(t => t.name === code);
        if (!base?.path) continue;
        const file = swap_file(base, location);
        if (!file) continue;
        if (!swaps.has(file)) swaps.set(file, new Texture({ name: code, path: file }).load());
        overriding[base.uuid] = swaps.get(file)!;
    }
    refreshing = true;
    for (const cube of Cube.all) Cube.preview_controller.updateFaces(cube);
    refreshing = false;
}

Blockbench.on('get_face_texture', ({ face }: { face: CubeFace }) => refreshing ? overriding[String(face.texture)] : undefined);
Blockbench.on('display_animation_frame', () => { if (is_vs_project(Project)) apply(active_overrides()); });
Blockbench.on('select_mode', () => apply({}));
Blockbench.on('select_project', () => { applied = ''; overriding = {}; });
