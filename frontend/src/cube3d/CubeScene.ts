import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { MAX_M } from '@/domain/constants';
import { isAnimated, samplePathPolyline } from '@/domain/motion';
import { isShownInCube, isSilenced, soloActive } from '@/domain/tracks';
import type { Track, Vec3 } from '@/domain/types';
import { AXIS_ENDS } from '@/domain/views';
import { isZoomWheel, wheelDeltaPixels } from '@/lib/cubeZoom';
import { layoutLabels, type Box } from '@/lib/labelLayout';

import {
  cameraDistance,
  clampToCube,
  distanceFromListener,
  dropOnViewPlane,
  FOV_DEGREES,
  gizmoTarget,
  HOME_DIRECTION,
  type GizmoTarget,
} from './geometry';

export interface CubeSceneModel {
  tracks: readonly Track[];
  selectedTrackId: string | null;
  editingTrackId: string | null;
}

export interface CubeSceneHandlers {
  selectTrack(trackId: string): void;
  movePosition(trackId: string, position: Vec3): void;
  movePathPoint(trackId: string, index: number, position: Vec3): void;
  addPathPoint(trackId: string, position: Vec3): void;
  /** Shift + wheel over the view, in wheel pixels. */
  wheelZoom(deltaPixels: number): void;
}

// Keep in sync with the tokens in globals.css.
const WELL = '#0A0E0C';
const GRID = '#1B2621';
const EDGES = '#2E3D37';
const LISTENER = '#8C9A93';
/** Blender's axis colours: the red / green / blue of the move arrows, readable on a dark room. */
const AXIS_COLOR = { x: '#FF3352', y: '#8BDC00', z: '#2890FF' } as const;
const ACTIVE_HANDLE = '#FFE14D';

const BALL_RADIUS = 0.36;
/** Pointer travel below which a press counts as a click rather than an orbit. */
const CLICK_SLOP = 4;

interface SourceParts {
  color: string;
  group: Group;
  ball: Mesh<SphereGeometry, MeshStandardMaterial>;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
  stem: Line<BufferGeometry, LineBasicMaterial>;
  foot: Mesh<RingGeometry, MeshBasicMaterial>;
  label: HTMLDivElement;
  name: HTMLSpanElement;
  distance: HTMLSpanElement;
}

interface Tag {
  el: HTMLElement;
  at: Vector3;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function round3(p: Vec3): Vec3 {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r(p.x), y: r(p.y), z: r(p.z) };
}

function disposeTree(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/**
 * The free-orbit 3D view of the cube. Imperative and outside React, like the audio engine: the
 * camera, the controls and the per-frame label placement change far too often to go through
 * state.
 *
 * Interaction, Blender-style: drag empty space (or middle-drag) to orbit, Shift + drag or
 * right-drag to pan, Shift + wheel to zoom. Clicking a source selects it and puts the move
 * arrows on it — red X, green Y, blue Z; dragging an arrow moves along that axis only. A source
 * on a path is moved through its keyframes instead: click one to put the arrows on it.
 *
 * Renders on demand: only when the camera, the arrows, the model or a moving source changed.
 */
export class CubeScene {
  private readonly renderer: WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.1, 200);
  private readonly gizmo: TransformControls;
  private readonly orbit: OrbitControls;
  private readonly raycaster = new Raycaster();
  /** What the arrows move; its position is copied back into the store on every drag step. */
  private readonly proxy = new Object3D();

  private readonly ballGeometry = new SphereGeometry(BALL_RADIUS, 32, 16);
  private readonly ringGeometry = new RingGeometry(BALL_RADIUS + 0.16, BALL_RADIUS + 0.22, 48);
  private readonly footGeometry = new RingGeometry(0.1, 0.16, 24);
  private readonly keyframeGeometry = new OctahedronGeometry(0.17);
  private readonly keyframeEdges = new EdgesGeometry(this.keyframeGeometry);

  private readonly sourcesGroup = new Group();
  private readonly pathsGroup = new Group();
  private readonly sources = new Map<string, SourceParts>();
  private keyframeMeshes: Mesh[] = [];
  private keyframeTags: Tag[] = [];
  private readonly fixedTags: Tag[] = [];
  private pathSignature = '';

  private model: CubeSceneModel = { tracks: [], selectedTrackId: null, editingTrackId: null };
  private selectedId: string | null = null;
  /** The selected path's keyframe under the arrows, if any. */
  private keyframe: number | null = null;
  private target: GizmoTarget = null;
  /** Latest positions of moving sources, from the frame loop. */
  private readonly live = new Map<string, Vec3>();

  private zoom = 1;
  private width = 1;
  private height = 1;
  private dirty = true;
  private frame = 0;
  private press: { x: number; y: number; onGizmo: boolean; button: number } | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    private readonly labelLayer: HTMLElement,
    private readonly handlers: CubeSceneHandlers,
  ) {
    // Throws when WebGL is unavailable; the caller shows a message instead of the view.
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(WELL);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'cube3d-canvas';
    host.prepend(this.canvas);

    this.scene.add(new HemisphereLight(0xffffff, 0x1a2420, 2.4));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    this.scene.add(this.buildRoom(), this.buildListener(), this.sourcesGroup, this.pathsGroup, this.proxy);
    this.placeCamera(cameraDistance(1));

    // The arrows before the orbit: their pointerdown must run first, so grabbing an arrow can
    // switch the orbit off before it starts turning the camera.
    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setMode('translate');
    this.gizmo.setSpace('world');
    this.gizmo.setColors(AXIS_COLOR.x, AXIS_COLOR.y, AXIS_COLOR.z, ACTIVE_HANDLE);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
    });
    this.gizmo.addEventListener('objectChange', this.onGizmoMove);
    this.gizmo.addEventListener('change', this.markDirty);

    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    // Shift + wheel zooms instead, as in the flat views, so a plain wheel still scrolls the page.
    this.orbit.enableZoom = false;
    this.orbit.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN };
    this.orbit.addEventListener('change', this.markDirty);
    this.orbit.addEventListener('start', () => this.setCursor('grabbing'));

    // After both controls, so these see whether the arrows took the press.
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.buildFixedTags();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.exposeForTests();
    this.frame = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------------ public

  update(model: CubeSceneModel): void {
    this.model = model;
    if (model.selectedTrackId !== this.selectedId) {
      this.selectedId = model.selectedTrackId;
      this.keyframe = null;
    }

    const solo = soloActive(model.tracks);
    const shown = model.tracks.filter(isShownInCube);
    const shownIds = new Set(shown.map((t) => t.id));
    for (const id of [...this.sources.keys()]) if (!shownIds.has(id)) this.removeSource(id);

    for (const track of shown) {
      const parts = this.sources.get(track.id) ?? this.addSource(track);
      if (parts.color !== track.color) this.recolor(parts, track.color);
      const moving = isAnimated(track.motionMode, track.path);
      if (!moving) this.live.delete(track.id);
      this.placeSource(parts, moving ? (this.live.get(track.id) ?? track.position) : track.position);

      parts.ring.visible = track.id === model.selectedTrackId;
      const silent = isSilenced(track, solo);
      parts.ball.material.transparent = silent;
      parts.ball.material.opacity = silent ? 0.35 : 1;
      parts.label.classList.toggle('silent', silent);
      parts.name.textContent = track.name;
    }

    this.rebuildPaths(shown);
    this.syncGizmo();
    this.dirty = true;
  }

  /** Moves automated sources; called every frame by the console's animation loop. */
  applyLivePositions(positions: Map<string, Vec3>): void {
    let changed = false;
    for (const [id, p] of positions) {
      const previous = this.live.get(id);
      if (previous && previous.x === p.x && previous.y === p.y && previous.z === p.z) continue;
      this.live.set(id, p);
      const parts = this.sources.get(id);
      if (parts) {
        this.placeSource(parts, p);
        changed = true;
      }
    }
    if (changed) this.dirty = true;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    const offset = this.camera.position.clone().sub(this.orbit.target);
    offset.setLength(cameraDistance(zoom));
    this.camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update();
    this.dirty = true;
  }

  resetView(): void {
    this.orbit.target.set(0, 0, 0);
    this.placeCamera(cameraDistance(this.zoom));
    this.orbit.update();
    this.dirty = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    disposeTree(this.scene);
    this.keyframeEdges.dispose();
    this.renderer.dispose();
    // Release the context now rather than at garbage collection: browsers cap live WebGL contexts,
    // and switching views back and forth would otherwise run into the cap.
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labelLayer.replaceChildren();
    if (process.env.NODE_ENV !== 'production') {
      delete (window as unknown as { __greanteafxCube3d?: unknown }).__greanteafxCube3d;
    }
  }

  // ------------------------------------------------------------------ building

  private buildRoom(): Group {
    const room = new Group();

    // Floor grid at the listener's ear height, 1 m squares, leaving room for the axis lines.
    const grid: number[] = [];
    for (let i = -MAX_M; i <= MAX_M; i++) {
      if (i === 0) continue;
      grid.push(i, 0, -MAX_M, i, 0, MAX_M, -MAX_M, 0, i, MAX_M, 0, i);
    }
    const gridGeometry = new BufferGeometry();
    gridGeometry.setAttribute('position', new Float32BufferAttribute(grid, 3));
    room.add(new LineSegments(gridGeometry, new LineBasicMaterial({ color: GRID })));

    const size = MAX_M * 2;
    room.add(
      new LineSegments(
        new EdgesGeometry(new BoxGeometry(size, size, size)),
        new LineBasicMaterial({ color: EDGES }),
      ),
    );

    // The world axes through the listener, in the arrows' colours, so a colour means one direction.
    const axis = (from: Vec3, to: Vec3, color: string) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([from.x, from.y, from.z, to.x, to.y, to.z], 3));
      return new Line(geometry, new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    };
    room.add(
      axis({ x: -MAX_M, y: 0, z: 0 }, { x: MAX_M, y: 0, z: 0 }, AXIS_COLOR.x),
      axis({ x: 0, y: -MAX_M, z: 0 }, { x: 0, y: MAX_M, z: 0 }, AXIS_COLOR.y),
      axis({ x: 0, y: 0, z: -MAX_M }, { x: 0, y: 0, z: MAX_M }, AXIS_COLOR.z),
    );
    return room;
  }

  /** The listener, with a cone showing which way it faces (−Z), since orbiting loses "ahead". */
  private buildListener(): Group {
    const listener = new Group();
    const material = new MeshStandardMaterial({ color: LISTENER, roughness: 0.6 });
    listener.add(new Mesh(new SphereGeometry(0.2, 24, 12), material));
    const nose = new Mesh(new ConeGeometry(0.09, 0.3, 16), material.clone());
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.36;
    listener.add(nose);
    return listener;
  }

  private buildFixedTags(): void {
    const face = (axis: 'x' | 'y' | 'z', sign: 1 | -1) => {
      const at = new Vector3();
      at[axis] = sign * (MAX_M + 0.9);
      const text = AXIS_ENDS[axis][sign > 0 ? 1 : 0];
      const tag = el('span', `face-label axis-${axis}`, text);
      this.labelLayer.append(tag);
      this.fixedTags.push({ el: tag, at });
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      face(axis, 1);
      face(axis, -1);
    }
    const you = el('span', 'listener-tag', 'YOU');
    this.labelLayer.append(you);
    this.fixedTags.push({ el: you, at: new Vector3(0, -0.2, 0) });
  }

  private addSource(track: Track): SourceParts {
    const group = new Group();
    const ball = new Mesh(
      this.ballGeometry,
      new MeshStandardMaterial({ color: track.color, roughness: 0.5, metalness: 0 }),
    );
    ball.userData.trackId = track.id;
    const ring = new Mesh(
      this.ringGeometry,
      new MeshBasicMaterial({ color: track.color, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false }),
    );
    ring.visible = false;

    // A stem down (or up) to the floor grid and a mark where it lands: height is otherwise the
    // hardest thing to read in a perspective view.
    const stemGeometry = new BufferGeometry();
    stemGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const stem = new Line(stemGeometry, new LineBasicMaterial({ color: track.color, transparent: true, opacity: 0.35 }));
    const foot = new Mesh(
      this.footGeometry,
      new MeshBasicMaterial({ color: track.color, transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false }),
    );
    foot.rotation.x = -Math.PI / 2;

    group.add(ball, ring, stem, foot);
    this.sourcesGroup.add(group);

    const label = el('div', 'source-label');
    const name = el('span', 'source-name', track.name);
    const distance = el('span', 'source-depth');
    label.append(name, distance);
    this.labelLayer.append(label);

    const parts: SourceParts = { color: track.color, group, ball, ring, stem, foot, label, name, distance };
    this.sources.set(track.id, parts);
    return parts;
  }

  private removeSource(id: string): void {
    const parts = this.sources.get(id);
    if (!parts) return;
    this.sourcesGroup.remove(parts.group);
    parts.ball.material.dispose();
    parts.ring.material.dispose();
    parts.stem.geometry.dispose();
    parts.stem.material.dispose();
    parts.foot.material.dispose();
    parts.label.remove();
    this.sources.delete(id);
    this.live.delete(id);
  }

  private recolor(parts: SourceParts, color: string): void {
    parts.color = color;
    parts.ball.material.color.set(color);
    parts.ring.material.color.set(color);
    parts.stem.material.color.set(color);
    parts.foot.material.color.set(color);
  }

  private placeSource(parts: SourceParts, p: Vec3): void {
    parts.group.position.set(p.x, p.y, p.z);
    const attr = parts.stem.geometry.getAttribute('position') as Float32BufferAttribute;
    attr.setY(1, -p.y);
    attr.needsUpdate = true;
    parts.foot.position.y = -p.y;
    const onFloor = Math.abs(p.y) < 0.05;
    parts.stem.visible = !onFloor;
    parts.foot.visible = !onFloor;
  }

  /**
   * Every shown path as a faint loop, and the selected track's as a dashed one with a diamond on
   * each keyframe. Rebuilt only when a path, the selection or the picked keyframe changes.
   */
  private rebuildPaths(shown: readonly Track[]): void {
    const selectedId = this.model.selectedTrackId;
    const signature = JSON.stringify([
      selectedId,
      this.keyframe,
      shown.filter((t) => t.path.length > 0).map((t) => [t.id, t.color, t.pathInterpolation, t.path]),
    ]);
    if (signature === this.pathSignature) return;
    this.pathSignature = signature;

    for (const child of [...this.pathsGroup.children]) {
      this.pathsGroup.remove(child);
      child.traverse((node) => {
        const line = node as Partial<Line>;
        // The keyframe shapes share geometry; only per-path lines own theirs.
        if (node instanceof Line && line.geometry !== this.keyframeEdges) line.geometry?.dispose();
        (line.material as Material | undefined)?.dispose();
      });
    }
    for (const tag of this.keyframeTags) tag.el.remove();
    this.keyframeMeshes = [];
    this.keyframeTags = [];

    for (const track of shown) {
      const selected = track.id === selectedId;
      if (track.path.length >= 2) {
        const points =
          track.pathInterpolation === 'smooth' && track.path.length >= 3
            ? samplePathPolyline(track.path, 'smooth')
            : track.path;
        // Closed by repeating the first point, so the dash pattern runs round the whole loop.
        const vectors = [...points, points[0]!].map((p) => new Vector3(p.x, p.y, p.z));
        const geometry = new BufferGeometry().setFromPoints(vectors);
        const material = selected
          ? new LineDashedMaterial({ color: track.color, dashSize: 0.3, gapSize: 0.22, transparent: true, opacity: 0.9 })
          : new LineBasicMaterial({ color: track.color, transparent: true, opacity: 0.22 });
        const line = new Line(geometry, material);
        if (selected) line.computeLineDistances();
        this.pathsGroup.add(line);
      }

      if (!selected) continue;
      track.path.forEach((p, index) => {
        const picked = index === this.keyframe;
        const diamond = new Mesh(
          this.keyframeGeometry,
          new MeshBasicMaterial({ color: picked ? track.color : WELL }),
        );
        diamond.position.set(p.x, p.y, p.z);
        diamond.userData.index = index;
        diamond.add(new LineSegments(this.keyframeEdges, new LineBasicMaterial({ color: track.color })));
        this.pathsGroup.add(diamond);
        this.keyframeMeshes.push(diamond);

        const tag = el('span', 'kf-num', String(index + 1));
        this.labelLayer.append(tag);
        this.keyframeTags.push({ el: tag, at: new Vector3(p.x, p.y, p.z) });
      });
    }
  }

  // ------------------------------------------------------------------ arrows

  private selectedTrack(): Track | null {
    return this.model.tracks.find((t) => t.id === this.model.selectedTrackId) ?? null;
  }

  private syncGizmo(): void {
    const track = this.selectedTrack();
    this.target = gizmoTarget(track, this.keyframe);
    if (!this.target || !track) {
      if (this.gizmo.object) this.gizmo.detach();
      return;
    }
    const p = this.target.kind === 'source' ? track.position : track.path[this.target.index]!;
    // Mid-drag the arrows own the proxy; writing the store's echo back would fight them.
    if (!this.gizmo.dragging) this.proxy.position.set(p.x, p.y, p.z);
    if (this.gizmo.object !== this.proxy) this.gizmo.attach(this.proxy);
  }

  private onGizmoMove = (): void => {
    const track = this.selectedTrack();
    const target = this.target;
    if (!track || !target) return;
    const p = round3(clampToCube(this.proxy.position));
    this.proxy.position.set(p.x, p.y, p.z);
    if (target.kind === 'source') this.handlers.movePosition(track.id, p);
    else this.handlers.movePathPoint(track.id, target.index, p);
  };

  // ------------------------------------------------------------------ pointer

  private setRay(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private balls(): Mesh[] {
    return [...this.sources.values()].map((s) => s.ball);
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.press = { x: e.clientX, y: e.clientY, onGizmo: this.gizmo.dragging, button: e.button };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const press = this.press;
    this.press = null;
    this.updateCursor(e.clientX, e.clientY);
    if (!press || press.button !== 0) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) return;
    // A press on an arrow that never moved was a click: the arrows often cover a neighbouring
    // source, and it must still be pickable through them.
    this.click(e.clientX, e.clientY, press.onGizmo);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.buttons === 0) this.updateCursor(e.clientX, e.clientY);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!isZoomWheel(e)) return;
    e.preventDefault();
    this.handlers.wheelZoom(wheelDeltaPixels(e.deltaY, e.deltaMode, e.deltaX));
  };

  private click(clientX: number, clientY: number, onArrows: boolean): void {
    this.setRay(clientX, clientY);

    const keyframe = this.raycaster.intersectObjects(this.keyframeMeshes, false)[0];
    if (keyframe) {
      this.keyframe = keyframe.object.userData.index as number;
      this.rebuildPaths(this.model.tracks.filter(isShownInCube));
      this.syncGizmo();
      this.dirty = true;
      return;
    }

    const editing = this.model.editingTrackId;
    const ball = this.raycaster.intersectObjects(this.balls(), false)[0];
    if (ball) {
      const id = ball.object.userData.trackId as string;
      // Pressing the armed track's own source drops a keyframe there, as in the flat views.
      if (id !== editing) {
        this.handlers.selectTrack(id);
        return;
      }
    }

    // A click on the arrows themselves is never a place to drop a keyframe.
    if (editing && !onArrows) this.dropKeyframe(editing);
  }

  private dropKeyframe(trackId: string): void {
    const track = this.model.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const anchor = track.path.at(-1) ?? track.position;
    const normal = this.camera.getWorldDirection(new Vector3());
    const p = dropOnViewPlane(this.raycaster.ray.origin, this.raycaster.ray.direction, anchor, normal);
    if (!p) return;
    // The new keyframe gets the arrows, ready to be pulled into place.
    this.keyframe = track.path.length;
    this.handlers.addPathPoint(trackId, round3(p));
  }

  private updateCursor(clientX: number, clientY: number): void {
    this.setRay(clientX, clientY);
    const overSomething =
      this.gizmo.axis !== null ||
      this.raycaster.intersectObjects([...this.keyframeMeshes, ...this.balls()], false).length > 0;
    this.setCursor(overSomething ? 'pointer' : this.model.editingTrackId ? 'crosshair' : 'grab');
  }

  private setCursor(cursor: string): void {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // ------------------------------------------------------------------ frame

  private markDirty = (): void => {
    this.dirty = true;
  };

  private tick = (): void => {
    this.frame = requestAnimationFrame(this.tick);
    const moved = this.orbit.update();
    if (!moved && !this.dirty) return;
    this.dirty = false;
    // The selection rings always face the camera.
    for (const parts of this.sources.values()) parts.ring.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  };

  private placeCamera(distance: number): void {
    const d = HOME_DIRECTION;
    this.camera.position.set(d.x * distance, d.y * distance, d.z * distance);
    this.camera.lookAt(0, 0, 0);
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** A world point in the view's pixels, or null when it is behind the camera. */
  private toView(p: Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z < -1 || v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  private pixelsPerMetre(at: Vector3): number {
    const halfFov = (FOV_DEGREES * Math.PI) / 360;
    return this.height / (2 * Math.tan(halfFov) * Math.max(0.1, this.camera.position.distanceTo(at)));
  }

  /** HTML labels follow the projection; source names keep clear of each other and the dots. */
  private placeLabels(): void {
    const place = (node: HTMLElement, at: { x: number; y: number } | null) => {
      node.style.display = at ? '' : 'none';
      if (!at) return;
      node.style.left = `${at.x}px`;
      node.style.top = `${at.y}px`;
    };

    const obstacles: Box[] = [];
    for (const tag of [...this.fixedTags, ...this.keyframeTags]) {
      const at = this.toView(tag.at);
      place(tag.el, at);
      // Face labels are centred on their point; source names keep off them.
      if (at && tag.el.classList.contains('face-label')) {
        const halfWidth = (tag.el.textContent ?? '').length * 4.5 + 4;
        obstacles.push({ left: at.x - halfWidth, right: at.x + halfWidth, top: at.y - 9, bottom: at.y + 9 });
      }
    }

    const origin = new Vector3();
    const listener = this.toView(origin);
    if (listener) {
      const r = 0.4 * this.pixelsPerMetre(origin) + 4;
      obstacles.push({ left: listener.x - r, right: listener.x + r, top: listener.y - r, bottom: listener.y + r + 18 });
    }

    // Labels keep off the arrows, which are what the pointer is after. TransformControls sizes
    // them to a fixed share of the view's height; its arrow tips reach about 0.14 of it.
    let arrowsRadius = 0;
    if (this.gizmo.object) {
      const centre = this.toView(this.proxy.getWorldPosition(new Vector3()));
      if (centre) {
        arrowsRadius = 0.14 * this.height * this.gizmo.size;
        obstacles.push({
          left: centre.x - arrowsRadius,
          right: centre.x + arrowsRadius,
          top: centre.y - arrowsRadius,
          bottom: centre.y + arrowsRadius,
        });
      }
    }

    const selectedId = this.model.selectedTrackId;
    const entries = [...this.sources.entries()].sort(([a], [b]) => Number(b === selectedId) - Number(a === selectedId));
    const anchors = [];
    for (const [id, parts] of entries) {
      const at = parts.group.position;
      const p = this.toView(at);
      parts.distance.textContent = `${distanceFromListener(at).toFixed(1)} m`;
      if (!p) {
        parts.label.style.display = 'none';
        continue;
      }
      const name = parts.name.textContent ?? '';
      const ball = BALL_RADIUS * this.pixelsPerMetre(at);
      const selected = id === selectedId;
      anchors.push({
        id,
        x: p.x,
        y: p.y,
        // The selected source's label sits just past its ring — or past its arrows when they are on it.
        r: Math.max(4, selected ? Math.max(ball * 1.8, this.target?.kind === 'source' ? arrowsRadius : 0) : ball),
        width: Math.ceil(Math.max(name.length * 7.6, 7 * 6.1)) + 4,
      });
    }
    for (const placed of layoutLabels(anchors, this.width, obstacles, this.height)) {
      const label = this.sources.get(placed.id)?.label;
      if (!label) continue;
      place(label, placed);
      label.classList.toggle('flip', placed.flip);
    }
  }

  /**
   * Development-only hooks for browser tests: the cube is WebGL, so where anything is on screen is
   * invisible to the DOM. Stripped from production builds by the environment check.
   */
  private exposeForTests(): void {
    if (process.env.NODE_ENV === 'production') return;
    const toClient = (p: Vector3) => {
      const at = this.toView(p);
      const rect = this.canvas.getBoundingClientRect();
      return at ? { x: rect.left + at.x, y: rect.top + at.y } : null;
    };
    (window as unknown as { __greanteafxCube3d?: unknown }).__greanteafxCube3d = {
      project: (p: Vec3) => toClient(new Vector3(p.x, p.y, p.z)),
      /** The middle of a move arrow's grab area, mirroring TransformControls' own sizing. */
      arrow: (axis: 'x' | 'y' | 'z') => {
        if (!this.gizmo.object) return null;
        const at = this.proxy.getWorldPosition(new Vector3());
        const halfFov = (FOV_DEGREES * Math.PI) / 360;
        const factor = at.distanceTo(this.camera.position) * Math.min((1.9 * Math.tan(halfFov)) / this.camera.zoom, 7);
        const handle = (factor * this.gizmo.size) / 4;
        const along = new Vector3();
        along[axis] = 0.3 * handle;
        return toClient(at.add(along));
      },
    };
  }
}
