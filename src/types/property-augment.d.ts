/**
 * blockbench-types omits `PropertyOptions.inputs` (which Blockbench uses to render a property
 * as a field in the element panel) and `PropertyOptions.onChange`. Declared here so the VS
 * property definitions typecheck.
 */

interface PropertyPanelInput {
    label?: string;
    type?: string;
    options?: Record<string, string> | (() => Record<string, string>);
}

declare global {
    interface PropertyOptions {
        inputs?: Record<string, { input: PropertyPanelInput }>;
        onChange?(this: any, value?: any): void;
    }

    interface Property<T extends PropertyType> {
        /**
         * Copies this property's value from an instance onto a plain object. blockbench-types
         * types both sides as the property's own value type, but the target is a bag of fields.
         */
        copy(instance: any, target: any): void;
    }

    /**
     * Format flags Blockbench supports but blockbench-types omits. Object literals are checked
     * for excess properties, and TypeScript only reports the first unknown key, so a single
     * missing declaration hides every later one in the same literal.
     */
    interface FormatOptions {
        /** Whether the format supports null objects (locators' animated cousins). */
        null_object?: boolean;
        /** Rotation order the format's transforms are composed in. */
        euler_order?: string;
        animation_loop_wrapping?: boolean;
        quaternion_interpolation?: boolean;
        per_animator_rotation_interpolation?: boolean;
    }

    interface OutlinerNode {
        addTo(target?: OutlinerNode | null): this;
    }

    interface Locator {
        position?: ArrayVector3;
        /**
         * VS stores a locator's position in `from`, mirroring its elements. Blockbench's own
         * locators use `position`, which the export falls back to.
         */
        from?: ArrayVector3;
    }
}

export {};
