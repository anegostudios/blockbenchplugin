/**
 * Vintage Story animation codec. Registers with Blockbench's pluggable `AnimationCodec`
 * system so the native multi-file animation workflow (group-by-file in the ANIMATIONS
 * panel, Load Animation File / Save / Save All) reads and writes VS animation *library*
 * files instead of the default Bedrock format.
 *
 * The format mirrors the engine's `AnimationLibrary` class: `{ code?, name?, animations[] }`
 * where each entry is a `VS_Animation`. Library files live at
 * `assets/<domain>/animations/<path>.json` and are referenced from a shape's
 * `animationLibraries[]`. See `./animation_library_paths.ts` and the engine's
 * `Shape.ResolveAnimationLibraries()`.
 *
 * Modelled on Blockbench's Bedrock codec. The panel gates "Load Animation File" on
 * `getCodec()?.pickFile` and "Save All Animations" calls `codec.exportFile(path)`, so a
 * codec must provide pickFile / importFile / exportFile (the base class supplies no
 * defaults; it just does `Object.assign(this, options)`):
 * https://github.com/JannisX11/blockbench/blob/master/js/formats/bedrock/bedrock_animation.js
 */

import { compile_animation, compile_animation_library } from "./export_animation";
import { create_animation } from "./import_animation";
import { VS_Animation, VS_AnimationLibrary } from "./vs_shape_def";
import { parse_model_location, basename_no_ext } from "./animation_library_paths";
import JSON5 from "json5";
import { fs } from "./util/native";


// Remembers each loaded library file's optional `code`/`name` so re-saving preserves them
// (the engine keys animations by their own `code`, so these are cosmetic, but preserving
// them keeps library files diff-stable across a round trip). Keyed by absolute file path.
const libraryMeta = new Map<string, { code?: string, name?: string }>();

/** All animations in the current project. */
function all_animations(): _Animation[] {
    return Blockbench.Animation.all;
}

/** Default directory the file dialogs open in: `<assets>/<domain>/animations`. */
function default_animations_dir(): string | undefined {
    const modelPath = Project?.save_path || Project?.export_path;
    if (!modelPath) return undefined;
    const ctx = parse_model_location(modelPath);
    return ctx ? `${ctx.assetsRoot}/${ctx.domain}/animations` : undefined;
}

/** Builds a library wrapper for a file, using remembered or filename-derived code/name. */
function build_library(path: string | undefined, animations: VS_Animation[]): VS_AnimationLibrary {
    const meta = path ? libraryMeta.get(path) : undefined;
    const stem = path ? basename_no_ext(path) : undefined;
    const library: VS_AnimationLibrary = { animations };
    const code = meta?.code ?? stem;
    const name = meta?.name ?? stem;
    if (code) library.code = code;
    if (name) library.name = name;
    return library;
}

function read_library(path: string | undefined): VS_AnimationLibrary | null {
    if (!path || !fs.existsSync(path)) return null;
    const library = JSON5.parse(fs.readFileSync(path, 'utf-8')) as VS_AnimationLibrary;
    if (!Array.isArray(library.animations)) throw new Error(`Invalid animation library: ${path}`);
    return library;
}

/** Parses a VS animation library file and adds its animations (grouped under `file.path`). */
function load_file(file: AnimationCodecFile, animation_filter?: string[]): _Animation[] {
    const json = (file.json ?? JSON5.parse(file.content as string)) as VS_AnimationLibrary;
    const created: _Animation[] = [];
    if (!Array.isArray(json.animations)) throw new Error(`Invalid animation library: ${file.path}`);

    libraryMeta.set(file.path, { code: json.code, name: json.name });

    for (const vsAnim of json.animations) {
        if (animation_filter && !animation_filter.includes(vsAnim.name)) continue;
        created.push(create_animation(vsAnim, file.path, vsAnim.name));
    }
    return created;
}

function compile_file(
    animations: _Animation[],
    compiled = compile_animation_library(animations).animations,
): VS_AnimationLibrary {
    const path = animations[0]?.path;
    const sharedPath = path && animations.every(a => a.path === path) ? path : undefined;
    const library = read_library(sharedPath);
    if (!library) return build_library(sharedPath, compiled);

    if (sharedPath) libraryMeta.set(sharedPath, { code: library.code, name: library.name });
    const renamedFrom = new Map<string, string>();
    for (const a of animations) {
        if (a.saved_name && a.saved_name !== a.name) renamedFrom.set(a.name, a.saved_name);
    }
    for (const vsAnim of compiled) {
        const oldName = renamedFrom.get(vsAnim.name) ?? vsAnim.name;
        const idx = library.animations.findIndex(a => a.name === oldName || a.name === vsAnim.name);
        if (idx >= 0) {
            library.animations[idx] = vsAnim;
            library.animations = library.animations.filter((a, i) => i === idx || a.name !== vsAnim.name);
        } else {
            library.animations.push(vsAnim);
        }
    }
    return library;
}

/** Opens a dialog to import one or more VS animation library files. */
function pick_file(): void {
    Blockbench.import({
        resource_id: 'vs_animation',
        type: 'Vintage Story Animation',
        extensions: ['json'],
        multiple: true,
        startpath: default_animations_dir(),
    }, (files) => {
        for (const file of files) {
            import_file(file);
        }
    });
}

/** Loads a single picked file into the project (called by pickFile and the file menu). */
function import_file(file: AnimationCodecFile): _Animation[] {
    Undo.initEdit({ animations: [], outliner: true, elements: Cube.all });
    const created = load_file(file);
    Undo.finishEdit('Import animations', { animations: created });
    return created;
}

function reload_animations(animations: _Animation[]): void {
    if (!animations.length) return;
    const path = animations[0].path;
    const json = JSON5.parse(fs.readFileSync(path, 'utf-8')) as VS_AnimationLibrary;
    if (!Array.isArray(json.animations)) throw new Error(`Invalid animation library: ${path}`);
    const selected = animations.find(a => a.selected);
    Undo.initEdit({ animations, outliner: true, elements: Cube.all });
    animations.forEach(a => a.remove(false, false));
    const created = load_file({ path, json }, animations.map(a => a.saved_name || a.name));
    for (const animation of created) {
        const previous = animations.find(a => (a.saved_name || a.name) === animation.name)!;
        animation.vs_library_ref = previous.vs_library_ref;
        if (previous === selected) animation.select();
    }
    Undo.finishEdit('Reload animations', { animations: created });
}

/**
 * Writes one animation into its library file (assumes `animation.path` is set), merging it
 * with the file's other animations and preserving their order.
 */
function write_animation_to_library(animation: _Animation): void {
    const vsAnim = compile_animation(animation);
    if (!vsAnim) {
        Blockbench.showMessageBox({
            title: 'Nothing to save',
            message: `Animation "${animation.name}" has no keyframes to export.`
        });
        return;
    }
    const path = animation.path;

    const library = compile_file([animation], [vsAnim]);

    Blockbench.writeFile(path, { content: autoStringify(library) }, (real_path) => {
        animation.saved = true;
        animation.saved_name = animation.name;
        animation.path = real_path;
        // Without this a silently skipped save (e.g. clicking a greyed-out button) is
        // indistinguishable from a successful one.
        Blockbench.showQuickMessage(`Saved "${animation.name}" to ${basename_no_ext(real_path)}.json`, 2000);
    });
}

/** Saves a single animation (per-animation "Save"); prompts for a file when it has none. */
function save_animation(animation: _Animation, save_as?: boolean): void {
    if (!animation.path || save_as) {
        Blockbench.export({
            resource_id: 'vs_animation',
            type: 'Vintage Story Animation',
            extensions: ['json'],
            name: animation.saved_name || animation.name,
            startpath: animation.path || default_animations_dir(),
            custom_writer: (_content, exportPath) => {
                if (!exportPath) return;
                animation.path = exportPath;
                delete animation.vs_library_ref;
                write_animation_to_library(animation);
            }
        });
        return;
    }
    write_animation_to_library(animation);
}

/**
 * Saves every animation that belongs to `path` to that file ("Save All" calls this once per
 * distinct path). Path-less animations are inline (saved inside the shape by the model codec
 * on project save/export), so the empty-path group is intentionally skipped here.
 */
function export_file(path: string, save_as?: boolean): void {
    const filterPath = path || '';
    const animations = all_animations().filter(a => (a.path || '') === filterPath);
    if (animations.length === 0) return;

    if (!save_as && filterPath && fs.existsSync(filterPath)) {
        // Recompile and merge EVERY loaded animation, not just the unsaved ones. "Export
        // Animations..." recompiles all of them, so skipping saved siblings here would leave
        // their on-disk bytes untouched and make the two paths diverge. The merge still
        // preserves animations on disk that aren't loaded into the project.
        animations.forEach(a => a.save());
        return;
    }

    // The "Unsaved" group (empty path), a brand-new file, or Save As: prompt for a destination,
    // then write the whole group there and associate the animations with it. This is how the
    // group's save button turns inline animations into a library file group.
    Blockbench.export({
        resource_id: 'vs_animation',
        type: 'Vintage Story Animation',
        extensions: ['json'],
        name: (filterPath && basename_no_ext(filterPath)) || 'animations',
        startpath: filterPath || default_animations_dir(),
        custom_writer: (_content, exportPath) => {
            if (!exportPath) return;
            animations.forEach(a => { a.path = exportPath; delete a.vs_library_ref; });
            fs.writeFileSync(exportPath, autoStringify(compile_file(animations)));
            animations.forEach(a => { a.saved = true; a.saved_name = a.name; });
        },
    });
}

/** Removes an animation's entry from its library file (when deleted from the project). */
function delete_animation_from_file(animation: _Animation): void {
    const path = animation.path;
    const library = read_library(path);
    if (!library) return;
    const target = animation.saved_name ?? animation.name;
    library.animations = library.animations.filter(a => a.name !== target);
    Blockbench.writeFile(path, { content: autoStringify(library) });
}

function create_vs_animation_codec(): AnimationCodec | undefined {
    if (typeof AnimationCodec === 'undefined') {
        console.error('[VS Plugin] This Blockbench version does not expose AnimationCodec; ' +
            'multi-file VS animation support is disabled. Update to Blockbench 5.x.');
        return undefined;
    }

    return new AnimationCodec('vintagestory', {
        multiple_per_file: true,
        pickFile: pick_file,
        importFile: import_file,
        loadFile: load_file,
        reloadFile: path => reload_animations(all_animations().filter(a => a.path === path && a.saved)),
        reloadAnimation: animation => reload_animations([animation]),
        compileAnimation: (animation) => compile_animation(animation),
        compileFile: compile_file,
        saveAnimation: save_animation,
        exportFile: export_file,
        deleteAnimationFromFile: delete_animation_from_file,
    });
}

export const vsAnimationCodec = create_vs_animation_codec();
