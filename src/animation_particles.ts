import { parse_model_location } from "./animation_library_paths";
import { is_vs_project } from "./util";

const fs = requireNativeModule('fs');
const nodePath = requireNativeModule('path');

declare var WinterskyScene: any;

const resolvedEffects = new Map<string, string | null>();

const namespacedEmitters = new Set<string>();

export function clear_particle_cache(): void {
    resolvedEffects.clear();
    namespacedEmitters.clear();
}

function clear_emitter_mirror(file: string): void {
    const effect = Animator.particle_effects[file];
    if (!effect) return;

    const magnitude = Math.abs(WinterskyScene?.global_options?.scale ?? 1) || 1;
    for (const key of Object.keys(effect.emitters)) {
        const emitter = effect.emitters[key];
        for (const space of [emitter.local_space, emitter.global_space]) {
            if (!space) continue;
            const s = space.scale;
            if (s.x < 0 || s.y < 0 || s.z < 0) s.set(magnitude, magnitude, magnitude);
        }
    }
}

function ensure_emitter_namespaced(file: string): boolean {
    if (namespacedEmitters.has(file)) {
        clear_emitter_mirror(file);
        return true;
    }

    try {
        Animator.loadParticleEmitter(file, namespace_components(fs.readFileSync(file, 'utf-8')));
    } catch (e) {
        console.warn(`[VS Particles] Could not load emitter "${file}":`, e);
        return false;
    }
    namespacedEmitters.add(file);
    clear_emitter_mirror(file);
    return true;
}

function particle_file_for(effectCode: string): string | null {
    const modelPath = Project?.save_path || Project?.export_path;
    if (!modelPath) return null;
    const ctx = parse_model_location(modelPath);
    if (!ctx) return null;

    const colon = effectCode.indexOf(':');
    const domain = colon >= 0 ? effectCode.slice(0, colon) : ctx.domain;
    const path = colon >= 0 ? effectCode.slice(colon + 1) : effectCode;
    if (!path) return null;

    return nodePath.join(ctx.assetsRoot, domain, 'particles', `${path}.json`);
}

export function resolve_particle_effect(effectCode: string): string | null {
    const code = effectCode.trim();
    if (!code) return null;

    const cached = resolvedEffects.get(code);
    if (cached !== undefined) return cached;

    const file = particle_file_for(code);
    const resolved = file && fs.existsSync(file) && ensure_emitter_namespaced(file) ? file : null;
    resolvedEffects.set(code, resolved);
    return resolved;
}

function namespace_components(content: string): string {
    const json = JSON.parse(content);
    const components = json?.particle_effect?.components;
    if (!components) return content;

    const namespaced: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(components)) {
        namespaced[name.includes(':') ? name : `minecraft:${name}`] = value;
    }
    json.particle_effect.components = mirror_motion(namespaced);
    return JSON.stringify(json);
}

function negate(value: unknown): unknown {
    if (typeof value === 'number') return -value;
    if (typeof value === 'string' && value.trim()) return `-(${value})`;
    return value;
}

const MIRRORED_FIELDS: Record<string, string[]> = {
    'minecraft:particle_motion_dynamic': ['linear_acceleration'],
    'minecraft:particle_motion_parametric': ['relative_position', 'direction'],
    'minecraft:particle_initial_speed': ['*'],
    'minecraft:emitter_shape_point': ['offset', 'direction'],
    'minecraft:emitter_shape_sphere': ['offset', 'direction'],
    'minecraft:emitter_shape_box': ['offset', 'direction'],
    'minecraft:emitter_shape_disc': ['offset', 'direction', 'plane_normal'],
    'minecraft:emitter_shape_entity_aabb': ['direction'],
};

function mirror_motion(components: Record<string, unknown>): Record<string, unknown> {
    for (const [name, fields] of Object.entries(MIRRORED_FIELDS)) {
        const component = components[name] as any;
        if (!component) continue;

        if (fields[0] === '*') {
            if (Array.isArray(component)) components[name] = component.map(negate);
            continue;
        }
        for (const field of fields) {
            if (Array.isArray(component[field])) component[field] = component[field].map(negate);
        }
    }
    return components;
}

export function particle_data_point(effect: string, locator?: string): Record<string, unknown> {
    const file = resolve_particle_effect(effect);
    const dp: Record<string, unknown> = { effect, locator: locator || '' };
    if (file) dp.file = file;
    return dp;
}

Blockbench.on('load_project', () => {
    if (!is_vs_project(Project)) return;
    relink_particle_previews();
});

export function ensure_particle_links(animator: any, relink = false): number {
    let linked = 0;
    for (const keyframe of (animator?.particle || []) as _Keyframe[]) {
        for (const dp of keyframe.data_points as any[]) {
            if (dp.file && !relink) {
                ensure_emitter_namespaced(dp.file);
                continue;
            }
            const file = resolve_particle_effect(dp.effect || '');
            if (file) {
                dp.file = file;
                linked++;
            } else if (relink) {
                if (dp.file && fs.existsSync(dp.file) && ensure_emitter_namespaced(dp.file)) linked++;
                else delete dp.file;
            }
        }
    }
    return linked;
}

export function relink_particle_previews(): number {
    clear_particle_cache();
    let linked = 0;

    for (const animation of Blockbench.Animation.all) {
        linked += ensure_particle_links(animation.animators?.effects, true);
    }
    return linked;
}
