import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";
import { is_vs_project } from "../util";
import { ensure_particle_links } from "../animation_particles";
import { ensure_sound_links } from "../animation_sounds";

const rewound = new WeakSet<object>();

function is_end_of_single_shot(animator: any): boolean {
    const animation = animator.animation;
    if (!animation || animation.loop !== 'once' || animation.time > 0) {
        rewound.delete(animator);
        return false;
    }
    if (animator.last_displayed_time > 0) rewound.add(animator);
    return rewound.has(animator);
}

createBlockbenchMod(`${PACKAGE.name}:effect_animator_mod`,
    {
        original: Blockbench.EffectAnimator.prototype.displayFrame
    },
    inject_context => {
        Blockbench.EffectAnimator.prototype.displayFrame = function (this: EffectAnimator, in_loop?: boolean) {
            if (!is_vs_project(Project)) {
                return inject_context.original.call(this, in_loop);
            }

            ensure_particle_links(this);
            ensure_sound_links(this);

            if (!is_end_of_single_shot(this)) {
                return inject_context.original.call(this, in_loop);
            }

            const muted = (this as any).muted;
            const previous = { sound: muted.sound, particle: muted.particle };
            muted.sound = true;
            muted.particle = true;
            try {
                return inject_context.original.call(this, in_loop);
            } finally {
                muted.sound = previous.sound;
                muted.particle = previous.particle;
            }
        };
        return inject_context;
    },
    extract_context => {
        Blockbench.EffectAnimator.prototype.displayFrame = extract_context.original;
    }
);
