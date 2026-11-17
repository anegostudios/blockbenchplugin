import { import_model } from "./import_model";
import { mergeVSAttachment } from "./attachments/importer";
import { create_animation, import_animation_keyframes } from "./import_animation";
import { events } from "./util/events";
import { fs } from "./util/native";

const api = {
    version: 1,
    files() {
        return {
            readFileSync: fs.readFileSync,
            writeFileSync: fs.writeFileSync,
            existsSync: fs.existsSync,
            readdirSync: fs.readdirSync,
        };
    },
    importModel: import_model,
    importAttachment: mergeVSAttachment,
    importAnimation: create_animation,
    importAnimationKeyframes: import_animation_keyframes,
};

declare global {
    var VintageStoryAPI: typeof api | undefined;
}

events.LOAD.subscribe(() => {
    globalThis.VintageStoryAPI = api;
    Blockbench.dispatchEvent("vintagestory_api_ready");
});

events.UNLOAD.subscribe(() => {
    if (globalThis.VintageStoryAPI === api) {
        globalThis.VintageStoryAPI = undefined;
    }
});
