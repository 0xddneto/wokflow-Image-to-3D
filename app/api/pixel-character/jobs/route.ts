const PIXELLAB_BASE_URL = "https://api.pixellab.ai/v2";
const MAX_REFERENCE_LENGTH = 4_000_000;

function getSecret() {
  return process.env.PIXELLAB_SECRET ?? process.env.PIXELLAB_API_TOKEN;
}

function errorResponse(message: string, status: number, code: string) {
  return Response.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const secret = getSecret();
  if (!secret) {
    return errorResponse(
      "O motor de IA multivista ainda não foi configurado neste servidor.",
      503,
      "PIXELLAB_NOT_CONFIGURED",
    );
  }

  let body: { referenceImage?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Corpo JSON inválido.", 400, "INVALID_JSON");
  }

  const referenceImage = typeof body.referenceImage === "string" ? body.referenceImage : "";
  const description = typeof body.description === "string"
    ? body.description.trim().slice(0, 2000)
    : "pixel art humanoid character, preserve anatomy, proportions, colors and silhouette";

  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(referenceImage)) {
    return errorResponse("Envie uma referência PNG, JPEG ou WebP válida.", 422, "INVALID_REFERENCE");
  }
  if (referenceImage.length > MAX_REFERENCE_LENGTH) {
    return errorResponse("A imagem de referência é grande demais.", 413, "REFERENCE_TOO_LARGE");
  }

  const formatMatch = referenceImage.match(/^data:image\/(png|jpeg|webp);base64,/i);
  const format = formatMatch?.[1]?.toLowerCase() ?? "png";

  const upstream = await fetch(`${PIXELLAB_BASE_URL}/generate-8-rotations-v3`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      first_frame: {
        type: "base64",
        base64: referenceImage,
        format,
      },
      description: description || undefined,
      no_background: true,
      seed: 0,
    }),
  });

  const responseBody = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!upstream.ok) {
    const detail = typeof responseBody?.detail === "string"
      ? responseBody.detail
      : upstream.status === 401
        ? "A chave do motor de IA é inválida."
        : upstream.status === 402
          ? "A conta do motor de IA está sem créditos."
          : upstream.status === 429
            ? "O motor de IA está ocupado. Tente novamente em instantes."
            : "O motor de IA recusou a geração.";
    return errorResponse(detail, upstream.status, "PIXELLAB_SUBMIT_FAILED");
  }

  const jobId = typeof responseBody?.background_job_id === "string"
    ? responseBody.background_job_id
    : "";
  if (!jobId) {
    return errorResponse("O motor não devolveu um identificador de geração.", 502, "MISSING_JOB_ID");
  }

  return Response.json({ jobId, status: responseBody?.status ?? "processing" });
}
