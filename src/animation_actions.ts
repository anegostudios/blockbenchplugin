import { createAction } from "./util/moddingTools";
import * as PACKAGE from "../package.json";
import { is_vs_project } from "./util";
import { clear_animations } from "./import_animation";
import { relink_particle_previews } from "./animation_particles";

// Importing and exporting VS animation files is handled natively by the multi-file
// animation workflow (format `animation_files` + the VS AnimationCodec): use the
// ANIMATIONS panel's Import Animations / Save / Save All. Only the bulk-clear helper
// remains as a convenience action here.

const clear_animations_action = createAction(`${PACKAGE.name}:clear_animations_vs`, {
    name: 'Clear All Animations',
    icon: 'delete_sweep',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        const total = Blockbench.Animation.all.length;
        if (total === 0) {
            Blockbench.showQuickMessage('No animations to clear');
            return;
        }
        if (!confirm(`Delete all ${total} animation${total === 1 ? '' : 's'} from this project?\n\nThis can be undone with Ctrl+Z.`)) {
            return;
        }
        const removed = clear_animations();
        Blockbench.showQuickMessage(`Cleared ${removed} animation${removed === 1 ? '' : 's'}`);
    }
});
MenuBar.addAction(clear_animations_action, 'edit');

// Particle keyframes only preview once their effect code has been resolved to a Snowstorm
// emitter file. Import does that automatically; this re-runs it for hand-authored keyframes
// and for effects added to the assets folder since the model was opened.
const reload_vfx_action = createAction(`${PACKAGE.name}:reload_vfx_previews`, {
    name: 'Reload VFX Previews',
    icon: 'auto_awesome',
    condition() {
        return is_vs_project(Project);
    },
    click: function () {
        const linked = relink_particle_previews();
        Blockbench.showQuickMessage(
            linked === 0
                ? 'No particle effects could be resolved'
                : `Linked ${linked} particle keyframe${linked === 1 ? '' : 's'}`
        );
    }
});
MenuBar.addAction(reload_vfx_action, 'animation');
