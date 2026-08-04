"use client";

import {
  Download,
  Grid3X3,
  Move3D,
  Palette,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type GenerationMode = "pixel" | "relief";
type ViewName = "front" | "quarter" | "side";

type Metrics = {
  source: string;
  grid: string;
  sourcePixels: number;
  elements: number;
  triangles: number;
  parts: number;
};

type PartId =
  | "head"
  | "torso"
  | "left-arm"
  | "right-arm"
  | "left-hand"
  | "right-hand"
  | "left-fingers"
  | "right-fingers"
  | "left-leg"
  | "right-leg"
  | "left-foot"
  | "right-foot";

type PixelSample = {
  x: number;
  y: number;
  red: number;
  green: number;
  blue: number;
};

type SelectedPixel = {
  partId: PartId;
  instanceId: number;
};

type VoxelBuild = PixelSample & {
  z: number;
  front: boolean;
  back: boolean;
  rim: boolean;
};

type AnatomyGuides = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  headBottom: number;
  legStart: number;
  footStart: number;
};

const PARTS: Array<{ id: PartId; label: string; depth: number }> = [
  { id: "head", label: "Cabeça", depth: 1 },
  { id: "torso", label: "Tronco", depth: 0.88 },
  { id: "left-arm", label: "Braço E", depth: 0.58 },
  { id: "right-arm", label: "Braço D", depth: 0.58 },
  { id: "left-hand", label: "Mão E", depth: 0.64 },
  { id: "right-hand", label: "Mão D", depth: 0.64 },
  { id: "left-fingers", label: "Dedos E", depth: 0.52 },
  { id: "right-fingers", label: "Dedos D", depth: 0.52 },
  { id: "left-leg", label: "Perna E", depth: 0.67 },
  { id: "right-leg", label: "Perna D", depth: 0.67 },
  { id: "left-foot", label: "Pé E", depth: 0.78 },
  { id: "right-foot", label: "Pé D", depth: 0.78 },
];

type BuildOptions = {
  mode: GenerationMode;
  resolution: number;
  depth: number;
  threshold: number;
};

const EMPTY_METRICS: Metrics = {
  source: "—",
  grid: "—",
  sourcePixels: 0,
  elements: 0,
  triangles: 0,
  parts: 0,
};

function inferAnatomyGuides(
  mask: Uint8Array,
  width: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): AnatomyGuides {
  const bboxHeight = Math.max(1, maxY - minY + 1);
  const bboxWidth = Math.max(1, maxX - minX + 1);
  const centerX = (minX + maxX) / 2;
  let headBottom = Math.round(minY + bboxHeight * 0.39);
  let bestNeckScore = Number.POSITIVE_INFINITY;

  for (
    let y = Math.round(minY + bboxHeight * 0.28);
    y <= Math.round(minY + bboxHeight * 0.49);
    y += 1
  ) {
    let rowMin = width;
    let rowMax = -1;
    for (let x = minX; x <= maxX; x += 1) {
      if (!mask[y * width + x]) continue;
      rowMin = Math.min(rowMin, x);
      rowMax = Math.max(rowMax, x);
    }
    if (rowMax < rowMin) continue;
    const rowWidth = rowMax - rowMin + 1;
    const expected = minY + bboxHeight * 0.39;
    const score = rowWidth + Math.abs(y - expected) * bboxWidth * 0.035;
    if (score < bestNeckScore) {
      bestNeckScore = score;
      headBottom = y;
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX,
    headBottom,
    legStart: Math.round(minY + bboxHeight * 0.68),
    footStart: Math.round(minY + bboxHeight * 0.86),
  };
}

function classifyCharacterPart(x: number, y: number, guides: AnatomyGuides): PartId {
  const bboxWidth = Math.max(1, guides.maxX - guides.minX + 1);
  const bboxHeight = Math.max(1, guides.maxY - guides.minY + 1);
  const normalizedY = (y - guides.minY) / bboxHeight;
  const sideDistance = Math.abs(x - guides.centerX) / bboxWidth;
  const left = x < guides.centerX;

  if (y <= guides.headBottom) return "head";
  if (y >= guides.footStart) return left ? "left-foot" : "right-foot";
  if (y >= guides.legStart && sideDistance < 0.27) {
    return left ? "left-leg" : "right-leg";
  }
  if (sideDistance > 0.25) {
    if (normalizedY > 0.67) return left ? "left-fingers" : "right-fingers";
    if (normalizedY > 0.57) return left ? "left-hand" : "right-hand";
    return left ? "left-arm" : "right-arm";
  }
  return "torso";
}

function buildDistanceField(mask: Uint8Array, width: number, height: number) {
  const field = new Float32Array(width * height);
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      field[index] = mask[index]
        ? Math.min(x + 1, y + 1, width - x, height - y)
        : 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      if (x > 0) field[index] = Math.min(field[index], field[index - 1] + 1);
      if (y > 0) field[index] = Math.min(field[index], field[index - width] + 1);
      if (x > 0 && y > 0) field[index] = Math.min(field[index], field[index - width - 1] + diagonal);
      if (x + 1 < width && y > 0) field[index] = Math.min(field[index], field[index - width + 1] + diagonal);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      if (x + 1 < width) field[index] = Math.min(field[index], field[index + 1] + 1);
      if (y + 1 < height) field[index] = Math.min(field[index], field[index + width] + 1);
      if (x + 1 < width && y + 1 < height) field[index] = Math.min(field[index], field[index + width + 1] + diagonal);
      if (x > 0 && y + 1 < height) field[index] = Math.min(field[index], field[index + width - 1] + diagonal);
    }
  }
  return field;
}

function colorDistance(
  red: number,
  green: number,
  blue: number,
  background: [number, number, number],
) {
  return Math.hypot(
    red - background[0],
    green - background[1],
    blue - background[2],
  );
}

function getRepresentativeColor(samples: PixelSample[]) {
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>();
  for (const sample of samples) {
    const brightness = sample.red * 0.299 + sample.green * 0.587 + sample.blue * 0.114;
    if (brightness < 42) continue;
    const key = (Math.round(sample.red / 24) << 16)
      | (Math.round(sample.green / 24) << 8)
      | Math.round(sample.blue / 24);
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += sample.red;
    bucket.green += sample.green;
    bucket.blue += sample.blue;
    buckets.set(key, bucket);
  }
  const winner = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!winner) return new THREE.Color().setRGB(0.72, 0.62, 0.54, THREE.SRGBColorSpace);
  return new THREE.Color().setRGB(
    winner.red / winner.count / 255,
    winner.green / winner.count / 255,
    winner.blue / winner.count / 255,
    THREE.SRGBColorSpace,
  );
}

function sampleBackground(data: Uint8ClampedArray, width: number, height: number) {
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const totals: [number, number, number] = [0, 0, 0];
  for (const [x, y] of points) {
    const offset = (y * width + x) * 4;
    totals[0] += data[offset];
    totals[1] += data[offset + 1];
    totals[2] += data[offset + 2];
  }
  return totals.map((value) => value / points.length) as [number, number, number];
}

function createProceduralAsset(image: HTMLImageElement, options: BuildOptions) {
  const maxDimension = Math.max(image.naturalWidth, image.naturalHeight);
  const effectiveResolution = Math.min(
    options.resolution,
    maxDimension,
    options.mode === "relief" ? 64 : 128,
  );
  const width = Math.max(
    2,
    Math.round((image.naturalWidth / maxDimension) * effectiveResolution),
  );
  const height = Math.max(
    2,
    Math.round((image.naturalHeight / maxDimension) * effectiveResolution),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = options.mode === "relief";
  context.drawImage(image, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height).data;
  let transparent = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 245) transparent += 1;
  }
  const hasTransparency = transparent / (width * height) > 0.03;
  const background = sampleBackground(pixels, width, height);
  const samples: PixelSample[] = [];
  const foregroundMask = new Uint8Array(width * height);
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      const foreground = hasTransparency
        ? alpha > 28
        : alpha > 28 && colorDistance(red, green, blue, background) > options.threshold;

      if (!foreground) continue;
      samples.push({ x, y, red, green, blue });
      foregroundMask[y * width + x] = 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (samples.length === 0) {
    throw new Error("Nenhum primeiro plano foi detectado. Reduza o recorte de fundo.");
  }

  const bboxWidth = Math.max(1, maxX - minX);
  const cell = 3.2 / Math.max(width, height);
  const distanceField = buildDistanceField(foregroundMask, width, height);
  const anatomy = inferAnatomyGuides(foregroundMask, width, minX, maxX, minY, maxY);
  const samplesByPart = new Map<PartId, PixelSample[]>();
  for (const part of PARTS) samplesByPart.set(part.id, []);

  for (const sample of samples) {
    samplesByPart.get(classifyCharacterPart(sample.x, sample.y, anatomy))?.push(sample);
  }

  const model = new THREE.Group();
  model.name = "ImageTo3D_EditableCharacter";
  let voxelCount = 0;
  let triangleCount = 0;

  for (const partDefinition of PARTS) {
    const partSamples = samplesByPart.get(partDefinition.id) ?? [];
    if (partSamples.length === 0) continue;

    const depthScale = THREE.MathUtils.mapLinear(options.depth, 0.12, 0.9, 0.42, 1.08);
    const baseColor = getRepresentativeColor(partSamples);
    const voxels: VoxelBuild[] = [];

    for (const sample of partSamples) {
      const distance = distanceField[sample.y * width + sample.x];
      const radius = THREE.MathUtils.clamp(
        Math.round(distance * partDefinition.depth * depthScale),
        1,
        Math.max(2, Math.round(bboxWidth * 0.28)),
      );

      for (let z = -radius; z <= radius; z += 1) {
        voxels.push({
          ...sample,
          z,
          front: z === radius,
          back: z === -radius,
          rim: distance <= 1.5,
        });
      }
    }

    const geometry = options.mode === "pixel"
      ? new THREE.BoxGeometry(cell * 0.72, cell * 0.72, cell * 0.72)
      : new RoundedBoxGeometry(cell * 0.82, cell * 0.82, cell * 0.82, 2, cell * 0.14);
    const material = options.mode === "pixel"
      ? new THREE.MeshBasicMaterial({ color: 0xffffff })
      : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0,
      });
    const mesh = new THREE.InstancedMesh(geometry, material, voxels.length);
    mesh.name = `${partDefinition.id}-voxels`;
    mesh.userData.partId = partDefinition.id;
    mesh.userData.cell = cell;
    mesh.userData.originalMatrices = [] as number[][];
    mesh.userData.originalColors = [] as number[][];
    mesh.userData.currentColors = [] as number[][];
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const surfaceColor = new THREE.Color();
    const sideColor = new THREE.Color();
    const backColor = baseColor.clone().multiplyScalar(0.9);
    voxels.forEach((voxel, index) => {
      position.set(
        (voxel.x - (width - 1) / 2) * cell,
        ((height - 1) / 2 - voxel.y) * cell,
        voxel.z * cell,
      );
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      surfaceColor.setRGB(
        voxel.red / 255,
        voxel.green / 255,
        voxel.blue / 255,
        THREE.SRGBColorSpace,
      );
      sideColor.copy(surfaceColor).lerp(baseColor, 0.58).multiplyScalar(0.84);
      const color = voxel.front
        ? surfaceColor
        : voxel.back
          ? backColor
          : voxel.rim
            ? sideColor
            : baseColor;
      mesh.setColorAt(index, color);
      mesh.userData.originalMatrices.push(matrix.toArray());
      mesh.userData.originalColors.push(color.toArray());
      mesh.userData.currentColors.push(color.toArray());
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const partGroup = new THREE.Group();
    partGroup.name = `part:${partDefinition.id}`;
    partGroup.userData.partId = partDefinition.id;
    partGroup.userData.label = partDefinition.label;
    partGroup.userData.voxels = voxels.length;
    partGroup.add(mesh);
    model.add(partGroup);

    voxelCount += voxels.length;
    const trianglesPerVoxel = geometry.index
      ? geometry.index.count / 3
      : geometry.getAttribute("position").count / 3;
    triangleCount += Math.round(trianglesPerVoxel * voxels.length);
  }

  model.userData.generation = {
    mode: options.mode,
    segmentation: "native-pixel-silhouette-sdf-v2",
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    sampleWidth: width,
    sampleHeight: height,
    voxels: voxelCount,
  };

  return {
    group: model,
    metrics: {
      source: `${image.naturalWidth}×${image.naturalHeight}`,
      grid: `${width}×${height}`,
      sourcePixels: samples.length,
      elements: voxelCount,
      triangles: triangleCount,
      parts: model.children.length,
    } satisfies Metrics,
  };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export function ImageTo3DStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const spinRef = useRef(false);

  const [mode, setMode] = useState<GenerationMode>("pixel");
  const [resolution, setResolution] = useState(128);
  const [depth, setDepth] = useState(0.42);
  const [threshold, setThreshold] = useState(52);
  const [activeView, setActiveView] = useState<ViewName>("front");
  const [autoRotate, setAutoRotate] = useState(false);
  const [preview, setPreview] = useState("/examples/mobs-base.png");
  const [fileName, setFileName] = useState("mobs-base.png · example");
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [status, setStatus] = useState("Preparando exemplo…");
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedPixels, setSelectedPixels] = useState<SelectedPixel[]>([]);
  const [selectionColor, setSelectionColor] = useState("#ffffff");

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewer = viewerRef.current;
    if (!canvas || !viewer) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0c1116, 8, 13);

    const camera = new THREE.OrthographicCamera(-2.3, 2.3, 2.3, -2.3, 0.01, 40);
    camera.position.set(0, 0.05, 6.5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 2.6;
    controls.maxDistance = 10;
    controls.target.set(0, 0, 0.2);
    controlsRef.current = controls;

    const root = new THREE.Group();
    root.name = "GeneratedAssetRoot";
    scene.add(root);
    rootRef.current = root;

    const key = new THREE.DirectionalLight(0xffe5d2, 1.15);
    key.position.set(-3.5, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa9c8ff, 0.32);
    fill.position.set(4, 1.5, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa8ffcf, 0.48);
    rim.position.set(1, 3, -5);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x1b222a, 0.62));

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.6, 72),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.3 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.72, 0.3);
    floor.receiveShadow = true;
    scene.add(floor);

    let resizeFrame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const resize = () => {
      const { width, height } = viewer.getBoundingClientRect();
      if (Math.abs(width - lastWidth) < 0.5 && Math.abs(height - lastHeight) < 0.5) return;
      lastWidth = width;
      lastHeight = height;
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      const aspect = Math.max(1, width) / Math.max(1, height);
      const halfHeight = 2.3;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(resize);
    });
    observer.observe(viewer);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const selectFromCanvas = (event: PointerEvent) => {
      if (Math.abs(event.movementX) > 3 || Math.abs(event.movementY) > 3) return;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(root, true)[0];
      let target: THREE.Object3D | null = hit?.object ?? null;
      while (target && !target.userData.partId) target = target.parent;
      if (target?.userData.partId && hit?.object instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
        const partId = target.userData.partId as PartId;
        const clicked = { partId, instanceId: hit.instanceId } satisfies SelectedPixel;
        setSelectedPixels((previous) => {
          if (!event.shiftKey) return [clicked];
          const exists = previous.some(
            (pixel) => pixel.partId === clicked.partId && pixel.instanceId === clicked.instanceId,
          );
          return exists
            ? previous.filter(
              (pixel) => pixel.partId !== clicked.partId || pixel.instanceId !== clicked.instanceId,
            )
            : [...previous, clicked];
        });
      } else if (!event.shiftKey) {
        setSelectedPixels([]);
      }
    };
    canvas.addEventListener("pointerup", selectFromCanvas);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), 0.05);
      if (spinRef.current) root.rotation.y += delta * 0.45;
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      canvas.removeEventListener("pointerup", selectFromCanvas);
      renderer.setAnimationLoop(null);
      controls.dispose();
      if (root.children[0]) disposeObject(root.children[0]);
      renderer.dispose();
      rootRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  const loadImage = useCallback((url: string, name: string) => {
    setStatus("Lendo pixels e transparência…");
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      sourceImageRef.current = image;
      setPreview(url);
      setFileName(name);
      setStatus("Gerando geometria…");
    };
    image.onerror = () => setStatus("Não foi possível abrir essa imagem");
    image.src = url;
  }, []);

  useEffect(() => {
    loadImage("/examples/mobs-base.png", "mobs-base.png · example");
  }, [loadImage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const image = sourceImageRef.current;
      const root = rootRef.current;
      if (!image || !root) return;
      setStatus("Gerando geometria…");
      try {
        if (root.children[0]) {
          const previous = root.children[0];
          root.remove(previous);
          disposeObject(previous);
        }
        const result = createProceduralAsset(image, {
          mode,
          resolution,
          depth,
          threshold,
        });
        root.add(result.group);
        root.rotation.set(0, 0, 0);
        setMetrics(result.metrics);
        setSelectedPixels([]);
        setSelectionColor("#ffffff");
        setActiveView("front");
        setStatus(
          `${result.metrics.sourcePixels.toLocaleString("pt-BR")} pixels preservados · ${result.metrics.elements.toLocaleString("pt-BR")} voxels 3D`,
        );
      } catch (error) {
        setMetrics(EMPTY_METRICS);
        setSelectedPixels([]);
        setStatus(error instanceof Error ? error.message : "Falha na geração");
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [mode, resolution, depth, threshold, preview]);

  const handleFile = useCallback((file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Envie PNG, JPG ou WEBP");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setStatus("A imagem deve ter no máximo 20 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadImage(String(reader.result), file.name);
    reader.onerror = () => setStatus("Falha ao ler o arquivo");
    reader.readAsDataURL(file);
  }, [loadImage]);

  const changeView = useCallback((view: ViewName) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const root = rootRef.current;
    if (!camera || !controls || !root) return;
    root.rotation.set(0, 0, 0);
    const positions: Record<ViewName, [number, number, number]> = {
      front: [0, 0.05, 6.5],
      quarter: [4.8, 3.4, 4.8],
      side: [6.5, 0.05, 0.2],
    };
    camera.position.set(...positions[view]);
    controls.target.set(0, 0, 0.2);
    controls.update();
    setActiveView(view);
  }, []);

  const toggleSpin = () => {
    const next = !autoRotate;
    setAutoRotate(next);
    spinRef.current = next;
  };

  const previousSelectionRef = useRef<SelectedPixel[]>([]);

  const getPixelMesh = useCallback((partId: PartId) => {
    const model = rootRef.current?.children[0];
    const group = model?.getObjectByName(`part:${partId}`);
    const mesh = group?.children.find((child) => child instanceof THREE.InstancedMesh);
    return mesh instanceof THREE.InstancedMesh ? mesh : null;
  }, []);

  const getEveryPixel = useCallback(() => {
    const result: SelectedPixel[] = [];
    rootRef.current?.children[0]?.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      const partId = object.userData.partId as PartId | undefined;
      if (!partId) return;
      for (let instanceId = 0; instanceId < object.count; instanceId += 1) {
        result.push({ partId, instanceId });
      }
    });
    return result;
  }, []);

  const renderSelection = useCallback((pixels: SelectedPixel[], highlighted: boolean) => {
    const dirty = new Set<THREE.InstancedMesh>();
    const highlight = new THREE.Color("#54ffb0");
    const color = new THREE.Color();
    for (const pixel of pixels) {
      const mesh = getPixelMesh(pixel.partId);
      const currentColors = mesh?.userData.currentColors as number[][] | undefined;
      const values = currentColors?.[pixel.instanceId];
      if (!mesh || !values) continue;
      color.fromArray(values);
      if (highlighted) color.lerp(highlight, 0.58);
      mesh.setColorAt(pixel.instanceId, color);
      dirty.add(mesh);
    }
    dirty.forEach((mesh) => {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [getPixelMesh]);

  useEffect(() => {
    renderSelection(previousSelectionRef.current, false);
    renderSelection(selectedPixels, true);
    previousSelectionRef.current = selectedPixels;
    const last = selectedPixels.at(-1);
    const colors = last ? getPixelMesh(last.partId)?.userData.currentColors as number[][] | undefined : undefined;
    const values = last ? colors?.[last.instanceId] : undefined;
    if (values) setSelectionColor(`#${new THREE.Color().fromArray(values).getHexString(THREE.SRGBColorSpace)}`);
  }, [getPixelMesh, renderSelection, selectedPixels]);

  const selectAllPixels = useCallback(() => setSelectedPixels(getEveryPixel()), [getEveryPixel]);
  const clearSelection = useCallback(() => setSelectedPixels([]), []);
  const invertSelection = useCallback(() => {
    setSelectedPixels((current) => {
      const selected = new Set(current.map((pixel) => `${pixel.partId}:${pixel.instanceId}`));
      return getEveryPixel().filter((pixel) => !selected.has(`${pixel.partId}:${pixel.instanceId}`));
    });
  }, [getEveryPixel]);

  const recolorSelection = useCallback((hex: string) => {
    setSelectionColor(hex);
    const color = new THREE.Color(hex);
    for (const pixel of selectedPixels) {
      const mesh = getPixelMesh(pixel.partId);
      const currentColors = mesh?.userData.currentColors as number[][] | undefined;
      if (!mesh || !currentColors) continue;
      currentColors[pixel.instanceId] = color.toArray();
    }
    renderSelection(selectedPixels, true);
  }, [getPixelMesh, renderSelection, selectedPixels]);

  const nudgeSelection = useCallback((axis: "x" | "y" | "z", direction: -1 | 1) => {
    const dirty = new Set<THREE.InstancedMesh>();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const pixel of selectedPixels) {
      const mesh = getPixelMesh(pixel.partId);
      if (!mesh) continue;
      mesh.getMatrixAt(pixel.instanceId, matrix);
      matrix.decompose(position, quaternion, scale);
      position[axis] += Number(mesh.userData.cell ?? 0.08) * direction;
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(pixel.instanceId, matrix);
      dirty.add(mesh);
    }
    dirty.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  }, [getPixelMesh, selectedPixels]);

  const restoreSelection = useCallback(() => {
    const dirty = new Set<THREE.InstancedMesh>();
    for (const pixel of selectedPixels) {
      const mesh = getPixelMesh(pixel.partId);
      const matrices = mesh?.userData.originalMatrices as number[][] | undefined;
      const originals = mesh?.userData.originalColors as number[][] | undefined;
      const current = mesh?.userData.currentColors as number[][] | undefined;
      if (!mesh || !matrices?.[pixel.instanceId] || !originals?.[pixel.instanceId] || !current) continue;
      mesh.setMatrixAt(pixel.instanceId, new THREE.Matrix4().fromArray(matrices[pixel.instanceId]));
      current[pixel.instanceId] = [...originals[pixel.instanceId]];
      dirty.add(mesh);
    }
    dirty.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
    renderSelection(selectedPixels, true);
  }, [getPixelMesh, renderSelection, selectedPixels]);

  const removeSelection = useCallback(() => {
    const dirty = new Set<THREE.InstancedMesh>();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const pixel of selectedPixels) {
      const mesh = getPixelMesh(pixel.partId);
      if (!mesh) continue;
      mesh.getMatrixAt(pixel.instanceId, matrix);
      matrix.decompose(position, quaternion, scale);
      matrix.compose(position, quaternion, scale.setScalar(0));
      mesh.setMatrixAt(pixel.instanceId, matrix);
      dirty.add(mesh);
    }
    dirty.forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  }, [getPixelMesh, selectedPixels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllPixels();
      } else if (event.key === "Escape") {
        clearSelection();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, removeSelection, selectAllPixels]);

  const exportGlb = useCallback(async () => {
    const source = rootRef.current?.children[0];
    if (!source) return;
    setExporting(true);
    setStatus("Empacotando GLB…");
    try {
      const exporter = new GLTFExporter();
      const asset = source.clone(true);
      asset.name = "ImageTo3D_Export";
      asset.traverse((object) => {
        if (!(object instanceof THREE.InstancedMesh)) return;
        const colors = object.userData.currentColors as number[][] | undefined;
        if (!colors) return;
        const color = new THREE.Color();
        colors.forEach((values, instanceId) => object.setColorAt(instanceId, color.fromArray(values)));
        if (object.instanceColor) object.instanceColor.needsUpdate = true;
      });
      const result = await exporter.parseAsync(asset, {
        binary: true,
        onlyVisible: true,
        trs: true,
      });
      if (!(result instanceof ArrayBuffer)) throw new Error("Exportação binária falhou");
      const blob = new Blob([result], { type: "model/gltf-binary" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${fileName.replace(/\.[^.]+.*$/, "") || "image-to-3d"}.glb`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      setStatus(`GLB pronto · ${(result.byteLength / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao exportar GLB");
    } finally {
      setExporting(false);
    }
  }, [fileName]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">3D</span>
          <span>IMAGE<span>→</span>3D</span>
        </div>
        <div className="build-tag">
          <span className="status-dot" /> local silhouette engine · alpha 0.4
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="intro-kicker">Reference-driven asset generation</p>
          <h1>Uma imagem entra. <em>Geometria editável sai.</em></h1>
        </div>
        <p className="intro-copy">
          A silhueta é inflada como um campo 3D: a frente preserva o sprite e o
          interior forma volume arredondado, sem esticar a imagem para trás.
        </p>
      </section>

      <section className="studio" aria-label="Estúdio Image to 3D">
        <aside className="control-panel">
          <div className="panel-heading">
            <h2>Referência</h2>
            <span className="step-number">01</span>
          </div>

          <label
            className={`dropzone ${dragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Enviar imagem de referência"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Imagem de referência selecionada" />
            <span className="drop-overlay"><UploadCloud size={14} /> Trocar imagem</span>
          </label>
          <p className="file-name">{fileName}</p>

          <div className="divider" />
          <div className="panel-heading">
            <h3>Motor</h3>
            <span className="step-number">02</span>
          </div>
          <div className="mode-grid">
            <button
              className={`mode-button ${mode === "pixel" ? "is-active" : ""}`}
              type="button"
              onClick={() => setMode("pixel")}
            >
              <Grid3X3 size={18} />
              <strong>Pixel nativo</strong>
              <span>1 pixel = 1 cubo frontal</span>
            </button>
            <button
              className={`mode-button ${mode === "relief" ? "is-active" : ""}`}
              type="button"
              onClick={() => setMode("relief")}
            >
              <Sparkles size={18} />
              <strong>Blocos suaves</strong>
              <span>cantos arredondados</span>
            </button>
          </div>

          <div className="divider" />
          <div className="sliders">
            <label className="slider-row">
              <span className="slider-label">Grade de pixels <output>{resolution}</output></span>
              <input
                type="range"
                min="32"
                max="128"
                value={resolution}
                onChange={(event) => setResolution(Number(event.target.value))}
              />
            </label>
            <label className="slider-row">
              <span className="slider-label">Profundidade <output>{depth.toFixed(2)}</output></span>
              <input
                type="range"
                min="0.12"
                max="0.9"
                step="0.02"
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
              />
            </label>
            <label className="slider-row">
              <span className="slider-label">Recorte do fundo <output>{threshold}</output></span>
              <input
                type="range"
                min="18"
                max="130"
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
            </label>
          </div>
        </aside>

        <div className="viewer" ref={viewerRef}>
          <canvas ref={canvasRef} aria-label="Visualização tridimensional gerada" />
          <div className="viewer-top">
            <span className="engine-tag"><span className="status-dot" /> {status}</span>
            <div className="view-controls" aria-label="Vistas do modelo">
              {(["front", "quarter", "side"] as ViewName[]).map((view) => (
                <button
                  key={view}
                  type="button"
                  className={activeView === view ? "is-active" : ""}
                  onClick={() => changeView(view)}
                >
                  {view === "front" ? "Frente" : view === "quarter" ? "3/4" : "Lado"}
                </button>
              ))}
            </div>
          </div>
          <div className="viewer-bottom">
            <div className="viewer-title">
              <small>local isometric preview</small>
              <strong>{mode === "pixel" ? "Editable voxel character" : "Rounded voxel character"}</strong>
            </div>
            <button
              className={`spin-button ${autoRotate ? "is-active" : ""}`}
              type="button"
              onClick={toggleSpin}
            >
              <RotateCw size={13} /> Auto-orbit
            </button>
          </div>
        </div>

        <aside className="inspector">
          <div>
            <div className="panel-heading">
              <h2>Pixels</h2>
              <span className="step-number">03</span>
            </div>
            <p className="selection-instruction">
              Clique em qualquer pixel. Use <strong>Shift + clique</strong> para adicionar ou remover pixels da seleção.
            </p>
            <div className="selection-toolbar" aria-label="Comandos de seleção de pixels">
              <button type="button" onClick={selectAllPixels}>Todos</button>
              <button type="button" onClick={invertSelection}>Inverter</button>
              <button type="button" onClick={clearSelection}>Limpar</button>
            </div>
            <div className="selection-summary" aria-live="polite">
              <strong>{selectedPixels.length.toLocaleString("pt-BR")}</strong>
              <span>{selectedPixels.length === 1 ? "pixel selecionado" : "pixels selecionados"}</span>
            </div>
          </div>

          <div className="divider" />
          <div className="pixel-selection-editor">
            <div className="panel-heading">
              <h3>Editar seleção</h3>
              <Move3D size={14} color="#a8ffcf" />
            </div>
            {selectedPixels.length > 0 ? (
              <>
                <div className="color-editor">
                  <label>
                    <Palette size={14} /> Cor dos pixels
                    <input
                      type="color"
                      value={selectionColor}
                      onChange={(event) => recolorSelection(event.target.value)}
                    />
                  </label>
                  <button type="button" onClick={restoreSelection}>
                    <Undo2 size={13} /> Original
                  </button>
                </div>

                <div className="voxel-move" aria-label="Mover pixels selecionados">
                  {(["x", "y", "z"] as const).map((axis) => (
                    <div key={axis}>
                      <span>{axis.toUpperCase()}</span>
                      <button type="button" aria-label={`Mover ${axis.toUpperCase()} negativo`} onClick={() => nudgeSelection(axis, -1)}>−</button>
                      <button type="button" aria-label={`Mover ${axis.toUpperCase()} positivo`} onClick={() => nudgeSelection(axis, 1)}>+</button>
                    </div>
                  ))}
                </div>

                <div className="part-actions">
                  <button type="button" onClick={restoreSelection}>
                    <Undo2 size={13} /> Restaurar
                  </button>
                  <button
                    type="button"
                    className="danger-action"
                    onClick={removeSelection}
                  >
                    <Trash2 size={13} /> Apagar seleção
                  </button>
                </div>
              </>
            ) : (
              <p className="empty-editor">Selecione um ou mais pixels diretamente no personagem.</p>
            )}
          </div>

          <div className="compact-metrics">
            <span>{(metrics.sourcePixels ?? 0).toLocaleString("pt-BR")} pixels frontais</span>
            <span>{metrics.elements.toLocaleString("pt-BR")} voxels</span>
            <span>{metrics.triangles.toLocaleString("pt-BR")} tris</span>
          </div>

          <div>
            <div className="divider" />
            <div className="editor-tip">
              Ctrl+A seleciona tudo · Shift+clique cria seleção múltipla · Delete apaga · Esc limpa a seleção.
            </div>
            <button
              className="export-button"
              type="button"
              disabled={exporting || metrics.elements === 0}
              onClick={exportGlb}
            >
              <Download size={16} /> {exporting ? "Gerando GLB…" : "Exportar GLB"}
            </button>
            <p className="privacy-note">
              <ShieldCheck size={14} /> A imagem é processada neste dispositivo nesta versão.
            </p>
          </div>
        </aside>
      </section>

      <section className="workflow" aria-label="Pipeline da ferramenta">
        <article className="workflow-step">
          <span>01 / INGEST</span>
          <h3>Imagem sem amarras</h3>
          <p>PNG transparente, sprite, render ou fotografia com fundo simples.</p>
        </article>
        <article className="workflow-step">
          <span>02 / SEGMENT</span>
          <h3>Corpo dividido</h3>
          <p>A máscara e as proporções inferem cabeça, tronco, braços, mãos, pernas e pés.</p>
        </article>
        <article className="workflow-step">
          <span>03 / BUILD</span>
          <h3>Frente pixel a pixel</h3>
          <p>A grade nativa preserva cada pixel da imagem como um cubo frontal separado.</p>
        </article>
        <article className="workflow-step">
          <span>04 / EDIT + SHIP</span>
          <h3>GLB ainda editável</h3>
          <p>Recolora, mova ou remova partes e voxels individuais antes de exportar.</p>
        </article>
      </section>
    </main>
  );
}
