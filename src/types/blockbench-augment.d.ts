/**
 * Ambient augmentations for Blockbench globals that the installed `blockbench-types`
 * (SnaveSutit fork) predates. Blockbench 5 exposes a pluggable `AnimationCodec`
 * (js/animations/animation_codec.ts, attached to `window`) and reads
 * `Format.animation_codec` first in `AnimationCodec.getCodec()`. See
 * https://github.com/JannisX11/blockbench/blob/master/js/animations/animation_codec.ts
 */

import type { VS_Animation } from '../vs_shape_def';

declare global {
    interface _Animation {
        vs_code?: string;
        vs_onActivityStopped?: VS_Animation['onActivityStopped'] | '';
        vs_onAnimationEnd?: VS_Animation['onAnimationEnd'] | '';
        vs_library_ref?: string;
    }

    /** The file-like object handed to `AnimationCodec.loadFile`. */
    interface AnimationCodecFile {
        path: string;
        content?: string | ArrayBuffer;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        json?: any;
    }

    interface AnimationCodecOptions {
        multiple_per_file?: boolean;
        pickFile?(): void;
        importFile?(file: AnimationCodecFile, auto_loaded?: boolean): _Animation[];
        loadFile?(file: AnimationCodecFile, animation_filter?: string[]): _Animation[];
        reloadFile?(path: string): void;
        reloadAnimation?(animation: _Animation): void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compileAnimation?(animation: _Animation): any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compileFile?(animations: _Animation[]): any;
        saveAnimation?(animation: _Animation, save_as?: boolean): void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        exportFile?(...args: any[]): void;
        deleteAnimationFromFile?(animation: _Animation): void;
    }

    class AnimationCodec {
        constructor(id: string, options: AnimationCodecOptions);
        id: string;
        multiple_per_file: boolean;
        loadFile(file: AnimationCodecFile, animation_filter?: string[]): _Animation[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compileAnimation(animation: _Animation): any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compileFile(animations: _Animation[]): any;
        saveAnimation(animation: _Animation, save_as?: boolean): void;
        static codecs: Record<string, AnimationCodec>;
        static getCodec(animation?: AnimationItem): AnimationCodec;
    }

    interface FormatOptions {
        animation_codec?: AnimationCodec;
    }

    interface ModelFormat {
        animation_codec?: AnimationCodec;
    }

    /**
     * Blockbench's desktop-only escape hatch to Node's require. Missing from blockbench-types,
     * so every call site otherwise needs its own @ts-expect-error.
     */
    function requireNativeModule(name: 'fs'): typeof import('fs');
    function requireNativeModule(name: 'path'): typeof import('path');
    function requireNativeModule(name: string): any;
}

export {};
