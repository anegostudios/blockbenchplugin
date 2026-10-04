import { VS_Shape } from "./vs_shape_def";

import {traverse} from "./import_model/traverse";
import { expand_complex_elements} from "./transform";

declare var Settings: any;

export interface ImportModelOptions {
    /** Overrides the normal model-centering offset for this import. */
    rootOffset?: [number, number, number];
}

/**
 * Recursively traverses the Vintage Story element tree and creates Blockbench groups and cubes.
 * @param shape The VS_Shape object which elements should be imported
 * @param asBackdrop Whether to import the model as a backdrop.
 * @param filePath The path to the file being imported (for clothing slot inference)
 */
export function import_model(shape: VS_Shape, asBackdrop: boolean, filePath?: string, options: ImportModelOptions = {}) {

    const expanded =  expand_complex_elements(shape);

    // Reverse the [8, 0, 8] offset that export applies to root elements
    const applyOffset = Settings.get("vs_apply_model_offset") ?? true;
    const configuredOffset: [number,number,number] = applyOffset ? [-8, 0, -8] : [0, 0, 0];
    const offset = options.rootOffset ?? configuredOffset;

    traverse(null, offset, expanded.elements, asBackdrop, filePath);
}
