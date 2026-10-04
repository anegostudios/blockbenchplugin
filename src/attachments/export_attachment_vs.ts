import { getActiveSlotNames } from './presets';
import * as props from "../property";
import * as util from '../util';
import { VS_Element } from '../vs_shape_def';
import { QUICK_MESSAGE_DURATION } from './constants';
import { process_cube } from '../export_model/cube';
import { visit_tree } from '../util/element_tree';
import { composeEulerXYZ, rebaseAttachmentRoot } from './attachment_transform';
import type { AttachmentElementFrame, StepParentFrame, Vector3Tuple } from './attachment_transform';

const fs = requireNativeModule('fs');

const DEBUG = false; // Enable debug to see what's being exported

function logDebug(message: string, ...args: unknown[]) {
    if (DEBUG) console.log(message, ...args);
}

function isFiniteVector3(value: unknown): value is Vector3Tuple {
    return Array.isArray(value)
        && value.length === 3
        && value.every(component => typeof component === 'number' && Number.isFinite(component));
}

function getElementBindRotation(element: Group | Cube): Vector3Tuple {
    const chain: Vector3Tuple[] = [];
    let current: OutlinerNode | OutlinerNode['parent'] = element;
    while (current instanceof Group || current instanceof Cube) {
        chain.unshift([...(current.rotation || [0, 0, 0])] as Vector3Tuple);
        current = current.parent;
    }
    return composeEulerXYZ(chain);
}

function getSocketFrom(group: Group): Vector3Tuple {
    const storedFrom = group.vs_group_from;
    if (isFiniteVector3(storedFrom)) return [...storedFrom];
    const geoChild = group.children.find(child =>
        child instanceof Cube && child.name === `${group.name}_geo`
    ) as Cube | undefined;
    return [...(geoChild?.from || group.origin)] as Vector3Tuple;
}

function isInAttachmentSubtree(candidate: Group, attachmentRoot: Group | Cube): boolean {
    let current: OutlinerNode | OutlinerNode['parent'] = candidate;
    while (current && current instanceof Group) {
        if (current === attachmentRoot) return true;
        current = current.parent;
    }
    return false;
}

function resolveStepParentFrame(element: Group | Cube, stepParentName: string): StepParentFrame | null {
    const attachmentSlot = element.clothingSlot?.trim();
    const candidates = Group.all.filter((candidate: Group) => {
        if (candidate === element || candidate.name !== stepParentName) return false;
        if (isInAttachmentSubtree(candidate, element)) return false;
        return true;
    });
    const target = candidates.find((candidate: Group) =>
        !candidate.stepParentName?.trim()
        && (!candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot)
    ) || candidates.find((candidate: Group) =>
        !candidate.clothingSlot?.trim() || candidate.clothingSlot?.trim() !== attachmentSlot
    ) || candidates[0];
    if (target) {
        // A live socket represents the hierarchy that the exported attachment
        // will actually run under. Stored metadata is the standalone fallback.
        return {
            from: getSocketFrom(target),
            rotation: getElementBindRotation(target),
        };
    }

    if (
        element.vs_has_step_parent_transform
        && isFiniteVector3(element.vs_step_parent_origin)
        && isFiniteVector3(element.vs_step_parent_rotation)
    ) {
        return {
            from: [...element.vs_step_parent_origin],
            rotation: [...element.vs_step_parent_rotation],
        };
    }

    return null;
}

function getGroupFrom(group: Group): Vector3Tuple {
    return isFiniteVector3(group.vs_group_from)
        ? [...group.vs_group_from]
        : [...group.origin] as Vector3Tuple;
}

function getGroupTo(group: Group): Vector3Tuple {
    return isFiniteVector3(group.vs_group_to)
        ? [...group.vs_group_to]
        : [...group.origin] as Vector3Tuple;
}

/**
 * Collects texture names that are actually used by the given elements.
 * @param elements The exported VS elements to scan for texture references.
 * @returns A set of texture names that are used by the elements.
 */
function getUsedTextureNames(elements: VS_Element[]): Set<string> {
    const usedTextures = new Set<string>();

    elements.forEach(element => {
        visit_tree(element, (elem) => {
            if (elem.faces) {
                Object.values(elem.faces).forEach(face => {
                    if (face.texture) {
                        // Texture references are in the format "#texture_name"
                        const textureName = face.texture.startsWith('#')
                            ? face.texture.substring(1)
                            : face.texture;
                        usedTextures.add(textureName);
                    }
                });
            }
        });
    });

    return usedTextures;
}

/**
 * Final cleanup pass that removes any textureSizes and textures entries
 * that are not actually used by the exported elements.
 * Also removes the keys entirely if they end up empty.
 * @param {Object} data - The export data object to clean up.
 * @param {Set<string>} usedTextureNames - Set of texture names that are actually used.
 */
function cleanupUnusedTextures(data: any, usedTextureNames: Set<string>) {
    // Clean up textureSizes - remove any entries not in usedTextureNames
    if (data.textureSizes) {
        for (const name of Object.keys(data.textureSizes)) {
            if (!usedTextureNames.has(name)) {
                logDebug(`[VS Attachment Export] Removing unused textureSizes entry: "${name}"`);
                delete data.textureSizes[name];
            }
        }
        // Remove the key entirely if empty
        if (Object.keys(data.textureSizes).length === 0) {
            logDebug('[VS Attachment Export] Removing empty textureSizes object');
            delete data.textureSizes;
        }
    }

    // Clean up textures - remove any entries not in usedTextureNames
    if (data.textures) {
        for (const name of Object.keys(data.textures)) {
            if (!usedTextureNames.has(name)) {
                logDebug(`[VS Attachment Export] Removing unused textures entry: "${name}"`);
                delete data.textures[name];
            }
        }
        // Remove the key entirely if empty
        if (Object.keys(data.textures).length === 0) {
            logDebug('[VS Attachment Export] Removing empty textures object');
            delete data.textures;
        }
    }
}

/**
 * Populates textureSizes and textures from the current project,
 * filtered to only include textures that are actually used.
 * @param {Object} data - The export data object to populate.
 * @param {Set<string>} usedTextureNames - Set of texture names that are actually used.
 */
function populateTexturesFromProject(data: any, usedTextureNames?: Set<string>) {
    // Populate Texture Sizes from the current project (only for used textures)
    for (const texture of Texture.all) {
        // Skip textures that aren't used (if filter is provided)
        if (usedTextureNames && !usedTextureNames.has(texture.name)) {
            continue;
        }
        if (texture.getUVWidth() && texture.getUVHeight()) {
            data.textureSizes[texture.name] = [texture.uv_width, texture.uv_height];
        }
    }

    // Populate Textures from the current project (only for used textures)
    for (const texture of Texture.all) {
        // Skip textures that aren't used (if filter is provided)
        if (usedTextureNames && !usedTextureNames.has(texture.name)) {
            continue;
        }
        let tmp: any = {};
        props.VS_TEXTURE_PROPS.find(p => p.name === 'textureLocation')?.copy(texture, tmp);
        data.textures[texture.name] = tmp.textureLocation;
    }
}

/**
 * Determines the correct step-parent bone name for a given attachment group.
 * First checks if the group has an explicit stepParentName property set,
 * then falls back to using the configurable attachment stepParent mappings from settings.
 * @param {Group} group - The attachment group from Blockbench.
 * @returns {string|null} The name of the parent bone, or null if no match is found.
 */
function getStepParentName(group: Group): string | null {
    // First, check if the group has an explicit stepParentName property set
    if (group.stepParentName && group.stepParentName.trim() !== '') {
        if (DEBUG) console.log(`[getStepParentName] Using explicit stepParentName property: "${group.stepParentName}"`);
        return group.stepParentName;
    }

    const { name } = group;
    const lowerName = name.toLowerCase();

    if (DEBUG) console.log(`[getStepParentName] Checking group: "${name}"`);

    // Get the mappings from settings
    const mappings = Settings.get("attachment_stepparent_mappings") || {
        exactMatches: {},
        patternMatches: []
    };

    // Check for exact matches first
    if (mappings.exactMatches && mappings.exactMatches[name]) {
        const stepParent = mappings.exactMatches[name];
        if (DEBUG) console.log(`[getStepParentName] Exact match found: "${name}" → "${stepParent}"`);
        return stepParent;
    }

    // Check pattern matches
    if (mappings.patternMatches && Array.isArray(mappings.patternMatches)) {
        for (const pattern of mappings.patternMatches) {
            // Check if the pattern's "contains" condition is met
            if (pattern.contains && lowerName.includes(pattern.contains.toLowerCase())) {
                // Check if there's an "endsWith" condition
                if (pattern.endsWith) {
                    if (lowerName.endsWith(pattern.endsWith.toLowerCase())) {
                        if (DEBUG) console.log(`[getStepParentName] Pattern match (contains="${pattern.contains}", endsWith="${pattern.endsWith}"): "${name}" → "${pattern.stepParent}"`);
                        return pattern.stepParent;
                    }
                } else if (pattern.default) {
                    // This is a fallback pattern - continue checking other patterns first
                    continue;
                } else if (pattern.stepParent) {
                    // Simple contains match without endsWith or default
                    if (DEBUG) console.log(`[getStepParentName] Pattern match (contains="${pattern.contains}"): "${name}" → "${pattern.stepParent}"`);
                    return pattern.stepParent;
                }
            }
        }

        // Second pass: check for default fallbacks
        for (const pattern of mappings.patternMatches) {
            if (pattern.contains && lowerName.includes(pattern.contains.toLowerCase()) && pattern.default) {
                if (DEBUG) console.log(`[getStepParentName] Pattern default match (contains="${pattern.contains}"): "${name}" → "${pattern.default}"`);
                return pattern.default;
            }
        }
    }

    // Fallback: Try to match against active slot names
    const activeSlotNames = getActiveSlotNames();
    const matches = activeSlotNames.filter(slotName =>
        lowerName.endsWith(slotName.toLowerCase())
    );

    if (matches.length === 0) {
        if (DEBUG) console.warn(`[getStepParentName] No slot match found for "${name}"`);
        return null;
    }

    if (matches.length > 1) {
        if (DEBUG) console.warn(`[getStepParentName] Multiple slot matches found for "${name}": ${matches.join(', ')}`);
    }

    // Pick the longest match to avoid shorter overlaps (e.g. "Top" vs "Face")
    const slot = matches.reduce((a, b) => (a.length >= b.length ? a : b));

    if (DEBUG) console.log(`[getStepParentName] Using slot: "${slot}"`);

    // Remove the slot suffix but keep the original casing of the prefix
    const stepParentName = name.slice(0, -slot.length);

    if (DEBUG) console.log(`[getStepParentName] Derived stepParentName: "${stepParentName}"`);

    return stepParentName || null;
}

/**
 * Processes a Blockbench Group for attachment export, filtering out base model elements.
 * Only processes children that have the matching clothingSlot or no slot (intermediate groups).
 * This is a specialized version of process_group that filters children by clothingSlot.
 */
function process_attachment_group(
    parent: Group | null,
    node: Group,
    accu: Array<VS_Element>,
    offset: [number, number, number],
    targetSlot: string,
    stepParentName?: string | null,
    rootTransform?: AttachmentElementFrame
) {
    if (node.backdrop) {
        return;
    }
    const parent_pos: [number, number, number] = parent ? getGroupFrom(parent) : [0, 0, 0];
    const converted_rotation = parent === null && rootTransform ? rootTransform.rotation : node.rotation;

    let from = util.vector_sub(getGroupFrom(node), parent_pos);
    let to = util.vector_sub(getGroupTo(node), parent_pos);
    let rotationOrigin = util.vector_sub(node.origin, parent_pos);

    if (parent === null && rootTransform) {
        from = [...rootTransform.from];
        to = [...rootTransform.to];
        rotationOrigin = [...rootTransform.rotationOrigin];
    } else if (parent === null) {
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

    for (const prop of props.VS_GROUP_PROPS) {
        const prop_name = prop.name;
        // Use stepParentName if provided (for top-level groups), otherwise use the node's property
        const value = (prop_name === 'stepParentName' && stepParentName) ? stepParentName : node[prop_name];

        // Skip properties with default/empty values
        if (value !== undefined && value !== null && value !== '' && value !== false) {
            const exportedValue = prop.type === 'number' ? Number(value) : value;
            if (prop_name === 'paletteSlot' && exportedValue === 0) continue;
            vsElement[prop_name] = exportedValue;
        }
    }

    // Group-like VS elements may carry cube properties (for example shade,
    // renderPass, or unwrapMode). Preserve the same payload as normal export.
    for (const prop of props.VS_CUBE_PROPS) {
        const prop_name = prop.name;
        if (props.VS_GROUP_PROPS.some(groupProp => groupProp.name === prop_name)) continue;
        const value = node[prop_name];
        if (prop_name === 'shade') {
            if (value !== undefined && value !== true) {
                vsElement[prop_name] = value;
            }
            continue;
        }
        if (value !== undefined && value !== null && value !== '' && value !== false) {
            const exportedValue = prop.type === 'number' ? Number(value) : value;
            if (prop_name === 'renderPass' && exportedValue === -1) continue;
            if (prop_name === 'unwrapMode' && exportedValue === 0) continue;
            if (prop_name === 'unwrapRotation' && exportedValue === 0) continue;
            if (prop_name === 'paletteSlot' && exportedValue === 0) continue;
            vsElement[prop_name] = exportedValue;
        }
    }

    // Process child locators as attachment points
    const locators = node.children.filter(child => child instanceof Locator) as Array<Locator>;
    if (locators.length > 0) {
        const { process_locators } = require('../export_model/locator');
        const attachmentPoints = process_locators(node, locators);
        if (attachmentPoints.length > 0) {
            vsElement.attachmentpoints = attachmentPoints;
        }
    }

    accu.push(vsElement);

    // Filter children to ONLY include those with matching clothingSlot
    // Don't include groups with no slot, as they might be base model elements
    const filteredChildren = (node.children || []).filter(child => {
        if (!(child instanceof Group || child instanceof Cube)) return false;
        const childSlot = child.clothingSlot;
        // Empty means inherit from this attachment root. An explicit different
        // slot is a real boundary and must not be exported with this attachment.
        return !childSlot || childSlot.trim() === '' || childSlot.trim() === targetSlot.trim();
    });

    logDebug(`[VS Attachment Export] Filtered children of "${node.name}": ${filteredChildren.length} of ${node.children.length} match slot "${targetSlot}"`);

    // Recursively process filtered children (don't pass stepParentName - it's only for top-level elements)
    traverseAttachment(node, filteredChildren, vsElement.children!, offset, targetSlot, undefined, undefined);
}

/**
 * Traverses attachment elements and processes them for export, filtering out base model elements.
 * Only processes children that have the matching clothingSlot or no slot (intermediate groups).
 * @param parent The parent node in the hierarchy
 * @param nodes The array of nodes to process
 * @param accu The accumulator for the VS elements
 * @param offset The position offset to apply
 * @param targetSlot The clothingSlot to filter by - only children with this slot or no slot are processed
 * @param stepParentName The step parent name to apply to top-level elements (null if not top-level)
 */
function traverseAttachment(
    parent: Group | null,
    nodes: Array<OutlinerNode>,
    accu: Array<VS_Element>,
    offset: [number, number, number],
    targetSlot: string,
    stepParentName?: string | null,
    rootTransform?: AttachmentElementFrame
) {
    for (const node of nodes) {
        if (!node.export) continue;
        if (!(node instanceof Group || node instanceof Cube)) continue;

        // Filter: ONLY process nodes with matching clothingSlot
        // Don't include nodes with no slot, as they might be base model elements
        const nodeSlot = node.clothingSlot;
        const hasMatchingSlot = !nodeSlot || nodeSlot.trim() === '' || nodeSlot.trim() === targetSlot.trim();

        // Skip nodes that don't have the matching slot
        if (!hasMatchingSlot) {
            logDebug(`[VS Attachment Export] Skipping node "${node.name}" - slot "${nodeSlot || '(none)'}" doesn't match target "${targetSlot}"`);
            continue;
        }

        // If this is a top-level element (parent is null) and we have a stepParentName, apply it
        const isTopLevel = parent === null;
        const stepParentToUse = isTopLevel ? stepParentName : undefined;

        if (node instanceof Group) {
            process_attachment_group(parent, node, accu, offset, targetSlot, stepParentToUse, rootTransform);
        } else if (node instanceof Cube) {
            // For cubes, we need to apply stepParentName manually since process_cube doesn't accept it
            // Save the original stepParentName to restore later
            const originalStepParent = node.stepParentName;
            if (stepParentToUse && (!originalStepParent || originalStepParent.trim() === '')) {
                node.stepParentName = stepParentToUse;
            }
            process_cube(parent, node, accu, offset);
            // Restore original stepParentName
            if (stepParentToUse) {
                node.stepParentName = originalStepParent;
            }
        }
        // Locator nodes are handled as attachment points on their parent elements, so skip them here
    }
}

/**
 * Finds the topmost parent group that should be the root of this attachment hierarchy.
 * This handles the case where clothingSlot is on cubes but not on their parent groups.
 * @param element The element to find the root for
 * @param clothingSlot The clothing slot to look for
 * @returns The topmost group that should contain this attachment, or null
 */
function findTopmostAttachmentRoot(element: Group | Cube, clothingSlot: string): Group | null {
    // Walk up the tree to find the highest group with the matching clothingSlot
    // Only return groups that have the matching clothingSlot (don't include groups with no slot)
    let current = element.parent;
    let topmostCandidate: Group | null = null;

    while (current && current instanceof Group) {
        // Check if this group's clothingSlot matches
        const groupSlot = current.clothingSlot;
        const hasMatchingSlot = groupSlot && groupSlot.trim() !== '' && groupSlot === clothingSlot;

        if (hasMatchingSlot) {
            // This group has the same clothingSlot - it could be the root
            topmostCandidate = current;
        } else {
            // This group doesn't have the matching slot - stop here
            // Don't include groups with no slot, as they might be base model elements
            break;
        }

        current = current.parent;
    }

    return topmostCandidate;
}

/**
 * Exports the selected attachments to the Vintage Story format.
 * @param selection - The selected attachment groups and cubes.
 */
export function exportAttachmentsVS(selection: (Group | Cube)[]) {
    if (!Project) {
        Blockbench.showQuickMessage("Please open a project before exporting attachments.", QUICK_MESSAGE_DURATION);
        return;
    }
    if (!selection || selection.length === 0) {
        Blockbench.showQuickMessage("Please select one or more attachments to export.", QUICK_MESSAGE_DURATION);
        return;
    }

    // Create a temporary data structure for the export
    const data: any = {
        textureWidth: Project.texture_width,
        textureHeight: Project.texture_height,
        textureSizes: {},
        textures: {},
        elements: [],
        animations: []
    };

    // Track groups that had stepParentName temporarily set for cleanup
    const modifiedGroups: Group[] = [];

    // First pass: find the actual root groups for all elements
    // This handles cases where clothingSlot is on cubes but not parent groups
    const rootGroupsSet = new Set<Group>();
    const processedElements = new Set<Group | Cube>();

    for (const element of selection) {
        const myClothingSlot = element.clothingSlot;
        if (!myClothingSlot || myClothingSlot.trim() === '') {
            continue; // Not an attachment
        }

        // Find the topmost group that should be the root
        const topmostRoot = findTopmostAttachmentRoot(element, myClothingSlot);

        if (topmostRoot && topmostRoot instanceof Group) {
            // Use the topmost group as the root
            if (!rootGroupsSet.has(topmostRoot)) {
                rootGroupsSet.add(topmostRoot);
                logDebug(`[VS Attachment Export] Found topmost root "${topmostRoot.name}" for element "${element.name}"`);
            }
            processedElements.add(element);
        } else if (element instanceof Group) {
            // Element is itself a group with no parent to promote to
            rootGroupsSet.add(element);
            processedElements.add(element);
        }
        // Note: Cubes without a parent group are handled below
    }

    // Second pass: handle cubes that have no parent group
    // These will be exported as individual elements
    const orphanCubes: Cube[] = [];
    for (const element of selection) {
        if (processedElements.has(element)) continue;

        const myClothingSlot = element.clothingSlot;
        if (!myClothingSlot || myClothingSlot.trim() === '') continue;

        if (element instanceof Cube) {
            orphanCubes.push(element);
            logDebug(`[VS Attachment Export] Orphan cube found: "${element.name}"`);
        }
    }

    // Convert to array and filter out groups with no clothingSlot
    // Only export groups that have a clothingSlot (don't export base model groups like "Root")
    const rootAttachments = Array.from(rootGroupsSet).filter(group => {
        const groupSlot = group.clothingSlot;
        const hasSlot = groupSlot && groupSlot.trim() !== '';
        if (!hasSlot) {
            logDebug(`[VS Attachment Export] Filtering out group "${group.name}" - no clothingSlot`);
        }
        return hasSlot;
    });

    logDebug(`[VS Attachment Export] Filtered ${selection.length} elements to ${rootAttachments.length} root groups and ${orphanCubes.length} orphan cubes`);

    let warnedMissingSocketTransform = false;
    try {
        // Process each root attachment group with its own relative offset
        rootAttachments.forEach(group => {
            const originalStepParent = group.stepParentName;
            let stepParentName = getStepParentName(group);

            // If no stepParentName was determined, find the first parent with a different clothingSlot
            // This parent should be the base model group that the attachment attaches to
            if (!stepParentName || stepParentName.trim() === '') {
                const groupClothingSlot = group.clothingSlot;
                let currentParent = group.parent;

                // Walk up the parent chain to find the first parent with a different (or no) clothingSlot
                // This should be the base model group that the attachment attaches to
                while (!stepParentName && currentParent && currentParent instanceof Group) {
                    const parentClothingSlot = currentParent.clothingSlot;
                    const parentHasDifferentSlot = !parentClothingSlot || parentClothingSlot.trim() === '' || parentClothingSlot !== groupClothingSlot;

                    if (parentHasDifferentSlot) {
                        // Found a parent with a different slot (or no slot) - this is the step parent
                        stepParentName = currentParent.name;
                        logDebug(`[VS Attachment Export] Found step parent for "${group.name}": "${stepParentName}" (parent slot: "${parentClothingSlot || '(none)'}", attachment slot: "${groupClothingSlot}")`);
                        break;
                    }
                    currentParent = currentParent.parent;
                }

                // If we still don't have a step parent, try using the immediate parent as a last resort
                if (!stepParentName && group.parent && group.parent instanceof Group) {
                    stepParentName = group.parent.name;
                    logDebug(`[VS Attachment Export] Using immediate parent as fallback step parent for "${group.name}": "${stepParentName}"`);
                }
            }

            if (stepParentName && stepParentName.trim() !== '') {
                // Only modify if we're setting a new value
                if (!originalStepParent || originalStepParent.trim() === '') {
                    group.stepParentName = stepParentName;
                    modifiedGroups.push(group);
                    logDebug(`[VS Attachment Export] Set stepParentName="${stepParentName}" on "${group.name}"`);
                }
            } else {
                if (DEBUG) console.warn(`Could not determine a step-parent for attachment: ${group.name}`);
            }

            let offset: [number, number, number] = [0, 0, 0];
            let rootTransform: AttachmentElementFrame | undefined;

            if (!group.vs_step_parent_local && stepParentName) {
                const socketFrame = resolveStepParentFrame(group, stepParentName);
                if (socketFrame) {
                    rootTransform = rebaseAttachmentRoot({
                        from: getGroupFrom(group),
                        to: getGroupTo(group),
                        rotationOrigin: [...group.origin] as Vector3Tuple,
                        rotation: getElementBindRotation(group),
                    }, socketFrame);
                    logDebug(`[VS Attachment Export] Rebased "${group.name}" against "${stepParentName}": position [${rootTransform.rotationOrigin.join(', ')}], rotation [${rootTransform.rotation.join(', ')}]`);
                } else {
                    // Backward-compatible translation fallback for old standalone
                    // source files. Rotation cannot be inferred without the actual
                    // socket frame, so retain the authored rotation and warn.
                    offset = util.vector_sub(offset, group.origin);
                    console.warn(`[VS Attachment Export] No distinct socket or stored socket transform found for "${group.name}" -> "${stepParentName}". Preserving legacy rotation.`);
                    if (!warnedMissingSocketTransform) {
                        warnedMissingSocketTransform = true;
                        Blockbench.showQuickMessage('Some legacy attachments have no stored socket transform; rotation was preserved as authored.', 5000);
                    }
                }
            }

            // Use filtered attachment traversal logic to process the attachment
            // We create a temporary array to hold the elements for this single attachment
            const attachmentElements: VS_Element[] = [];
            const groupClothingSlot = group.clothingSlot || '';
            traverseAttachment(null, [group], attachmentElements, offset, groupClothingSlot, stepParentName, rootTransform);

            // Add the processed elements to the main elements array
            data.elements.push(...attachmentElements);
        });

        // Process orphan cubes (cubes with clothingSlot but no parent group)
        // This is a fallback for edge cases where cubes are at the root level
        if (orphanCubes.length > 0) {
            logDebug(`[VS Attachment Export] Processing ${orphanCubes.length} orphan cubes`);

            // Group orphan cubes by clothingSlot to determine stepParentName for each group
            const cubesBySlot = new Map<string, Cube[]>();
            orphanCubes.forEach(cube => {
                const slot = cube.clothingSlot || '';
                if (!cubesBySlot.has(slot)) {
                    cubesBySlot.set(slot, []);
                }
                cubesBySlot.get(slot)!.push(cube);
            });

            // Process each orphan cube individually to determine its correct stepParentName
            // Each cube should use its immediate base model parent, not a shared parent
            const orphanElements: VS_Element[] = [];
            orphanCubes.forEach(cube => {
                // Determine stepParentName for this specific cube
                let stepParentName: string | null = cube.stepParentName?.trim() || null;
                const cubeSlot = cube.clothingSlot || '';
                let currentParent = cube.parent;

                // Walk up the parent chain to find the first parent with a different (or no) clothingSlot
                // This should be the immediate base model parent for this cube.
                // An authored stepParentName always wins.
                while (!stepParentName && currentParent && currentParent instanceof Group) {
                    const parentClothingSlot = currentParent.clothingSlot;
                    const parentHasDifferentSlot = !parentClothingSlot || parentClothingSlot.trim() === '' || parentClothingSlot !== cubeSlot;

                    if (parentHasDifferentSlot) {
                        // Found a parent with a different slot (or no slot) - this is the step parent
                        stepParentName = currentParent.name;
                        logDebug(`[VS Attachment Export] Found step parent for orphan cube "${cube.name}": "${stepParentName}" (parent slot: "${parentClothingSlot || '(none)'}", cube slot: "${cubeSlot}")`);
                        break;
                    }
                    currentParent = currentParent.parent;
                }

                // If we still don't have a step parent, try using the immediate parent as a last resort
                if (!stepParentName && cube.parent && cube.parent instanceof Group) {
                    stepParentName = cube.parent.name;
                    logDebug(`[VS Attachment Export] Using immediate parent as fallback step parent for orphan cube "${cube.name}": "${stepParentName}"`);
                }

                // Temporarily set stepParentName on the cube
                const originalStepParent = cube.stepParentName;
                if (stepParentName && (!originalStepParent || originalStepParent.trim() === '')) {
                    cube.stepParentName = stepParentName;
                }
                const cubeElements: VS_Element[] = [];
                process_cube(null, cube, cubeElements, [0, 0, 0]);

                const exportedCube = cubeElements[0];
                if (exportedCube && cube.vs_step_parent_local !== true && stepParentName) {
                    const socketFrame = resolveStepParentFrame(cube, stepParentName);
                    if (socketFrame) {
                        const rootTransform = rebaseAttachmentRoot({
                            from: [...cube.from] as Vector3Tuple,
                            to: [...cube.to] as Vector3Tuple,
                            rotationOrigin: [...cube.origin] as Vector3Tuple,
                            rotation: getElementBindRotation(cube),
                        }, socketFrame);
                        exportedCube.from = rootTransform.from;
                        exportedCube.to = rootTransform.to;
                        exportedCube.rotationOrigin = rootTransform.rotationOrigin;
                        delete exportedCube.rotationX;
                        delete exportedCube.rotationY;
                        delete exportedCube.rotationZ;
                        if (rootTransform.rotation[0] !== 0) exportedCube.rotationX = rootTransform.rotation[0];
                        if (rootTransform.rotation[1] !== 0) exportedCube.rotationY = rootTransform.rotation[1];
                        if (rootTransform.rotation[2] !== 0) exportedCube.rotationZ = rootTransform.rotation[2];
                    } else {
                        console.warn(`[VS Attachment Export] No distinct socket or stored socket transform found for cube "${cube.name}" -> "${stepParentName}"; preserving its model-space transform.`);
                    }
                }
                orphanElements.push(...cubeElements);
                // Restore original stepParentName
                if (stepParentName) {
                    cube.stepParentName = originalStepParent;
                }
            });
            data.elements.push(...orphanElements);
        }
    } finally {
        // Clean up the temporarily added property to avoid side effects
        modifiedGroups.forEach(group => {
            delete group.stepParentName;
        });
    }

    // Prompt for save location first to check if file exists
    Blockbench.export({
        type: 'Vintage Story Attachment',
        extensions: ['json'],
        name: `${selection[0].name}_attachment.json`,
        startpath: Project.save_path,
        custom_writer: (content: any, path: string) => {
            logDebug(`[VS Attachment Export] Writing to path: ${path}`);

            // Collect texture names that are actually used by the exported elements
            const usedTextureNames = getUsedTextureNames(data.elements);
            logDebug(`[VS Attachment Export] Used textures: ${Array.from(usedTextureNames).join(', ')}`);

            // Check if the file already exists
            if (fs.existsSync(path)) {
                logDebug('[VS Attachment Export] File exists, will overwrite');
                try {
                    // Read the existing file
                    const existingContent = fs.readFileSync(path, 'utf8');
                    const existingData = JSON.parse(existingContent);

                    // Use textureSizes and textures from the existing file, but only for used textures
                    if (existingData.textureSizes) {
                        for (const [name, size] of Object.entries(existingData.textureSizes)) {
                            if (usedTextureNames.has(name)) {
                                data.textureSizes[name] = size;
                            }
                        }
                        logDebug('[VS Attachment Export] Preserved textureSizes from existing file (filtered to used textures)');
                    }
                    if (existingData.textures) {
                        for (const [name, location] of Object.entries(existingData.textures)) {
                            if (usedTextureNames.has(name)) {
                                data.textures[name] = location;
                            }
                        }
                        logDebug('[VS Attachment Export] Preserved textures from existing file (filtered to used textures)');
                    }
                } catch (e) {
                    console.error('[VS Attachment Export] Error reading existing file:', e);
                    // Warn user about malformed JSON
                    Blockbench.showQuickMessage('Warning: Existing file has invalid JSON. Using project textures instead.', 3000);
                    // Fall back to current project textures (filtered to used textures)
                    populateTexturesFromProject(data, usedTextureNames);
                }
            } else {
                // File doesn't exist, use textures from current project (filtered to used textures)
                logDebug('[VS Attachment Export] File does not exist, using project textures');
                populateTexturesFromProject(data, usedTextureNames);
            }

            // Final cleanup pass: remove any textureSizes/textures entries not actually used
            // This prevents crashes in VS when unused texture references are present
            cleanupUnusedTextures(data, usedTextureNames);

            // Write the final content (this will overwrite if file exists)
            const finalContent = autoStringify(data);
            try {
                fs.writeFileSync(path, finalContent, 'utf8');
                logDebug(`[VS Attachment Export] Successfully wrote file: ${path}`);
                Blockbench.showQuickMessage(`Exported attachment to ${path.split(/[/\\]/).pop()}`, 2000);
            } catch (e) {
                console.error('[VS Attachment Export] Error writing file:', e);
                Blockbench.showQuickMessage(`Failed to write file: ${e instanceof Error ? e.message : String(e)}`, 5000);
            }
        }
    });
}
