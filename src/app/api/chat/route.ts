import { streamChat } from "@/lib/server/chat";
import { describeError } from "@/lib/server/errors";
import { parseChatRequest } from "@/lib/server/validate";
import type { ChatStreamEvent } from "@/lib/types";

// Long answers from reasoning models can take several minutes.
export const maxDuration = 300;

/** Streams the answer as newline-delimited JSON (one ChatStreamEvent per line). */
export async function POST(request: Request) {
  const req = parseChatRequest(await request.json().catch(() => null));
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The client went away; nothing left to deliver.
        }
      };
      try {
        for await (const event of streamChat(req, request.signal)) send(event);
        send({ type: "done" });
      } catch (err) {
        if (!request.signal.aborted) {
          console.error("[chat]", req.provider, req.model, err);
          send({ type: "error", message: describeError(err) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
