export type ImageProbe = {
  ok: boolean;
  detail: string;
  models: string[];
};

export type ImageCapability = {
  openai: ImageProbe;
  gemini: ImageProbe;
  summary: string;
};

function openaiImageModel(id: string) {
  return /dall-e|gpt-image|imagen/i.test(id);
}

function geminiImageModel(id: string) {
  return /image/i.test(id);
}

export async function probeImageCapability(): Promise<ImageCapability> {
  const [openai, gemini] = await Promise.all([probeOpenAIImages(), probeGeminiImages()]);
  const bits: string[] = [];
  if (openai.ok) bits.push(`OpenAI images: ${openai.models.slice(0, 3).join(", ") || "yes"}`);
  else bits.push(`OpenAI images: ${openai.detail}`);
  if (gemini.ok) bits.push(`Gemini images: ${gemini.models.slice(0, 3).join(", ") || "yes"}`);
  else bits.push(`Gemini images: ${gemini.detail}`);
  return { openai, gemini, summary: bits.join(" · ") };
}

async function probeOpenAIImages(): Promise<ImageProbe> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, detail: "No OpenAI key", models: [] };
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) return { ok: false, detail: "OpenAI key invalid", models: [] };
    if (res.status === 429) return { ok: false, detail: "OpenAI quota / rate limit", models: [] };
    if (!res.ok) return { ok: false, detail: `OpenAI HTTP ${res.status}`, models: [] };
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((m) => m.id ?? "").filter(openaiImageModel);
    const wanted = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
    if (models.length === 0) {
      return {
        ok: false,
        detail: `This OpenAI key has no image models listed (need ${wanted} or DALL·E). Chat can work while images stay off.`,
        models: [],
      };
    }
    return { ok: true, detail: "Image models available", models };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "OpenAI image probe failed",
      models: [],
    };
  }
}

async function probeGeminiImages(): Promise<ImageProbe> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { ok: false, detail: "No Gemini key", models: [] };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
    );
    if (res.status === 400 || res.status === 403) {
      return { ok: false, detail: `Gemini key rejected (${res.status})`, models: [] };
    }
    if (res.status === 429) return { ok: false, detail: "Gemini quota", models: [] };
    if (!res.ok) return { ok: false, detail: `Gemini HTTP ${res.status}`, models: [] };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(geminiImageModel);
    if (models.length === 0) {
      return {
        ok: false,
        detail: "This Gemini key lists no image-generation models.",
        models: [],
      };
    }
    return { ok: true, detail: "Image models available", models };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "Gemini image probe failed",
      models: [],
    };
  }
}
