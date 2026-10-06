import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { get_game_path } from "../util/native";

declare var Setting: any;
declare var Settings: any;
declare var Dialog: any;
declare var Interface: any;

createBlockbenchMod(
    `${PACKAGE.name}:vs_gamepath_settings_mod`,
    {},
    _context => {
        const setting =  new Setting("game_path", {
            name: "Game Path",
            description: "The path to your Vintage Story game folder. This is the folder that contains the assets, mods and lib folders.",
            category: "general",
            type: "click",
            icon: "fa-folder-plus",
            value: "",
            click() {
                new Dialog("gamePathSelect", {
                    title: "Select Game Path",
                    form: {
                        path: {
                            label: "Path to your game folder",
                            type: "folder",
                            value: get_game_path(),
                        }
                    },
                    onConfirm(formResult) {
                        setting.set(formResult.path);
                        console.log("setting and saving");
                        Settings.save();
                    }
                }).show();
            }
        });
        return setting;
    },
    () => {
    }

);

createBlockbenchMod(
    `${PACKAGE.name}:attachment_preset_settings_mod`,
    {},
    _context => {
        const presetSetting = new Setting("attachment_preset", {
            name: "Attachment Preset",
            description: "Choose the clothing/attachment slot system to use. Glint for Glint character customization, Vintage Story for Seraph models, or Custom for your own slots.",
            category: "general",
            type: "select",
            value: "glint",
            options: {
                glint: "Glint (Outerwear, Top, Bottoms, Boots, etc.)",
                vintage_story: "Vintage Story (Arm, Head, UpperBody, etc.)",
                custom: "Custom (configure your own slots)"
            },
            onChange() {
                // Refresh attachments panel when preset changes
                try {
                    if (Interface.Panels.attachments_panel && Interface.Panels.attachments_panel.vue) {
                        Interface.Panels.attachments_panel.vue.updateAttachments();
                    }
                } catch (e) {
                    console.warn('Could not refresh attachments panel:', e);
                }
            }
        });

        return presetSetting;
    },
    () => {
    }
);

createBlockbenchMod(
    `${PACKAGE.name}:attachment_custom_slots_settings_mod`,
    {},
    _context => {
        const customSlotsSetting = new Setting("attachment_custom_slots", {
            name: "Custom Attachment Slots",
            description: "Define custom slot names (one per line) when using Custom preset. Example: Head, Torso, Legs, etc.",
            category: "general",
            type: "click",
            icon: "fa-list",
            value: "",
            condition: () => Settings.get("attachment_preset") === "custom",
            click() {
                new Dialog("customSlotsEdit", {
                    title: "Edit Custom Attachment Slots",
                    form: {
                        slots: {
                            label: "Slot Names (one per line)",
                            type: "textarea",
                            value: (Settings.get("attachment_custom_slots") || []).join("\n"),
                        }
                    },
                    onConfirm(formResult) {
                        // Split by newlines and filter out empty lines
                        const slots = formResult.slots
                            .split("\n")
                            .map((s: string) => s.trim())
                            .filter((s: string) => s.length > 0);

                        customSlotsSetting.set(slots);
                        Settings.save();

                        // Refresh attachments panel
                        try {
                            if (Interface.Panels.attachments_panel && Interface.Panels.attachments_panel.vue) {
                                Interface.Panels.attachments_panel.vue.updateAttachments();
                            }
                        } catch (e) {
                            console.warn('Could not refresh attachments panel:', e);
                        }
                    }
                }).show();
            }
        });

        return customSlotsSetting;
    },
    () => {
    }
);

createBlockbenchMod(
    `${PACKAGE.name}:vs_model_offset_settings_mod`,
    {},
    _context => {
        const setting = new Setting("vs_apply_model_offset", {
            name: "Apply Model Offset",
            description: "Apply [8, 0, 8] offset to exported models for Vintage Story engine centering. Disable if your models are already positioned correctly.",
            category: "general",
            type: "toggle",
            value: true
        });
        return setting;
    },
    () => {
    }
);

createBlockbenchMod(
    `${PACKAGE.name}:vs_export_textures_settings_mod`,
    {},
    _context => {
        const setting = new Setting("vs_export_textures", {
            name: "Export Texture Files",
            description: "Automatically save texture files to disk when exporting models. Disable to only include texture references in the JSON without saving the actual texture files.",
            category: "general",
            type: "toggle",
            value: false
        });
        return setting;
    },
    () => {
    }
);


