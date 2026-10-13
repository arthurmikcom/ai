import type OpenAI from "openai";
import type { AspectRatio, GenerateRequest, GenerateResult, MediaOutput } from "@/lib/types";
import { openAIClient } from "../config";

const GPT_IMAGE_SIZES: Record<AspectRatio, "1024x1024" | "1536x1024" | "1024x1536"> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "4:3": "1536x1024",
  "9:16": "1024x1536",
  "3:4": "1024x1536",
};

const DALLE_SIZES: Record<AspectRatio, "1024x1024" | "1792x1024" | "1024x1792"> = {
  "1:1": "1024x1024",
  "16:9": "1792x1024",
  "4:3": "1792x1024",
  "9:16": "1024x1792",
  "3:4": "1024x1792",
};

export async function generateOpenAIImage(req: GenerateRequest): Promise<GenerateResult> {
  const client = openAIClient("openai");
  const dalle = req.model.startsWith("dall-e");

  const params: OpenAI.ImageGenerateParamsNonStreaming = dalle
    ? {
        model: req.model,
        prompt: req.prompt,
        size: DALLE_SIZES[req.aspectRatio],
        response_format: "b64_json",
      }
    : { model: req.model, prompt: req.prompt, size: GPT_IMAGE_SIZES[req.aspectRatio] };

  const res = await client.images.generate(params);
  const mime = `image/${res.output_format ?? "png"}`;
  const outputs: MediaOutput[] = (res.data ?? []).flatMap((d): MediaOutput[] => {
    if (d.b64_json) return [{ type: "base64", mime, data: d.b64_json }];
    return [];
  });

  if (outputs.length === 0) return { status: "failed", error: "Модель не вернула изображение." };
  return { status: "succeeded", outputs };
}
