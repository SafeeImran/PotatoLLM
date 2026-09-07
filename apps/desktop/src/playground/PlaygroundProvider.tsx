import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  useAvailableModels,
  useInferenceActions,
  useInferenceStatus,
  useRuntimeDefaults,
} from "../hooks/useInference";
import { useSetting } from "../hooks/useSettings";
import { streamGenerate } from "../api/inference";
import { deleteAttachment, pickAttachment } from "../api/attachments";
import type {
  Attachment,
  AvailableModel,
  ChatMessage,
  FlashAttentionMode,
  InferenceStats,
  InferenceStatus,
  KvCacheType,
  LoadedSlot,
  RuntimeDefaults,
  RequestedRole,
  SlotRole,
  RuntimeOptions,
} from "../api/types";

/** What a second model contributed before the answer — today, the vision
 *  slot's description of an attached image. */
export interface HandoffNote {
  role: SlotRole;
  model_name: string;
  artifact_id: string;
  content: string;
  /** The hand-off was attempted and failed; `content` carries the reason. */
  failed?: boolean;
}

export interface DisplayMessage extends ChatMessage {
  time: string;
  stats?: InferenceStats;
  /** Files sent with this turn, kept so the transcript can re-render its chips. */
  attachments?: Attachment[];
  /** Which loaded model wrote this, when more than one was resident. */
  modelName?: string;
  /** Work another model did for this turn, shown above the answer. */
  handoff?: HandoffNote;
  /** Chain-of-thought from a reasoning model, shown in a collapsible block. */
  reasoning?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: DisplayMessage[];
  updatedAt: number;
  /** Pinned chats sort into their own group above the rest. */
  pinned?: boolean;
  /** Archived chats leave the default list but stay on disk. */
  archived?: boolean;
}

/**
 * Sampling knobs. These ride along with every request, so a change takes
 * effect on the next message with no reload.
 */
export interface GenerationParams {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  minP: number;
  repeatPenalty: number;
  repeatLastN: number;
  /** -1 draws a fresh random seed per request; anything else pins the output. */
  seed: number;
}

/**
 * llama.cpp's load-time knobs — these are baked into the `llama-server`
 * process when a model is loaded, so editing one marks the session dirty and
 * takes effect only on the next load (see `runtimeDirty` / `reloadModel`).
 *
 * Each carries its own Auto sentinel rather than a nullable field, because
 * that is the shape the core's settings registry stores and validates:
 * 0 threads, 0 batch and -1 GPU layers all mean "detect it for me".
 */
export interface RuntimeSettings {
  contextLength: number;
  threads: number;
  gpuLayers: number;
  batchSize: number;
  flashAttention: FlashAttentionMode;
  kvCacheType: KvCacheType;
}

function toRuntimeOptions(runtime: RuntimeSettings): RuntimeOptions {
  return {
    context_length: runtime.contextLength,
    threads: runtime.threads,
    gpu_layers: runtime.gpuLayers,
    batch_size: runtime.batchSize,
    flash_attention: runtime.flashAttention,
    kv_cache_type: runtime.kvCacheType,
  };
}

function sameRuntime(a: RuntimeSettings, b: RuntimeSettings): boolean {
  return (
    a.contextLength === b.contextLength &&
    a.threads === b.threads &&
    a.gpuLayers === b.gpuLayers &&
    a.batchSize === b.batchSize &&
    a.flashAttention === b.flashAttention &&
    a.kvCacheType === b.kvCacheType
  );
}

/**
 * Playground state lives above the router because the prototype splits one
 * conversation across three panes: the sidebar lists it, the main pane renders
 * it, and the live monitor edits the parameters it generates with. Those panes
 * are siblings in the shell, so the state has to be their common ancestor.
 */
interface PlaygroundValue {
  conversations: Conversation[];
  activeId: string;
  activeConversation: Conversation;
  messages: DisplayMessage[];
  selectConversation: (id: string) => void;
  newConversation: () => void;
  /** Empties a chat's transcript but keeps the entry. */
  clearConversation: (id: string) => void;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  deleteConversation: (id: string) => void;

  draft: string;
  setDraft: (value: string) => void;
  /** Sends `draft` by default; an override lets a caller (the Lorenz idle-art
   * easter egg) ask something without a setDraft-then-send race against
   * send()'s own stale closure over `draft`. */
  send: (overrideText?: string) => void;
  stop: () => void;
  generating: boolean;
  /** Text streamed so far for the in-flight assistant turn. */
  streamText: string;
  /** Reasoning trace streamed so far from a <think> block, if the model emits one. */
  streamReasoning: string;
  /** Another model's contribution to the turn in flight, if there was one. */
  streamHandoff: HandoffNote | null;
  /** The model currently reading an attachment for the turn in flight. */
  streamWaitingOn: string | null;
  /**
   * Which conversation the in-flight turn belongs to. The stream is global —
   * one generation at a time — but it belongs to the chat it was sent from,
   * and every other chat must not render it as its own.
   */
  streamConversationId: string | null;

  params: GenerationParams;
  setParam: <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => void;
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;

  /** Load-time llama.cpp options being edited for the next load. */
  runtime: RuntimeSettings;
  setRuntimeOption: <K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]) => void;
  /** What each Auto position resolves to on this machine, for labelling. */
  runtimeDefaults: RuntimeDefaults | undefined;
  /** The running server no longer matches the knobs above. */
  runtimeDirty: boolean;
  /** Restarts the loaded model with the current runtime options. */
  reloadModel: () => void;

  models: AvailableModel[];
  status: InferenceStatus | undefined;
  loaded: boolean;
  loadingModel: boolean;
  loadError: string | null;
  /** Loads a model as the primary, replacing whoever held that role. */
  selectModel: (artifactId: string) => void;
  /** Unloads every slot. */
  unloadModel: () => void;

  /** Every resident model, in load order. */
  slots: LoadedSlot[];
  /** How many models may be resident at once (the `max_loaded_models` setting). */
  maxSlots: number;
  /**
   * Adds a model alongside the ones already loaded. The role defaults to
   * "auto", which lets the engine decide what the model is for.
   */
  addModel: (artifactId: string, role?: RequestedRole) => void;
  /** Unloads one slot, leaving the rest running. */
  removeModel: (artifactId: string) => void;
  /** Hands the answering role to an already-loaded model. */
  makePrimary: (artifactId: string) => void;
  /** The slot that will answer the next message. */
  responder: LoadedSlot | undefined;

  /**
   * Rolling tok/s samples for the sparkline. Live samples are ESTIMATED from
   * streamed characters (the core reports measured throughput only once, at
   * `done`); `lastStats` below carries the measured number.
   */
  tpsHistory: number[];
  liveTps: number;
  lastStats: InferenceStats | null;

  attachments: Attachment[];
  attaching: boolean;
  attachError: string | null;
  attachFile: () => void;
  removeAttachment: (id: string) => void;
}

const PlaygroundContext = createContext<PlaygroundValue | null>(null);

const STORAGE_KEY = "potatollm.playground.conversations";
const SPARK_SAMPLES = 44;
const SAMPLE_MS = 250;
/** Rough chars-per-token for the live estimate; the measured value replaces it at `done`. */
const CHARS_PER_TOKEN = 4;

function clockLabel(): string {
  return new Date().toTimeString().slice(0, 5);
}

function newId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The name a chat carries until its first message renames it. */
const NEW_CHAT_TITLE = "New chat";

function emptyConversation(): Conversation {
  return { id: newId(), title: NEW_CHAT_TITLE, messages: [], updatedAt: Date.now() };
}

/**
 * A chat nobody has said anything in yet, still carrying its default name.
 *
 * The title matters: an empty chat called something else was named by a turn
 * that has since been cleared, so it is a chat its owner kept deliberately.
 * Pinned and archived chats are excluded for the same reason.
 */
function isBlank(conversation: Conversation): boolean {
  return (
    conversation.messages.length === 0 &&
    conversation.title === NEW_CHAT_TITLE &&
    !conversation.pinned &&
    !conversation.archived
  );
}

/**
 * Keeps at most one empty chat.
 *
 * "New chat" used to mint a conversation per click with nothing stopping it,
 * so a stored list can hold a long run of identical empty rows. They are
 * indistinguishable from each other and from the one the button would make
 * next, so collapsing them to the newest loses nothing.
 */
function collapseBlanks(list: Conversation[]): Conversation[] {
  let kept = false;
  return list.filter((conversation) => {
    if (!isBlank(conversation)) return true;
    if (kept) return false;
    kept = true;
    return true;
  });
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return collapseBlanks(
      (parsed as Conversation[]).filter(
        (c) => c && typeof c.id === "string" && Array.isArray(c.messages),
      ),
    );
  } catch {
    return [];
  }
}

/** First user line, trimmed to a sidebar-sized label. */
function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return NEW_CHAT_TITLE;
  return oneLine.length > 42 ? `${oneLine.slice(0, 42)}…` : oneLine;
}

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const { data: models } = useAvailableModels();
  const { data: status } = useInferenceStatus();
  const { data: runtimeDefaults } = useRuntimeDefaults();
  const { load, unload, setPrimary } = useInferenceActions();

  const slots = status?.slots ?? [];
  const maxSlots = status?.max_slots ?? 1;
  const responder = slots.find((slot) => slot.artifact_id === status?.primary_artifact_id) ?? slots[0];
  const multiModel = slots.length > 1;

  // Seeded from Settings -> Inference, then owned locally: moving a slider in
  // the live monitor is a per-session experiment, not a change to the default.
  const defaultSystemPrompt = useSetting("default_system_prompt", "You are a helpful assistant.");
  const defaultTemperature = useSetting("default_temperature", 0.8);
  const defaultTopP = useSetting("default_top_p", 0.95);
  const defaultTopK = useSetting("default_top_k", 40);
  const defaultMaxTokens = useSetting("default_max_tokens", 512);
  const defaultMinP = useSetting("default_min_p", 0.05);
  const defaultRepeatPenalty = useSetting("default_repeat_penalty", 1.1);
  const defaultRepeatLastN = useSetting("default_repeat_last_n", 64);
  const defaultSeed = useSetting("default_seed", -1);

  const defaultContextLength = useSetting("default_context_length", 4096);
  const defaultThreads = useSetting("inference_threads", 0);
  const defaultGpuLayers = useSetting("gpu_layers", -1);
  const defaultBatchSize = useSetting("batch_size", 0);
  const defaultFlashAttention = useSetting<FlashAttentionMode>("flash_attention", "auto");
  const defaultKvCacheType = useSetting<KvCacheType>("kv_cache_type", "f16");

  const [touched, setTouched] = useState(false);
  const [systemPrompt, setSystemPromptState] = useState(defaultSystemPrompt);
  const [params, setParams] = useState<GenerationParams>({
    temperature: defaultTemperature,
    topP: defaultTopP,
    topK: defaultTopK,
    maxTokens: defaultMaxTokens,
    minP: defaultMinP,
    repeatPenalty: defaultRepeatPenalty,
    repeatLastN: defaultRepeatLastN,
    seed: defaultSeed,
  });

  // Runtime is tracked separately from `touched`: a sampling slider changes
  // nothing about the running server, while these decide whether a reload is
  // owed, so they need their own "the user has taken this over" flag.
  const [runtimeTouched, setRuntimeTouched] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeSettings>({
    contextLength: defaultContextLength,
    threads: defaultThreads,
    gpuLayers: defaultGpuLayers,
    batchSize: defaultBatchSize,
    flashAttention: defaultFlashAttention,
    kvCacheType: defaultKvCacheType,
  });
  // The runtime the loaded server was started with, so an edit can be told
  // apart from the state it is already running in.
  const [appliedRuntime, setAppliedRuntime] = useState<RuntimeSettings | null>(null);

  // The settings query resolves after first paint, so the initial state above
  // is the hook's fallback. Adopt the real defaults when they land, but only
  // while the user has not overridden anything.
  useEffect(() => {
    if (touched) return;
    setSystemPromptState(defaultSystemPrompt);
    setParams({
      temperature: defaultTemperature,
      topP: defaultTopP,
      topK: defaultTopK,
      maxTokens: defaultMaxTokens,
      minP: defaultMinP,
      repeatPenalty: defaultRepeatPenalty,
      repeatLastN: defaultRepeatLastN,
      seed: defaultSeed,
    });
  }, [
    touched,
    defaultSystemPrompt,
    defaultTemperature,
    defaultTopP,
    defaultTopK,
    defaultMaxTokens,
    defaultMinP,
    defaultRepeatPenalty,
    defaultRepeatLastN,
    defaultSeed,
  ]);

  useEffect(() => {
    if (runtimeTouched) return;
    setRuntime({
      contextLength: defaultContextLength,
      threads: defaultThreads,
      gpuLayers: defaultGpuLayers,
      batchSize: defaultBatchSize,
      flashAttention: defaultFlashAttention,
      kvCacheType: defaultKvCacheType,
    });
  }, [
    runtimeTouched,
    defaultContextLength,
    defaultThreads,
    defaultGpuLayers,
    defaultBatchSize,
    defaultFlashAttention,
    defaultKvCacheType,
  ]);

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const stored = loadConversations();
    return stored.length ? stored : [emptyConversation()];
  });
  const [activeId, setActiveId] = useState(() => conversations[0].id);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, 50)));
    } catch {
      // Storage full or disabled — the session keeps working in memory.
    }
  }, [conversations]);

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? conversations[0] ?? emptyConversation();

  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  // The in-flight turn's hand-off, shown live above the streaming answer.
  const [streamHandoff, setStreamHandoff] = useState<HandoffNote | null>(null);
  // Who the turn is waiting on before the answer can start.
  const [streamWaitingOn, setStreamWaitingOn] = useState<string | null>(null);
  // The chat that owns the in-flight turn.
  const [streamConversationId, setStreamConversationId] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<InferenceStats | null>(null);
  const [tpsHistory, setTpsHistory] = useState<number[]>(() => new Array<number>(SPARK_SAMPLES).fill(0));
  const [liveTps, setLiveTps] = useState(0);

  // Files staged for the NEXT message only. Once sent they move onto the turn
  // itself, so this never accumulates across a session (and is never rehydrated
  // from every attachment the core has ever stored).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamedCharsRef = useRef(0);
  const lastSampleRef = useRef({ chars: 0, at: Date.now() });

  // One always-on sampler rather than one started per generation: the sparkline
  // should keep scrolling (at zero) while idle, exactly like the prototype's.
  useEffect(() => {
    const timer = setInterval(() => {
      const nowMs = Date.now();
      const previous = lastSampleRef.current;
      const elapsedSeconds = Math.max(1, nowMs - previous.at) / 1000;
      const tps = Math.max(
        0,
        (streamedCharsRef.current - previous.chars) / CHARS_PER_TOKEN / elapsedSeconds,
      );
      lastSampleRef.current = { chars: streamedCharsRef.current, at: nowMs };
      setLiveTps(tps);
      setTpsHistory((history) => [...history.slice(1 - SPARK_SAMPLES), tps]);
    }, SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loaded = status?.loaded ?? false;

  const patchActive = useCallback(
    (update: (conversation: Conversation) => Conversation) => {
      setConversations((all) =>
        all.map((c) => (c.id === activeId ? { ...update(c), updatedAt: Date.now() } : c)),
      );
    },
    [activeId],
  );

  const send = useCallback((overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    // An attachment on its own is a legitimate turn ("what is in this?" is
    // implied), so only require text when nothing is attached.
    if ((!text && attachments.length === 0) || generating || !loaded) return;

    const sent = attachments;
    const lastHandoffIndex = activeConversation.messages.reduce(
      (latest, message, index) => (message.handoff && !message.handoff.failed ? index : latest),
      -1,
    );
    const userMessage: DisplayMessage = {
      role: "user",
      content: text,
      time: clockLabel(),
      attachments: sent.length ? sent : undefined,
    };
    const history: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      // Prior turns replay as plain text. Re-sending every historical image
      // would blow the context window open after two or three turns; the model
      // keeps its own answer about them instead.
      //
      // What does replay is the most recent successful hand-off: the vision
      // slot's reading of the picture is the only trace of it the answering
      // model ever had, and dropping it meant the second message about a
      // screenshot ("now do part b") reached a model that had never heard of
      // the image. Only the latest one, because a transcription is long and the
      // default context is 4k — replaying every image ever attached would spend
      // the window on pictures nobody is asking about any more.
      ...activeConversation.messages.flatMap<ChatMessage>(({ role, content, handoff }, index) =>
        handoff && !handoff.failed && index === lastHandoffIndex
          ? [
              {
                role: "system" as const,
                content:
                  `${handoff.model_name} read the image(s) attached to the previous message ` +
                  `and transcribed them as:\n\n${handoff.content}`,
              },
              { role, content },
            ]
          : [{ role, content }],
      ),
      { role: "user", content: text, attachment_ids: sent.map((a) => a.id) },
    ];

    patchActive((c) => ({
      ...c,
      title: c.messages.length === 0 ? titleFrom(text || sent[0]?.file_name || "") : c.title,
      messages: [...c.messages, userMessage],
    }));
    setDraft("");
    setAttachments([]);
    setStreamText("");
    setStreamReasoning("");
    setStreamConversationId(activeConversation.id);
    setGenerating(true);
    setLastStats(null);
    streamedCharsRef.current = 0;
    lastSampleRef.current = { chars: 0, at: Date.now() };

    // Captured now rather than read in the callback: the user may unload or
    // re-assign a model while the answer is still streaming.
    const responderId = responder?.artifact_id ?? null;
    const responderName = responder?.model_name;

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = "";
    let reasoningAccumulated = "";
    let stats: InferenceStats | undefined;
    let failure: string | null = null;
    let handoff: HandoffNote | undefined;

    streamGenerate(
      history,
      {
        temperature: params.temperature,
        top_p: params.topP,
        top_k: params.topK,
        max_tokens: params.maxTokens,
        min_p: params.minP,
        repeat_penalty: params.repeatPenalty,
        repeat_last_n: params.repeatLastN,
        seed: params.seed,
        responder_artifact_id: responderId,
      },
      (chunk) => {
        if ("delta" in chunk) {
          accumulated += chunk.delta;
          streamedCharsRef.current = accumulated.length;
          setStreamText(accumulated);
        } else if ("reasoning" in chunk) {
          reasoningAccumulated += chunk.reasoning;
          setStreamReasoning(reasoningAccumulated);
        } else if ("handoff_started" in chunk) {
          setStreamWaitingOn(chunk.handoff_started.model_name);
        } else if ("handoff" in chunk) {
          // Another model looked at the attachment first. Kept so the turn can
          // show whose observation the answer was built on.
          handoff = chunk.handoff;
          setStreamHandoff(chunk.handoff);
          setStreamWaitingOn(null);
        } else if ("done" in chunk) {
          stats = chunk.stats;
        } else if ("error" in chunk) {
          failure = chunk.error;
        }
      },
      controller.signal,
    )
      .catch((error: unknown) => {
        // An abort is the Stop button doing its job: keep the partial turn.
        if (controller.signal.aborted) return;
        failure = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        const content = failure ? `${accumulated}\n\n[error] ${failure}`.trim() : accumulated;
        if (content || reasoningAccumulated) {
          patchActive((c) => ({
            ...c,
            messages: [
              ...c.messages,
              {
                role: "assistant",
                content,
                time: clockLabel(),
                stats,
                // Only worth recording when more than one model was resident;
                // in a single-model chat the name is just noise on every turn.
                modelName: multiModel ? responderName : undefined,
                handoff,
                reasoning: reasoningAccumulated || undefined,
              },
            ],
          }));
        }
        if (stats) setLastStats(stats);
        setStreamText("");
        setStreamReasoning("");
        setStreamHandoff(null);
        setStreamWaitingOn(null);
        setStreamConversationId(null);
        setGenerating(false);
        abortRef.current = null;
      });
  }, [
    draft,
    attachments,
    generating,
    loaded,
    activeConversation,
    systemPrompt,
    params,
    patchActive,
    responder,
    multiModel,
  ]);

  const loadWithRuntime = useCallback(
    (artifactId: string) => {
      // The applied snapshot is taken optimistically rather than in onSuccess:
      // a failed load leaves no server running, so there is nothing for the
      // "reload to apply" banner to be about either way.
      setAppliedRuntime(runtime);
      load.mutate({ artifactId, runtime: toRuntimeOptions(runtime) });
    },
    [load, runtime],
  );

  const attachFile = useCallback(async () => {
    setAttaching(true);
    setAttachError(null);
    try {
      const attachment = await pickAttachment();
      if (attachment) {
        setAttachments((all) => [attachment, ...all]);
      }
    } catch (error: unknown) {
      setAttachError(error instanceof Error ? error.message : String(error));
    } finally {
      setAttaching(false);
    }
  }, []);

  const removeAttachment = useCallback(async (id: string) => {
    try {
      await deleteAttachment(id);
      setAttachments((all) => all.filter((a) => a.id !== id));
    } catch (error: unknown) {
      setAttachError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const value = useMemo<PlaygroundValue>(
    () => ({
      conversations,
      activeId: activeConversation.id,
      activeConversation,
      messages: activeConversation.messages,
      selectConversation: setActiveId,
      newConversation: () => {
        // An empty chat already open *is* a new chat. Minting another one per
        // click is what filled the sidebar with an unbounded run of identical
        // "New chat" rows, none of which the user could tell apart.
        const reusable = isBlank(activeConversation)
          ? activeConversation
          : conversations.find(isBlank);
        if (reusable) {
          setActiveId(reusable.id);
          setDraft("");
          return;
        }
        const fresh = emptyConversation();
        setConversations((all) => [fresh, ...all]);
        setActiveId(fresh.id);
        setDraft("");
      },
      clearConversation: (id: string) =>
        setConversations((all) =>
          all.map((c) =>
            c.id === id ? { ...c, title: NEW_CHAT_TITLE, messages: [], updatedAt: Date.now() } : c,
          ),
        ),
      togglePin: (id: string) =>
        setConversations((all) => all.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))),
      toggleArchive: (id: string) =>
        setConversations((all) =>
          all.map((c) => (c.id === id ? { ...c, archived: !c.archived, pinned: false } : c)),
        ),
      deleteConversation: (id: string) =>
        setConversations((all) => {
          // Take the files with the chat, otherwise deleting a conversation
          // silently leaks its attachments into the data directory forever.
          const doomed = all.find((c) => c.id === id);
          for (const message of doomed?.messages ?? []) {
            for (const attachment of message.attachments ?? []) {
              void deleteAttachment(attachment.id).catch(() => {
                // Already gone, or the core is down — the chat still goes.
              });
            }
          }
          const remaining = all.filter((c) => c.id !== id);
          const next = remaining.length ? remaining : [emptyConversation()];
          setActiveId((current) => (current === id ? next[0].id : current));
          return next;
        }),

      draft,
      setDraft,
      send,
      stop: () => abortRef.current?.abort(),
      generating,
      streamText,
      streamReasoning,
      streamHandoff,
      streamWaitingOn,
      streamConversationId,

      params,
      setParam: (key, paramValue) => {
        setTouched(true);
        setParams((p) => ({ ...p, [key]: paramValue }));
      },
      systemPrompt,
      setSystemPrompt: (next: string) => {
        setTouched(true);
        setSystemPromptState(next);
      },

      runtime,
      setRuntimeOption: (key, runtimeValue) => {
        setRuntimeTouched(true);
        setRuntime((r) => ({ ...r, [key]: runtimeValue }));
      },
      runtimeDefaults,
      // With no applied snapshot the server was started before this session
      // (the core outlives a window reload), so any edit is assumed unapplied
      // rather than silently treated as already live.
      runtimeDirty:
        loaded && runtimeTouched && (appliedRuntime === null || !sameRuntime(runtime, appliedRuntime)),
      reloadModel: () => {
        const artifactId = status?.model_artifact_id;
        if (artifactId) loadWithRuntime(artifactId);
      },

      models: models ?? [],
      status,
      loaded,
      loadingModel: load.isPending,
      loadError: load.isError ? (load.error as Error).message : null,
      selectModel: loadWithRuntime,
      unloadModel: () => {
        setAppliedRuntime(null);
        unload.mutate(undefined);
      },

      slots,
      maxSlots,
      responder,
      addModel: (artifactId: string, role: RequestedRole = "auto") =>
        load.mutate({ artifactId, runtime: toRuntimeOptions(runtime), role }),
      removeModel: (artifactId: string) => unload.mutate(artifactId),
      makePrimary: (artifactId: string) => setPrimary.mutate(artifactId),

      tpsHistory,
      liveTps,
      lastStats,

      attachments,
      attaching,
      attachError,
      attachFile,
      removeAttachment,
    }),
    [
      conversations,
      activeConversation,
      draft,
      send,
      generating,
      streamText,
      params,
      systemPrompt,
      runtime,
      runtimeTouched,
      runtimeDefaults,
      appliedRuntime,
      loadWithRuntime,
      models,
      status,
      loaded,
      load,
      unload,
      setPrimary,
      slots,
      maxSlots,
      responder,
      multiModel,
      streamHandoff,
      streamWaitingOn,
      streamConversationId,
      tpsHistory,
      liveTps,
      lastStats,
      attachments,
      attaching,
      attachError,
      attachFile,
      removeAttachment,
    ],
  );

  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;
}

export function usePlayground(): PlaygroundValue {
  const value = useContext(PlaygroundContext);
  if (!value) throw new Error("usePlayground must be used inside <PlaygroundProvider>");
  return value;
}
