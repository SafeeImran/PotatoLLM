import { useEffect, useRef, useState } from "react";
import { usePlayground } from "../playground/PlaygroundProvider";
import { formatBytes } from "../lib/format";
import type { Attachment, SlotRole } from "../api/types";
import type { HandoffNote } from "../playground/PlaygroundProvider";
import { MarkdownBlock } from "../components/chat/MarkdownBlock";
import { LorenzIdle } from "../components/chat/LorenzIdle";
import { ChevronIcon, CloseIcon, SendIcon, StopIcon } from "../components/layout/icons";

const MONO = "var(--pot-mono)";

/** Short label for the duty a loaded model holds. */
const ROLE_LABEL: Record<SlotRole, string> = {
  primary: "answers",
  vision: "eyes",
  code: "code",
  reasoning: "thinks",
  member: "loaded",
};

const ROLE_HINT: Record<SlotRole, string> = {
  primary: "Writes the replies.",
  vision: "Reads attached images for models that cannot see them.",
  code: "Loaded for code questions — hand a turn to it from this panel.",
  reasoning: "Loaded for hard, multi-step questions.",
  member: "Loaded, with no special duty.",
};

function RoleBadge({ role }: { role: SlotRole }) {
  const primary = role === "primary";
  return (
    <span
      title={ROLE_HINT[role]}
      style={{
        flex: "0 0 auto",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: ".4px",
        padding: "2px 5px",
        borderRadius: 4,
        border: `1px solid ${primary ? "var(--pot-accent-edge)" : "var(--pot-line-strong)"}`,
        background: primary ? "var(--pot-accent)" : "var(--pot-raised)",
        color: primary ? "var(--pot-on-accent)" : "var(--pot-sub)",
        textTransform: "uppercase",
      }}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

/**
 * The composer's model panel.
 *
 * A chat can hold several models at once, so this is a roster rather than a
 * single-choice list: what is loaded and in which role at the top, what can be
 * added underneath. A model's role is chosen when it is added, because that is
 * the only moment the user knows why they are adding it.
 */
function ModelPanel({ onClose }: { onClose: () => void }) {
  const {
    models,
    slots,
    maxSlots,
    addModel,
    removeModel,
    makePrimary,
    selectModel,
    responder,
    loadingModel,
    loadError,
  } = usePlayground();
  const ref = useRef<HTMLDivElement>(null);
  const full = slots.length >= maxSlots;

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const loadedIds = new Set(slots.map((slot) => slot.artifact_id));
  const addable = models.filter((model) => !loadedIds.has(model.artifact_id));
  // Capability, not label — the same rule the engine routes on.
  const eyes = slots.find((slot) => slot.role === "vision" && slot.multimodal)
    ?? slots.find((slot) => slot.multimodal);
  const hasEyes = Boolean(eyes);
  const eyesName = eyes?.model_name;
  const responderCanSee = Boolean(responder?.multimodal);

  return (
    <div
      ref={ref}
      aria-label="Models in this chat"
      style={{
        position: "absolute",
        right: 96,
        bottom: "calc(100% + 10px)",
        width: 360,
        maxHeight: 460,
        overflowY: "auto",
        background: "var(--pot-bg)",
        border: "1px solid var(--pot-line-strong)",
        borderRadius: 12,
        boxShadow: "0 18px 40px -14px rgba(0,0,0,.35)",
        zIndex: 20,
        animation: "potPop .2s cubic-bezier(.2,.9,.3,1) both",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          borderBottom: "1px solid var(--pot-line)",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: 1.3,
          color: "var(--pot-sub)",
          position: "sticky",
          top: 0,
          background: "var(--pot-bg)",
        }}
      >
        <span style={{ flex: "1 1 auto" }}>MODELS IN THIS CHAT</span>
        <span className="pot-num" style={{ letterSpacing: 0, color: "var(--pot-faint)" }}>
          {slots.length}/{maxSlots}
        </span>
      </div>

      {slots.map((slot) => (
        <div
          key={slot.artifact_id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            borderTop: "1px solid var(--pot-line)",
          }}
        >
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: "-.2px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {slot.model_name}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-faint)", marginTop: 2 }}>
              {[`${slot.context_length.toLocaleString()} ctx`, slot.multimodal ? "vision" : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--pot-sub)", marginTop: 3, lineHeight: 1.4 }}>
              {ROLE_HINT[slot.role]}
            </div>
          </div>
          <RoleBadge role={slot.role} />
          {slot.role !== "primary" && (
            <button
              type="button"
              className="pot-chip-btn"
              style={{ height: 22, fontSize: 10, flex: "0 0 auto" }}
              onClick={() => makePrimary(slot.artifact_id)}
              title={`Let ${slot.model_name} answer`}
            >
              Answer
            </button>
          )}
          <button
            type="button"
            className="pot-icon-btn"
            style={{ width: 22, height: 22, flex: "0 0 22px" }}
            onClick={() => removeModel(slot.artifact_id)}
            title={`Unload ${slot.model_name}`}
            aria-label={`Unload ${slot.model_name}`}
          >
            <CloseIcon />
          </button>
        </div>
      ))}

      {slots.length > 1 && hasEyes && !responderCanSee && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--pot-line)",
            fontSize: 10.5,
            lineHeight: 1.5,
            color: "var(--pot-faint)",
          }}
        >
          Attach an image and <strong>{eyesName}</strong> will read it for{" "}
          <strong>{responder?.model_name}</strong>, which writes the answer.
        </div>
      )}

      {slots.length > 0 && !hasEyes && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--pot-line)",
            fontSize: 10.5,
            lineHeight: 1.5,
            color: "var(--pot-faint)",
          }}
        >
          No model here can see. Add one as <strong>eyes</strong> and it will describe attached
          images for the model that answers.
        </div>
      )}

      <div
        style={{
          padding: "9px 12px",
          borderTop: "1px solid var(--pot-line)",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: 1.3,
          color: "var(--pot-sub)",
        }}
      >
        {slots.length === 0 ? "LOAD A MODEL" : "ADD ANOTHER"}
      </div>

      {models.length === 0 && (
        <div style={{ padding: "0 12px 14px", fontSize: 12, color: "var(--pot-faint)" }}>
          No downloaded models yet — grab a pack from the Model Library.
        </div>
      )}

      {models.length > 0 && addable.length === 0 && (
        <div style={{ padding: "0 12px 14px", fontSize: 12, color: "var(--pot-faint)" }}>
          Every downloaded model is already loaded.
        </div>
      )}

      {addable.map((model) => (
        <div
          key={model.artifact_id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            borderTop: "1px solid var(--pot-line)",
            opacity: full ? 0.45 : 1,
          }}
        >
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: "-.2px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {model.model_name}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-faint)", marginTop: 2 }}>
              {[
                model.quantization,
                `${model.context_length.toLocaleString()} ctx`,
                formatBytes(model.size_bytes),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>

          {slots.length === 0 ? (
            <button
              type="button"
              className="pot-chip-btn"
              style={{ height: 24, fontSize: 10.5, flex: "0 0 auto" }}
              disabled={loadingModel}
              onClick={() => {
                selectModel(model.artifact_id);
                onClose();
              }}
            >
              Load
            </button>
          ) : (
            <>
              {model.multimodal && (
                <button
                  type="button"
                  className="pot-chip-btn"
                  style={{ height: 24, fontSize: 10.5, flex: "0 0 auto" }}
                  disabled={loadingModel || full}
                  title={
                    full
                      ? "Slot limit reached — unload a model first"
                      : `Add ${model.model_name} as this chat's eyes`
                  }
                  onClick={() => addModel(model.artifact_id, "vision")}
                >
                  + eyes
                </button>
              )}
              <button
                type="button"
                className="pot-chip-btn"
                style={{ height: 24, fontSize: 10.5, flex: "0 0 auto" }}
                disabled={loadingModel || full}
                title={
                  full
                    ? "Slot limit reached — unload a model first"
                    : `Add ${model.model_name} — its job is worked out from what it can do`
                }
                onClick={() => addModel(model.artifact_id)}
              >
                + add
              </button>
            </>
          )}
        </div>
      ))}

      {full && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--pot-line)",
            fontSize: 10.5,
            color: "var(--pot-faint)",
          }}
        >
          Slot limit reached. Raise “Max Loaded Models” in Settings, or unload one above.
        </div>
      )}

      {loadError && (
        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid var(--pot-line)",
            fontSize: 11,
            color: "var(--pot-danger)",
          }}
        >
          {loadError}
        </div>
      )}
    </div>
  );
}

/**
 * What a second model contributed before the answer.
 *
 * Collapsed by default and clearly attributed: the description is another
 * model's reading of the image, not the answering model's, and folding it
 * silently into the reply would pass off one model's guess as another's
 * observation. Expanding it is how a user checks whether a wrong answer came
 * from bad eyes or bad reasoning.
 */
function HandoffNoteBlock({ note }: { note: HandoffNote }) {
  const [open, setOpen] = useState(Boolean(note.failed));
  const failed = Boolean(note.failed);
  return (
    <div
      style={{
        alignSelf: "stretch",
        marginBottom: 8,
        border: `1px solid ${failed ? "var(--pot-danger)" : "var(--pot-line)"}`,
        borderRadius: 10,
        background: "var(--pot-panel)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "7px 10px",
          border: 0,
          background: "transparent",
          color: "var(--pot-sub)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 10.5,
        }}
      >
        <ChevronIcon
          aria-hidden="true"
          style={{
            flex: "0 0 10px",
            width: 10,
            transition: "transform .2s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        <span>
          <strong style={{ color: failed ? "var(--pot-danger)" : "var(--pot-ink-soft)" }}>
            {note.model_name}
          </strong>{" "}
          {failed ? "could not read the image for this turn" : "looked at the image for this turn"}
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: "0 10px 9px 27px",
            fontSize: 11.5,
            lineHeight: 1.55,
            color: "var(--pot-ink-soft)",
            whiteSpace: "pre-wrap",
          }}
        >
          {note.content}
        </div>
      )}
    </div>
  );
}

/**
 * A reasoning model's chain-of-thought, collapsed by default.
 *
 * Reasoning traces are often long and frequently contain partial markdown
 * (half-formed lists, unmatched fences), so they are shown as pre-wrapped plain
 * text rather than fed through the markdown renderer: the answer below is the
 * part the user came for, the trace is there when it needs checking.
 */
function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        alignSelf: "stretch",
        marginBottom: 8,
        border: "1px solid var(--pot-line)",
        borderRadius: 10,
        background: "var(--pot-panel)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "7px 10px",
          border: 0,
          background: "transparent",
          color: "var(--pot-sub)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 10.5,
        }}
      >
        <ChevronIcon
          aria-hidden="true"
          style={{
            flex: "0 0 10px",
            width: 10,
            transition: "transform .2s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        <span>
          {open ? "Hide reasoning" : "Show reasoning"}
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: "0 10px 9px 27px",
            fontSize: 11.5,
            lineHeight: 1.55,
            color: "var(--pot-ink-soft)",
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/**
 * One attached file. The composer renders it with a remove button; a sent turn
 * renders the same chip read-only so the transcript still shows what went with
 * the message.
 */
function AttachmentChip({
  attachment,
  unreadable,
  onRemove,
}: {
  attachment: Attachment;
  unreadable?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div
      title={
        unreadable
          ? `${attachment.file_name} — no model in this chat can see, so its contents will not be read. Add a vision model as the chat's eyes.`
          : attachment.file_name
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        maxWidth: "100%",
        padding: onRemove ? "5px 8px 5px 10px" : "4px 9px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        background:
          attachment.kind === "image"
            ? "var(--pot-accent-soft)"
            : attachment.kind === "document"
              ? "var(--pot-raised)"
              : "var(--pot-panel)",
        border: `1px solid ${unreadable ? "var(--pot-danger)" : "var(--pot-line)"}`,
        color: "var(--pot-ink-soft)",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {attachment.file_name}
      </span>
      <span className="pot-num" style={{ fontSize: 9, color: "var(--pot-ghost)", flex: "0 0 auto" }}>
        {formatBytes(attachment.size_bytes)}
      </span>
      {unreadable && (
        <span style={{ fontSize: 9, color: "var(--pot-danger)", flex: "0 0 auto" }}>not read</span>
      )}
      {onRemove && (
        <button
          type="button"
          className="pot-icon-btn"
          style={{ width: 16, height: 16, flex: "0 0 16px", color: "var(--pot-sub)" }}
          onClick={onRemove}
          title={`Remove ${attachment.file_name}`}
          aria-label={`Remove ${attachment.file_name}`}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/**
 * The app's face — the prototype's chat surface, driven by Potato Core's
 * streaming /inference/generate. Parameters and the system prompt live in the
 * live monitor drawer; this pane owns the transcript and the composer.
 */
export default function Playground() {
  const {
    messages,
    draft,
    setDraft,
    send,
    stop,
    generating,
    streamText,
    streamReasoning,
    streamHandoff,
    streamWaitingOn,
    streamConversationId,
    activeId,
    loaded,
    loadingModel,
    slots,
    responder,
    attachments,
    attaching,
    attachError,
    attachFile,
    removeAttachment,
  } = usePlayground();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  // Easter egg: the idle screen's Lorenz-attractor art puns on the Lorentz
  // transform, so hovering it offers the obvious question about the other
  // "Lorenz". The prompt tracks the cursor while over the art, and — since
  // send() would otherwise silently no-op with nothing loaded — falls back to
  // opening the model picker instead of asking when no model is loaded yet.
  const [lorenzHovered, setLorenzHovered] = useState(false);
  const [lorenzCursor, setLorenzCursor] = useState({ x: 0, y: 0 });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom has no layout, so scrollIntoView is undefined under test.
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, streamText]);

  // One generation runs at a time, but it belongs to the chat it was sent from.
  // Without this every other chat rendered the same streaming answer as its
  // own, and an empty chat lost its idle screen while a different chat worked.
  const answeringHere = generating && streamConversationId === activeId;
  const answeringElsewhere = generating && !answeringHere;
  const canSend = loaded && (draft.trim().length > 0 || attachments.length > 0) && !generating;
  // Whether the CHAT can read an image, not whether the answering model can.
  // Reading `status.multimodal` here described the primary slot alone, so a
  // text model paired with a vision model — the whole point of the eyes —
  // still stamped every attached image "not read" and told the user the model
  // could not see it, while the hand-off read it perfectly well.
  const canSeeImages = slots.some((slot) => slot.multimodal);
  // With no turns yet there is nothing to scroll, so the idle state sits in the
  // middle of the empty pane instead of pinned to the top of a tall blank.
  const idle = messages.length === 0 && !answeringHere;

  return (
    <>
      <div
        className="pot-shell-scale"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          padding: idle ? "24px 0" : "26px 0 18px",
          display: idle ? "flex" : undefined,
        }}
      >
        <div
          style={{
            maxWidth: 760,
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            flexDirection: "column",
            gap: 22,
            ...(idle ? { flex: "1 1 auto", width: "100%", justifyContent: "center" } : {}),
          }}
        >
          {idle && (
            <div style={{ textAlign: "center", color: "var(--pot-faint)" }}>
              <div
                style={{ position: "relative", display: "inline-block" }}
                onMouseEnter={() => setLorenzHovered(true)}
                onMouseLeave={() => setLorenzHovered(false)}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setLorenzCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
              >
                <LorenzIdle />
                {lorenzHovered && (
                  <button
                    type="button"
                    className="pot-lorenz-btn"
                    style={{
                      position: "absolute",
                      left: lorenzCursor.x,
                      top: lorenzCursor.y,
                      // Centered on the cursor horizontally, and offset up
                      // just short of the button's own height vertically —
                      // so the cursor point always lands inside the button's
                      // own box instead of chasing a target that flees it.
                      transform: "translate(-50%, calc(-100% + 12px))",
                      pointerEvents: "auto",
                    }}
                    onClick={() => (loaded ? send("What is lorenz transform?") : setPickerOpen(true))}
                  >
                    <span>
                      {loaded
                        ? `Ask ${responder?.model_name ?? "the model"} about this fractal structure`
                        : "Choose a model and ask it about this fractal structure"}
                    </span>
                  </button>
                )}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--pot-ink)", marginTop: 26 }}>
                {loaded ? "Ask PotatoLLM anything" : "Load a model to start chatting"}
              </div>
              <div style={{ fontSize: 13, marginTop: 8, maxWidth: 360, marginInline: "auto", lineHeight: 1.5 }}>
                {loaded
                  ? "Parameters and the system prompt live in the live monitor."
                  : "Select a downloaded model and PotatoLLM will load it for this chat."}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
                {!loaded && (
                  <button
                    type="button"
                    className="pot-solid-btn"
                    onClick={() => setPickerOpen(true)}
                  >
                    Select a model
                  </button>
                )}
                {loaded && (
                  <button
                    type="button"
                    className="pot-chip-btn"
                    onClick={() => window.dispatchEvent(new CustomEvent("potato-toggle-monitor"))}
                  >
                    Open Live Monitor
                  </button>
                )}
              </div>
            </div>
          )}

          {messages.map((message, index) => {
            const user = message.role === "user";
            return (
              <div
                key={index}
                style={{
                  alignSelf: user ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: user ? "flex-end" : "flex-start",
                  animation: "potFadeUp .38s cubic-bezier(.2,.9,.3,1) both",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: user ? 6 : 5 }}>
                  <span className="pot-num" style={{ fontSize: 9.5, color: "var(--pot-ghost)" }}>
                    {message.time}
                  </span>
                </div>
                {user && message.attachments && message.attachments.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      justifyContent: "flex-end",
                      marginBottom: 6,
                      maxWidth: "100%",
                    }}
                  >
                    {message.attachments.map((attachment) => (
                      <AttachmentChip key={attachment.id} attachment={attachment} />
                    ))}
                  </div>
                )}
                {user ? (
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: "var(--pot-ink)",
                      background: "var(--pot-raised)",
                      border: "1px solid var(--pot-line-strong)",
                      borderRadius: "14px 14px 4px 14px",
                      padding: "11px 14px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {message.content || <span style={{ color: "var(--pot-faint)" }}>(no message)</span>}
                  </div>
                ) : (
                  <>
                    {message.handoff && <HandoffNoteBlock note={message.handoff} />}
                    {message.reasoning && <ReasoningBlock text={message.reasoning} />}
                    <MarkdownBlock>{message.content}</MarkdownBlock>
                  </>
                )}
                {!user && message.modelName && (
                  <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-faint)", marginTop: 5 }}>
                    {message.modelName}
                  </div>
                )}
                {message.stats?.tokens_per_sec && (
                  <div
                    className="pot-num"
                    style={{
                      display: "flex",
                      gap: 12,
                      marginTop: 6,
                      fontSize: 9.5,
                      color: "var(--pot-faint)",
                    }}
                  >
                    <span>{message.stats.tokens_per_sec.toFixed(1)} tok/s</span>
                    {message.stats.ttft_ms && <span>ttft {Math.round(message.stats.ttft_ms)}ms</span>}
                    <span style={{ color: "var(--pot-ok)" }}>measured</span>
                  </div>
                )}
              </div>
            );
          })}

          {answeringHere && (
            <div style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-faint)" }}>
                  {streamWaitingOn
                    ? `${streamWaitingOn} is reading the image — this is the slow part`
                    : streamHandoff && !streamHandoff.failed && !streamText && !streamReasoning
                      ? `${streamHandoff.model_name} read the image`
                      : streamReasoning && !streamText
                        ? `${responder?.model_name ?? "Model"} is thinking`
                        : slots.length > 1 && responder
                          ? `${responder.model_name} is answering`
                          : "generating"}
                </span>
              </div>
              <div>
                {streamHandoff && <HandoffNoteBlock note={streamHandoff} />}
                {streamReasoning && <ReasoningBlock text={streamReasoning} />}
                {streamText && <MarkdownBlock>{streamText}</MarkdownBlock>}
                <span
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 15,
                    background: "var(--pot-ink)",
                    verticalAlign: -2,
                    marginLeft: 2,
                    animation: "potBlink 1s steps(1) infinite",
                  }}
                />
              </div>
            </div>
          )}

          {/* Scroll anchor for new turns. Omitted while idle: as a flex sibling
              it would take the column's 22px gap and push the centred idle
              state off-centre by exactly that much. */}
          {!idle && <div ref={bottomRef} style={{ height: 4 }} />}
        </div>
      </div>

      <div className="pot-shell-scale" style={{ flex: "0 0 auto", padding: "0 0 14px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px", position: "relative" }}>
          {pickerOpen && <ModelPanel onClose={() => setPickerOpen(false)} />}

          <div
            style={{
              border: `1px solid ${focused ? "var(--pot-accent-edge)" : "var(--pot-line-strong)"}`,
              borderRadius: 14,
              background: "var(--pot-bg)",
              boxShadow: focused ? "0 10px 30px -18px rgba(0,0,0,.45)" : "0 4px 18px -16px rgba(0,0,0,.5)",
              transition: "border-color .2s ease, box-shadow .25s ease",
            }}
          >
            {attachments.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: "12px 16px 0",
                }}
              >
                {attachments.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    unreadable={attachment.kind === "image" && !canSeeImages}
                    onRemove={() => removeAttachment(attachment.id)}
                  />
                ))}
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={loaded ? "Ask PotatoLLM anything" : "Load a model first"}
              disabled={!loaded}
              rows={3}
              aria-label="Message"
              style={{
                width: "100%",
                border: 0,
                resize: "none",
                background: "transparent",
                color: "var(--pot-ink)",
                fontSize: 14,
                lineHeight: 1.6,
                padding: "14px 16px 6px",
                display: "block",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 10px 12px" }}>
              <button
                type="button"
                className="pot-icon-btn"
                style={{ width: 30, height: 30, flex: "0 0 30px" }}
                onClick={attachFile}
                disabled={attaching}
                title={
                  canSeeImages
                    ? "Attach a file or image"
                    : "Attach a file — no model in this chat can read images"
                }
                aria-label="Attach a file"
              >
                <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
                  {attaching ? "···" : "+"}
                </span>
              </button>
              {attachError && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--pot-danger)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 200,
                  }}
                  title={attachError}
                >
                  {attachError}
                </span>
              )}
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-ghost)", whiteSpace: "nowrap" }}>
                {answeringElsewhere
                  ? "answering in another chat"
                  : draft.length
                    ? `~${Math.max(1, Math.round(draft.length / 4))} tok · Enter to send`
                    : "Shift+Enter for a newline"}
              </span>
              <span style={{ flex: "1 1 auto" }} />

              <button
                type="button"
                className="pot-chip-btn"
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
                title="Model selector"
                onClick={() => setPickerOpen((o) => !o)}
                style={{
                  borderColor: pickerOpen ? "var(--pot-accent-edge)" : undefined,
                  background: pickerOpen ? "var(--pot-accent-soft)" : undefined,
                  maxWidth: 260,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    flex: "0 0 5px",
                    borderRadius: "50%",
                    background: loaded ? "var(--pot-accent-dot)" : "var(--pot-ghost)",
                  }}
                />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {loadingModel ? "loading…" : (responder?.model_name ?? "select model")}
                </span>
                {slots.length > 1 && (
                  <span
                    className="pot-num"
                    title={`${slots.length} models loaded for this chat`}
                    style={{
                      flex: "0 0 auto",
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: "1px 5px",
                      borderRadius: 4,
                      border: "1px solid var(--pot-accent-line)",
                      background: "var(--pot-accent-soft)",
                      color: "var(--pot-accent-ink)",
                    }}
                  >
                    +{slots.length - 1}
                  </span>
                )}
                <ChevronIcon
                  aria-hidden="true"
                  style={{
                    flex: "0 0 12px",
                    color: "var(--pot-sub)",
                    transition: "transform .24s cubic-bezier(.2,.9,.3,1)",
                    transform: pickerOpen ? "rotate(-90deg)" : "rotate(90deg)",
                  }}
                />
              </button>

              {answeringHere ? (
                <button
                  type="button"
                  className="pot-icon-btn"
                  style={{ width: 34, height: 30, flex: "0 0 34px" }}
                  onClick={stop}
                  title="Stop"
                  aria-label="Stop"
                >
                  <StopIcon aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className="pot-icon-btn"
                  style={{
                    width: 34,
                    height: 30,
                    flex: "0 0 34px",
                    border: `1px solid ${canSend ? "var(--pot-accent-edge)" : "var(--pot-line-strong)"}`,
                    background: canSend ? "var(--pot-accent)" : "var(--pot-raised)",
                    color: canSend ? "var(--pot-on-accent)" : "var(--pot-ghost)",
                  }}
                  onClick={() => send()}
                  disabled={!canSend}
                  title={answeringElsewhere ? "Answering in another chat" : "Send"}
                  aria-label="Send"
                >
                  <SendIcon aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
