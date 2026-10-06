import { events } from "./util/events";
import PACKAGE from "../package.json";

// Actions
import "./debug_actions";
import "./actions";
import "./animation_actions";

// Properties
import "./property";

// Mods (order matters — these must load before panels)
import "./mods/boneAnimatorMod";
import "./mods/formatMod";
import "./mods/settingsMod";
import "./mods/legacyFormatConverterMod";
import "./mods/nodePreviewControllerMod";
import "./mods/effectAnimatorMod";
import "./mods/attachmentsMod";

// Panels (loaded after mods to avoid blocking critical format registration)
import "./panels/vs_face_panel";

BBPlugin.register(PACKAGE.name, {
    title: PACKAGE.title,
    icon: 'icon.png',
    author: PACKAGE.author.name,
    contributors: PACKAGE.contributors.map(x => x.name),
    description: PACKAGE.description,
    version: PACKAGE.version,
    variant: 'desktop',
    min_version: "5.0.0",
    repository: PACKAGE.repository.url,
    tags: ["Vintage Story"],
    onload() {
        events.LOAD.dispatch();
    },
    onunload() {
        events.UNLOAD.dispatch();
    },
    oninstall() {
        events.INSTALL.dispatch();
    },
    onuninstall() {
        events.UNINSTALL.dispatch();
    },
});
