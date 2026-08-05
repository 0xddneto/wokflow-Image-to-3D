import * as THREE from "three";

export type PreviewRenderer = {
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setAnimationLoop(callback: (() => void) | null): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
};

export type PreviewControls = {
  enabled: boolean;
  target: THREE.Vector3;
  update(): void;
  dispose(): void;
};

type ProjectedVoxel = {
  color: string;
  depth: number;
  size: number;
  x: number;
  y: number;
};

function makeWebGlAdapter(renderer: THREE.WebGLRenderer): PreviewRenderer {
  return {
    setSize: (width, height, updateStyle) => renderer.setSize(width, height, updateStyle),
    setAnimationLoop: (callback) => renderer.setAnimationLoop(callback),
    render: (scene, camera) => renderer.render(scene, camera),
    dispose: () => renderer.dispose(),
  };
}

export function tryCreateWebGlRenderer(canvas: HTMLCanvasElement) {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return { renderer: makeWebGlAdapter(renderer), webgl: renderer };
  } catch {
    return null;
  }
}

export function createSoftwareVoxelRenderer(canvas: HTMLCanvasElement): PreviewRenderer {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("O navegador não disponibilizou WebGL nem Canvas 2D");

  let cssWidth = 1;
  let cssHeight = 1;
  let frame = 0;
  let animationLoop: (() => void) | null = null;
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const projected = new THREE.Vector3();
  const cameraSpace = new THREE.Vector3();
  const color = new THREE.Color();

  const render = (scene: THREE.Scene, camera: THREE.Camera) => {
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    const voxels: ProjectedVoxel[] = [];

    scene.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      const cell = Number(object.userData.cell ?? 0.08);
      for (let instanceId = 0; instanceId < object.count; instanceId += 1) {
        object.getMatrixAt(instanceId, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        worldMatrix.decompose(position, quaternion, scale);
        if (Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) < 0.001) continue;

        projected.copy(position).project(camera);
        if (projected.z < -1.2 || projected.z > 1.2) continue;
        cameraSpace.copy(position).applyMatrix4(camera.matrixWorldInverse);
        object.getColorAt(instanceId, color);
        const visibleHeight = camera instanceof THREE.OrthographicCamera
          ? Math.max(0.1, (camera.top - camera.bottom) / camera.zoom)
          : 4.6;
        const size = Math.max(1, cell * cssHeight / visibleHeight * Math.max(scale.x, scale.y, scale.z) * 1.08);
        voxels.push({
          color: `#${color.getHexString(THREE.SRGBColorSpace)}`,
          depth: cameraSpace.z,
          size,
          x: (projected.x + 1) * cssWidth * 0.5,
          y: (1 - projected.y) * cssHeight * 0.5,
        });
      }
    });

    voxels.sort((a, b) => a.depth - b.depth);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.lineWidth = 0.45;
    context.strokeStyle = "rgba(3, 7, 10, 0.28)";
    for (const voxel of voxels) {
      const half = voxel.size * 0.5;
      context.fillStyle = voxel.color;
      context.beginPath();
      context.roundRect(voxel.x - half, voxel.y - half, voxel.size, voxel.size, Math.min(2, half * 0.45));
      context.fill();
      context.stroke();
    }
  };

  const tick = () => {
    if (!animationLoop) return;
    animationLoop();
    frame = window.requestAnimationFrame(tick);
  };

  return {
    setSize(width, height, updateStyle = true) {
      cssWidth = Math.max(1, width);
      cssHeight = Math.max(1, height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(cssWidth * ratio));
      canvas.height = Math.max(1, Math.round(cssHeight * ratio));
      if (updateStyle) {
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }
    },
    setAnimationLoop(callback) {
      animationLoop = callback;
      window.cancelAnimationFrame(frame);
      if (callback) frame = window.requestAnimationFrame(tick);
    },
    render,
    dispose() {
      animationLoop = null;
      window.cancelAnimationFrame(frame);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

export function createSoftwareControls(
  canvas: HTMLCanvasElement,
  camera: THREE.OrthographicCamera,
  root: THREE.Group,
  isEditing: () => boolean,
): PreviewControls {
  const controls: PreviewControls = {
    enabled: true,
    target: new THREE.Vector3(0, 0, 0.2),
    update() {
      camera.lookAt(controls.target);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
    },
    dispose() {},
  };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const pointerDown = (event: PointerEvent) => {
    if (!controls.enabled || isEditing()) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!dragging || !controls.enabled || isEditing()) return;
    root.rotation.y += (event.clientX - lastX) * 0.012;
    root.rotation.x = THREE.MathUtils.clamp(root.rotation.x + (event.clientY - lastY) * 0.006, -0.45, 0.45);
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const pointerUp = (event: PointerEvent) => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const wheel = (event: WheelEvent) => {
    if (!controls.enabled || isEditing()) return;
    event.preventDefault();
    camera.zoom = THREE.MathUtils.clamp(camera.zoom * Math.exp(-event.deltaY * 0.001), 0.55, 3.5);
    controls.update();
  };

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  canvas.addEventListener("wheel", wheel, { passive: false });
  controls.dispose = () => {
    canvas.removeEventListener("pointerdown", pointerDown);
    canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", pointerUp);
    canvas.removeEventListener("pointercancel", pointerUp);
    canvas.removeEventListener("wheel", wheel);
  };
  controls.update();
  return controls;
}
