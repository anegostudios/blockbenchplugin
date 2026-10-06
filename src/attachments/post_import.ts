import { inferClothingSlotFromPath } from './presets';
import { showClothingSlotDialog } from './dialogs';
import { findAllGroupsByName, findGroupByName, stripNumericSuffix, collectGroupsDepthFirst, isDescendantOf } from '../util/outliner';
import { QUICK_MESSAGE_DURATION } from './constants';
import { markAsRecentlyImported } from './panel';
import { composeEulerXYZ, relativeEulerXYZ } from './attachment_transform';
import type { Vector3Tuple } from './attachment_transform';

const DEBUG = false;

/**
 * Finds a matching group in the existing model based on clothing slot and optional name.
 */
function findBestMatchingGroupBySlot(clothingSlot: string, groupName: string | null, existingElements: Set<any>): Group | null {
    if (!clothingSlot || !clothingSlot.trim()) return null;

    const normalizedSlot = clothingSlot.trim().toLowerCase();
    const normalizedName = groupName ? groupName.trim().toLowerCase() : '';

    let bestMatch: Group | null = null;
    let exactNameMatch: Group | null = null;

    function search(elements: any[]) {
        for (const element of elements) {
            if (element instanceof Group && existingElements.has(element)) {
                const elemSlot = (element.clothingSlot || '').trim().toLowerCase();

                if (elemSlot === normalizedSlot) {
                    if (normalizedName && (element.name || '').trim().toLowerCase() === normalizedName) {
                        exactNameMatch = element;
                        return;
                    }
                    if (!bestMatch) bestMatch = element;
                }
            }
            if (element.children && element.children.length > 0) {
                search(element.children);
                if (exactNameMatch) return;
            }
        }
    }

    search(Outliner.root);
    return exactNameMatch || bestMatch;
}

/**
 * Applies the selected clothing slot to all new elements.
 */
function applyClothingSlot(newElements: any[], slot: string, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] Applying slot "${slot}" to ${newElements.length} elements.`);

    const apply = (element: any) => {
        if (element instanceof Group || element instanceof Cube) {
            element.clothingSlot = slot;
        }
        if (element.children) {
            element.children.forEach(apply);
        }
    };

    // Filter for top-level new elements to avoid double processing
    const newElementsSet = new Set(newElements);
    const topLevel = newElements.filter(e => !e.parent || !newElementsSet.has(e.parent));

    topLevel.forEach(element => {
        apply(element);
        markAsRecentlyImported(element);
        element.children?.forEach((child: any) => markAsRecentlyImported(child));
    });
}

/**
 * Returns true when an imported node belongs to a wrapper that is intentionally
 * kept external and attached through VS step-parenting. Collapsing one of these
 * wrappers loses its local translation/rotation.
 */
function isWithinStepParentAttachment(element: any, newElementsSet: Set<any>): boolean {
    let current = element;
    while (current && newElementsSet.has(current)) {
        if (current.stepParentName?.trim()) return true;
        current = current.parent instanceof Group ? current.parent : null;
    }
    return false;
}

function mergePaletteSlot(source: any, target: any, logPrefix: string) {
    const sourceSlot = Number(source?.paletteSlot) || 0;
    const targetSlot = Number(target?.paletteSlot) || 0;
    if (sourceSlot === 0) return;
    if (targetSlot === 0) {
        target.paletteSlot = sourceSlot;
    } else if (targetSlot !== sourceSlot) {
        console.warn(`[${logPrefix}] Keeping paletteSlot ${targetSlot} on "${target.name}"; imported "${source.name}" requested ${sourceSlot}.`);
    }
}

function preserveInheritedPaletteOnChildren(source: any, children: any[]) {
    const sourceSlot = Number(source?.paletteSlot) || 0;
    if (sourceSlot === 0) return;
    children.forEach(child => {
        if ((child instanceof Group || child instanceof Cube) && (Number(child.paletteSlot) || 0) === 0) {
            child.paletteSlot = sourceSlot;
        }
    });
}

function materializePaletteInheritance(newElements: any[], newElementsSet: Set<any>) {
    const roots = newElements.filter(element =>
        (element instanceof Group || element instanceof Cube)
        && (!element.parent || !newElementsSet.has(element.parent))
    );

    const walk = (element: any, inheritedSlot: number) => {
        if (!(element instanceof Group || element instanceof Cube) || !newElementsSet.has(element)) return;
        const ownSlot = Number(element.paletteSlot) || 0;
        const effectiveSlot = ownSlot || inheritedSlot;
        if (ownSlot === 0 && inheritedSlot !== 0) {
            element.paletteSlot = inheritedSlot;
        }
        // Only groups have children; cubes are leaves.
        if (element instanceof Group) {
            element.children.forEach(child => walk(child, effectiveSlot));
        }
    };

    roots.forEach(root => walk(root, 0));
}

/**
 * Matches new groups to existing ones based on clothing slot.
 */
function smartMatchGroups(newElements: any[], newElementsSet: Set<any>, existingElements: Set<any>, logPrefix: string): number {
    const topLevelGroups = newElements.filter(e =>
        e instanceof Group
        && (!e.parent || !newElementsSet.has(e.parent))
        && !isWithinStepParentAttachment(e, newElementsSet)
    ) as Group[];
    let matchCount = 0;

    if (DEBUG) console.log(`[${logPrefix}] Smart match: checking ${topLevelGroups.length} groups.`);

    for (const newGroup of topLevelGroups) {
        const slot = newGroup.clothingSlot?.trim();
        if (!slot) continue;

        const match = findBestMatchingGroupBySlot(slot, newGroup.name, existingElements);
        if (match) {
            if (DEBUG) console.log(`[${logPrefix}] Matched "${newGroup.name}" -> "${match.name}" (slot: ${slot})`);

            mergePaletteSlot(newGroup, match, logPrefix);
            [...newGroup.children].forEach(child => child.addTo(match));
            matchCount++;

            if (newGroup.children.length === 0) newGroup.remove();
        }
    }
    return matchCount;
}

/**
 * Merges new groups into existing groups with the same name (hierarchical merge).
 */
function mergeHierarchicalGroups(newElements: any[], newElementsSet: Set<any>, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] merging hierarchies.`);

    const allNewGroups = collectGroupsDepthFirst(newElements.filter(e => e instanceof Group && newElementsSet.has(e)));

    // Process deepest first
    for (let i = allNewGroups.length - 1; i >= 0; i--) {
        const newGroup = allNewGroups[i];
        if (!newElementsSet.has(newGroup)) continue;
        if (isWithinStepParentAttachment(newGroup, newElementsSet)) continue;

        const matches = findAllGroupsByName(newGroup.name, Outliner.root).filter(g => !newElementsSet.has(g));

        if (matches.length > 0) {
            const target = matches[0]; // Take first match
            if (DEBUG) console.log(`[${logPrefix}] Merging "${newGroup.name}" into "${target.name}"`);

            const movedChildren = [...newGroup.children];
            // This is a structural hierarchy match, so the existing target is
            // a base socket rather than the attachment root. Keep attachment
            // discovery and palette inheritance on the moved subtree instead
            // of marking/tinting the base socket itself.
            preserveInheritedPaletteOnChildren(newGroup, movedChildren);
            movedChildren.forEach(child => child.addTo(target));

            if (newGroup.children.length === 0) {
                newGroup.remove();
                newElementsSet.delete(newGroup);
            }
        }
    }
}

/**
 * Merges groups that share the same clothing slot and have similar names.
 */
function mergeGroupsByCommonSlot(newElements: any[], newElementsSet: Set<any>, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] merging by common slot.`);

    const bySlot = new Map<string, Group[]>();
    newElements.forEach(e => {
        if (e instanceof Group && newElementsSet.has(e) && e.clothingSlot && !isWithinStepParentAttachment(e, newElementsSet)) {
            const slot = e.clothingSlot.trim();
            if (!bySlot.has(slot)) bySlot.set(slot, []);
            bySlot.get(slot)!.push(e);
        }
    });

    bySlot.forEach((groups, slot) => {
        if (groups.length < 2) return;

        // Sort by name length to find the "base" group (shortest name)
        groups.sort((a, b) => (a.name || '').length - (b.name || '').length);
        const base = groups[0];
        const baseName = (base.name || '').toLowerCase();

        if (!baseName) return;

        // Find groups extending the base name (e.g. "Hair" vs "HairOuter")
        const targets = groups.slice(1).filter(g => (g.name || '').toLowerCase().startsWith(baseName));
        if (targets.length === 0) return;

        // Check if base exists in old model, otherwise use the new one as base
        const existMatches = findAllGroupsByName(base.name, Outliner.root).filter(g => !newElementsSet.has(g));
        const finalTarget = existMatches[0] || base;

        if (finalTarget === base || !newElementsSet.has(finalTarget)) {
            targets.forEach(g => {
                if (!newElementsSet.has(g)) return;

                if (DEBUG) console.log(`[${logPrefix}] Merging "${g.name}" into "${finalTarget.name}" (slot: ${slot})`);
                mergePaletteSlot(g, finalTarget, logPrefix);
                [...g.children].forEach(c => c.addTo(finalTarget));

                if (g.children.length === 0) {
                    g.remove();
                    newElementsSet.delete(g);
                }
            });
        }
    });
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

function isFiniteVector3(value: unknown): value is Vector3Tuple {
    return Array.isArray(value)
        && value.length === 3
        && value.every(component => typeof component === 'number' && Number.isFinite(component));
}

function getSocketFrom(group: Group): Vector3Tuple {
    if (isFiniteVector3(group.vs_group_from)) return [...group.vs_group_from];
    const geoChild = group.children.find(child =>
        child instanceof Cube && child.name === `${group.name}_geo`
    ) as Cube | undefined;
    return [...(geoChild?.from || group.origin)] as Vector3Tuple;
}

function translateVector(vector: number[] | undefined, delta: Vector3Tuple) {
    if (!Array.isArray(vector) || vector.length < 3) return;
    vector[0] += delta[0];
    vector[1] += delta[1];
    vector[2] += delta[2];
}

function translateAttachmentSubtree(element: any, delta: Vector3Tuple) {
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return;

    if (element instanceof Group) {
        translateVector(element.origin, delta);
        translateVector(element.vs_group_from, delta);
        translateVector(element.vs_group_to, delta);
    } else if (element instanceof Cube) {
        translateVector(element.from, delta);
        translateVector(element.to, delta);
        translateVector(element.origin, delta);
    } else {
        // Locators and other positioned child nodes use `from` in Blockbench.
        translateVector(element?.from, delta);
    }

    element.children?.forEach((child: any) => translateAttachmentSubtree(child, delta));
}

/**
 * Keeps VS-imported local wrappers external, while placing absolute-space BB
 * wrappers beneath their real socket and converting their world rotation to a
 * socket-local rotation.
 */
function placeStepParentWrappers(newElements: any[], newElementsSet: Set<any>, logPrefix: string) {
    if (DEBUG) console.log(`[${logPrefix}] placing step-parent wrappers.`);

    newElements.forEach(element => {
        const stepParent = element.stepParentName?.trim();
        if (!stepParent) return;
        if (!(element instanceof Group || element instanceof Cube)) return;

        if (element.vs_step_parent_local === true) {
            if (DEBUG) console.log(`[${logPrefix}] Kept local wrapper "${element.name}" external to "${stepParent}".`);
            return;
        }

        const target = findAllGroupsByName(stepParent, Outliner.root).find(group =>
            !newElementsSet.has(group)
            && group !== element
            && !isDescendantOf(group, element)
        );

        if (!target) {
            console.warn(`[${logPrefix}] Could not find external step parent "${stepParent}" for "${element.name}"; keeping its model-space transform.`);
            return;
        }

        const worldRotation = getElementBindRotation(element);
        const liveSocketFrom = getSocketFrom(target);
        const liveSocketRotation = getElementBindRotation(target);
        // Read into locals so the isFiniteVector3 guards narrow away the undefined, which they
        // cannot do through a property access.
        const storedFrom = element.vs_step_parent_origin;
        const storedRotation = element.vs_step_parent_rotation;
        const hasStoredFrame = element.vs_has_step_parent_transform === true
            && isFiniteVector3(storedFrom)
            && isFiniteVector3(storedRotation);
        const authoredSocketFrom = hasStoredFrame
            ? [...storedFrom] as Vector3Tuple
            : liveSocketFrom;
        const authoredSocketRotation = hasStoredFrame
            ? [...storedRotation] as Vector3Tuple
            : liveSocketRotation;
        const localRotation = relativeEulerXYZ(worldRotation, authoredSocketRotation);
        const socketDelta: Vector3Tuple = [
            liveSocketFrom[0] - authoredSocketFrom[0],
            liveSocketFrom[1] - authoredSocketFrom[1],
            liveSocketFrom[2] - authoredSocketFrom[2],
        ];
        translateAttachmentSubtree(element, socketDelta);
        element.rotation[0] = localRotation[0];
        element.rotation[1] = localRotation[1];
        element.rotation[2] = localRotation[2];

        element.vs_has_step_parent_transform = true;
        element.vs_step_parent_origin = [...liveSocketFrom];
        element.vs_step_parent_rotation = [...liveSocketRotation];

        if (element.parent !== target) {
            element.addTo(target);
        }
        if (DEBUG) console.log(`[${logPrefix}] Placed "${element.name}" under "${target.name}" with local rotation [${localRotation.join(', ')}].`);
    });
}

/**
 * Merges any duplicate groups in the model.
 */
function mergeDuplicateGroups(newElementsSet: Set<any>) {
    const toDelete: Group[] = [];
    collectGroupsDepthFirst(Outliner.root).forEach(group => {
        if (isWithinStepParentAttachment(group, newElementsSet)) return;
        const name = group.name || '';
        const base = stripNumericSuffix(name);

        if (base !== name && base) {
            const original = findGroupByName(base, Outliner.root);
            if (original && original !== group) {
                // Move children if safe
                [...group.children].forEach(child => {
                    if (child !== original && child.parent !== original && !isDescendantOf(original, child)) {
                        child.addTo(original);
                    }
                });
                toDelete.push(group);
            }
        }
    });
    toDelete.forEach(g => g.remove());
}

/**
 * Main entry point: Organizes imported attachments.
 */
export async function processImportedAttachments(elementsBefore: Set<any>, filePath: string, logPrefix: string, model?: any) {
    const elementsAfter = new Set([...Group.all, ...Cube.all]);
    const newElements = [...elementsAfter].filter(e => !elementsBefore.has(e));
    const newElementsSet = new Set(newElements);

    // 1. User selects clothing slot
    const inferred = inferClothingSlotFromPath(filePath);
    const result = await showClothingSlotDialog(inferred, filePath, model);
    const masterSlot = result.slot;

    if (!masterSlot) {
        if (DEBUG) console.log(`[${logPrefix}] Import cancelled.`);
        newElements.forEach(e => e.remove());
        Blockbench.showQuickMessage('Import cancelled', QUICK_MESSAGE_DURATION);
        return;
    }

    // 2. Apply slot to new elements
    applyClothingSlot(newElements, masterSlot, logPrefix);
    // Structural wrapper groups can be merged away below. Materialize palette
    // inheritance first so an ancestor-only paletteSlot follows the imported
    // attachment geometry rather than disappearing with the wrapper.
    materializePaletteInheritance(newElements, newElementsSet);

    // 3. Smart Match: New groups -> Old groups with same slot
    const matchCount = smartMatchGroups(newElements, newElementsSet, elementsBefore, logPrefix);
    if (matchCount > 0) {
        Blockbench.showQuickMessage(`Matched ${matchCount} groups`, QUICK_MESSAGE_DURATION);
    }

    // 4. Hierarchical Match: New groups -> Old groups with same name/path
    mergeHierarchicalGroups(newElements, newElementsSet, logPrefix);

    // 5. Common Slot Match: "HairOuter" -> "Hair" if same slot
    mergeGroupsByCommonSlot(newElements, newElementsSet, logPrefix);

    // 6. Step Parent Placement
    placeStepParentWrappers(newElements, newElementsSet, logPrefix);

    // 7. Cleanup Duplicates
    mergeDuplicateGroups(newElementsSet);

    Undo.finishEdit(`Import attachment: ${filePath.split(/[/\\]/).pop()}`);
    Canvas.updateAll();
    if (typeof updateSelection === 'function') updateSelection();
}
