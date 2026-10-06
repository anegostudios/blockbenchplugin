import {export_model} from "./export_model";
import { compile_animation_library } from "./export_animation";
import { VS_EditorSettings, VS_Shape } from "./vs_shape_def";
import { VS_PROJECT_PROPS } from "./property";
import { apply_extra_props } from "./preserved_props";
import { resolveTextureLocation, warnTextureReadErrors } from "./export_textures";
import { path_to_reference } from "./animation_library_paths";
import { fs } from "./util/native";

const path = requireNativeModule('path');

declare var Settings: any;

/**
 * Saves a texture to disk, respecting VS folder structure (shapes -> textures).
 * @param texture - The Blockbench texture object
 * @param textureDir - The directory where the texture should be saved
 * @param textureSubPath - The subdirectory path relative to textures folder (e.g., "egg" for textures/egg/)
 * @returns The VS-style texture path (e.g., "egg/egg") or empty string if failed
 */
function saveTextureToFile(texture: Texture, textureDir: string, textureSubPath: string): string {
    try {
        // Check if texture has data URL method
        if (typeof texture.getDataURL !== 'function') {
            console.warn(`Texture ${texture.name} does not have getDataURL method`);
            return "";
        }

        // Ensure texture has proper extension
        let filename = texture.name;
        if (!filename.match(/\.(png|jpg|jpeg)$/i)) {
            filename += '.png';
        }

        // Create the full texture directory path if it doesn't exist
        const fullTextureDir = path.join(textureDir, textureSubPath);
        if (!fs.existsSync(fullTextureDir)) {
            fs.mkdirSync(fullTextureDir, { recursive: true });
        }

        const texturePath = path.join(fullTextureDir, filename);

        // Convert data URL to buffer and save
        const dataUrl = texture.getDataURL();
        if (!dataUrl) {
            console.warn(`Could not get data URL for texture: ${texture.name}`);
            return "";
        }

        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(texturePath, buffer);

        // Return VS-style path (subdirectory + filename without extension)
        const filenameWithoutExt = filename.replace(/\.[^.]+$/, '');
        // Convert backslashes to forward slashes for VS format
        const normalizedSubPath = textureSubPath.split(path.sep).join('/');
        return normalizedSubPath ? `${normalizedSubPath}/${filenameWithoutExt}` : filenameWithoutExt;
    } catch (e) {
        console.error(`Failed to save texture ${texture.name}:`, e);
        return "";
    }
}

export function ex(options): VS_Shape {

    if(!Project) {
        throw new Error("No project loaded during export");
    }

    // Get export path and directory from options
    const exportPath = options?.path || "";
    const exportDir = options?.exportDir || "";

    // Determine texture directory based on VS folder structure
    let textureBaseDir = exportDir;
    let textureSubPath = "";

    if (exportPath) {
        // Check if the export path contains /shapes/
        const shapesIndex = exportPath.indexOf(path.sep + "shapes" + path.sep);

        if (shapesIndex !== -1) {
            // Get the base path (up to and including the asset folder)
            const basePath = exportPath.substring(0, shapesIndex);

            // Texture base directory is basePath + /textures/
            textureBaseDir = path.join(basePath, "textures");

            // Get the subdirectory between shapes/ and the filename
            // e.g., for "shapes/egg/humanegg.json", subPath is "egg"
            const afterShapes = exportPath.substring(shapesIndex + path.sep.length + "shapes".length + path.sep.length);
            const lastSep = afterShapes.lastIndexOf(path.sep);
            if (lastSep !== -1) {
                textureSubPath = afterShapes.substring(0, lastSep);
            }

            console.log(`VS folder structure detected:`);
            console.log(`  Export path: ${exportPath}`);
            console.log(`  Texture base dir: ${textureBaseDir}`);
            console.log(`  Texture subpath: ${textureSubPath}`);
        }
    }

    // Populate Texture Sizes — start with stored sizes from import, then override with live textures
    const textureSizes: Record<string, [number,number]> = {
        ...(Project.vs_textureSizes || {})
    };
    for (const texture of Texture.all) {
        if (texture.uv_width && texture.uv_height) {
            textureSizes[texture.name] = [texture.uv_width, texture.uv_height];
        }
    }

    // Populate Textures
    const textures: Record<string, string> = {};
    const unresolvedReadErrors = new Map<string, unknown>();
    for (const texture of Texture.all) {
        // Try using existing textureLocation first, then resolve from project path or texture source
        let location = texture.textureLocation || "";
        const readErrors = new Map<string, unknown>();

        if (!location || location === "") {
            // Try project save path first
            location = resolveTextureLocation(Project.save_path, texture.name, readErrors);

            // If no save path, try texture source path
            if ((!location || location === "") && texture.source) {
                location = resolveTextureLocation(texture.source, texture.name, readErrors);
            }
        }

        // If still no location and we have an export directory, save the texture (if enabled in settings)
        const exportTextures = Settings.get("vs_export_textures") || false;
        if ((!location || location === "") && exportDir && exportTextures) {
            location = saveTextureToFile(texture, textureBaseDir, textureSubPath);
        }

        textures[texture.name] = location || "";
        if (!location) readErrors.forEach((error, dir) => unresolvedReadErrors.set(dir, error));
    }

    // Export model elements
    const elements = export_model();

    // Partition animations by file: path-less ones are inline (embedded in the shape),
    // while animations belonging to a library file are referenced via animationLibraries
    // (the library file itself is saved separately through the animation codec / panel).
    const allAnimations = Blockbench.Animation.all;
    const inlineAnimations = compile_animation_library(allAnimations.filter(a => !a.path)).animations;

    // Library refs are emitted even for backdrop projects. Backdrops suppress inline animation
    // data, but the ref list points at files the user never edited here, so dropping it would
    // silently unlink those libraries from the shape.
    const libraryRefs: string[] = [];
    const seenRefs = new Set<string>();
    for (const animation of allAnimations) {
        if (!animation.path) continue;
        const ref: string | null = animation.vs_library_ref || path_to_reference(animation.path);
        if (ref && !seenRefs.has(ref)) { seenRefs.add(ref); libraryRefs.push(ref); }
    }

    // Populate Editor Info
    const editor: VS_EditorSettings = {};

    for(const prop of VS_PROJECT_PROPS) {
        const prop_name = prop.name;
        editor[prop_name] = Project[prop_name];
    }

    apply_extra_props(editor, Project.vs_extra_editor_props);

    const data: VS_Shape = {
        editor: editor,
        textureWidth: Project.texture_width,
        textureHeight: Project.texture_height,
        textureSizes: textureSizes,
        textures: textures,
        elements: elements,
        animations: inlineAnimations,
    };

    if (libraryRefs.length > 0) {
        data.animationLibraries = libraryRefs;
    }

    apply_extra_props(data, Project.vs_extra_props);

    warnTextureReadErrors(unresolvedReadErrors);
    return data;
}
