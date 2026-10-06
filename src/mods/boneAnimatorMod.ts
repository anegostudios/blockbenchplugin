import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { fps, is_vs_project } from "../util";

declare const THREE: typeof import('three');

createBlockbenchMod(
    `${PACKAGE.name}:bone_animator_mod`,
    {
        original: Blockbench.BoneAnimator.prototype.displayFrame,
        original_interpolate: Blockbench.BoneAnimator.prototype.interpolate
    },
    context => {
        Blockbench.BoneAnimator.prototype.interpolate = function (this: BoneAnimator, channel, allow_expression, axis) {
            const animation = this.animation;
            const keys = this[channel] as _Keyframe[];
            const length = animation.length;
            if (!is_vs_project(Project) || !length || keys.length < 2) {
                return context.original_interpolate.call(this, channel, allow_expression, axis);
            }

            const lastFrameTime = Math.max(0, Math.round(length * fps) - 1) / fps;
            const time = animation.loop === 'loop' ? animation.time : Math.min(animation.time, lastFrameTime);
            const times = keys.map(key => key.time);
            const outsideKeys = time < Math.min(...times) || time > Math.max(...times);
            if (!outsideKeys && time === animation.time) {
                return context.original_interpolate.call(this, channel, allow_expression, axis);
            }

            const preview = Object.create(this) as BoneAnimator;
            preview.animation = Object.create(animation, { time: { value: time } });
            if (outsideKeys) {
                const shifted = (offset: number) => keys.map(key =>
                    Object.create(key, { time: { value: key.time + offset } })
                );
                preview[channel] = [...shifted(-length), ...keys, ...shifted(length)];
            }
            return context.original_interpolate.call(preview, channel, allow_expression, axis);
        };

        Blockbench.BoneAnimator.prototype.displayFrame = function (this: BoneAnimator, multiplier = 1) {
            if (!is_vs_project(Project)) return context.original.call(this, multiplier);
            if (!this.doRender()) return;
            this.getGroup();
            //@ts-expect-error: Missing in type --- IGNORE ---
            Animator.MolangParser.context.animation = this.animation;

            //@ts-expect-error: Copied from blockbench itself, so it should work :P
            if (!this.muted.rotation) this.displayRotation(this.interpolate('rotation'), multiplier);
            //@ts-expect-error: Copied from blockbench itself, so it should work :P
            if (!this.muted.scale) this.displayScale(this.interpolate('scale'), multiplier);

            const position = this.interpolate('position');
            if (!this.muted.position && position) {
                const mesh = this.group.mesh;
                const offset = new THREE.Vector3().fromArray(position)
                    .multiply(mesh.scale)
                    .applyQuaternion(mesh.quaternion);
                this.displayPosition(offset.toArray(), multiplier);
            }
        };
        return context;
    },
    context => {
        Blockbench.BoneAnimator.prototype.displayFrame = context.original;
        Blockbench.BoneAnimator.prototype.interpolate = context.original_interpolate;
    }
);
