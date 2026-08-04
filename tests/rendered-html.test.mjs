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
  assert.match(html, /<title>Image to 3D — Procedural Asset Studio<\/title>/i);
  assert.match(html, /Uma imagem entra/);
  assert.match(html, /Pixel nativo/);
  assert.match(html, /Partes/);
  assert.match(html, /Selecione uma parte/);
  assert.match(html, /Exportar GLB/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});

test("ships the canonical MOB example without coupling the tool to MOBs", async () => {
  const [page, studio, layout, packageJson, example] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/image-to-3d-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/examples/mobs-base.png", import.meta.url)),
  ]);

  assert.match(page, /ImageTo3DStudio/);
  assert.match(studio, /createProceduralAsset/);
  assert.match(studio, /GLTFExporter/);
  assert.match(studio, /ImageTo3D_EditableCharacter/);
  assert.match(studio, /classifyCharacterPart/);
  assert.match(studio, /togglePartVisibility/);
  assert.match(studio, /recolorPart/);
  assert.match(studio, /movePart/);
  assert.match(layout, /\/og\.png/);
  assert.match(packageJson, /"three"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  const hash = createHash("sha256").update(example).digest("hex").toUpperCase();
  assert.equal(hash, "67CA2D2A95DF8F79DF891CFB7D4494716615AB8D2AE5C657152D3B077C36319E");

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL(".openai/hosting.json", templateRoot));
});
