import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";

declare const THREE: typeof import('three');

const AXES = ['x', 'y', 'z'] as const;

createBlockbenchMod(
    `${PACKAGE.name}:animation_transform_mod`,
    {
        module: TransformerModule.modules.animation,
        original: TransformerModule.modules.animation.onMove,
        original_gizmo: TransformerModule.modules.animation.updateGizmo
    },
    context => {
        context.module.updateGizmo = function (this: TransformerModule) {
            const result = context.original_gizmo.call(this);
            const mesh = Group.first_selected?.mesh;
            if (is_vs_project(Project) && Toolbox.selected.id === 'rotate_tool' && mesh) {
                Transformer.position.copy(mesh.parent!.localToWorld(mesh.fix_position!.clone()));
            }
            return result;
        };
        context.module.onMove = function (this: TransformerModule, ctx) {
            const tool = Toolbox.selected.id;
            const space = (BarItems[tool === 'rotate_tool' ? 'rotation_space' : 'transform_space'] as BarSelect<string>).get();
            const rotate = tool === 'rotate_tool' && space !== 'global' && (Transformer.axis as string) !== 'E';
            if (!is_vs_project(Project) || !(tool === 'move_tool' || rotate)) return context.original.call(this, ctx);

            const keyframe = Blockbench.Keyframe.selected[0];
            const mesh = (Group.first_selected ?? Outliner.selected[0]).mesh;
            const difference = ctx.value - this.previous_value;

            if (rotate) {
                const order = mesh.rotation.order;
                mesh.rotation.reorder((['ZYX', 'ZXY', 'XYZ'] as const)[ctx.axis_number]);
                mesh.rotation[ctx.axis] += Math.degToRad(Math.abs(difference) > 120 ? 0 : difference);
                mesh.rotation.reorder(order);
                const base = mesh.pre_rotation ?? mesh.fix_rotation!;
                for (const axis of AXES) {
                    keyframe.offset(axis, Math.roundTo(Math.trimDeg(Math.radToDeg(mesh.rotation[axis] - base[axis]) - keyframe.calc(axis)), 4));
                }
                Blockbench.setCursorTooltip(trimFloatNumber(ctx.value - this.initial_value));
            } else {
                context.original.call(this, ctx);
                const parent = new THREE.Vector3();
                parent[ctx.axis] = difference;
                if (space === 'global') parent.applyQuaternion(mesh.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
                if (space === 'local') parent.applyQuaternion(mesh.quaternion);
                const local = parent.clone().applyQuaternion(mesh.quaternion.clone().invert());
                for (const axis of AXES) keyframe.offset(axis, local[axis] - parent[axis]);
            }
            Animator.preview();
        };
        return context;
    },
    context => {
        context.module.onMove = context.original;
        context.module.updateGizmo = context.original_gizmo;
    }
);
