import * as util from "./util";
import { import_model } from "./import_model";
import { import_animations } from "./import_animation";
import { VS_Shape } from "./vs_shape_def";
import { VS_PROJECT_PROPS } from "./property";
import { collect_editor_extras, collect_shape_extras } from "./preserved_props";
import { load_back_drop_shape } from "./util/misc";
import { reference_to_candidate_paths } from "./animation_library_paths";
import { vsAnimationCodec } from "./animation_codec";
import { fs } from "./util/native";


export function im(content: VS_Shape, _path: string, asBackdrop: boolean) {

    if (!Project) {
        throw new Error("No project loaded during import");
    }

    // Set project texture dimensions
    Project.texture_width = content.textureWidth || 16;
    Project.texture_height = content.textureHeight || 16;

    // Store original textureSizes for round-trip (includes entries for textures not in the textures map)
    if (content.textureSizes) {
        Project.vs_textureSizes = { ...content.textureSizes };
    }

    // Load textures
    for (const name in content.textures) {
        const texturePath = util.get_texture_location(null, content.textures[name]);
        const texture = new Texture({ name, path: texturePath }).add().load();
        if (content.textureSizes && content.textureSizes[name]) {
            texture.uv_width = content.textureSizes[name][0];
            texture.uv_height = content.textureSizes[name][1];
        }

        texture.textureLocation = content.textures[name];
    }

    // Load editor properties
    if (!asBackdrop) {
        if (content.editor) {
            for (const prop of VS_PROJECT_PROPS) {
                const prop_name = prop.name;
                Project[prop_name] = content.editor[prop_name];
            }
        }

        const shape_extras = collect_shape_extras(content);
        if (shape_extras) {
            Project.vs_extra_props = shape_extras;
        }
        const editor_extras = collect_editor_extras(content.editor);
        if (editor_extras) {
            Project.vs_extra_editor_props = editor_extras;
        }

        if (Project.backDropShape && Project.backDropShape !== "") {
            load_back_drop_shape(Project.backDropShape);
        }
    }




    // Build the model structure using the dedicated module
    import_model(content, asBackdrop, _path);

    // Import inline (shape-embedded) animations.
    if (content.animations) {
        import_animations(content.animations);
    }

    // Load referenced external animation libraries so they appear grouped by file.
    if (content.animationLibraries && content.animationLibraries.length > 0) {
        load_animation_libraries(content.animationLibraries, _path);
    }
}

/**
 * Resolves each `animationLibraries` reference to a file under `assets/<domain>/animations/`,
 * loads it through the VS animation codec (so its animations group under that file in the
 * panel), and remembers the original reference string for a diff-stable round trip.
 * Mirrors the engine's `Shape.ResolveAnimationLibraries()`. Warns and skips missing files.
 */
function load_animation_libraries(refs: string[], modelPath: string) {
    if (!vsAnimationCodec) return;
    for (const ref of refs) {
        const candidates = reference_to_candidate_paths(ref, modelPath);
        const filePath = candidates.find(p => fs.existsSync(p));
        if (!filePath) {
            console.warn(`[VS Import] Animation library "${ref}" not found. Looked in: ${candidates.join(', ') || '(model is not inside an assets/<domain> tree)'}`);
            continue;
        }
        let fileContent: string;
        try {
            fileContent = fs.readFileSync(filePath, 'utf-8');
        } catch (e) {
            console.error(`[VS Import] Failed to read animation library ${filePath}:`, e);
            continue;
        }
        const created = vsAnimationCodec.loadFile({ path: filePath, content: fileContent });
        for (const anim of created) {
            anim.vs_library_ref = ref;
        }
    }
}
