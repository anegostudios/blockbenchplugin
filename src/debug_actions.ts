import { createAction } from "./util/moddingTools";
import * as PACKAGE from "../package.json";
import { is_vs_project } from "./util";
import JSON5 from "json5";
import { fs } from "./util/native";

const path = requireNativeModule('path');


const reExportAction = createAction(`${PACKAGE.name}:reExport`, {
    name: 'Reexport Test',
    icon: 'fa-flask-vial',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        new Dialog("folder_select", {
            title: "Select Folder",
            form: {
                select_folder: {
                    label: "Select Folder to test",
                    description: "This Action is made for testing. If you don't know what it does, you probably should not use it.",
                    type: "folder",
                }
            },
            onConfirm(form_result) {
                const test_folder = form_result.select_folder;
                console.log(test_folder);
                const test_files: string[] = fs!.readdirSync(test_folder, { encoding: "utf-8" });
                for (const test_file of test_files) {
                    if (!test_file.endsWith('.json') || test_file.startsWith('reexport_')) continue;

                    const input_path = path.resolve(test_folder, test_file);
                    const output_path = path.resolve(test_folder, `reexport_${test_file}`);

                    if (!fs?.statSync(input_path).isFile()) continue;
                    console.log(`Processing: ${input_path} → ${output_path}`);
                    try {
                        Blockbench.readFile([input_path], {}, (files) => {
                            try {
                                //@ts-expect-error: Missing in type --- IGNORE ---
                                loadModelFile(files[0], []);

                                const reexport_content = Format.codec!.compile();

                                fs.writeFileSync(output_path, reexport_content, 'utf-8');
                                console.log(`Reexported: ${test_file}`);
                            } catch (inner) {
                                console.error(`Error inside callback for ${test_file}:`, inner);
                            }
                        });
                    } catch (e) {
                        console.error(`Error reexporting ${test_file}:`, e);
                    }
                }
            }
        }).show();
    }
});
MenuBar.addAction(reExportAction, "file");

const debugAction = createAction(`${PACKAGE.name}:printDebug`, {
    name: 'Print Debug Info',
    icon: 'icon',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        console.log(Outliner.selected);
    }
});
MenuBar.addAction(debugAction, "edit");

// ---- Round-Trip Diff Test ----

const FLOAT_EPSILON = 0.001;

/**
 * Checks if a value is "empty" in the VS format sense (equivalent to being absent).
 */
function isVsEmpty(val: unknown): boolean {
    if (val === undefined || val === null) return true;
    if (val === false) return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (typeof val === 'object' && val !== null && Object.keys(val).length === 0) return true;
    // [0,0] uv is equivalent to absent
    if (Array.isArray(val) && val.length === 2 && val[0] === 0 && val[1] === 0) return true;
    return false;
}

/** Keys where VS treats missing and empty/default as equivalent */
const VS_EMPTY_EQUIVALENT_KEYS = new Set([
    'faces', 'children', 'attachmentpoints', 'uv', 'autoUnwrap',
    'disableRandomDrawOffset'
]);

/**
 * Deep-compare two JSON values and return a list of human-readable diff descriptions.
 */
function deepCompare(a: unknown, b: unknown, path: string): string[] {
    const diffs: string[] = [];

    if (a === b) return diffs;
    if (a === undefined && b === undefined) return diffs;
    if (a === null && b === null) return diffs;

    // One is null/undefined but not the other
    if (a == null || b == null) {
        diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        return diffs;
    }

    // Both are numbers — use epsilon comparison
    if (typeof a === 'number' && typeof b === 'number') {
        if (Math.abs(a - b) > FLOAT_EPSILON) {
            diffs.push(`${path}: ${a} vs ${b}`);
        }
        return diffs;
    }

    // Type mismatch
    if (typeof a !== typeof b) {
        diffs.push(`${path}: type ${typeof a} vs ${typeof b} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
        return diffs;
    }

    // Both are arrays
    if (Array.isArray(a) && Array.isArray(b)) {
        const maxLen = Math.max(a.length, b.length);
        if (a.length !== b.length) {
            diffs.push(`${path}: array length ${a.length} vs ${b.length}`);
        }
        for (let i = 0; i < maxLen; i++) {
            diffs.push(...deepCompare(a[i], b[i], `${path}[${i}]`));
        }
        return diffs;
    }

    // Both are objects
    if (typeof a === 'object' && typeof b === 'object') {
        const aObj = a as Record<string, unknown>;
        const bObj = b as Record<string, unknown>;
        const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
        for (const key of allKeys) {
            // Skip keys where both values are VS-empty (equivalent defaults)
            if (VS_EMPTY_EQUIVALENT_KEYS.has(key) && isVsEmpty(aObj[key]) && isVsEmpty(bObj[key])) {
                continue;
            }
            diffs.push(...deepCompare(aObj[key], bObj[key], `${path}.${key}`));
        }
        return diffs;
    }

    // Strings that are both numeric — compare as numbers (e.g. "0.0" vs "0")
    if (typeof a === 'string' && typeof b === 'string') {
        const aNum = Number(a);
        const bNum = Number(b);
        if (!isNaN(aNum) && !isNaN(bNum)) {
            if (Math.abs(aNum - bNum) > FLOAT_EPSILON) {
                diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
            }
            return diffs;
        }
    }

    // Primitives (string, boolean)
    if (a !== b) {
        diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }

    return diffs;
}

const roundTripDiffAction = createAction(`${PACKAGE.name}:roundTripDiff`, {
    name: 'Round-Trip Diff Test',
    icon: 'fa-rotate',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        new Dialog("roundtrip_diff", {
            title: "Round-Trip Diff Test",
            form: {
                select_folder: {
                    label: "Select Folder to test",
                    description: "Imports each VS shape file, re-exports it, and compares the JSON. Differences are logged to the console (F12).",
                    type: "folder",
                }
            },
            onConfirm(form_result) {
                const test_folder = form_result.select_folder;
                const test_files: string[] = fs.readdirSync(test_folder, { encoding: "utf-8" });
                let totalFiles = 0;
                let totalDiffs = 0;

                for (const test_file of test_files) {
                    if (!test_file.endsWith('.json') || test_file.includes('reexport_')) continue;

                    const input_path = path.resolve(test_folder, test_file);
                    if (!fs.statSync(input_path).isFile()) continue;

                    try {
                        const originalContent = fs.readFileSync(input_path, 'utf-8');
                        const originalJson = JSON5.parse(originalContent);

                        // Skip non-VS shape files
                        if (!originalJson.elements || !originalJson.textures) continue;

                        totalFiles++;

                        Blockbench.readFile([input_path], {}, (files) => {
                            //@ts-expect-error: Missing in type --- IGNORE ---
                            loadModelFile(files[0], []);

                            const reexportContent = Format.codec!.compile();
                            const reexportJson = JSON.parse(reexportContent);

                            // Compare, ignoring the editor section (not a round-trip concern)
                            const originalForCompare = { ...originalJson };
                            const reexportForCompare = { ...reexportJson };
                            delete originalForCompare.editor;
                            delete reexportForCompare.editor;

                            // Compare animations by name instead of index
                            if (originalForCompare.animations) {
                                const animMap: Record<string, unknown> = {};
                                for (const a of originalForCompare.animations) animMap[a.name] = a;
                                originalForCompare.animations = animMap;
                            }
                            if (reexportForCompare.animations) {
                                const animMap: Record<string, unknown> = {};
                                for (const a of reexportForCompare.animations) animMap[a.name] = a;
                                reexportForCompare.animations = animMap;
                            }

                            const diffs = deepCompare(originalForCompare, reexportForCompare, '$');

                            if (diffs.length > 0) {
                                totalDiffs += diffs.length;
                                console.group(`%c DIFFS in ${test_file} (${diffs.length} differences)`, 'color: orange; font-weight: bold');
                                for (const diff of diffs.slice(0, 50)) {
                                    console.warn(`  ${diff}`);
                                }
                                if (diffs.length > 50) {
                                    console.warn(`  ... and ${diffs.length - 50} more`);
                                }
                                console.groupEnd();
                            } else {
                                console.log(`%c OK: ${test_file}`, 'color: green');
                            }
                        });
                    } catch (e) {
                        console.error(`Error testing ${test_file}:`, e);
                    }
                }

                // Summary (logged after loop, but files process async so counts may lag)
                console.log(`%c Round-trip test complete: ${totalFiles} files tested`, 'font-weight: bold');
            }
        }).show();
    }
});
MenuBar.addAction(roundTripDiffAction, "file");
