import { createBlockbenchMod } from "../util/moddingTools";
import * as PACKAGE from "../../package.json";

const WIND_MODE_OPTIONS: Record<string, string> = {
    '-1': 'Default',
    '0': 'NoWind',
    '1': 'WeakWind',
    '2': 'NormalWind',
    '3': 'Leaves',
    '4': 'Bend',
    '5': 'TallBend',
    '6': 'Water',
    '7': 'ExtraWeakWind',
    '8': 'Fruit',
    '9': 'WeakWindNoBend',
    '10': 'Vines',
    '11': 'Seaweed',
    '12': 'WaterWaves',
    '13': 'WeakWindReducedAlpha',
};

const REFLECTIVE_MODE_OPTIONS: Record<string, string> = {
    '0': 'Not reflective',
    '1': 'Weakly random reflective',
    '2': 'Weakly reflective',
    '3': 'Strongly reflective',
    '4': 'Sparkly',
    '5': 'Mild',
};

const FACE_DIRECTIONS = ['north', 'east', 'south', 'west', 'up', 'down'] as const;
const FACE_LABELS: Record<string, string> = {
    north: 'N',
    east: 'E',
    south: 'S',
    west: 'W',
    up: 'U',
    down: 'D',
};

// Colors matching VSMC Face.ColorsByFace * DefaultBlockSideBrightnessByFacing
const FACE_COLORS: Record<string, string> = {
    north: 'rgb(143,154,204)',
    east: 'rgb(204,143,143)',
    south: 'rgb(143,154,204)',
    west: 'rgb(204,143,143)',
    up: 'rgb(187,255,179)',
    down: 'rgb(131,179,125)',
};

/**
 * Returns the 4 vertex positions for a given face direction on a cube.
 * Order matches VS Model Creator's CubeVertices array (Face.java).
 * Maps unit cube (-1,-1,-1)→(1,1,1) to Blockbench cube from→to.
 */
function getFaceVertices(cube: Cube, direction: string): [number, number, number][] {
    const [x1, y1, z1] = cube.from;
    const [x2, y2, z2] = cube.to;

    switch (direction) {
        case 'north': return [[x1,y1,z1], [x1,y2,z1], [x2,y2,z1], [x2,y1,z1]];
        case 'east':  return [[x2,y1,z1], [x2,y2,z1], [x2,y2,z2], [x2,y1,z2]];
        case 'south': return [[x1,y1,z2], [x2,y1,z2], [x2,y2,z2], [x1,y2,z2]];
        case 'west':  return [[x1,y1,z1], [x1,y1,z2], [x1,y2,z2], [x1,y2,z1]];
        case 'up':    return [[x1,y2,z1], [x1,y2,z2], [x2,y2,z2], [x2,y2,z1]];
        case 'down':  return [[x1,y1,z1], [x2,y1,z1], [x2,y1,z2], [x1,y1,z2]];
        default:      return [[0,0,0], [0,0,0], [0,0,0], [0,0,0]];
    }
}

/**
 * Auto-compute wind data for a face from vertex world Y positions.
 * Matches VSMC FacePropertiesPanel.getWindData(): windData[i] = (int)(worldY / 16)
 */
function computeWindData(cube: Cube, direction: string): [number, number, number, number] {
    const vertices = getFaceVertices(cube, direction);
    const result: [number, number, number, number] = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
        const pos = vertices[i];
        const localPos = new THREE.Vector3(
            pos[0] - cube.origin[0],
            pos[1] - cube.origin[1],
            pos[2] - cube.origin[2]
        );

        if (cube.mesh) {
            cube.mesh.updateMatrixWorld();
            const worldPos = cube.mesh.localToWorld(localPos);
            result[i] = Math.trunc(worldPos.y / 16);
        } else {
            result[i] = Math.trunc(pos[1] / 16);
        }
    }
    return result;
}

// Vertex highlight dot — shared THREE.js objects
let vertexDot: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;

function createVertexDot() {
    if (vertexDot) return vertexDot;
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false, transparent: true, opacity: 0.9 });
    vertexDot = new THREE.Mesh(geo, mat);
    vertexDot.renderOrder = 999;
    vertexDot.visible = false;
    return vertexDot;
}

function showVertexDot(cube: Cube, direction: string, vertexIndex: number) {
    const dot = createVertexDot();
    const vertices = getFaceVertices(cube, direction);
    const pos = vertices[vertexIndex];
    if (!pos) return;

    const localPos = new THREE.Vector3(
        pos[0] - cube.origin[0],
        pos[1] - cube.origin[1],
        pos[2] - cube.origin[2]
    );

    if (cube.mesh) {
        cube.mesh.updateMatrixWorld();
        const worldPos = cube.mesh.localToWorld(localPos);
        dot.position.copy(worldPos);
    } else {
        dot.position.set(pos[0], pos[1], pos[2]);
    }

    dot.visible = true;

    if (!dot.parent) {
        Canvas.scene.add(dot);
    }
}

function hideVertexDot() {
    if (vertexDot) {
        vertexDot.visible = false;
    }
}

function removeVertexDot() {
    if (vertexDot) {
        if (vertexDot.parent) vertexDot.parent.remove(vertexDot);
        vertexDot.geometry.dispose();
        vertexDot.material.dispose();
        vertexDot = null;
    }
}

function createFacePanelData() {
    return {
        selectedCube: null as Cube | null,
        selectedFaceName: 'north' as CubeFaceDirection,
        applyToAll: false,
        glow: 0,
        reflectiveMode: '0',
        windMode: [-1, -1, -1, -1] as number[],
        windData: [0, 0, 0, 0] as number[],
        windModeOptions: WIND_MODE_OPTIONS,
        reflectiveModeOptions: REFLECTIVE_MODE_OPTIONS,
        faceDirections: FACE_DIRECTIONS,
        faceLabels: FACE_LABELS,
        faceColors: FACE_COLORS,
        _listeners: [] as Array<() => void>,
    };
}

const vueComponent = {
    template: `
        <div>
            <p v-if="!selectedCube" class="vs_fp_message">Select a cube to edit face properties</p>
            <div v-else>
                <div class="vs_fp_header">
                    <div class="vs_fp_face_buttons">
                        <div v-for="dir in faceDirections" :key="dir"
                            class="vs_fp_face_btn" :class="{ active: selectedFaceName === dir }"
                            :style="{ '--face-color': faceColors[dir] }"
                            @click="selectFace(dir)">{{ faceLabels[dir] }}</div>
                    </div>
                    <label class="vs_fp_apply_all">
                        <input type="checkbox" v-model="applyToAll"> All
                    </label>
                </div>

                <div class="vs_fp_section">
                    <label class="vs_fp_label">Glow Level (0-255)</label>
                    <input type="number" class="dark_bordered" min="0" max="255" step="1"
                        :value="glow" @input="setGlow($event.target.value)">
                </div>

                <div class="vs_fp_section">
                    <label class="vs_fp_label">Reflective Mode</label>
                    <select class="dark_bordered" :value="reflectiveMode" @change="setReflectiveMode($event.target.value)">
                        <option v-for="(label, value) in reflectiveModeOptions" :value="value" :key="value">{{ label }}</option>
                    </select>
                </div>

                <div class="vs_fp_section" v-for="i in 4" :key="'wm'+i">
                    <label class="vs_fp_label">Wind Mode {{ i }}</label>
                    <select class="dark_bordered" :value="getWindModeComponent(i-1)" @change="setWindModeComponent(i-1, $event.target.value)"
                        @mouseenter="highlightVertex(i-1)" @mouseleave="clearVertex()"
                        @focus="highlightVertex(i-1)" @blur="clearVertex()">
                        <option v-for="(label, value) in windModeOptions" :value="value" :key="value">{{ label }}</option>
                    </select>
                </div>

                <div class="vs_fp_section">
                    <label class="vs_fp_label">Wind Data</label>
                    <input type="text" class="dark_bordered" :value="windDataDisplay" disabled>
                </div>
            </div>
        </div>
    `,
    data: createFacePanelData,
    computed: {
        windDataDisplay(this: FacePanelContext): string {
            return this.windData.join(', ');
        }
    },
    methods: {
        getSelectedFace(this: FacePanelContext): CubeFace | null {
            if (!this.selectedCube || !this.selectedFaceName) return null;
            return this.selectedCube.faces[this.selectedFaceName];
        },

        getTargetFaces(this: FacePanelContext): Array<{ face: CubeFace, direction: CubeFaceDirection }> {
            const cube = this.selectedCube;
            if (!cube) return [];
            if (this.applyToAll) {
                return FACE_DIRECTIONS
                    .filter(d => cube.faces[d])
                    .map(d => ({ face: cube.faces[d], direction: d }));
            }
            const face = this.getSelectedFace();
            if (!face) return [];
            return [{ face, direction: this.selectedFaceName }];
        },

        selectFace(this: FacePanelContext, direction: CubeFaceDirection) {
            this.selectedFaceName = direction;
            this.loadFromFace();
        },

        highlightVertex(this: FacePanelContext, index: number) {
            if (this.selectedCube && this.selectedFaceName) {
                showVertexDot(this.selectedCube, this.selectedFaceName, index);
            }
        },

        clearVertex() {
            hideVertexDot();
        },

        setGlow(this: FacePanelContext, value: string) {
            const num = Math.max(0, Math.min(255, parseInt(value) || 0));
            this.glow = num;
            for (const { face } of this.getTargetFaces()) {
                face.glow = num;
            }
        },

        setReflectiveMode(this: FacePanelContext, value: string) {
            const num = parseInt(value) || 0;
            this.reflectiveMode = String(num);
            for (const { face } of this.getTargetFaces()) {
                face.reflectiveMode = num;
            }
        },

        getWindModeComponent(this: FacePanelContext, index: number): string {
            return String(this.windMode[index] ?? -1);
        },

        setWindModeComponent(this: FacePanelContext, index: number, value: string) {
            const num = parseInt(value);
            this.windMode[index] = num;
            // Force reactivity
            this.windMode = [...this.windMode];

            for (const { face, direction } of this.getTargetFaces()) {
                if (!face.windMode) {
                    face.windMode = [-1, -1, -1, -1];
                }
                face.windMode[index] = num;

                // Auto-compute wind data when wind mode changes (matching VSMC behavior)
                if (this.selectedCube) {
                    const autoData = computeWindData(this.selectedCube, direction);
                    if (autoData[0] !== 0 || autoData[1] !== 0 || autoData[2] !== 0 || autoData[3] !== 0) {
                        face.windData = autoData;
                    } else {
                        face.windData = undefined;
                    }
                }

                // If all components are default (-1), clear windMode
                if (face.windMode.every((v: number) => v === -1)) {
                    face.windMode = undefined;
                    face.windData = undefined;
                }
            }

            // Update wind data display
            this.updateWindDataDisplay();
        },

        updateWindDataDisplay(this: FacePanelContext) {
            const face = this.getSelectedFace();
            if (face && face.windData) {
                this.windData = [...face.windData];
            } else if (this.selectedCube && this.selectedFaceName) {
                this.windData = computeWindData(this.selectedCube, this.selectedFaceName);
            } else {
                this.windData = [0, 0, 0, 0];
            }
        },

        loadFromFace(this: FacePanelContext) {
            const face = this.getSelectedFace();
            if (!face) {
                this.glow = 0;
                this.reflectiveMode = '0';
                this.windMode = [-1, -1, -1, -1];
                this.windData = [0, 0, 0, 0];
                return;
            }
            this.glow = face.glow || 0;
            this.reflectiveMode = String(face.reflectiveMode || 0);
            this.windMode = face.windMode ? [...face.windMode] : [-1, -1, -1, -1];
            this.updateWindDataDisplay();
        },

        updateSelection(this: FacePanelContext) {
            hideVertexDot();

            const selected = Cube.selected;
            if (!selected || selected.length === 0) {
                this.selectedCube = null;
                this.selectedFaceName = 'north';
                return;
            }
            this.selectedCube = selected[0];
            this.loadFromFace();
        },
    },
    mounted(this: FacePanelContext) {
        this.updateSelection();

        const onSelectionUpdate = () => this.updateSelection();
        Blockbench.on('update_selection' as EventName, onSelectionUpdate);

        this._listeners = [
            () => Blockbench.removeListener('update_selection' as EventName, onSelectionUpdate),
        ];
    },
    beforeDestroy(this: FacePanelContext) {
        hideVertexDot();
        for (const unsub of this._listeners) {
            unsub();
        }
    }
};

interface FacePanelContext extends ReturnType<typeof createFacePanelData> {
    getSelectedFace(): CubeFace | null;
    getTargetFaces(): Array<{ face: CubeFace, direction: CubeFaceDirection }>;
    loadFromFace(): void;
    updateWindDataDisplay(): void;
    updateSelection(): void;
}

let panel: Panel | null = null;

createBlockbenchMod(
    `${PACKAGE.name}:vs_face_panel`,
    {},
    () => {
        panel = new Panel('vs_face_properties', {
            id: 'vs_face_properties',
            name: 'VS Face Properties',
            icon: 'grain',
            expand_button: false,
            default_side: 'right',
            condition: () => Format?.id === 'formatVS',
            default_position: {
                slot: 'right_bar',
                float_position: [0, 0],
                float_size: [300, 300],
                height: 300,
                folded: false
            },
            component: vueComponent
        });

        const style = document.createElement('style');
        style.id = 'vs-face-panel-styles';
        style.textContent = `
            .vs_fp_message {
                padding: 8px;
                color: var(--color-subtle_text);
                text-align: center;
            }
            .vs_fp_header {
                display: flex;
                align-items: center;
                padding: 4px 8px;
                border-bottom: 1px solid var(--color-border);
                margin-bottom: 6px;
                gap: 6px;
            }
            .vs_fp_face_buttons {
                display: flex;
                gap: 2px;
                flex: 1;
            }
            .vs_fp_face_btn {
                flex: 1;
                text-align: center;
                padding: 3px 0;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                border-radius: 3px;
                color: var(--face-color);
                background: var(--color-back);
                border: 1px solid var(--color-border);
                transition: background 0.1s;
            }
            .vs_fp_face_btn:hover {
                background: var(--color-button);
            }
            .vs_fp_face_btn.active {
                background: var(--color-button);
                border-color: var(--face-color);
                box-shadow: 0 0 0 1px var(--face-color);
            }
            .vs_fp_apply_all {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                cursor: pointer;
                white-space: nowrap;
            }
            .vs_fp_section {
                padding: 2px 8px;
                margin-bottom: 4px;
            }
            .vs_fp_label {
                display: block;
                font-size: 12px;
                color: var(--color-subtle_text);
                margin-bottom: 2px;
            }
            .vs_fp_section input[type="number"],
            .vs_fp_section input[type="text"],
            .vs_fp_section select {
                width: 100%;
                box-sizing: border-box;
            }
        `;
        document.head.appendChild(style);

        return { panel, style };
    },
    (context) => {
        context.panel?.delete();
        removeVertexDot();
        const style = document.getElementById('vs-face-panel-styles');
        if (style) style.remove();
    }
);
