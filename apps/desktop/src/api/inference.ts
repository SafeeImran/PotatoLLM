import { api, CORE_BASE_URL } from "./client";
import type {
  AvailableModel,
  ChatMessage,
  GenerationParams,
  InferenceStats,
  InferenceStatus,
  RuntimeDefaults,
  RuntimeOptions,
  RequestedRole,
  SlotRole,
} from "./types";

export const inferenceApi = {
  availableModels: () => api.get<AvailableModel[]>("/inference/available-models"),
  status: () => api.get<InferenceStatus>("/inference/status"),
  /** Hardware-detected values behind the Auto positions of the runtime controls. */
  runtimeDefaults: () => api.get<RuntimeDefaults>("/inference/runtime-defaults"),
  /** Brings a model up in its own slot. Several can be resident at once. */
  load: (modelArtifactId: string, runtime?: RuntimeOptions, role: RequestedRole = "auto") =>
    api.post<InferenceStatus>("/inference/load", {
      model_artifact_id: modelArtifactId,
      runtime,
      role,
    }),
  /** Unloads one slot, or every slot when no artifact is named. */
  unload: (modelArtifactId?: string) =>
    api.post<InferenceStatus>("/inference/unload", { model_artifact_id: modelArtifactId ?? null }),
  /** Hands the answering role to an already-loaded model. */
  setPrimary: (modelArtifactId: string) =>
    api.post<InferenceStatus>("/inference/primary", { model_artifact_id: modelArtifactId }),
  benchmark: () => api.post<InferenceStats>("/inference/benchmark"),
};

/**
 * A record from the generation stream.
 *
 * `handoff` announces that a *different* loaded model contributed before the
 * answer — today that is the vision slot describing an attached image. It is
 * surfaced rather than folded silently into the reply, so the transcript can
 * show whose observation it was.
 */
export type GenerateChunk =
  | { delta: string }
  | { reasoning: string }
  | {
      /** A hand-off has begun — emitted before the wait, so the UI can say who
       *  is holding the turn up rather than showing a silent gap. */
      handoff_started: { role: SlotRole; model_name: string; artifact_id: string };
    }
  | {
      handoff: {
        role: SlotRole;
        model_name: string;
        artifact_id: string;
        content: string;
        /** The hand-off was attempted and failed; `content` is why. */
        failed?: boolean;
      };
    }
  | { done: true; stats: InferenceStats }
  | { error: string };

/**
 * Streams a chat completion as NDJSON lines (see api/inference.py's
 * StreamingResponse) — fetch's ReadableStream rather than EventSource,
 * since EventSource can't send a POST body.
 */
export async function streamGenerate(
  messages: ChatMessage[],
  params: GenerationParams,
  onChunk: (chunk: GenerateChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${CORE_BASE_URL}/inference/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...params }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Generation request failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) onChunk(JSON.parse(line) as GenerateChunk);
    }
  }
}
