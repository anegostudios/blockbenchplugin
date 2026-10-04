import { import_model } from '../import_model';
import { VS_Shape } from '../vs_shape_def';
import { handleVSTextures } from './texture_handler';


const DEBUG = false;

/**
 * Minimal shapes for the parts of a .bbmodel this importer reads. Blockbench writes far more than
 * this; everything here is deliberately loose because the file is user data that may come from an
 * older Blockbench version, so each field is validated at the point of use rather than trusted.
 */

/** A face's texture is written either as an index into `textures` or as a texture uuid. */
type TextureRef = string | number;

interface BBTextureData {
    name?: string;
    path?: string;
    uuid?: string;
    [key: string]: unknown;
}

interface BBCubeElement {
    uuid: string;
    type: 'cube';
    [key: string]: unknown;
}

/** Outliner entries are either a bare element uuid (Blockbench 4.x) or an inline group object. */
type BBOutlinerItem = string | Record<string, any>;

interface BBModel {
    elements?: unknown;
    groups?: unknown;
    outliner?: unknown;
    textures?: unknown;
    [key: string]: unknown;
}

function logDebug(message: string, ...args: unknown[]) {
    if (DEBUG) console.log(message, ...args);
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
}

function asArray<T = unknown>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function getErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}

function buildUuidMap<T extends { uuid?: unknown }>(items: unknown): Map<UUID, T> {
    const map = new Map<UUID, T>();
    for (const item of asArray<T>(items)) {
        const uuid = item.uuid;
        if (typeof uuid === 'string') map.set(uuid, item);
    }
    return map;
}

function buildTextureMap(model: BBModel): Map<TextureRef, Texture> {
    const map = new Map<TextureRef, Texture>();

    for (const [oldIndex, texData] of asArray<BBTextureData>(model.textures).entries()) {
        const texName = typeof texData.name === 'string' ? texData.name : undefined;
        const texPath = typeof texData.path === 'string' ? texData.path : undefined;

        const existing = Texture.all.find(
            t => (texName && t.name === texName) || (texPath && t.path && t.path === texPath)
        );

        let texture = existing;
        if (!texture) {
            texture = new Texture(texData).add();

            // Preserve textureLocation if it exists in the imported data
            if (typeof texData.textureLocation === 'string') {
                texture.textureLocation = texData.textureLocation;
                logDebug(`[Import BB] Set textureLocation: ${texData.textureLocation}`);
            }

            // Load texture from embedded base64 or from disk path (when available)
            if (typeof texData.source === 'string' && texData.source.length > 0) {
                texture.fromDataURL(texData.source);
                logDebug(`[Import BB] Loaded texture from base64: ${texName ?? '(unnamed)'}`);
            } else if (typeof texPath === 'string' && texPath.length > 0 && !texPath.startsWith('data:')) {
                texture.load();
                logDebug(`[Import BB] Loaded texture from path: ${texName ?? texPath}`);
            }

            logDebug(`[Import BB] Added texture: ${texName ?? '(unnamed)'}`);
        } else {
            // Update UV size for existing texture to match the imported data
            if (typeof texData.uv_width === 'number') texture.uv_width = texData.uv_width;
            if (typeof texData.uv_height === 'number') texture.uv_height = texData.uv_height;

            // Update textureLocation if it exists in the imported data and isn't already set
            if (typeof texData.textureLocation === 'string' && !texture.textureLocation) {
                texture.textureLocation = texData.textureLocation;
                logDebug(`[Import BB] Updated textureLocation: ${texData.textureLocation}`);
            }

            logDebug(
                `[Import BB] Using existing texture: ${texture.name}, updated UV size to ${texture.uv_width}x${texture.uv_height}`
            );
        }

        map.set(oldIndex, texture);
        if (typeof texData.uuid === 'string') map.set(texData.uuid, texture);
    }

    return map;
}

function remapCubeFaceTextures(cubeProps: Record<string, any>, textureMap: Map<TextureRef, Texture>) {
    const faces = cubeProps?.faces;
    if (!faces || !isRecord(faces)) return;

    for (const faceKey of Object.keys(faces)) {
        const face = faces[faceKey];
        if (!face || !isRecord(face)) continue;

        const textureRef = face.texture as TextureRef | undefined;
        if (textureRef === undefined || textureRef === null) continue;

        const mapped = textureMap.get(textureRef);
        if (!mapped) continue;

        face.texture = mapped.uuid;
    }
}

function normalizePaletteSlot(value: unknown): number {
    const slot = Number(value);
    return Number.isFinite(slot) && slot !== 0 ? slot : 0;
}

function createCubeFromElementData(
    elemData: BBCubeElement,
    parentGroup: Group | null,
    textureMap: Map<TextureRef, Texture>,
    createdGroups: Set<Group>,
    inheritedPaletteSlot = 0,
) {
    const cubeProps: Record<string, any> = { ...elemData };
    delete cubeProps.uuid;

    // A source attachment can put paletteSlot on a structural group that is
    // merged into an existing base-model bone. Keep that inheritance on the
    // newly imported geometry instead of tinting the reused base bone.
    if (normalizePaletteSlot(cubeProps.paletteSlot) === 0 && inheritedPaletteSlot !== 0) {
        cubeProps.paletteSlot = inheritedPaletteSlot;
    }

    remapCubeFaceTextures(cubeProps, textureMap);

    // Handle legacy bbmodel files where clothingSlot is on cubes instead of groups.
    // If the cube has a clothingSlot, propagate it up the hierarchy to parent groups.
    // Stop when we reach a parent that already has a clothingSlot (this is a boundary - either
    // an existing attachment group or a base model group that has been marked).
    // Keep the cube value as well: the attachment exporter treats an explicit
    // different slot as a boundary, and the discovery panel de-duplicates
    // descendants that inherit the same slot.
    const cubeClothingSlot = cubeProps.clothingSlot;
    if (cubeClothingSlot && typeof cubeClothingSlot === 'string' && cubeClothingSlot.trim() !== '') {
        // Propagate clothingSlot up the hierarchy, but stop at boundaries
        let currentGroup: OutlinerNode['parent'] | null = parentGroup;
        while (currentGroup && currentGroup instanceof Group && createdGroups.has(currentGroup)) {
            const existingSlot = currentGroup.clothingSlot;
            // If this group already has a clothingSlot, stop propagation (we've hit a boundary)
            if (existingSlot && existingSlot.trim() !== '') {
                logDebug(`[Import BB] Stopped propagation at group "${currentGroup.name}" which already has clothingSlot "${existingSlot}"`);
                break;
            }
            // This group doesn't have a clothingSlot - propagate it up
            currentGroup.clothingSlot = cubeClothingSlot;
            logDebug(`[Import BB] Propagated clothingSlot "${cubeClothingSlot}" from cube to group "${currentGroup.name}"`);
            // Move up to the parent group
            currentGroup = currentGroup.parent;
        }
    }

    const cube = new Cube(cubeProps);
    cube.addTo(parentGroup).init();
    logDebug(`[Import BB] Created cube: ${cube.name ?? '(unnamed)'}`);
}

function findExistingGroupByName(parentGroup: Group | null, groupName: string): Group | null {
    if (!groupName) return null;
    const searchRoot = parentGroup ? parentGroup.children || [] : Outliner.root;

    for (const child of searchRoot) {
        if (child instanceof Group && (child.name || '').toLowerCase() === groupName.toLowerCase()) {
            return child;
        }
    }

    return null;
}

function getOrCreateGroup(
    groupSeed: Record<string, any>,
    parentGroup: Group | null,
    createdGroups: Set<Group>,
    inheritedPaletteSlot = 0,
): { group: Group; childPaletteSlot: number } {
    const groupName = typeof groupSeed.name === 'string' ? groupSeed.name : '';
    const hasExternalStepParent = typeof groupSeed.stepParentName === 'string' && groupSeed.stepParentName.trim() !== '';
    const ownPaletteSlot = normalizePaletteSlot(groupSeed.paletteSlot);
    const childPaletteSlot = ownPaletteSlot || inheritedPaletteSlot;

    // An explicit step-parent group is an attachment wrapper, not a duplicate
    // of the base socket with the same name.
    const existing = hasExternalStepParent ? null : findExistingGroupByName(parentGroup, groupName);
    if (existing) {
        logDebug(`[Import BB] Merging into existing group: ${groupName}`);
        return { group: existing, childPaletteSlot };
    }

    const groupProps: Record<string, any> = { ...groupSeed };
    delete groupProps.uuid;
    delete groupProps.children;
    if (ownPaletteSlot === 0 && inheritedPaletteSlot !== 0) {
        groupProps.paletteSlot = inheritedPaletteSlot;
    }

    const group = new Group(groupProps);
    group.addTo(parentGroup).init();
    createdGroups.add(group);
    logDebug(`[Import BB] Created new group: ${groupName || '(unnamed group)'}`);

    return { group, childPaletteSlot };
}

function isCubeElement(value: unknown): value is BBCubeElement {
    return (
        isRecord(value) &&
        typeof value.uuid === 'string' &&
        value.type === 'cube'
    );
}

/**
 * Merges a Vintage Story attachment into the current project, intelligently handling textures.
 * @param content The VS_Shape data to merge.
 * @param filePath The path to the file being imported, used for clothing slot inference.
 */
export function mergeVSAttachment(content: VS_Shape, filePath?: string) {
    const elementsBefore = new Set<Group | Cube>([...Group.all, ...Cube.all]);
    handleVSTextures(content);
    // Attachment roots are already expressed in their step parent's local space.
    // Applying the normal block-model [-8, 0, -8] offset corrupts that transform.
    import_model(content, false, filePath, { rootOffset: [0, 0, 0] });

    for (const element of [...Group.all, ...Cube.all]) {
        if (elementsBefore.has(element)) continue;
        const parentIsNew = element.parent instanceof Group && !elementsBefore.has(element.parent);
        if (!parentIsNew && element.stepParentName?.trim()) {
            element.vs_step_parent_local = true;
        }
    }
}

/**
 * Merges a Blockbench .bbmodel attachment into the current project.
 * Supports both Blockbench 4.x outliner (groups are inline, elements referenced by UUID strings)
 * and Blockbench 5.x+ outliner (outliner nodes reference separate `elements` / `groups` lists by UUID).
 */
export function mergeBBModel(content: unknown, _filePath: string) {
    try {
        if (!isRecord(content)) {
            Blockbench.showQuickMessage('Import failed: invalid .bbmodel content', 5000);
            return;
        }

        const model = content as BBModel;
        logDebug(`[Import BB] Starting merge of .bbmodel attachment`);

        const textureMap = buildTextureMap(model);
        const elementByUuid = buildUuidMap<Record<string, any>>(model.elements);
        const groupByUuid = buildUuidMap<Record<string, any>>(model.groups);
        const createdGroups = new Set<Group>();
        const processChildren = (children: BBOutlinerItem[], parent: Group | null, inheritedPaletteSlot = 0) => {
            for (const child of children) processOutlinerItem(child, parent, inheritedPaletteSlot);
        };

        const tryCreateCubeByUuid = (uuid: UUID, parent: Group | null, inheritedPaletteSlot = 0): boolean => {
            const elemData = elementByUuid.get(uuid);
            if (!isCubeElement(elemData)) return false;
            createCubeFromElementData(elemData, parent, textureMap, createdGroups, inheritedPaletteSlot);
            return true;
        };

        const tryProcessGroupByUuid = (
            uuid: UUID,
            node: Record<string, any>,
            parent: Group | null,
            inheritedPaletteSlot = 0,
        ): boolean => {
            const groupData = groupByUuid.get(uuid);
            if (!groupData) return false;

            // Merge groupMap data with outliner hints (e.g., children structure)
            const seed = { ...groupData, ...node };
            const { group: targetGroup, childPaletteSlot } = getOrCreateGroup(seed, parent, createdGroups, inheritedPaletteSlot);

            const children = asArray<BBOutlinerItem>(node.children);
            processChildren(children, targetGroup, childPaletteSlot);
            return true;
        };

        const processUuidStringItem = (uuid: UUID, parent: Group | null, inheritedPaletteSlot = 0) => {
            // Blockbench 4.x: element references are UUID strings
            if (tryCreateCubeByUuid(uuid, parent, inheritedPaletteSlot)) return;
        };

        const processInlineGroupNode = (node: Record<string, any>, parent: Group | null, inheritedPaletteSlot = 0) => {
            const { group: targetGroup, childPaletteSlot } = getOrCreateGroup(node, parent, createdGroups, inheritedPaletteSlot);
            const children = asArray<BBOutlinerItem>(node.children);
            processChildren(children, targetGroup, childPaletteSlot);
        };

        const processObjectNode = (node: Record<string, any>, parent: Group | null, inheritedPaletteSlot = 0) => {
            const uuid = typeof node.uuid === 'string' ? node.uuid : undefined;

            // Blockbench 5.x+: outliner node references separate `elements` / `groups` lists by UUID.
            if (uuid) {
                if (tryCreateCubeByUuid(uuid, parent, inheritedPaletteSlot)) return;
                if (tryProcessGroupByUuid(uuid, node, parent, inheritedPaletteSlot)) return;
            }

            // Blockbench 4.x: the node itself is an inline group object
            processInlineGroupNode(node, parent, inheritedPaletteSlot);
        };

        const processOutlinerItem = (item: BBOutlinerItem, parent: Group | null, inheritedPaletteSlot = 0) => {
            if (typeof item === 'string') return processUuidStringItem(item, parent, inheritedPaletteSlot);
            if (!isRecord(item)) return;
            return processObjectNode(item, parent, inheritedPaletteSlot);
        };

        for (const item of asArray<BBOutlinerItem>(model.outliner)) {
            processOutlinerItem(item, null);
        }

        Canvas.updateAll();
        logDebug(`[Import BB] Merge complete. Groups: ${Group.all.length}, Cubes: ${Cube.all.length}`);
    } catch (e) {
        console.error('[Import BB] CRITICAL ERROR in mergeBBModel:', e);
        Blockbench.showQuickMessage(`Import failed: ${getErrorMessage(e)}`, 5000);
    }
}
