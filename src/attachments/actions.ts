/**
 * @file Defines the import actions for attachments.
 * This file creates the UI actions and orchestrates the import process,
 * delegating the core logic to other modules.
 */

import { createExportCodec } from './codec';
import { VS_Shape } from '../vs_shape_def';
import { cleanJSONString } from '../util/json';
import { processImportedAttachments } from './post_import';
import { mergeBBModel, mergeVSAttachment } from './importer';
import { IMPORT_SETTLE_DELAY, QUICK_MESSAGE_DURATION } from './constants';

const DEBUG = false;

function logDebug(message: string, ...args: any[]) {
    if (DEBUG) console.log(message, ...args);
}

interface ImportActionConfig {
    id: string;
    name: string;
    description: string;
    icon: string;
    resource_id?: string;
    extensions: string[];
    type: string;
    logPrefix: string;
    mergeFn: (model: any, filePath: string) => void;
}

/**
 * Factory function to create a generic attachment import action. This abstracts the common logic
 * for handling file import, parsing, and post-processing, thus reducing code duplication.
 * @param config Configuration object defining the specifics of the import action.
 * @returns A configured Blockbench `Action` instance.
 */
function createImportAction(config: ImportActionConfig) {
    return new Action(config.id, {
        name: config.name,
        icon: config.icon,
        category: 'file',
        description: config.description,
        click: () => {
            Blockbench.import({
                resource_id: config.resource_id,
                extensions: config.extensions,
                type: config.type,
                multiple: true,
            }, function(files) {
                if (!files || !files.length) return;

                Undo.initEdit({ outliner: true });

                const elementsBefore = new Set([...Group.all, ...Cube.all]);

                files.forEach(file => {
                    try {
                        const cleanedContent = cleanJSONString(file.content as string);
                        const model = autoParseJSON(cleanedContent);

                        if (!model || typeof model !== 'object') {
                            if (DEBUG) console.error(`[${config.logPrefix}] Invalid model data in file:`, file.path);
                            Blockbench.showQuickMessage(`Failed to import ${file.name}: Invalid JSON structure`, QUICK_MESSAGE_DURATION);
                            return;
                        }

                        if (model.animations && Array.isArray(model.animations) && model.animations.length > 0) {
                            logDebug(`[${config.logPrefix}] Skipping`, model.animations.length, 'animations from attachment file');
                            delete model.animations;
                        }

                        config.mergeFn(model, file.path);

                    } catch (err) {
                        if (DEBUG) console.error(`[${config.logPrefix}] Error importing file:`, file.path, err);
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        Blockbench.showQuickMessage(`Failed to import ${file.name}: ${errorMsg}`, QUICK_MESSAGE_DURATION);
                    }
                });

                const currentProject = Project;
                // Store first model for preview dialog
                let firstModel: any = null;
                if (files.length > 0) {
                    try {
                        const cleanedContent = cleanJSONString(files[0].content as string);
                        firstModel = autoParseJSON(cleanedContent);
                    } catch (e) {
                        if (DEBUG) console.warn(`[${config.logPrefix}] Could not parse model for preview:`, e);
                    }
                }
                
                // WORKAROUND: Use a timeout to wait for Blockbench's internal processes to complete.
                // After an import, the outliner and other project data are not updated instantaneously.
                // Running processImportedAttachments immediately would mean it can't find the new elements.
                // This delay gives Blockbench time to settle before we run our post-processing logic.
                setTimeout(async () => {
                    if (!currentProject || Project !== currentProject) {
                        if (DEBUG) console.warn(`[${config.logPrefix}] Project changed or closed, skipping post-import processing`);
                        return;
                    }
                    await processImportedAttachments(elementsBefore, files[0].path, config.logPrefix, firstModel);
                }, IMPORT_SETTLE_DELAY);
            });
        }
    });
}

/**
 * Creates and returns the attachment import actions for the UI.
 * This function leverages the `createImportAction` factory to build actions for different
 * file formats (.bbmodel and .json) without duplicating code.
 * @returns An object containing the configured import actions.
 */
export function createActions() {
    const codec = createExportCodec();

    const importBBAction = createImportAction({
        id: 'import_bb_attachment',
        name: 'Import BB Attachment',
        description: 'Import and automatically parent a .bbmodel attachment file',
        icon: 'fa-file-import',
        resource_id: 'model',
        extensions: [codec.extension],
        type: codec.name,
        logPrefix: 'Import BB',
        mergeFn: (model, filePath) => mergeBBModel(model, filePath)
    });

    const importVSAction = createImportAction({
        id: 'import_vs_attachment',
        name: 'Import VS Attachment',
        description: 'Import and automatically parent a .json attachment file',
        icon: 'fa-file-import',
        extensions: ['json'],
        type: 'Vintage Story Shape',
        logPrefix: 'Import VS',
        mergeFn: (model, filePath) => mergeVSAttachment(model as VS_Shape, filePath)
    });

    return {
        importBB: importBBAction,
        importVS: importVSAction
    };
}
