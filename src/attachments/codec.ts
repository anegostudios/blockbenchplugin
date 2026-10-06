import { composeEulerXYZ } from './attachment_transform';
import type { StepParentFrame, Vector3Tuple } from './attachment_transform';

export function createExportCodec(selection: any[] = []) {
    function getElementBindRotation(element: Group | Cube): Vector3Tuple {
        const chain: Vector3Tuple[] = [];
        let current: any = element;
        while (current instanceof Group || current instanceof Cube) {
            chain.unshift([...(current.rotation || [0, 0, 0])] as Vector3Tuple);
            current = current.parent;
        }
        return composeEulerXYZ(chain);
    }

    function getSocketFrom(group: Group): Vector3Tuple {
        const storedFrom = (group as any).vs_group_from;
        if (Array.isArray(storedFrom) && storedFrom.length === 3) {
            return [...storedFrom] as Vector3Tuple;
        }
        const geoChild = group.children.find(child =>
            child instanceof Cube && child.name === `${group.name}_geo`
        ) as Cube | undefined;
        return [...(geoChild?.from || group.origin)] as Vector3Tuple;
    }

    /**
     * Compiles groups for the outliner while preserving attachment metadata.
     * Also sets stepParentName on root groups so they can be correctly placed in hierarchy on import.
     * @param rootGroups The root groups being exported (these should keep clothingSlot)
     * @param undo Whether this is for undo purposes
     * @param rootGroupUuids Set of UUIDs for root groups that should keep clothingSlot
     * @param parentNameMap Map of root group UUIDs to their original parent group names
     */
    function compileGroupsFrom(
        rootGroups: any[],
        undo: boolean,
        rootGroupUuids: Set<string>,
        parentNameMap: Map<string, string>,
        stepParentTransformMap: Map<string, StepParentFrame>,
        rootBindRotationMap: Map<string, Vector3Tuple>
    ): any[] {
        const result: any[] = [];
        function iterate(array: any[], save_array: any[], isRoot: boolean = false) {
            for (const element of array) {
                if (element.type === 'group') {
                    const obj = element.compile(undo);
                    // Set stepParentName on root groups so they can be placed correctly on import
                    // This tells the importer where this group should go in the target model's hierarchy
                    if (isRoot && rootGroupUuids.has(element.uuid)) {
                        const parentName = parentNameMap.get(element.uuid);
                        if (!obj.stepParentName && parentName) {
                            obj.stepParentName = parentName;
                        }

                        const transform = stepParentTransformMap.get(element.uuid);
                        if (transform && !obj.vs_step_parent_local) {
                            obj.vs_has_step_parent_transform = true;
                            obj.vs_step_parent_origin = [...transform.from];
                            obj.vs_step_parent_rotation = [...transform.rotation];
                        }

                        // The selection is detached from its outliner parent in
                        // the saved file, so its root rotation must be promoted
                        // from socket-local to model-space as well.
                        const rootBindRotation = rootBindRotationMap.get(element.uuid);
                        if (rootBindRotation && !obj.vs_step_parent_local) {
                            obj.rotation = [...rootBindRotation];
                        }
                    }
                    if (element.children.length > 0) {
                        iterate(element.children, obj.children, false);
                    }
                    save_array.push(obj);
                } else {
                    save_array.push(element.uuid);
                }
            }
        }
        iterate(rootGroups, result, true);
        return result;
    }

    // Recursive function to collect all nested elements
    function collectAllElements(nodes: any[]): any[] {
        const allElements: any[] = [];

        function traverse(node: any) {
            allElements.push(node);
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any) => traverse(child));
            }
        }

        nodes.forEach(node => traverse(node));
        return allElements;
    }

    /**
     * Collects all texture UUIDs used by the given cubes
     * @param cubes Array of cubes to check
     * @returns Set of texture UUIDs that are referenced by the cubes
     */
    function collectUsedTextureUuids(cubes: any[]): Set<string> {
        const usedUuids = new Set<string>();

        for (const cube of cubes) {
            if (!cube.faces) continue;

            for (const faceKey in cube.faces) {
                const face = cube.faces[faceKey];
                if (face && face.texture !== undefined && face.texture !== null) {
                    // face.texture can be a texture index or UUID
                    // Get the actual texture to find its UUID
                    const tex = Texture.all[face.texture] || Texture.all.find((t: any) => t.uuid === face.texture);
                    if (tex) {
                        usedUuids.add(tex.uuid);
                    }
                }
            }
        }

        return usedUuids;
    }

    return new Codec('projectSelection', {
        name: 'Blockbench Project Selection',
        extension: 'bbmodel',
        remember: true,
        export() {
            if (!Project || selection.length === 0) return;
            Blockbench.export({
                resource_id: 'model',
                type: this.name,
                extensions: [this.extension],
                name: `${selection[0].name}_attachment.bbmodel`,
                startpath: this.startPath(),
                content: this.compile(selection)
            });
        },
        compile(selection: any[], options?: any) {
            if (!Project) throw new Error('Cannot export attachments without an open project.');
            if (!options) options = {};
            const model: any = {
                meta: {
                    format_version: '4.5',
                    model_format: Format.id,
                    box_uv: Project.box_uv
                },
                resolution: {
                    width: Project.texture_width || 16,
                    height: Project.texture_height || 16,
                },
                elements: [],
                outliner: []
            };

            // Track root group UUIDs - these are the groups that should keep their clothingSlot
            // Also track their parent names for correct hierarchy placement on import
            const rootGroupUuids = new Set<string>();
            const rootElementUuids = new Set<string>();
            const parentNameMap = new Map<string, string>();
            const stepParentTransformMap = new Map<string, StepParentFrame>();
            const rootBindRotationMap = new Map<string, Vector3Tuple>();
            selection.forEach(el => {
                if (el instanceof Group || el instanceof Cube) {
                    rootElementUuids.add(el.uuid);
                    if (el instanceof Group) rootGroupUuids.add(el.uuid);
                    // Store the parent group name so the importer knows where to place this group
                    if (el.parent && el.parent instanceof Group) {
                        parentNameMap.set(el.uuid, el.parent.name);
                    }

                    const stepParentName = el.stepParentName?.trim() || parentNameMap.get(el.uuid);
                    if (stepParentName && !el.vs_step_parent_local) {
                        rootBindRotationMap.set(el.uuid, getElementBindRotation(el));
                        const candidates = Group.all.filter((candidate: Group) => {
                            if (candidate === el || candidate.name !== stepParentName) return false;
                            let current: any = candidate;
                            while (current && current instanceof Group) {
                                if (current === el) return false;
                                current = current.parent;
                            }
                            return true;
                        });
                        const attachmentSlot = el.clothingSlot?.trim();
                        const target = candidates.find((candidate: Group) => {
                            const candidateSlot = candidate.clothingSlot?.trim();
                            return !candidateSlot || candidateSlot !== attachmentSlot;
                        }) || candidates[0];

                        if (target) {
                            stepParentTransformMap.set(el.uuid, {
                                from: getSocketFrom(target),
                                rotation: getElementBindRotation(target),
                            });
                        }
                    }
                }
            });

            // Use the recursive function to collect all nested elements
            const allElements = collectAllElements(selection);

            // Collect all cubes from the selection
            const cubes: any[] = [];
            allElements.forEach(el => {
                if (el instanceof Cube) {
                    cubes.push(el);
                    const saveCopy = el.getSaveCopy();
                    if (rootElementUuids.has(el.uuid)) {
                        const parentName = parentNameMap.get(el.uuid);
                        if (!saveCopy.stepParentName && parentName) {
                            saveCopy.stepParentName = parentName;
                        }

                        const transform = stepParentTransformMap.get(el.uuid);
                        if (transform && !saveCopy.vs_step_parent_local) {
                            saveCopy.vs_has_step_parent_transform = true;
                            saveCopy.vs_step_parent_origin = [...transform.from];
                            saveCopy.vs_step_parent_rotation = [...transform.rotation];
                        }

                        const rootBindRotation = rootBindRotationMap.get(el.uuid);
                        if (rootBindRotation && !saveCopy.vs_step_parent_local) {
                            saveCopy.rotation = [...rootBindRotation];
                        }
                    }
                    model.elements.push(saveCopy);
                }
            });

            model.outliner = compileGroupsFrom(
                selection,
                true,
                rootGroupUuids,
                parentNameMap,
                stepParentTransformMap,
                rootBindRotationMap
            );

            // Only export textures that are actually used by the selected elements
            const usedTextureUuids = collectUsedTextureUuids(cubes);
            model.textures = [];
            Texture.all.forEach((tex: any) => {
                if (usedTextureUuids.has(tex.uuid)) {
                    const t: any = tex.getUndoCopy();
                    t.source = 'data:image/png;base64,' + tex.getBase64();
                    t.mode = 'bitmap';
                    model.textures.push(t);
                }
            });

            return compileJSON(model);
        }
    });
}
