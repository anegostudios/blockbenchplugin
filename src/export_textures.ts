import { collect_tree_data, flatten } from "./util/element_tree";
import { VS_Element } from "./vs_shape_def";
import type { Dirent } from "fs";

const fs = requireNativeModule('fs');
const path = requireNativeModule('path');

/**
 * Exports textures used by the given elements.
 * @param elements The element tree to extract textures from.
 * @returns A record mapping texture names to their resolved locations.
 */
export function export_textures(elements: VS_Element[]): Record<string, string> {
    // Populate Textures
    const used_texture_refs = get_used_texture_names(elements);
    const textures: Record<string, string> = {};
    const unresolvedReadErrors = new Map<string, unknown>();
    for (const texture of Texture.all) {
        // Skip unused textures
        if(!used_texture_refs.has(texture.name)) {
            continue;
        }
        // Try using existing textureLocation first, then resolve from project path or texture source
        let location = texture.textureLocation;
        const readErrors = new Map<string, unknown>();
        if (!location) {
            // Try project save path first
            location = resolveTextureLocation(Project!.save_path, texture.name, readErrors);
            // If no save path, try texture source path
            if (!location && texture.source) {
                location = resolveTextureLocation(texture.source, texture.name, readErrors);
            }
        }
        textures[texture.name] = location;
        if (!location) readErrors.forEach((error, dir) => unresolvedReadErrors.set(dir, error));
    }
    warnTextureReadErrors(unresolvedReadErrors);
    return textures;
}

export function warnTextureReadErrors(readErrors: Map<string, unknown>): void {
    if (readErrors.size === 0) return;
    console.error('[VS Export] Unresolved texture search; unreadable folders:', readErrors);
    Blockbench.showQuickMessage('Some texture paths are unresolved and folders could not be searched. Check the exported texture references.', 5000);
}

/**
 * Get all texture names used in the element tree.
 * @param elements The element tree root to search for texture references.
 * @returns A set of texture names that are used by the elements.
 */
function get_used_texture_names(elements: VS_Element[]): Set<string> {
    return flatten(collect_tree_data(elements, texture_name_extractor));
}

/**
 *  Extracts texture names from an element's faces.
 * @param element The element to extract texture names from.
 * @returns A set of texture names used by the element.
 */
function texture_name_extractor(element: VS_Element): Set<string> {
    const texture_names = new Set<string>();
    if(element.faces) {
        Object.values(element.faces).forEach(face => {
            if(face.texture) {
                // Texture references are in the format "#texture_name"
                const texture_name = face.texture.startsWith('#') ? face.texture.substring(1) : face.texture;
                texture_names.add(texture_name);
            }
        });
    }
    return texture_names;
}

/**
 * Resolves texture location by searching in the textures folder relative to the shapes folder.
 * @param projectPath - The path to the .bbmodel file
 * @param textureName - The name of the texture (e.g., "fern.png")
 * @returns The VS-style texture path (e.g., "blocks/fern") or empty string if not found
 */
export function resolveTextureLocation(projectPath: string | undefined, textureName: string, readErrors = new Map<string, unknown>()): string {
    if (!projectPath || !textureName) {
        return "";
    }

    let texturesPath: string | null = null;

    // Check if path contains /shapes/ (project path)
    const shapesIndex = projectPath.indexOf(path.sep + "shapes" + path.sep);

    if (shapesIndex !== -1) {
        // Get the base path (up to and including the asset folder)
        const basePath = projectPath.substring(0, shapesIndex);
        texturesPath = path.join(basePath, "textures");
    } else {
        // Check if path contains /textures/ (texture source path)
        const texturesIndex = projectPath.indexOf(path.sep + "textures" + path.sep);

        if (texturesIndex !== -1) {
            texturesPath = projectPath.substring(0, texturesIndex + path.sep.length + "textures".length);
        } else {
            return "";
        }
    }

    if (!texturesPath) {
        return "";
    }

    // Search recursively for the texture file
    const textureFile = findTextureFile(texturesPath, textureName, readErrors);
    if (!textureFile) return "";

    // Build VS-style relative path (relative to textures folder, without extension)
    const relativePath = path.relative(texturesPath, textureFile);
    const withoutExt = relativePath.replace(/\.[^.]+$/, ""); // Remove extension
    // Convert backslashes to forward slashes for VS
    return withoutExt.split(path.sep).join("/");
}

/**
 * Recursively searches for a texture file in a directory.
 */
function findTextureFile(dir: string, textureName: string, readErrors: Map<string, unknown>): string | null {
    let entries: Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            readErrors.set(dir, error);
        }
        return null;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findTextureFile(fullPath, textureName, readErrors);
            if (found) return found;
        } else if (entry.isFile() && entry.name === textureName) {
            return fullPath;
        }
    }

    return null;
}
