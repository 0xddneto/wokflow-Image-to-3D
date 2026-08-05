export type NativeSpriteDirection =
  | "south"
  | "south-east"
  | "east"
  | "north-east"
  | "north"
  | "north-west"
  | "west"
  | "south-west";

type RGB = { red: number; green: number; blue: number };
type SpritePalette = {
  outline: string;
  base: string;
  shade: string;
  highlight: string;
  colors: RGB[];
};

const LOCAL_ATLAS_PATH = "/models/mobs-canonical-directions";

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function mix(color: RGB, target: RGB, amount: number): RGB {
  return {
    red: clampByte(color.red + (target.red - color.red) * amount),
    green: clampByte(color.green + (target.green - color.green) * amount),
    blue: clampByte(color.blue + (target.blue - color.blue) * amount),
  };
}

function hex(color: RGB) {
  return `#${[color.red, color.green, color.blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color: RGB) {
  return color.red * 0.2126 + color.green * 0.7152 + color.blue * 0.0722;
}

function colorDistance(a: RGB, b: RGB) {
  return (a.red - b.red) ** 2 + (a.green - b.green) ** 2 + (a.blue - b.blue) ** 2;
}

function extractPalette(image: HTMLImageElement): SpritePalette {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D indisponível");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const corners = [
    0,
    (canvas.width - 1) * 4,
    (canvas.height - 1) * canvas.width * 4,
    (canvas.height * canvas.width - 1) * 4,
  ];
  const corner: RGB = corners.reduce((result, index) => ({
    red: result.red + pixels[index] / corners.length,
    green: result.green + pixels[index + 1] / corners.length,
    blue: result.blue + pixels[index + 2] / corners.length,
  }), { red: 0, green: 0, blue: 0 });
  const opaqueCorners = corners.every((index) => pixels[index + 3] > 245);
  const counts = new Map<string, { color: RGB; count: number }>();

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 80) continue;
    const color = { red: pixels[index], green: pixels[index + 1], blue: pixels[index + 2] };
    if (opaqueCorners && colorDistance(color, corner) < 850) continue;
    const quantized = {
      red: Math.round(color.red / 8) * 8,
      green: Math.round(color.green / 8) * 8,
      blue: Math.round(color.blue / 8) * 8,
    };
    const key = `${quantized.red}:${quantized.green}:${quantized.blue}`;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { color: quantized, count: 1 });
  }

  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  const base = ranked.find((entry) => luminance(entry.color) > 70)?.color ?? { red: 205, green: 169, blue: 143 };
  const darkest = [...ranked]
    .filter((entry) => entry.count > 2)
    .sort((a, b) => luminance(a.color) - luminance(b.color))[0]?.color;
  const outline = darkest && luminance(darkest) < luminance(base) * 0.72
    ? mix(darkest, base, 0.12)
    : mix(base, { red: 15, green: 12, blue: 10 }, 0.72);
  const shade = mix(base, outline, 0.24);
  const highlight = mix(base, { red: 255, green: 244, blue: 228 }, 0.2);
  return {
    outline: hex(outline),
    base: hex(base),
    shade: hex(shade),
    highlight: hex(highlight),
    colors: [outline, base, shade, highlight],
  };
}

function ellipse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  palette: SpritePalette,
  fill = palette.base,
) {
  context.beginPath();
  context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
}

function capsule(
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  width: number,
  palette: SpritePalette,
  fill = palette.base,
) {
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.lineTo(toX, toY);
  context.strokeStyle = fill;
  context.lineWidth = width;
  context.stroke();
}

function seam(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  palette: SpritePalette,
  color = palette.outline,
) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(...points[0]);
  points.slice(1).forEach((point) => context.lineTo(...point));
  context.strokeStyle = color;
  context.lineWidth = 0.85;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

function shadeEllipse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  color: string,
) {
  context.beginPath();
  context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function drawFront(context: CanvasRenderingContext2D, palette: SpritePalette) {
  drawBack(context, palette);
  ellipse(context, 32, 37.8, 7.3, 7.1, palette);
  shadeEllipse(context, 27.7, 38, 1.6, 5.3, palette.shade);
  context.fillStyle = palette.shade;
  context.fillRect(31, 40, 2, 1);
  seam(context, [[27, 36.2], [28.8, 32.8], [35.2, 32.8], [37, 36.2]], palette, palette.shade);
  seam(context, [[26.4, 32], [25.8, 37], [25.2, 42]], palette);
  seam(context, [[37.6, 32], [38.2, 37], [38.8, 42]], palette);
}

function drawBack(context: CanvasRenderingContext2D, palette: SpritePalette) {
  capsule(context, 28.3, 42, 27.8, 51.7, 4.5, palette, palette.shade);
  capsule(context, 35.7, 42, 36.2, 51.7, 4.5, palette);
  capsule(context, 27.2, 53, 25.1, 54.1, 5, palette, palette.shade);
  capsule(context, 36.8, 53, 38.9, 54.1, 5, palette);
  capsule(context, 23.8, 31.8, 22.7, 42.4, 4, palette, palette.shade);
  capsule(context, 40.2, 31.8, 41.3, 42.4, 4, palette);
  ellipse(context, 32, 36.4, 8.4, 10.1, palette);
  shadeEllipse(context, 27.4, 35.7, 2, 7, palette.shade);
  context.strokeStyle = palette.shade;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(32, 42, 4.3, 0.18, Math.PI - 0.18);
  context.stroke();
  ellipse(context, 21.2, 19.7, 2.2, 3, palette, palette.shade);
  ellipse(context, 42.8, 19.7, 2.2, 3, palette);
  ellipse(context, 32, 18, 10.4, 12, palette);
  shadeEllipse(context, 26.3, 16.5, 2.3, 8.1, palette.shade);
  shadeEllipse(context, 35.5, 11.5, 3.2, 1.4, palette.highlight);
  seam(context, [[26.7, 28.4], [30, 29.2], [34, 29.2], [37.3, 28.4]], palette);
  seam(context, [[26.2, 32], [25.7, 37.5], [25.2, 42]], palette);
  seam(context, [[37.8, 32], [38.3, 37.5], [38.8, 42]], palette);
  seam(context, [[32, 44], [32, 52.5]], palette);
}

function drawProfile(context: CanvasRenderingContext2D, palette: SpritePalette) {
  capsule(context, 29.6, 41.4, 29, 51.5, 4.4, palette, palette.shade);
  capsule(context, 34.8, 41.8, 35.4, 51.5, 4.5, palette);
  capsule(context, 29, 53, 27.1, 54.2, 4.9, palette, palette.shade);
  capsule(context, 35.7, 53, 39.1, 54.2, 5, palette);
  capsule(context, 29.7, 31, 29.2, 42, 3.9, palette, palette.shade);
  ellipse(context, 33.2, 36.3, 7.4, 10.2, palette);
  shadeEllipse(context, 29.1, 35.5, 2, 7.2, palette.shade);
  ellipse(context, 37.2, 38, 4.5, 6.5, palette);
  capsule(context, 37.1, 30.6, 39.1, 41.4, 4, palette);
  ellipse(context, 39.6, 43, 2.3, 2.8, palette);
  ellipse(context, 28.3, 19.8, 2.3, 3.1, palette, palette.shade);
  ellipse(context, 33.6, 18, 9.8, 12, palette);
  shadeEllipse(context, 28.1, 16.2, 2.2, 8.1, palette.shade);
  shadeEllipse(context, 37.1, 11.7, 3, 1.4, palette.highlight);
  context.strokeStyle = palette.shade;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(36.8, 38.8, 3.2, 1.2, 2.5);
  context.stroke();
  seam(context, [[29, 28.5], [32.5, 29.4], [36.5, 28.7]], palette);
  seam(context, [[35.4, 31.5], [36.6, 36], [38.3, 41.5]], palette);
  seam(context, [[32.3, 44], [32.6, 52.4]], palette);
  seam(context, [[27.2, 18.7], [28.7, 19.4], [27.5, 21.1]], palette, palette.shade);
}

function drawQuarter(context: CanvasRenderingContext2D, palette: SpritePalette, back: boolean) {
  drawBack(context, palette);
  shadeEllipse(context, 27.4, 34.8, 1.8, 7.2, palette.shade);
  if (!back) {
    ellipse(context, 35, 38, 5.2, 6.5, palette);
    shadeEllipse(context, 31.7, 38, 1.3, 4.8, palette.shade);
    context.fillStyle = palette.shade;
    context.fillRect(35, 40, 2, 1);
  }
  capsule(context, 38.3, 31.1, 40, 41.8, 4, palette);
  ellipse(context, 40.5, 43.5, 2.25, 2.75, palette);
  seam(context, [[27.3, 31.8], [26.4, 37], [25.4, 41.8]], palette);
  seam(context, [[36.6, 31.5], [38.1, 36.7], [39.5, 41.7]], palette);
}

function quantize(context: CanvasRenderingContext2D, palette: SpritePalette) {
  const image = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] < 54) {
      image.data[index + 3] = 0;
      continue;
    }
    const color = { red: image.data[index], green: image.data[index + 1], blue: image.data[index + 2] };
    const closest = palette.colors.reduce((best, candidate) => (
      colorDistance(color, candidate) < colorDistance(color, best) ? candidate : best
    ), palette.colors[0]);
    image.data[index] = closest.red;
    image.data[index + 1] = closest.green;
    image.data[index + 2] = closest.blue;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function addExteriorOutline(context: CanvasRenderingContext2D, palette: SpritePalette) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const image = context.getImageData(0, 0, width, height);
  const source = new Uint8ClampedArray(image.data);
  const outline = palette.colors[0];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      if (source[index + 3] !== 0) continue;
      let touchesBody = false;
      for (let offsetY = -1; offsetY <= 1 && !touchesBody; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighbor = ((y + offsetY) * width + x + offsetX) * 4;
          if (source[neighbor + 3] > 0) {
            touchesBody = true;
            break;
          }
        }
      }
      if (!touchesBody) continue;
      image.data[index] = outline.red;
      image.data[index + 1] = outline.green;
      image.data[index + 2] = outline.blue;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function renderNativeDirection(direction: NativeSpriteDirection, palette: SpritePalette, outputSize: number) {
  const native = document.createElement("canvas");
  native.width = 64;
  native.height = 64;
  const context = native.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D indisponível");
  context.imageSmoothingEnabled = false;
  const mirrored = direction === "west" || direction === "north-west" || direction === "south-west";
  if (mirrored) {
    context.translate(64, 0);
    context.scale(-1, 1);
  }
  if (direction === "south") drawFront(context, palette);
  else if (direction === "north") drawBack(context, palette);
  else if (direction === "east" || direction === "west") drawProfile(context, palette);
  else drawQuarter(context, palette, direction === "north-east" || direction === "north-west");
  context.setTransform(1, 0, 0, 1, 0, 0);
  quantize(context, palette);
  addExteriorOutline(context, palette);

  const output = document.createElement("canvas");
  output.width = outputSize;
  output.height = outputSize;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("Canvas de exportação indisponível");
  outputContext.imageSmoothingEnabled = false;
  const renderedSize = Math.min(outputSize, 128);
  const offset = Math.floor((outputSize - renderedSize) / 2);
  outputContext.drawImage(native, offset, offset, renderedSize, renderedSize);
  return output.toDataURL("image/png");
}

export function generateNativeSpriteSet(
  image: HTMLImageElement,
  directions: NativeSpriteDirection[],
  outputSize = 128,
) {
  const palette = extractPalette(image);
  return Object.fromEntries(
    directions.map((direction) => [direction, renderNativeDirection(direction, palette, outputSize)]),
  ) as Partial<Record<NativeSpriteDirection, string>>;
}

function placeNativeFrame(native: HTMLCanvasElement, outputSize: number) {
  const output = document.createElement("canvas");
  output.width = outputSize;
  output.height = outputSize;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas de exportação indisponível");
  context.imageSmoothingEnabled = false;
  const offsetX = Math.floor((outputSize - native.width) / 2);
  const offsetY = Math.floor((outputSize - native.height) / 2);
  context.drawImage(native, offsetX, offsetY);
  return output.toDataURL("image/png");
}

function loadAtlasFrame(direction: NativeSpriteDirection) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Falha ao carregar a vista local ${direction}`));
    image.src = `${LOCAL_ATLAS_PATH}/${direction}.png`;
  });
}

function applyReferencePalette(
  context: CanvasRenderingContext2D,
  sourcePalette: SpritePalette,
  targetPalette: SpritePalette,
) {
  const frame = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  for (let index = 0; index < frame.data.length; index += 4) {
    if (frame.data[index + 3] < 54) {
      frame.data[index + 3] = 0;
      continue;
    }
    const source = {
      red: frame.data[index],
      green: frame.data[index + 1],
      blue: frame.data[index + 2],
    };
    const paletteIndex = sourcePalette.colors.reduce(
      (best, candidate, candidateIndex) => (
        colorDistance(source, candidate) < colorDistance(source, sourcePalette.colors[best])
          ? candidateIndex
          : best
      ),
      0,
    );
    const color = targetPalette.colors[paletteIndex];
    frame.data[index] = color.red;
    frame.data[index + 1] = color.green;
    frame.data[index + 2] = color.blue;
    frame.data[index + 3] = 255;
  }
  context.putImageData(frame, 0, 0);
}

function palettesMatch(source: SpritePalette, target: SpritePalette) {
  return source.colors.reduce(
    (distance, color, index) => distance + colorDistance(color, target.colors[index]),
    0,
  ) < 1200;
}

/**
 * Local MOB renderer. The user-authored eight-view atlas is the canonical 2D
 * body rig. Matching references reuse it exactly; color variants transfer only
 * palette indices and preserve every contour and anatomical pixel.
 */
export async function generateCanonicalMobSpriteSet(
  image: HTMLImageElement,
  directions: NativeSpriteDirection[],
  outputSize = 256,
) {
  const targetPalette = extractPalette(image);
  const nativeSize = Math.min(228, outputSize);
  const generated: Partial<Record<NativeSpriteDirection, string>> = {};
  for (const direction of directions) {
    const atlasFrame = await loadAtlasFrame(direction);
    const sourcePalette = extractPalette(atlasFrame);
    if (nativeSize === atlasFrame.naturalWidth && palettesMatch(sourcePalette, targetPalette)) {
      generated[direction] = atlasFrame.src;
      continue;
    }
    const native = document.createElement("canvas");
    native.width = nativeSize;
    native.height = nativeSize;
    const context = native.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D indisponível");
    context.imageSmoothingEnabled = false;
    context.drawImage(atlasFrame, 0, 0, nativeSize, nativeSize);
    applyReferencePalette(context, sourcePalette, targetPalette);
    generated[direction] = placeNativeFrame(native, outputSize);
  }
  return generated;
}
