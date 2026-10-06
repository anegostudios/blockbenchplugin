import { VS_AttachmentPoint } from "../vs_shape_def";
import * as util from "../util";
import { collect_attachment_point_extras } from "../preserved_props";

/**
 * Processes VS attachment points and creates Blockbench Locators.
 * @param parent The parent Blockbench Group.
 * @param object_space_pos The position in object space.
 * @param attachmentPoints Array of VS attachment points to convert.
 * @param asBackdrop Whether to import as a backdrop.
 */
export function process_attachment_points(
    parent: Group,
    object_space_pos: [number, number, number],
    attachmentPoints: Array<VS_AttachmentPoint>,
    asBackdrop: boolean
) {
    for (const ap of attachmentPoints) {
        // Parse string values to numbers
        const posX = parseFloat(ap.posX);
        const posY = parseFloat(ap.posY);
        const posZ = parseFloat(ap.posZ);

        // Calculate absolute position: VS attachment positions are relative to parent's `from`,
        // which is stored as vs_group_from in absolute BB space (not rotationOrigin/origin)
        const absolute_pos = util.vector_add(
            [posX, posY, posZ],
            parent.vs_group_from ?? parent.origin
        );

        const locator = new Locator({
            name: ap.code,
            from: absolute_pos
        });

        // Set rotation via registered properties (persists in .bbmodel)
        locator.rotationX = parseFloat(ap.rotationX) || 0;
        locator.rotationY = parseFloat(ap.rotationY) || 0;
        locator.rotationZ = parseFloat(ap.rotationZ) || 0;

        const extras = collect_attachment_point_extras(ap);
        if (extras) {
            (locator as any).vs_extra_props = extras;
        }

        if (asBackdrop) {
            locator.locked = true;
        }

        locator.addTo(parent).init();
    }
}
