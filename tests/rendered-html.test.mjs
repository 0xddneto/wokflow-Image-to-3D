import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Image to 3D studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Image to 3D — Pixel Character &amp; Voxel Studio<\/title>/i);
  assert.match(html, /Uma imagem entra/);
  assert.match(html, /Pixel Character/);
  assert.match(html, /Pixel 3D/);
  assert.match(html, /1, 2, 4 ou 8 direções/);
  assert.match(html, /não editável/);
  assert.match(html, /Quantidade de direções/);
  assert.match(html, /IA multivista/);
  assert.match(html, /qualidade PixelLab/);
  assert.match(html, /Requer PIXELLAB_SECRET no servidor/);
  assert.match(html, /Local experimental/);
  assert.match(html, /Exportar spritesheet PNG/);
  assert.match(html, /semantic anatomy v5/);
  assert.match(html, /Identidade em direções/);
  assert.match(html, /modelo reconstrói anatomia, silhueta e sobreposição/);
  assert.match(html, /Edição só no Pixel 3D/);
  assert.doesNotMatch(html, /Partes editáveis|Cor da parte|Selecione uma parte/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});

test("ships the canonical MOB example without coupling the tool to MOBs", async () => {
  const [page, studio, layout, packageJson, example, submitRoute, pollRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/image-to-3d-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/examples/mobs-base.png", import.meta.url)),
    readFile(new URL("../app/api/pixel-character/jobs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pixel-character/jobs/[jobId]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /ImageTo3DStudio/);
  assert.match(studio, /createProceduralAsset/);
  assert.match(studio, /type OutputMode = "pixel-character" \| "pixel-3d"/);
  assert.match(studio, /const DIRECTION_SETS/);
  assert.match(studio, /DIRECTION_SETS\[directionCount\]/);
  assert.match(studio, /requestDirectionalGeneration/);
  assert.match(studio, /generateNativeSpriteSet/);
  assert.match(studio, /spriteEngine === "ai-multiview"/);
  assert.match(studio, /\/api\/pixel-character\/jobs/);
  assert.match(studio, /downloadDirectionSheet/);
  assert.match(studio, /Exportar spritesheet PNG/);
  assert.doesNotMatch(studio, /aguardando conexão do motor de IA/);
  assert.match(studio, /Contrato interno de 8 vistas/);
  assert.match(studio, /Pixel nativo/);
  assert.match(studio, /Ferramentas de edição de pixels/);
  assert.match(studio, /Tamanho do pixel/);
  assert.match(studio, /Editar seleção/);
  assert.match(studio, /Exportar GLB/);
  assert.match(studio, /GLTFExporter/);
  assert.match(studio, /ImageTo3D_EditableCharacter/);
  assert.match(studio, /classifyCharacterPart/);
  assert.match(studio, /selectAllPixels/);
  assert.match(studio, /invertSelection/);
  assert.match(studio, /recolorSelection/);
  assert.match(studio, /nudgeSelection/);
  assert.match(layout, /\/og\.png/);
  assert.match(packageJson, /"three"/);
  assert.match(packageJson, /"@mediapipe\/tasks-vision"/);
  assert.match(studio, /PoseLandmarker/);
  assert.match(studio, /inferSemanticSkeleton/);
  assert.match(studio, /buildAnatomyPrimitives/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(submitRoute, /generate-8-rotations-v3/);
  assert.match(submitRoute, /process\.env\.PIXELLAB_SECRET/);
  assert.match(pollRoute, /background-jobs/);
  assert.match(pollRoute, /normalizeImages/);
  assert.doesNotMatch(studio, /process\.env\.PIXELLAB_SECRET/);

  const hash = createHash("sha256").update(example).digest("hex").toUpperCase();
  assert.equal(hash, "67CA2D2A95DF8F79DF891CFB7D4494716615AB8D2AE5C657152D3B077C36319E");

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/models/pose_landmarker_lite.task", import.meta.url));
  await access(new URL("../public/mediapipe/wasm/vision_wasm_internal.wasm", import.meta.url));
  await access(new URL("../app/native-sprite-engine.ts", import.meta.url));
  await access(new URL("../.env.example", import.meta.url));
  await access(new URL(".openai/hosting.json", templateRoot));
});
