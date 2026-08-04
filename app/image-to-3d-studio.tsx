"use client";

import {
  Box,
  CircleCheck,
  Download,
  Grid3X3,
  Image as ImageIcon,
  Layers3,
  RotateCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type GenerationMode = "pixel" | "relief";
type ViewName = "front" | "quarter" | "side";

type Metrics = {
  source: string;
  grid: string;
  elements: number;
  triangles: number;
};

type BuildOptions = {
  mode: GenerationMode;
  resolution: number;
  depth: number;
  threshold: number;
};

const EMPTY_METRICS: Metrics = {
  source: "—",
  grid: "—",
  elements: 0,
  triangles: 0,
};

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

function setGeometryColor(
  geometry: THREE.BufferGeometry,
  red: number,
  green: number,
  blue: number,
) {
  const count = geometry.getAttribute("position").count;
  const values = new Float32Array(count * 3);
  const color = new THREE.Color(red / 255, green / 255, blue / 255);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = color.r;
    values[index * 3 + 1] = color.g;
    values[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
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
  const effectiveResolution = Math.min(
    options.resolution,
    options.mode === "relief" ? 34 : 58,
  );
  const maxDimension = Math.max(image.naturalWidth, image.naturalHeight);
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
  const cell = 3.2 / Math.max(width, height);
  const geometries: THREE.BufferGeometry[] = [];
  let elements = 0;

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

      const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      const depth = options.depth * (
        options.mode === "pixel"
          ? 0.74 + (1 - luminance) * 0.34
          : 0.5 + (1 - luminance) * 0.92
      );
      const geometry = options.mode === "pixel"
        ? new THREE.BoxGeometry(cell * 0.985, cell * 0.985, depth)
        : new RoundedBoxGeometry(
            cell * 1.06,
            cell * 1.06,
            depth,
            2,
            Math.min(cell * 0.23, depth * 0.22),
          );

      setGeometryColor(geometry, red, green, blue);
      geometry.translate(
        (x - (width - 1) / 2) * cell,
        ((height - 1) / 2 - y) * cell,
        depth / 2,
      );
      geometries.push(geometry);
      elements += 1;
    }
  }

  if (geometries.length === 0) {
    throw new Error("Nenhum primeiro plano foi detectado. Reduza o recorte de fundo.");
  }

  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  if (!merged) throw new Error("Não foi possível consolidar a geometria");
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: options.mode === "pixel" ? 0.76 : 0.58,
    metalness: 0,
    clearcoat: options.mode === "relief" ? 0.14 : 0,
    clearcoatRoughness: 0.8,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = options.mode === "pixel" ? "Pixel3D_Geometry" : "SmoothRelief_Geometry";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = "ImageTo3D_Asset";
  group.add(mesh);
  group.userData.generation = {
    mode: options.mode,
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    sampleWidth: width,
    sampleHeight: height,
    elements,
  };

  return {
    group,
    metrics: {
      source: `${image.naturalWidth}×${image.naturalHeight}`,
      grid: `${width}×${height}`,
      elements,
      triangles: Math.round(merged.index ? merged.index.count / 3 : merged.getAttribute("position").count / 3),
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
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const spinRef = useRef(false);

  const [mode, setMode] = useState<GenerationMode>("pixel");
  const [resolution, setResolution] = useState(42);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewer = viewerRef.current;
    if (!canvas || !viewer) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0c1116, 8, 13);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
    camera.position.set(0, 0.05, 5.5);
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

    const key = new THREE.DirectionalLight(0xffe5d2, 4.6);
    key.position.set(-3.5, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa9c8ff, 2.1);
    fill.position.set(4, 1.5, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xa8ffcf, 2.5);
    rim.position.set(1, 3, -5);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x1b222a, 1.5));

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.6, 72),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.3 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.72, 0.3);
    floor.receiveShadow = true;
    scene.add(floor);

    const resize = () => {
      const { width, height } = viewer.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewer);
    resize();

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), 0.05);
      if (spinRef.current) root.rotation.y += delta * 0.45;
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      observer.disconnect();
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
        setActiveView("front");
        setStatus("Geometria pronta");
      } catch (error) {
        setMetrics(EMPTY_METRICS);
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
      front: [0, 0.05, 5.5],
      quarter: [4.1, 0.55, 4.5],
      side: [5.6, 0.05, 0.2],
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

  const exportGlb = useCallback(async () => {
    const source = rootRef.current?.children[0];
    if (!source) return;
    setExporting(true);
    setStatus("Empacotando GLB…");
    try {
      const exporter = new GLTFExporter();
      const asset = source.clone(true);
      asset.name = "ImageTo3D_Export";
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
          <span className="status-dot" /> local geometry engine · alpha 0.1
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="intro-kicker">Reference-driven asset generation</p>
          <h1>Uma imagem entra. <em>Geometria editável sai.</em></h1>
        </div>
        <p className="intro-copy">
          Converta qualquer imagem isolada em Pixel 3D ou relevo suave. Ajuste a
          reconstrução ao vivo, inspecione todos os ângulos e exporte um GLB real.
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
              <strong>Pixel 3D</strong>
              <span>fidelidade frontal</span>
            </button>
            <button
              className={`mode-button ${mode === "relief" ? "is-active" : ""}`}
              type="button"
              onClick={() => setMode("relief")}
            >
              <Sparkles size={18} />
              <strong>Relevo</strong>
              <span>volumes suaves</span>
            </button>
          </div>

          <div className="divider" />
          <div className="sliders">
            <label className="slider-row">
              <span className="slider-label">Resolução <output>{resolution}</output></span>
              <input
                type="range"
                min="18"
                max="58"
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
              <small>live procedural preview</small>
              <strong>{mode === "pixel" ? "Pixel volume" : "Smooth relief"}</strong>
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
              <h2>Geometria</h2>
              <span className="step-number">03</span>
            </div>
            <div className="metric-grid">
              <div className="metric"><span>Origem</span><strong>{metrics.source}</strong></div>
              <div className="metric"><span>Amostra</span><strong>{metrics.grid}</strong></div>
              <div className="metric"><span>Elementos</span><strong>{metrics.elements.toLocaleString("pt-BR")}</strong></div>
              <div className="metric"><span>Triângulos</span><strong>{metrics.triangles.toLocaleString("pt-BR")}</strong></div>
            </div>
          </div>

          <div className="divider" />
          <div>
            <div className="panel-heading">
              <h3>Prontidão</h3>
              <CircleCheck size={14} color="#a8ffcf" />
            </div>
            <div className="readiness">
              <div className="readiness-row"><span>Geometria consolidada</span><b>ready</b></div>
              <div className="readiness-row"><span>Cores por vértice</span><b>ready</b></div>
              <div className="readiness-row"><span>Hierarchy GLTF</span><b>ready</b></div>
            </div>
          </div>

          <div>
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
          <span>02 / SAMPLE</span>
          <h3>Silhueta mensurável</h3>
          <p>Alpha e distância cromática separam o objeto do ambiente.</p>
        </article>
        <article className="workflow-step">
          <span>03 / BUILD</span>
          <h3>Geometria real</h3>
          <p>Volumes, normais, cores e hierarquia são gerados no navegador.</p>
        </article>
        <article className="workflow-step">
          <span>04 / SHIP</span>
          <h3>GLB interoperável</h3>
          <p>Abra no Blender, Three.js, Unity ou no pipeline do seu jogo.</p>
        </article>
      </section>
    </main>
  );
}
