import { exportAttachmentsVS } from './export_attachment_vs';
import { exportAttachmentsBB } from './export_attachment_bb';
import { deleteSection, deleteSectionSafe } from './delete_section';
import { findAttachments } from './discovery';
import type { IAttachmentSection } from './discovery';
import { DISCOVERY_DEBOUNCE_MS, QUICK_MESSAGE_DURATION } from './constants';
import { getSlotInfo } from './slot_helpers';

const DEBUG = false;

interface AttachmentPanelState {
    sections: IAttachmentSection[];
    openSections: string[];
    hoveredSection: string | null;
}

type AttachmentPanelListener = [event: string, listener: () => void];

interface AttachmentPanelContext extends AttachmentPanelState {
    updateAttachments(): void;
    refresh?: () => void;
    _bbListeners?: AttachmentPanelListener[];
}

type AttachmentOutlinerNode = OutlinerNode & {
    visibility?: boolean;
    toggleVisibility?: (visible: boolean) => void;
};

// Track recently imported elements (within last 5 minutes)
const RECENT_IMPORT_THRESHOLD = 5 * 60 * 1000; // 5 minutes in ms
const recentImports = new Map<any, number>();

// Mark element as recently imported
export function markAsRecentlyImported(element: any) {
    recentImports.set(element, Date.now());
    // Clean up old entries periodically
    if (recentImports.size > 100) {
        const now = Date.now();
        for (const [el, time] of recentImports.entries()) {
            if (now - time > RECENT_IMPORT_THRESHOLD) {
                recentImports.delete(el);
            }
        }
    }
}

function isRecentlyImported(element: any): boolean {
    const time = recentImports.get(element);
    if (!time) return false;
    return Date.now() - time < RECENT_IMPORT_THRESHOLD;
}

/**
 * Creates a debounced function that delays invoking the provided function
 * until after the specified wait time has elapsed since the last call.
 * @param fn The function to debounce.
 * @param wait The debounce delay in milliseconds.
 * @returns The debounced function.
 */
function debounce<T extends (...args: any[]) => any>(fn: T, wait: number): T {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return ((...args: any[]) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), wait);
    }) as T;
}

/**
 * Recursively gets all elements within a group or a cube.
 * @param {Group | Cube} element The element to traverse.
 * @returns {Array<object>} A flat array of all elements.
 */
function getAllChildElements(element: any) {
    const elements: any[] = [];
    function traverse(node: any) {
        elements.push(node);
        if (node instanceof Group && Array.isArray(node.children)) {
            node.children.forEach(traverse);
        }
    }
    traverse(element);
    return elements;
}

function walkOutliner(node: AttachmentOutlinerNode, callback: (node: AttachmentOutlinerNode) => void): void {
    callback(node);
    if (node instanceof Group && Array.isArray(node.children)) {
        node.children.forEach(child => walkOutliner(child, callback));
    }
}

/**
 * Calculates the depth of an element in the outliner hierarchy.
 * Depth is measured from the root (root = 0, first child = 1, etc.)
 * @param element The element to calculate depth for.
 * @returns The depth of the element in the hierarchy.
 */
function getElementDepth(element: any): number {
    let depth = 0;
    let current = element.parent;
    while (current) {
        depth++;
        current = current.parent;
    }
    return depth;
}

/**
 * Calculates the minimum depth among all elements in a section.
 * @param elements Array of elements in the section.
 * @returns The minimum depth found.
 */
function getMinDepth(elements: any[]): number {
    if (elements.length === 0) return 0;
    return Math.min(...elements.map(el => getElementDepth(el)));
}

/**
 * Updates the outliner selection with the provided elements.
 * @param {Array<object>} elements The elements to select.
 */
function updateOutlinerSelection(elements: any[]) {
    Outliner.selected.empty();
    elements.forEach((element: any) => {
        Outliner.selected.safePush(element);
    });
    updateSelection();
}


const vuePanel = {
    template: `
        <div class="attachments-panel">
            <style>
                .attachments-panel {
                    padding: 0;
                }
                .attachment-section {
                    margin: 0;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                }
                .attachment-section:last-child {
                    border-bottom: none;
                }
                .attachment-section h2 {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 8px;
                    margin: 0;
                    cursor: pointer;
                    user-select: none;
                    position: relative;
                    font-size: 18px !important;
                    font-weight: 500;
                    min-height: 32px;
                }
                .attachments-panel .attachment-section h2 {
                    font-size: 18px !important;
                }
                .attachments-panel .attachment-section h2 * {
                    font-size: inherit !important;
                }
                .attachment-section h2:hover {
                    background: rgba(255, 255, 255, 0.05);
                }
                .expand_icon {
                    font-size: 18px !important;
                    width: 18px;
                    flex-shrink: 0;
                }
                .slot-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    padding: 1px 6px;
                    border-radius: 10px;
                    font-size: 18px !important;
                    font-weight: 500;
                    line-height: 1.3;
                    flex-shrink: 0;
                }
                .attachments-panel .attachment-section h2 .slot-badge {
                    font-size: 18px !important;
                }
                /* Override w3-css h2 styles specifically for our text span */
                .attachments-panel .slot-badge-text,
                .attachments-panel .attachment-section h2 .slot-badge .slot-badge-text,
                .attachments-panel .attachment-section h2 .slot-badge-text,
                .attachments-panel .attachment-section h2 span.slot-badge span.slot-badge-text {
                    font-size: 18px !important;
                    line-height: 1.3;
                    display: inline-block;
                }
                /* Maximum specificity to override w3-css */
                .attachments-panel .attachment-section h2 .slot-badge .slot-badge-text {
                    font-size: 18px !important;
                }
                .slot-icon {
                    font-size: 8px !important;
                }
                .attachment-section h2 .slot-badge .material-icons.slot-icon {
                    font-size: 8px !important;
                }
                .attachment-count {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 1px 5px;
                    border-radius: 8px;
                    font-size: 10px;
                    font-weight: 500;
                    margin-left: auto;
                    flex-shrink: 0;
                }
                .section-stats {
                    font-size: 8px;
                    color: rgba(255, 255, 255, 0.5);
                    margin-left: 4px;
                    flex-shrink: 0;
                }
                .section-buttons {
                    display: flex;
                    gap: 0;
                    margin-left: auto;
                    align-items: center;
                    flex-shrink: 0;
                }
                .section-buttons .material-icons {
                    width: 24px;
                    height: 24px;
                    min-width: 24px;
                    min-height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    border-radius: 0;
                    font-size: 16px;
                    transition: background 0.15s;
                    padding: 0;
                }
                .section-buttons .material-icons:hover {
                    background: rgba(255, 255, 255, 0.1);
                }
                .section-buttons .material-icons:first-child {
                    border-top-left-radius: 3px;
                    border-bottom-left-radius: 3px;
                }
                .section-buttons .material-icons:last-child {
                    border-top-right-radius: 3px;
                    border-bottom-right-radius: 3px;
                }
                .section-buttons .action-group {
                    display: flex;
                    gap: 0;
                }
                .section-buttons .action-divider {
                    width: 1px;
                    height: 16px;
                    background: rgba(255, 255, 255, 0.15);
                    margin: 0 2px;
                    flex-shrink: 0;
                }
                .element-list {
                    list-style: none;
                    margin: 0;
                    padding: 0;
                    padding-left: 2px;
                }
                .element-item {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    padding: 1px 4px;
                    cursor: pointer;
                    font-size: 11px;
                    min-height: 18px;
                    position: relative;
                }
                .element-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }
                .element-item.selected {
                    background: rgba(66, 165, 245, 0.2);
                }
                .element-icon {
                    font-size: 13px;
                    width: 14px;
                    text-align: center;
                    flex-shrink: 0;
                    margin-right: 2px;
                }
                .element-name {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .modified-indicator {
                    color: #ff9800;
                    font-size: 10px;
                    margin-left: 2px;
                    flex-shrink: 0;
                }
                .tooltip-content {
                    display: none;
                    position: absolute;
                    background: rgba(0, 0, 0, 0.95);
                    color: white;
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 11px;
                    z-index: 1000;
                    max-width: 280px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                    pointer-events: none;
                    top: 100%;
                    left: 0;
                    margin-top: 2px;
                }
                .section-header-wrapper {
                    position: relative;
                }
                .section-header-wrapper:hover .tooltip-content {
                    display: block;
                }
            </style>
            <div v-if="sections.every(s => s.elements.length === 0)" class="panel_placeholder">
                <i class="material-icons">folder</i>
                <p>No attachments found in model.</p>
                <p>Assign a "Clothing Slot" to a group or cube in the element panel.</p>
            </div>
            <div v-else>
                <div v-for="section in sections.filter(s => s.elements.length > 0)" :key="section.slot" class="attachment-section">
                    <div class="section-header-wrapper" style="position: relative;">
                        <h2 @click="toggleSection(section.slot)" :class="{ collapsed: !isSectionOpen(section.slot) }">
                            <i class="material-icons expand_icon">
                                {{ isSectionOpen(section.slot) ? 'arrow_drop_down' : 'arrow_right' }}
                            </i>
                            <span class="slot-badge" :style="{ backgroundColor: getSlotInfo(section.slot).color + '40', color: getSlotInfo(section.slot).color }">
                                <i class="material-icons slot-icon">{{ getSlotInfo(section.slot).icon }}</i>
                                <span class="slot-badge-text" style="font-size: 18px !important;">{{ section.slot }}: {{ section.elements.length }} {{ getSectionStats(section.elements) }}</span>
                            </span>
                            
                            <span class="section-buttons">
                                <i class="material-icons" @click.stop="selectSection(section.elements)" title="Select all elements in this section">select_all</i>
                                <i class="material-icons" @click.stop="toggleVisibility(section.elements, !getSectionVisibility(section.elements))" :title="getSectionVisibility(section.elements) ? 'Hide all elements in this section' : 'Show all elements in this section'">
                                    {{ getSectionVisibility(section.elements) ? 'visibility' : 'visibility_off' }}
                                </i>
                                <span class="action-divider"></span>
                                <i class="material-icons" @click.stop="exportBB(section.elements)" title="Export to .bbmodel">save</i>
                                <i class="material-icons" @click.stop="exportVS(section.elements)" title="Export as VS .json">file_download</i>
                                <span class="action-divider"></span>
                                <i class="material-icons" @click.stop="confirmDeleteMinusRoot(section.elements, section.slot)" title="Delete (-) Root: Delete attachments but preserve root groups" style="color: #4caf50;">remove_circle_outline</i>
                                <i class="material-icons" @click.stop="confirmDelete(section.elements, section.slot)" title="Delete all elements in this section (including root groups)" style="color: #f44336;">delete</i>
                            </span>
                        </h2>
                        <div class="tooltip-content">
                            <div><strong>{{ section.slot }}</strong></div>
                            <div style="margin-top: 4px; font-size: 11px; line-height: 1.4;">
                                <span v-for="(element, index) in getFlattenedElementList(section.elements).slice(0, 10)" :key="element.uuid">
                                    {{ element.name }}<span v-if="index < Math.min(section.elements.length, 10) - 1">, </span>
                                </span>
                                <span v-if="section.elements.length > 10" style="opacity: 0.7;">
                                    ... and {{ section.elements.length - 10 }} more
                                </span>
                            </div>
                        </div>
                    </div>
                    <div v-if="isSectionOpen(section.slot)" class="element-list">
                        <div v-for="element in section.elements" 
                            :key="element.uuid"
                            :class="{ selected: isSelected(element), 'recently-imported': isRecentlyImported(element) }"
                            class="element-item"
                            :style="{ paddingLeft: (getElementIndent(element, section.elements) * 12 + 4) + 'px' }"
                            @click="selectElement(element)"
                            :title="getElementTooltip(element)">
                            
                            <i class="material-icons element-icon" :style="{ color: element instanceof Group ? '#64b5f6' : '#81c784' }">
                                {{ getIcon(element) }}
                            </i>
                            <span class="element-name">
                                {{ element.name }}
                                <span v-if="isRecentlyImported(element)" class="modified-indicator" title="Recently imported">●</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,
    data: (): AttachmentPanelState => ({
        sections: [],
        openSections: [],
        hoveredSection: null
    }),
    methods: {
        /**
         * Gets slot information for styling
         */
        getSlotInfo(slot: string) {
            return getSlotInfo(slot);
        },
        /**
         * Gets section statistics (groups vs cubes) in format: (5 Groups, 2 Cubes)
         */
        getSectionStats(elements: any[]): string {
            const groups = elements.filter(e => e instanceof Group).length;
            const cubes = elements.filter(e => e instanceof Cube).length;
            const parts: string[] = [];
            if (groups > 0) parts.push(`${groups} Group${groups !== 1 ? 's' : ''}`);
            if (cubes > 0) parts.push(`${cubes} Cube${cubes !== 1 ? 's' : ''}`);
            if (parts.length === 0) return '(0 items)';
            return `(${parts.join(', ')})`;
        },
        /**
         * Checks if element was recently imported
         */
        isRecentlyImported(element: any): boolean {
            return isRecentlyImported(element);
        },
        /**
         * Gets tooltip text for an element
         */
        getElementTooltip(element: any): string {
            const parts: string[] = [];
            parts.push(element.name || 'Unnamed');
            if (element instanceof Group) {
                parts.push(`Group (${element.children?.length || 0} children)`);
            } else {
                parts.push('Cube');
            }
            if (element.clothingSlot) {
                parts.push(`Slot: ${element.clothingSlot}`);
            }
            if (element.stepParentName) {
                parts.push(`Step Parent: ${element.stepParentName}`);
            }
            return parts.join(' | ');
        },
        /**
         * Gets a flattened list of element names (for tooltip display).
         * @param elements Array of elements to flatten.
         * @returns Array of elements in a flat list.
         */
        getFlattenedElementList(elements: any[]): any[] {
            // Return elements in a simple flat list, sorted by name for consistency
            return [...elements].sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
        },
        /**
         * Calculates the indentation level for an element based on its depth in the hierarchy.
         * Indentation is normalized so the shallowest element starts at 0.
         * @param element The element to calculate indentation for.
         * @param allElements All elements in the section (to find min depth).
         * @returns The indentation level (0 = shallowest element, increases with relative depth).
         */
        getElementIndent(element: any, allElements: any[]): number {
            const minDepth = getMinDepth(allElements);
            const elementDepth = getElementDepth(element);
            // Normalize: subtract minDepth so shallowest element is at 0
            return elementDepth - minDepth;
        },
        /**
         * Exports the given elements to a .bbmodel file.
         * @param {Array<Group | Cube>} elements The elements to export.
         */
        exportBB(elements: any[]) {
            try {
                exportAttachmentsBB(elements);
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                Blockbench.showQuickMessage(`Export failed: ${errorMsg}`, QUICK_MESSAGE_DURATION);
                if (DEBUG) console.error('Export BB error:', e);
            }
        },
        /**
         * Exports the given elements to a Vintage Story .json file.
         * @param {Array<Group | Cube>} elements The elements to export.
         */
        exportVS(elements: any[]) {
            try {
                exportAttachmentsVS(elements);
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                Blockbench.showQuickMessage(`Export failed: ${errorMsg}`, QUICK_MESSAGE_DURATION);
                if (DEBUG) console.error('Export VS error:', e);
            }
        },
        /**
         * Confirms delete minus root (preserves root attachment groups and base model groups)
         */
        confirmDeleteMinusRoot(elements: any[], slotName: string) {
            if (confirm(`Delete (-) Root in "${slotName}"?\n\nThis will delete attachment content but preserve:\n- Base model groups (like "Ears")\n- Root attachment groups (first level with clothingSlot)\n\nThis action cannot be undone.`)) {
                deleteSectionSafe(elements);
            }
        },
        /**
         * Confirms deletion before deleting section (original behavior - deletes everything)
         */
        confirmDelete(elements: any[], slotName: string) {
            if (confirm(`Are you sure you want to delete all ${elements.length} attachment(s) in "${slotName}"?\n\nThis will delete everything including base model groups.\n\nThis action cannot be undone.`)) {
                deleteSection(elements);
            }
        },
        /**
         * Updates the list of attachments by calling the discovery function.
         */
        updateAttachments(this: AttachmentPanelState) {
            this.sections = findAttachments();
        },
        /**
         * Toggles the visibility of a section in the panel.
         * @param {string} slot The slot name of the section to toggle.
         */
        toggleSection(this: AttachmentPanelState, slot: string) {
            const index = this.openSections.indexOf(slot);
            if (index > -1) {
                this.openSections.splice(index, 1);
            } else {
                this.openSections.push(slot);
            }
        },
        /**
         * Checks if a section is open in the panel.
         * @param {string} slot The slot name of the section.
         * @returns {boolean} True if the section is open, false otherwise.
         */
        isSectionOpen(this: AttachmentPanelState, slot: string) {
            return this.openSections.includes(slot);
        },
        /**
         * Selects an element and all its children.
         * @param {Group | Cube} element The element to select.
         */
        selectElement(element: any) {
            const allChildren = getAllChildElements(element);
            updateOutlinerSelection(allChildren);
        },
        /**
         * Checks if an element is selected in the outliner.
         * @param {Group | Cube} element The element to check.
         * @returns {boolean} True if the element is selected, false otherwise.
         */
        isSelected(element: any) {
            return Outliner.selected.includes(element);
        },
        /**
         * Toggles the visibility of all given elements.
         * @param {Array<Group | Cube>} elements The elements to toggle visibility for.
         * @param {boolean} isVisible The desired visibility state.
         */
        toggleVisibility(elements: OutlinerNode[], isVisible: boolean) {
            if (!elements || !Array.isArray(elements)) return;

            try {
                Undo.initEdit({ outliner: true });

                elements.forEach(element => {
                    if (!element) return;
                    try {
                        walkOutliner(element, node => {
                            if (!node) return;
                            if (typeof node.toggleVisibility === 'function') {
                                if (node.visibility !== isVisible) node.toggleVisibility(isVisible);
                            } else if ('visibility' in node) {
                                node.visibility = isVisible;
                            }
                        });
                    } catch (e) {
                        if (DEBUG) console.warn('Error toggling visibility for element:', element?.name, e);
                    }
                });

                Undo.finishEdit('Toggle visibility');
                Canvas.updateVisibility?.();
                Canvas.updateAll?.();
            } catch (e) {
                if (DEBUG) console.error('Error in toggleVisibility:', e);
                Blockbench.showQuickMessage('Failed to toggle visibility', QUICK_MESSAGE_DURATION);
            }
        },
        /**
         * Selects all elements in a section.
         * @param {Array<Group | Cube>} elements The elements in the section.
         */
        selectSection(elements: any[]) {
            const allChildren = elements.flatMap(element => getAllChildElements(element));
            updateOutlinerSelection(allChildren);
        },
        /**
         * Gets the visibility state of a section.
         * @param {Array<Group | Cube>} elements The elements in the section.
         * @returns {boolean} True if all elements are visible, false otherwise.
         */
        getSectionVisibility(elements: any[]) {
            return elements.every(element => element.visibility);
        },
        /**
         * Gets the appropriate icon for an element.
         * @param {Group | Cube} element The element.
         * @returns {string} The icon name.
         */
        getIcon(element: any) {
            return element instanceof Group ? 'folder' : 'widgets';
        }
    },
    mounted(this: AttachmentPanelContext) {
        // Debounce refresh calls to avoid unnecessary updates when multiple events fire
        this.refresh = debounce(() => this.updateAttachments(), DISCOVERY_DEBOUNCE_MS);
        this.updateAttachments(); // Initial load without debounce

        this._bbListeners = [
            ['update_outliner', this.refresh],
            ['load_project', this.refresh],
            ['select_project', this.refresh],
            ['new_project', this.refresh],
            ['update_selection', this.refresh],
            ['undo', this.refresh],
            ['redo', this.refresh],
            ['attachments_changed', this.refresh]
        ];

        this._bbListeners.forEach(([evt, fn]) => Blockbench.on(evt, fn));
    },
    beforeUnmount(this: AttachmentPanelContext) {
        if (this._bbListeners) {
            this._bbListeners.forEach(([evt, fn]) => Blockbench.removeListener(evt, fn));
        }
    },
    // Vue 2 compatibility
    beforeDestroy(this: AttachmentPanelContext) {
        if (this._bbListeners) {
            this._bbListeners.forEach(([evt, fn]) => Blockbench.removeListener(evt, fn));
        }
    }
};

/**
 * Creates and configures the Attachments panel.
 * @param {object} import_action - The import action
 * @returns {Panel} A new Blockbench Panel instance.
 */
export function createAttachmentsPanel(actions: any) {
    const toolbar = new Toolbar('attachments_toolbar', {
        id: 'attachments_toolbar',
        children: []
    });

    // Add the action to the toolbar
    if (actions.importBB) {
        toolbar.add(actions.importBB);
    }
    if (actions.importVS) {
        toolbar.add(actions.importVS);
    }

    const panel = new Panel('attachments_panel', {
        id: 'attachments_panel',
        name: 'Attachments',
        icon: 'attach_file',
        expand_button: false,
        default_side: 'right',
        default_position: {
            slot: 'right_bar',
            float_position: [0, 0],
            float_size: [300, 400],
            height: 400,
            folded: false
        },
        toolbars: [toolbar],
        component: vuePanel
    });

    // Store reference in Interface.Panels for easy access
    Interface.Panels.attachments_panel = panel;

    return panel;
}
