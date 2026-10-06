import { createExportCodec } from './codec';
import { QUICK_MESSAGE_DURATION } from './constants';

const DEBUG = false;

/**
 * Exports the selected attachments to the standard Blockbench (.bbmodel) format.
 * @param {Array<Group>} selection - An array of selected attachment groups.
 */
export function exportAttachmentsBB(selection: Group[]) {
    if (!selection || selection.length === 0) {
        Blockbench.showQuickMessage("Please select one or more attachments to export.", QUICK_MESSAGE_DURATION);
        return;
    }

    const bb_codec = createExportCodec(selection);
    bb_codec.export();
    
    if (DEBUG) console.log("Exporting selected attachments to .bbmodel format...");
}
