import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import { composeEulerXYZ, relativeEulerXYZ } from "../attachments/attachment_transform";
import type { Vector3Tuple } from "../attachments/attachment_transform";


createBlockbenchMod(`${PACKAGE.name}:node_preview_controller_mod`,
    {
        original: Blockbench.NodePreviewController.prototype.updateTransform
    },
    inject_context => {
        Blockbench.NodePreviewController.prototype.updateTransform = function (this: NodePreviewController, node: OutlinerNode) {
            if (is_vs_project(Project)) {
                if ((node instanceof Group || node instanceof Cube)&& node.stepParentName && node.stepParentName !== "") {
                    const stepParent = resolveStepParentTarget(node);
                    const usesPhysicalParent = node.vs_step_parent_local !== true
                        && stepParent instanceof Group
                        && node.parent === stepParent;

                    // Absolute-space BB attachments can use Blockbench's normal
                    // transform once they have been placed under the real socket.
                    // Standalone legacy sources should likewise retain their
                    // authored hierarchy when no socket is present.
                    if (usesPhysicalParent || (node.vs_step_parent_local !== true && !stepParent)) {
                        return inject_context.original.call(this, node);
                    }

                    return updateStepChildTransform(this, node, stepParent);
                }

                return inject_context.original.call(this, node);
            }
            return inject_context.original.call(this, node);
        };
        return inject_context;
    },
    extract_context => {
        Blockbench.NodePreviewController.prototype.updateTransform = extract_context.original;
    }
);

/**
 * Does the same as the original method but skips parenting root groups to the internal root mesh (commented section)
 */
function updateStepChildTransform(controller: NodePreviewController, element: any, stepParent: Group | Cube | null) {
    const mesh = element.mesh;

    if (element.getTypeBehavior('movable')) {
        let position = [...element.origin] as Vector3Tuple;
        if (stepParent) {
            if (element.vs_step_parent_local === true) {
                // VS children are relative to parent.from, while the preview
                // mesh is rooted at parent.rotationOrigin/origin.
                const parentFrom = getStepParentFrom(stepParent);
                position = [
                    element.origin[0] + parentFrom[0] - stepParent.origin[0],
                    element.origin[1] + parentFrom[1] - stepParent.origin[1],
                    element.origin[2] + parentFrom[2] - stepParent.origin[2],
                ];
            } else {
                // Absolute BB coordinates become local to the target mesh pivot.
                position = [
                    element.origin[0] - stepParent.origin[0],
                    element.origin[1] - stepParent.origin[1],
                    element.origin[2] - stepParent.origin[2],
                ];
            }
        }
        mesh.position.set(position[0], position[1], position[2]);
    }

    if (element.getTypeBehavior('rotatable')) {
        const rotation = element.vs_step_parent_local === true || !stepParent
            ? ([element.rotation?.[0] || 0, element.rotation?.[1] || 0, element.rotation?.[2] || 0] as [number, number, number])
            : relativeEulerXYZ(getElementBindRotation(element), getElementBindRotation(stepParent));
        mesh.rotation.x = Math.degToRad(rotation[0]);
        mesh.rotation.y = Math.degToRad(rotation[1]);
        mesh.rotation.z = Math.degToRad(rotation[2]);
    }
    
    if (element.getTypeBehavior('scalable')) {
        mesh.scale.x = element.scale[0] || 1e-7;
        mesh.scale.y = element.scale[1] || 1e-7;
        mesh.scale.z = element.scale[2] || 1e-7;
    }

    // if (Format.bone_rig) {
    //     //@ts-expect-error: missing types
    //     if (element.parent instanceof OutlinerNode && element.parent.getTypeBehavior('parent')) {
    //         element.parent.mesh.add(mesh);
    //         //@ts-expect-error: missing types
    //         if (element.parent.getTypeBehavior('use_absolute_position')) {
    //             mesh.position.x -= element.parent.origin[0];
    //             mesh.position.y -= element.parent.origin[1];
    //             mesh.position.z -= element.parent.origin[2];
    //         }
    //     } else if (mesh.parent !== Project!.model_3d) {
    //         Project!.model_3d.add(mesh);
    //     }
    // } else if (mesh.parent !== Project!.model_3d) {
    //     Project!.model_3d.add(mesh);
    // }

    if((element instanceof Cube || element instanceof Group) && element.stepParentName && element.stepParentName != "") {
        // Guard against self-parenting and attachment-child cycles.
        if(stepParent && stepParent !== element && stepParent.mesh !== element.mesh) {
            stepParent.mesh.add(element.mesh);
        } else {
            Project!.model_3d.add(mesh);
        }
    }

    mesh.updateMatrixWorld();

    controller.dispatchEvent('update_transform', { element });
}

function isInElementSubtree(candidate: Group | Cube, element: Group | Cube): boolean {
    let current: any = candidate;
    while (current instanceof Group || current instanceof Cube) {
        if (current === element) return true;
        current = current.parent;
    }
    return false;
}

function resolveStepParentTarget(element: Group | Cube): Group | Cube | null {
    const name = element.stepParentName?.trim();
    if (!name) return null;
    const attachmentSlot = element.clothingSlot?.trim();

    const groups = Group.all.filter((candidate: Group) =>
        candidate.name === name
        && candidate !== element
        && !isInElementSubtree(candidate, element)
    );
    const preferredGroup = groups.find((candidate: Group) =>
        !candidate.stepParentName?.trim()
        && (!candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot)
    ) || groups.find((candidate: Group) =>
        !candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot
    ) || groups[0];
    if (preferredGroup) return preferredGroup;

    const cubes = Cube.all.filter((candidate: Cube) =>
        candidate.name === `${name}_geo`
        && candidate !== element
        && !isInElementSubtree(candidate, element)
    );
    return cubes.find((candidate: Cube) =>
        !candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot
    ) || cubes[0] || null;
}

function getStepParentFrom(stepParent: Group | Cube): Vector3Tuple {
    if (stepParent instanceof Cube) return [...stepParent.from] as Vector3Tuple;
    if (Array.isArray(stepParent.vs_group_from) && stepParent.vs_group_from.length === 3) {
        return [...stepParent.vs_group_from] as Vector3Tuple;
    }
    const geoChild = stepParent.children.find(child =>
        child instanceof Cube && child.name === `${stepParent.name}_geo`
    ) as Cube | undefined;
    return [...(geoChild?.from || stepParent.origin)] as Vector3Tuple;
}

function getElementBindRotation(element: Group | Cube): Vector3Tuple {
    const chain: Vector3Tuple[] = [];
    let current: any = element;
    while (current instanceof Group || current instanceof Cube) {
        chain.unshift([...(current.rotation || [0, 0, 0])] as Vector3Tuple);
        current = current.parent;
    }
    return composeEulerXYZ(chain);
}

