import { GenerateVideosOperation, Modality } from "@google/genai";
import type { AspectRatio, GenerateRequest, GenerateResult, MediaOutput } from "@/lib/types";
import { googleClient } from "../config";

export async function generateGoogleImage(req: GenerateRequest): Promise<GenerateResult> {
  const ai = googleClient();

  if (req.model.includes("imagen")) {
    const res = await ai.models.generateImages({
      model: req.model,
      prompt: req.prompt,
      config: { numberOfImages: 1, aspectRatio: req.aspectRatio, includeRaiReason: true },
    });
    const outputs: MediaOutput[] = [];
    let filtered: string | undefined;
    for (const img of res.generatedImages ?? []) {
      if (img.image?.imageBytes) {
        outputs.push({
          type: "base64",
          mime: img.image.mimeType ?? "image/png",
          data: img.image.imageBytes,
        });
      } else if (img.raiFilteredReason) {
        filtered = img.raiFilteredReason;
      }
    }
    if (outputs.length) return { status: "succeeded", outputs };
    return { status: "failed", error: filtered ?? "Модель не вернула изображение." };
  }

  // Gemini image models ("Nano Banana") answer through generateContent.
  const res = await ai.models.generateContent({
    model: req.model,
    contents: req.prompt,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: req.aspectRatio },
    },
  });
  const outputs: MediaOutput[] = [];
  let text = "";
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/")) {
      outputs.push({ type: "base64", mime: part.inlineData.mimeType, data: part.inlineData.data });
    } else if (part.text && !part.thought) {
      text += part.text;
    }
  }
  if (outputs.length) return { status: "succeeded", outputs };
  return { status: "failed", error: text.trim() || "Модель не вернула изображение." };
}

/** Veo only renders landscape or portrait. */
function veoAspect(ratio: AspectRatio): "16:9" | "9:16" {
  return ratio === "9:16" || ratio === "3:4" ? "9:16" : "16:9";
}

function videoResult(op: GenerateVideosOperation): GenerateResult {
  if (!op.done) return { status: "pending", jobId: op.name ?? "" };
  if (op.error) {
    const message = typeof op.error.message === "string" ? op.error.message : JSON.stringify(op.error);
    return { status: "failed", error: message };
  }
  const outputs: MediaOutput[] = [];
  for (const v of op.response?.generatedVideos ?? []) {
    if (v.video?.videoBytes) {
      outputs.push({ type: "base64", mime: v.video.mimeType ?? "video/mp4", data: v.video.videoBytes });
    } else if (v.video?.uri) {
      outputs.push({ type: "url", url: v.video.uri });
    }
  }
  if (outputs.length) return { status: "succeeded", outputs };
  const reasons = op.response?.raiMediaFilteredReasons?.join("; ");
  return { status: "failed", error: reasons || "Видео не сгенерировано (возможно, сработал фильтр безопасности)." };
}

export async function startGoogleVideo(req: GenerateRequest): Promise<GenerateResult> {
  const op = await googleClient().models.generateVideos({
    model: req.model,
    source: { prompt: req.prompt },
    config: { numberOfVideos: 1, aspectRatio: veoAspect(req.aspectRatio) },
  });
  return videoResult(op);
}

export async function checkGoogleVideo(jobId: string): Promise<GenerateResult> {
  const pending = new GenerateVideosOperation();
  pending.name = jobId;
  const op = await googleClient().operations.getVideosOperation({ operation: pending });
  return videoResult(op);
}
