import { codecVS } from "./codec";
import { vsAnimationCodec } from "./animation_codec";

export function create_format(): ModelFormat { 
    const format =  new ModelFormat("formatVS", {
        name: "Vintage Story Base Format",
        codec: codecVS,
        icon: "icon.png",
        box_uv: false,
        optional_box_uv: false,
        single_texture: false,
        single_texture_default: false,
        per_group_texture: false,
        per_texture_uv_size: true,
        model_identifier: false,
        legacy_editable_file_name: false,
        parent_model_id: false, //Use this for backdrops? false for now
        vertex_color_ambient_occlusion: false,
        animated_textures: false, // NOt sure if supported by VS
        bone_rig: true,
        centered_grid: true,
        rotate_cubes: true,
        stretch_cubes: false,
        integer_size: false,
        meshes: false,
        texture_meshes: false,
        locators: true,
        null_object: true,
        rotation_limit: false,
        rotation_snap: false,
        uv_rotation: true,
        java_face_properties: false,
        select_texture_for_particles: false,
        texture_mcmeta: false,
        bone_binding_expression: false, // Revisit for animation
        // Enables Blockbench's multi-file animation workflow: per-animation `path`/`saved_name`,
        // grouping by file in the ANIMATIONS panel, and per-file Save / Save All / Import.
        animation_files: true,
        texture_folder: true,
        image_editor: false, // Setting this to true removes the object outliner?!?!
        edit_mode: true,
        paint_mode: true,
        display_mode: false, // Only some Minecraft Skin stuff it seems
        animation_mode: true,
        pose_mode: false,
        animation_controllers: false, // VS has no animation-controller concept

        box_uv_float_size: false,
        java_cube_shading_properties: false,
        cullfaces: false, // Not sure if Vintage Story supports this
        render_sides: "double",
        //@ts-expect-error: Missing in type --- IGNORE ---
        euler_order: "XYZ",
        animation_loop_wrapping: true,
        quaternion_interpolation: false,
        per_animator_rotation_interpolation: false,
    });
    codecVS.format = format;
    // Route animation save/load/compile through the VS library codec (AnimationCodec.getCodec
    // checks Format.animation_codec first), so files use the VS format, not Bedrock's.
    // vsAnimationCodec is undefined on Blockbench builds without the AnimationCodec API.
    if (vsAnimationCodec) format.animation_codec = vsAnimationCodec;
    return format;
};