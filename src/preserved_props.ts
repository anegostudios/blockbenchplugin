import { VS_CUBE_PROPS, VS_FACE_PROPS, VS_GROUP_PROPS, VS_PROJECT_PROPS } from "./property";

function clone_json<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    try {
        return structuredClone(value);
    } catch {
        return JSON.parse(JSON.stringify(value));
    }
}

function prop_names(props: Array<{ name: string }>): string[] {
    return props.map(prop => prop.name);
}

function is_empty_record(value: unknown): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

const ELEMENT_STRUCTURAL_KEYS = [
    'name', 'from', 'to', 'uv',
    'rotationOrigin', 'rotationX', 'rotationY', 'rotationZ',
    'faces', 'children', 'attachmentpoints',
];

const FACE_STRUCTURAL_KEYS = ['texture', 'uv', 'rotation', 'enabled'];

const FACE_UNTRACKED_KEYS = new Set(['texture', 'rotation']);
const ELEMENT_UNTRACKED_KEYS = new Set(
    ELEMENT_STRUCTURAL_KEYS.filter(key => !['rotationX', 'rotationY', 'rotationZ'].includes(key))
);

const ELEMENT_KNOWN_KEYS = new Set([
    ...ELEMENT_STRUCTURAL_KEYS,
    ...prop_names(VS_CUBE_PROPS),
    ...prop_names(VS_GROUP_PROPS),
]);

const FACE_KNOWN_KEYS = new Set([
    ...FACE_STRUCTURAL_KEYS,
    ...prop_names(VS_FACE_PROPS),
]);

const SHAPE_KNOWN_KEYS = new Set([
    'editor', 'textureWidth', 'textureHeight', 'textureSizes',
    'textures', 'elements', 'animations', 'animationLibraries',
]);

const ATTACHMENT_POINT_KNOWN_KEYS = new Set([
    'code', 'posX', 'posY', 'posZ', 'rotationX', 'rotationY', 'rotationZ',
]);

function editor_known_keys(): Set<string> {
    return new Set(prop_names(VS_PROJECT_PROPS));
}

function is_dropped_element_value(name: string, value: unknown, on_group: boolean): boolean {
    if (name === 'shade') return on_group || value !== false;
    if (name === 'faces') return on_group && is_empty_record(value);
    if (ELEMENT_UNTRACKED_KEYS.has(name)) return false;
    if (name === 'rotationX' || name === 'rotationY' || name === 'rotationZ') return Number(value) === 0;
    if (value === undefined || value === null || value === '' || value === false) return true;
    if (name === 'renderPass') return Number(value) === -1;
    if (name === 'unwrapMode' || name === 'unwrapRotation' || name === 'paletteSlot') {
        return Number(value) === 0;
    }
    return false;
}

function is_dropped_face_value(name: string, value: unknown): boolean {
    if (FACE_UNTRACKED_KEYS.has(name)) return false;
    if (name === 'enabled') return value !== false;
    if (value === undefined || value === null || value === '' || value === false) return true;
    if (name === 'windMode') return Array.isArray(value) && value.every(v => v === -1);
    if (name === 'windData' || name === 'uv') return Array.isArray(value) && value.every(v => v === 0);
    if (typeof value === 'number') return value === 0;
    return false;
}

export type ExtraProps = Record<string, unknown>;

export function collect_extras(
    source: unknown,
    known: Set<string>,
    is_dropped?: (name: string, value: unknown) => boolean,
): ExtraProps | undefined {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;

    let extras: ExtraProps | undefined;
    for (const [key, value] of Object.entries(source as ExtraProps)) {
        if (value === undefined) continue;
        if (known.has(key) && !(is_dropped && is_dropped(key, value))) continue;
        if (!extras) extras = {};
        extras[key] = clone_json(value);
    }
    return extras;
}

export function collect_element_extras(element: unknown, on_group = false): ExtraProps | undefined {
    return collect_extras(element, ELEMENT_KNOWN_KEYS, (name, value) => is_dropped_element_value(name, value, on_group));
}

export function collect_face_extras(face: unknown): ExtraProps | undefined {
    return collect_extras(face, FACE_KNOWN_KEYS, is_dropped_face_value);
}

export function collect_shape_extras(shape: unknown): ExtraProps | undefined {
    return collect_extras(shape, SHAPE_KNOWN_KEYS);
}

export function collect_editor_extras(editor: unknown): ExtraProps | undefined {
    return collect_extras(editor, editor_known_keys());
}

export function collect_attachment_point_extras(point: unknown): ExtraProps | undefined {
    return collect_extras(point, ATTACHMENT_POINT_KNOWN_KEYS);
}

export function apply_extra_props<T extends object>(target: T, extras: unknown): T {
    if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return target;

    const record = target as unknown as ExtraProps;
    for (const [key, value] of Object.entries(extras as ExtraProps)) {
        if (value === undefined) continue;
        if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) continue;
        record[key] = clone_json(value);
    }
    return target;
}
