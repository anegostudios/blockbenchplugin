import { VS_CUBE_PROPS } from "../property";
import { apply_extra_props } from "../preserved_props";
import { VS_Element } from "../vs_shape_def";
import {process_faces} from "./cube/faces";
import {create_VS_element} from "./cube/factory";

/**
 * Processes a Blockbench Cube and converts it to a VS element.
 * @param parent The parent node in the hierarchy.
 * @param node The Cube node to process.
 * @param accu The accumulator for the VS elements.
 * @param offset The position offset to apply.
 * @param parent_from_override Absolute position of the parent's VS `from`.
 */
export function process_cube(parent: Group | null, node: Cube, accu: Array<VS_Element>, offset: [number,number,number], parent_from_override?: [number, number, number]) {
    if(node.backdrop) {
        return;
    }
    const parent_pos: [number,number,number] = parent_from_override ? parent_from_override : (parent ? ((parent as any).vs_group_from ?? parent.origin) : [0, 0, 0]);
    const reduced_faces = process_faces(node.faces);
    const vsElement = create_VS_element(parent, node, parent_pos, offset, reduced_faces);

    for(const prop of VS_CUBE_PROPS) {
        const prop_name = prop.name;
        const value = node[prop_name];

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

    apply_extra_props(vsElement, node.vs_extra_props);

    accu.push(vsElement);
}
