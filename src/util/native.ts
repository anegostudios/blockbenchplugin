type FsModule = typeof import('fs');

let fs_module: FsModule | undefined;
let fs_denied = false;

function load_fs(): FsModule {
    if (!fs_module && !fs_denied) {
        fs_module = requireNativeModule('fs');
        fs_denied = !fs_module;
    }
    if (!fs_module) throw new Error('File system access was denied. Reload the plugin to grant it.');
    return fs_module;
}

export const fs = new Proxy({} as FsModule, {
    get: (_target, key) => Reflect.get(load_fs(), key),
});

let env_game_path: string | undefined | null = null;

function get_env_game_path(): string | undefined {
    if (env_game_path === null) {
        env_game_path = requireNativeModule('process', {
            message: 'Reads the VINTAGE_STORY environment variable to find your game folder.',
        })?.env.VINTAGE_STORY;
    }
    return env_game_path;
}

export function get_game_path(): string {
    return Settings.get('game_path') || get_env_game_path() || '';
}
