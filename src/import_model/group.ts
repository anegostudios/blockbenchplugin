import { VS_Element } from "../vs_shape_def";
import * as util from "../util";
import {VS_GROUP_PROPS, VS_CUBE_PROPS } from "../property";
import { collect_element_extras } from "../preserved_props";
import { process_attachment_points } from "./locator";
import { getActiveSlotNames } from "../attachments/presets";


/**
 * Processes a Vintage Story element and creates a Blockbench Group.
 * @param parent The parent Blockbench object.
 * @param object_space_pos The position in the object space.
 * @param vsElement The Vintage Story element to process.
 * @param asBackdrop Whether to import as a backdrop.
 * @param filePath The path to the file being imported (for clothing slot inference)
 * @returns The created Blockbench Group.
 */
export function process_group(parent: Group | null, object_space_pos: [number,number,number], vsElement: VS_Element, asBackdrop: boolean, filePath?: string): Group {
    const absolute_from: [number,number,number] = util.vector_add(vsElement.from, object_space_pos);
    const absolute_to: [number,number,number] = util.vector_add(vsElement.to, object_space_pos);

    const group = new Group({
        name: vsElement.name,
        origin: vsElement.rotationOrigin ? util.vector_add(vsElement.rotationOrigin, object_space_pos) : absolute_from,
        rotation: [vsElement.rotationX || 0, vsElement.rotationY || 0, vsElement.rotationZ || 0],
    });

    // Store VS from/to in absolute BB coordinates for export round-trip.
    // Groups only have `origin` (= rotationOrigin), but VS elements can have
    // from/to that differ from rotationOrigin.
    group.vs_group_from = absolute_from;
    group.vs_group_to = absolute_to;
    group.vs_has_rotation_origin = vsElement.rotationOrigin !== undefined;

    // Preserve faces on zero-size elements (from==to but with non-empty faces)
    if (vsElement.faces && Object.keys(vsElement.faces).length > 0 && util.vector_equals(vsElement.from, vsElement.to)) {
        group.vs_zero_size_faces = vsElement.faces;
    }

    // Preserve element-level uv offset (Blockbench may not preserve uv_offset in per-face UV mode)
    if (vsElement.uv) {
        group.vs_uv = vsElement.uv;
    }

    if (asBackdrop) {
        group.backdrop = true;
        group.locked = true;
    }

    for(const prop of VS_GROUP_PROPS) {
        const prop_name = prop.name;
        if (vsElement[prop_name] !== undefined) {
            group[prop_name] = vsElement[prop_name];
        }
    }

    // Also preserve VS_CUBE_PROPS that may appear on group-like elements
    // (e.g. elements with from≠to but empty faces, like "eyesroot")
    for (const prop of VS_CUBE_PROPS) {
        const prop_name = prop.name;
        if (VS_GROUP_PROPS.some(groupProp => groupProp.name === prop_name)) continue;
        if (prop_name === 'shade') continue;
        if (vsElement[prop_name] !== undefined) {
            group[prop_name] = vsElement[prop_name];
        }
    }

    const extras = collect_element_extras(vsElement, true);
    if (extras) {
        group.vs_extra_props = extras;
    }

    // If this is a top-level group with stepParentName and no clothingSlot set, infer from path
    if (vsElement.stepParentName && !group.clothingSlot && filePath && !parent) {
        const inferredSlot = getActiveSlotNames().includes(vsElement.stepParentName)
            ? vsElement.stepParentName
            : require('../attachments/presets').inferClothingSlotFromPath(filePath);

        if (inferredSlot) {
            group.clothingSlot = inferredSlot;
            console.log(`[Import] Inferred clothingSlot "${inferredSlot}" for group "${group.name}" from path`);
        }
    }

    group.addTo(parent ? parent : undefined).init();
    
    // Process attachment points as locators
    if (vsElement.attachmentpoints && vsElement.attachmentpoints.length > 0) {
        process_attachment_points(group, object_space_pos, vsElement.attachmentpoints, asBackdrop);
    }

    return group;
}
