import { VS_Element } from "../vs_shape_def";
import { traverse } from "./traverse";
import * as util from "../util";
import { VS_CUBE_PROPS, VS_GROUP_PROPS } from "../property";
import { process_locators } from "./locator";
import { process_faces } from "./cube/faces";

/**
 * Computes the parent reference position for child element positioning.
 * In VS format, children are positioned relative to the parent's `from`.
 * Uses the stored vs_group_from (original VS `from` in absolute BB coordinates)
 * if available, falling back to origin.
 *
 * @param parent The parent Blockbench Group (null for root).
 * @param parent_from_override Absolute position override for the parent's VS `from`.
 * @returns The absolute position to subtract from children to get VS-relative coordinates.
 */
function get_parent_pos(parent: Group | null, parent_from_override?: [number, number, number]): [number, number, number] {
    if (parent_from_override) {
        return parent_from_override;
    }
    if (!parent) return [0, 0, 0];
    // Use stored VS from if available (set during import), otherwise fall back to origin
    return parent.vs_group_from ?? parent.origin;
}

/**
 * Gets the VS `from` position for a group in absolute BB coordinates.
 * Uses vs_group_from if set during import, otherwise falls back to origin.
 */
function get_group_vs_from(node: Group): [number, number, number] {
    return node.vs_group_from ?? [...node.origin];
}

/**
 * Gets the VS `to` position for a group in absolute BB coordinates.
 * Uses vs_group_to if set during import, otherwise falls back to origin.
 */
function get_group_vs_to(node: Group): [number, number, number] {
    return node.vs_group_to ?? [...node.origin];
}

/**
 * Processes a Blockbench Group and converts it to a VS element.
 * @param parent The parent node in the hierarchy.
 * @param node The Group node to process.
 * @param accu The accumulator for the VS elements.
 * @param offset The position offset to apply.
 * @param parent_from_override Absolute position of the parent's VS `from`.
 */
export function process_group(
    parent: Group | null,
    node: Group,
    accu: Array<VS_Element>,
    offset: [number, number, number],
    parent_from_override?: [number, number, number]
) {
    if (node.backdrop) {
        return;
    }
    const parent_pos = get_parent_pos(parent, parent_from_override);
    const converted_rotation = node.rotation;

    const node_vs_from = get_group_vs_from(node);
    const node_vs_to = get_group_vs_to(node);

    let from = util.vector_sub(node_vs_from, parent_pos);
    let to = util.vector_sub(node_vs_to, parent_pos);
    let rotationOrigin = util.vector_sub(node.origin, parent_pos);

    if (parent === null) {
        from = util.vector_add(from, offset);
        to = util.vector_add(to, offset);
        rotationOrigin = util.vector_add(rotationOrigin, offset);
    }


    const vsElement: VS_Element = {
        name: node.name,
        from: from,
        to: to,
        rotationOrigin: rotationOrigin,
        ...(node.vs_uv ? { uv: node.vs_uv } : undefined),
        ...(converted_rotation[0] !== 0 && { rotationX: converted_rotation[0] }),
        ...(converted_rotation[1] !== 0 && { rotationY: converted_rotation[1] }),
        ...(converted_rotation[2] !== 0 && { rotationZ: converted_rotation[2] }),
        ...(node.vs_zero_size_faces ? { faces: node.vs_zero_size_faces } : undefined),
        children: []
    };

    for (const prop of VS_GROUP_PROPS) {
        const prop_name = prop.name;
        const value = node[prop_name];

        // Skip properties with default/empty values
        if (value !== undefined && value !== null && value !== '' && value !== false) {
            const exportedValue = prop.type === 'number' ? Number(value) : value;
            if (prop_name === 'paletteSlot' && exportedValue === 0) continue;
            vsElement[prop_name] = exportedValue;
        }
    }

    // Also export VS_CUBE_PROPS stored on group-like elements (e.g. unwrapMode on eyesroot)
    for (const prop of VS_CUBE_PROPS) {
        const prop_name = prop.name;
        if (VS_GROUP_PROPS.some(groupProp => groupProp.name === prop_name)) continue;
        const value = node[prop_name];
        if (prop_name === 'shade') {
            if (value !== undefined && value !== true) {
                vsElement[prop_name] = value;
            }
            continue;
        }
        if (value !== undefined && value !== null && value !== '' && value !== false) {
            // Coerce to number for numeric properties (select dropdowns may return strings)
            const numValue = prop.type === 'number' ? Number(value) : value;
            if (prop_name === 'renderPass' && numValue === -1) continue;
            if (prop_name === 'unwrapMode' && numValue === 0) continue;
            if (prop_name === 'unwrapRotation' && numValue === 0) continue;
            if (prop_name === 'paletteSlot' && numValue === 0) continue;
            vsElement[prop_name] = numValue;
        }
    }

    // Process child locators as attachment points
    const locators = node.children.filter(child => child instanceof Locator && !(typeof NullObject !== 'undefined' && child instanceof NullObject)) as Array<Locator>;
    if (locators.length > 0) {
        const attachmentPoints = process_locators(node, locators);
        if (attachmentPoints.length > 0) {
            vsElement.attachmentpoints = attachmentPoints;
        }
    }

    accu.push(vsElement);

    // Pass this group's VS from as the parent reference for children
    traverse(node, node.children, vsElement.children!, offset, node_vs_from);
}

/**
 * Processes a Blockbench Group that has a _geo child Cube, collapsing them back
 * into a single VS element with both geometry and children.
 * This reverses the expand_complex_element() transformation done during import.
 *
 * @param parent The parent node in the hierarchy.
 * @param node The Group node (provides rotation, origin, hierarchy, attachments).
 * @param geoChild The _geo Cube child (provides geometry: from/to, faces, cube properties).
 * @param accu The accumulator for the VS elements.
 * @param offset The position offset to apply.
 * @param parent_from_override Absolute position of the parent's VS `from`.
 */
export function process_collapsed_group(
    parent: Group | null,
    node: Group,
    geoChild: Cube,
    accu: Array<VS_Element>,
    offset: [number, number, number],
    parent_from_override?: [number, number, number]
) {
    if (node.backdrop) {
        return;
    }
    const parent_pos = get_parent_pos(parent, parent_from_override);
    const converted_rotation = node.rotation;

    // Geometry from/to comes from the _geo cube (relative to parent's VS from)
    let from = util.vector_sub(geoChild.from, parent_pos);
    let to = util.vector_sub(geoChild.to, parent_pos);

    // Apply inflate value from the _geo cube
    if (geoChild.inflate && geoChild.inflate !== 0) {
        from = [from[0] - geoChild.inflate, from[1] - geoChild.inflate, from[2] - geoChild.inflate];
        to = [to[0] + geoChild.inflate, to[1] + geoChild.inflate, to[2] + geoChild.inflate];
    }

    // rotationOrigin comes from the group's origin (the element's rotation pivot)
    let rotationOrigin = util.vector_sub(node.origin, parent_pos);

    if (parent === null) {
        from = util.vector_add(from, offset);
        to = util.vector_add(to, offset);
        rotationOrigin = util.vector_add(rotationOrigin, offset);
    }

    // Process faces from the _geo cube
    const reduced_faces = process_faces(geoChild.faces);


    const vsElement: VS_Element = {
        name: node.name,
        from: from,
        to: to,
        rotationOrigin: rotationOrigin,
        ...(geoChild.vs_uv ? { uv: geoChild.vs_uv } : ((geoChild.uv_offset[0] !== 0 || geoChild.uv_offset[1] !== 0) && { uv: geoChild.uv_offset })),
        ...(converted_rotation[0] !== 0 && { rotationX: converted_rotation[0] }),
        ...(converted_rotation[1] !== 0 && { rotationY: converted_rotation[1] }),
        ...(converted_rotation[2] !== 0 && { rotationZ: converted_rotation[2] }),
        faces: reduced_faces,
        children: []
    };

    // Copy VS_GROUP_PROPS from the group node (e.g. stepParentName)
    for (const prop of VS_GROUP_PROPS) {
        const prop_name = prop.name;
        const value = node[prop_name];
        if (value !== undefined && value !== null && value !== '' && value !== false) {
            const exportedValue = prop.type === 'number' ? Number(value) : value;
            if (prop_name === 'paletteSlot' && exportedValue === 0) continue;
            vsElement[prop_name] = exportedValue;
        }
    }

    const groupPaletteSlot = Number(node.paletteSlot) || 0;
    const geometryPaletteSlot = Number(geoChild.paletteSlot) || 0;
    if (groupPaletteSlot === 0 && geometryPaletteSlot !== 0) {
        vsElement.paletteSlot = geometryPaletteSlot;
    }

    // Copy VS_CUBE_PROPS from the _geo cube (e.g. shade, climateColorMap, unwrapMode)
    for (const prop of VS_CUBE_PROPS) {
        const prop_name = prop.name;
        if (VS_GROUP_PROPS.some(groupProp => groupProp.name === prop_name)) continue;
        const value = geoChild[prop_name];
        if (prop_name === 'shade') {
            if (value !== true) {
                vsElement[prop_name] = value;
            }
            continue;
        }
        if (value !== undefined && value !== null && value !== '' && value !== false) {
            // Coerce to number for numeric properties (select dropdowns may return strings)
            const numValue = prop.type === 'number' ? Number(value) : value;
            if (prop_name === 'renderPass' && numValue === -1) {
                continue;
            }
            if (prop_name === 'unwrapMode' && numValue === 0) {
                continue;
            }
            if (prop_name === 'unwrapRotation' && numValue === 0) {
                continue;
            }
            if (prop_name === 'paletteSlot' && numValue === 0) {
                continue;
            }
            vsElement[prop_name] = numValue;
        }
    }

    // Process child locators as attachment points
    const locators = node.children.filter(child => child instanceof Locator && !(typeof NullObject !== 'undefined' && child instanceof NullObject)) as Array<Locator>;
    if (locators.length > 0) {
        const attachmentPoints = process_locators(node, locators);
        if (attachmentPoints.length > 0) {
            vsElement.attachmentpoints = attachmentPoints;
        }
    }

    accu.push(vsElement);

    // In VS format, children are positioned relative to the parent's `from`.
    // The _geo cube's absolute `from` position IS the VS element's `from` in absolute BB space.
    // Pass it as the parent_from_override so children compute positions correctly.
    const otherChildren = node.children.filter(
        child => child !== geoChild
    );
    traverse(node, otherChildren, vsElement.children!, offset, geoChild.from as [number, number, number]);
}
