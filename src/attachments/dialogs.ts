
import { getActiveSlotNames } from './presets';
import { suggestSlotFromName } from './slot_helpers';

// Store last used slot per file pattern
const slotMemory = new Map<string, string>();

/**
 * Gets remembered slot for a file pattern
 */
function getRememberedSlot(filePath: string): string | null {
    const pattern = extractFilePattern(filePath);
    return slotMemory.get(pattern) || null;
}

/**
 * Remembers slot choice for a file pattern
 */
function rememberSlot(filePath: string, slot: string) {
    const pattern = extractFilePattern(filePath);
    slotMemory.set(pattern, slot);
    // Limit memory size
    if (slotMemory.size > 100) {
        const firstKey = slotMemory.keys().next().value;
        slotMemory.delete(firstKey);
    }
}

/**
 * Extracts a pattern from file path for memory matching
 */
function extractFilePattern(filePath: string): string {
    const fileName = filePath.split(/[/\\]/).pop() || '';
    // Remove extension and numeric suffixes
    return fileName.replace(/\.[^.]+$/, '').replace(/\d+$/, '').toLowerCase();
}

/**
 * Analyzes imported model to extract preview information
 */
function analyzeImportPreview(model: any): {
    elementCount: number;
    groupCount: number;
    cubeCount: number;
    textureCount: number;
    detectedSlots: string[];
    elementNames: string[];
} {
    const result = {
        elementCount: 0,
        groupCount: 0,
        cubeCount: 0,
        textureCount: 0,
        detectedSlots: [] as string[],
        elementNames: [] as string[]
    };

    if (!model) return result;

    // Count textures
    if (model.textures && Array.isArray(model.textures)) {
        result.textureCount = model.textures.length;
    } else if (model.textures && typeof model.textures === 'object') {
        result.textureCount = Object.keys(model.textures).length;
    }

    // Analyze elements
    const elements = model.elements || [];
    const groups = model.groups || [];
    const outliner = model.outliner || [];

    result.elementCount = elements.length + groups.length;
    result.cubeCount = elements.length;
    result.groupCount = groups.length;

    // Extract element names
    const nameSet = new Set<string>();
    
    function extractNames(item: any) {
        if (typeof item === 'string') {
            // UUID reference
            return;
        }
        if (item && typeof item === 'object') {
            if (item.name) nameSet.add(item.name);
            if (item.children && Array.isArray(item.children)) {
                item.children.forEach(extractNames);
            }
        }
    }

    outliner.forEach(extractNames);
    elements.forEach((el: any) => {
        if (el && el.name) nameSet.add(el.name);
    });
    groups.forEach((g: any) => {
        if (g && g.name) nameSet.add(g.name);
    });

    result.elementNames = Array.from(nameSet);

    // Detect slots from element names
    const availableSlots = getActiveSlotNames();
    const detectedSlotsSet = new Set<string>();
    
    result.elementNames.forEach(name => {
        const suggested = suggestSlotFromName(name, availableSlots);
        if (suggested) detectedSlotsSet.add(suggested);
    });

    result.detectedSlots = Array.from(detectedSlotsSet);

    return result;
}

/**
 * Shows an enhanced import preview dialog with slot selection
 * @param inferredSlot The slot inferred from the file path (if any)
 * @param filePath The file path being imported
 * @param model The imported model data (for preview)
 * @returns Promise that resolves to the selected clothing slot, or null if cancelled
 */
export function showClothingSlotDialog(
    inferredSlot: string | null, 
    filePath: string,
    model?: any
): Promise<{ slot: string | null; rememberChoice: boolean }> {
    return new Promise((resolve) => {
        const availableSlots = getActiveSlotNames();
        const fileName = filePath.split(/[/\\]/).pop() || 'attachment';
        const preview = model ? analyzeImportPreview(model) : null;
        
        // Get remembered slot
        const rememberedSlot = getRememberedSlot(filePath);
        
        // Determine default selection (priority: remembered > inferred > suggested)
        let defaultSlot = '';
        if (rememberedSlot && availableSlots.includes(rememberedSlot)) {
            defaultSlot = rememberedSlot;
        } else if (inferredSlot && availableSlots.includes(inferredSlot)) {
            defaultSlot = inferredSlot;
        } else if (preview && preview.detectedSlots.length > 0) {
            defaultSlot = preview.detectedSlots[0];
        }

        // Create options for the dialog with visual indicators
        const options: { [key: string]: string } = {};
        availableSlots.forEach(slot => {
            let label = slot;
            if (slot === rememberedSlot) label += ' (remembered)';
            else if (slot === inferredSlot) label += ' (detected from path)';
            else if (preview && preview.detectedSlots.includes(slot)) label += ' (suggested)';
            options[slot] = label;
        });

        // Add a "None" option
        options[''] = '(None)';

        const previewHtml = preview ? `
            <div style="margin: 12px 0; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 4px;">
                <div style="font-weight: 500; margin-bottom: 8px;">Import Preview:</div>
                <div style="font-size: 12px; line-height: 1.6;">
                    <div>• ${preview.elementCount} element(s) (${preview.groupCount} groups, ${preview.cubeCount} cubes)</div>
                    <div>• ${preview.textureCount} texture(s)</div>
                    ${preview.detectedSlots.length > 0 ? `<div>• Detected slots: ${preview.detectedSlots.join(', ')}</div>` : ''}
                    ${preview.elementNames.length > 0 ? `<div style="margin-top: 8px; opacity: 0.8;">Elements: ${preview.elementNames.slice(0, 5).join(', ')}${preview.elementNames.length > 5 ? '...' : ''}</div>` : ''}
                </div>
            </div>
        ` : '';

        new Dialog({
            id: 'clothing_slot_selector',
            title: 'Import Attachment',
            component: {
                template: `
                    <div>
                        <p>Choose the clothing slot for imported elements from:</p>
                        <p style="font-weight: 500; margin: 8px 0;">${fileName}</p>
                        ${previewHtml}
                    </div>
                `
            },
            form: {
                clothing_slot: {
                    label: 'Clothing Slot',
                    type: 'select',
                    options: options,
                    value: defaultSlot
                },
                remember_choice: {
                    label: 'Remember this choice for similar files',
                    type: 'checkbox',
                    value: !!rememberedSlot
                }
            },
            onConfirm(formData: any) {
                const selectedSlot = formData.clothing_slot;
                const rememberChoice = formData.remember_choice || false;
                
                if (rememberChoice && selectedSlot) {
                    rememberSlot(filePath, selectedSlot);
                }
                
                resolve({
                    slot: selectedSlot === '' ? null : selectedSlot,
                    rememberChoice
                });
            },
            onCancel() {
                resolve({ slot: null, rememberChoice: false });
            }
        }).show();
    });
}
