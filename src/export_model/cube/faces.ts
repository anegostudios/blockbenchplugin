import { VS_FACE_PROPS } from "../../property";
import { apply_extra_props } from "../../preserved_props";
import { VS_Direction, VS_Face } from "../../vs_shape_def";

/**
 * Transforms UV coordinates and rotation for export.
 * Applies 180° rotation correction for downward-facing faces.
 * @param uv - The UV coordinates [x1, y1, x2, y2]
 * @param rotation - The face rotation in degrees (0, 90, 180, 270)
 * @param direction - The face direction
 * @returns Object with transformed UV and rotation
 */
function transformUV(uv: [number, number, number, number], rotation: number, direction: VS_Direction): { uv: [number, number, number, number], rotation: number } {
    // Apply 180° rotation for down faces to correct orientation in Vintage Story
    if (direction === VS_Direction.DOWN) {
        const correctedRotation = (rotation + 180) % 360;
        return { uv, rotation: correctedRotation };
    }
    // Pass through unchanged for other faces
    return { uv, rotation };
}

/**
 * Processes the face data from a Blockbench cube.
 * @param faces The faces object from the Blockbench cube.
 * @returns The processed face data for the VS element.
 */
export function process_faces(faces: Partial<Record<CardinalDirection, CubeFace>>): Partial<Record<VS_Direction, VS_Face>> {
    const processed_faces = {};

    for (const direction of Object.values(VS_Direction)) {
        const face = faces[direction];

        // Skip faces without textures
        if (!face || !face.texture) {
            continue;
        }

        const faceTexture = face.texture;

        const isUvDefault = face.uv[0] === 0 && face.uv[1] === 0 && face.uv[2] === 0 && face.uv[3] === 0;

        const rotation = face.rotation || 0;
        const transformed = transformUV(face.uv, rotation, direction);
        const transformedUV = transformed.uv;
        const transformedRotation = transformed.rotation;

        const texture_name = get_texture_name(faceTexture);

        const processed_face = {
            texture: `#${texture_name}`,
            ...(face.enabled === false && { enabled: false }),
            ...(!isUvDefault && { uv: transformedUV }),
            ...(transformedRotation !== 0 && { rotation: transformedRotation }),
        };

        for (const prop of VS_FACE_PROPS) {
            const prop_name = prop.name;
            const value = face[prop_name];

            if (value === undefined || value === null) continue;

            // windMode: skip when all vertices are "Default" (-1); [0,0,0,0] = NoWind is valid
            if (prop_name === 'windMode') {
                if (Array.isArray(value) && value.every((v: number) => v === -1)) continue;
                processed_face[prop_name] = value;
                continue;
            }
            // windData: skip when all zeros
            if (prop_name === 'windData') {
                if (Array.isArray(value) && value.every((v: number) => v === 0)) continue;
                processed_face[prop_name] = value;
                continue;
            }
            // Skip 0 for numeric properties (glow, reflectiveMode)
            if (typeof value === 'number' && value === 0) continue;
            // Skip false for boolean face properties (autoUv, snapUv default to false in VS)
            if (typeof value === 'boolean' && value === false) continue;

            processed_face[prop_name] = value;
        }

        apply_extra_props(processed_face, face.vs_extra_props);

        processed_faces[direction] = new oneLiner(processed_face);
    }
    return processed_faces;
}

/**
 * Tries to get the texture name from a face texture UUID.
 * @param face_texture The UUID of the face texture.
 * @returns The name of the texture, or 'missing_texture' if not found.
 */
function get_texture_name(face_texture: string): string {
    const texture = Texture.all.find(t => t.uuid === face_texture);
    if (texture) {
        return texture.name;
    } else {
        console.error("Texture not found for UUID:", face_texture);
        return 'missing_texture';
    }
}