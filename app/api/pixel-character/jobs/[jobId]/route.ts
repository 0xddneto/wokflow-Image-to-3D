const PIXELLAB_BASE_URL = "https://api.pixellab.ai/v2";
const DIRECTION_ORDER = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
] as const;

type PixelLabImage = {
  base64?: unknown;
  format?: unknown;
};

function getSecret() {
  return process.env.PIXELLAB_SECRET ?? process.env.PIXELLAB_API_TOKEN;
}

function asDataUrl(image: PixelLabImage | undefined) {
  if (!image || typeof image.base64 !== "string") return null;
  if (image.base64.startsWith("data:image/")) return image.base64;
  const format = typeof image.format === "string" ? image.format : "png";
  return `data:image/${format};base64,${image.base64}`;
}

function normalizeImages(value: unknown) {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      DIRECTION_ORDER.map((direction, index) => [direction, asDataUrl(value[index] as PixelLabImage)]),
    );
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, PixelLabImage>;
    return Object.fromEntries(
      DIRECTION_ORDER.map((direction) => [direction, asDataUrl(record[direction])]),
    );
  }
  return {};
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const secret = getSecret();
  if (!secret) {
    return Response.json(
      { error: "O motor de IA multivista ainda não foi configurado neste servidor.", code: "PIXELLAB_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const { jobId } = await context.params;
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(jobId)) {
    return Response.json({ error: "Identificador de geração inválido." }, { status: 400 });
  }

  const upstream = await fetch(`${PIXELLAB_BASE_URL}/background-jobs/${encodeURIComponent(jobId)}`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const responseBody = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!upstream.ok) {
    return Response.json(
      { error: typeof responseBody?.detail === "string" ? responseBody.detail : "Falha ao consultar a geração." },
      { status: upstream.status },
    );
  }

  const status = typeof responseBody?.status === "string" ? responseBody.status : "processing";
  const lastResponse = responseBody?.last_response && typeof responseBody.last_response === "object"
    ? responseBody.last_response as Record<string, unknown>
    : null;
  if (status === "failed") {
    const detail = lastResponse && typeof lastResponse.detail === "string"
      ? lastResponse.detail
      : "O motor de IA não conseguiu gerar as direções.";
    return Response.json({ status, error: detail });
  }
  if (status !== "completed") return Response.json({ status });

  const images = normalizeImages(lastResponse?.images);
  const readyCount = Object.values(images).filter(Boolean).length;
  if (readyCount !== DIRECTION_ORDER.length) {
    return Response.json(
      { status: "failed", error: `A geração terminou, mas devolveu apenas ${readyCount} de 8 direções.` },
      { status: 502 },
    );
  }

  return Response.json({ status, images });
}
