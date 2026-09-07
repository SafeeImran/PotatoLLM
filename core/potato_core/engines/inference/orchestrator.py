"""One chat turn, possibly across several models.

The Playground can hold more than one model resident (see llama_cpp_backend's
slots). This module is what turns that into a single answer:

1. **Vision hand-off.** If the turn carries images and the answering model
   cannot see, a loaded model that *can* is asked to describe them first, and
   its description is handed to the answerer as context. That is the whole
   point of loading two models — your best writer usually is not your best
   reader. A small VLM that reads screenshots well but answers in one line, and
   a text model that writes properly but is blind, add up to something neither
   manages alone.
2. **Answering.** The chosen slot streams the reply.

Which model does the seeing is decided by capability, never by the role label:
`backend.vision_provider()` asks which running server actually loaded a
projector. Routing on the label meant a usable vision model sat idle whenever
the user had not happened to tag it.

Two rules keep this honest:

* The hand-off is *announced*, never silent. The stream emits a `handoff`
  record naming the model that looked and what it said, so the transcript can
  show that a second model was involved rather than passing its work off as
  the answerer's own observation. A hand-off that *fails* is announced the same
  way, flagged `failed`: the turn still gets an answer, but the user is told the
  eyes came back empty instead of being left to guess why the reply says it
  cannot see.
* If no vision slot is loaded, an image sent to a text-only model still becomes
  the attachments engine's explicit "cannot be read" note. A missing hand-off
  degrades to the old honest behaviour; it never fabricates a description.
  Once a hand-off *has* succeeded, though, that note is withdrawn for the images
  it covered — telling the answerer both "here is what the picture says" and
  "this picture could not be read" reliably produced the second answer.
"""
from __future__ import annotations

import re
from typing import AsyncIterator

from potato_core.engines import attachments as attachment_engine
from potato_core.engines import settings as app_settings
from potato_core.engines.inference import llama_cpp_backend as backend
from potato_core.logging_config import get_logger

log = get_logger("inference.orchestrator")

#: What the vision slot is asked.
#:
#: Short, on purpose, and arrived at by measuring rather than by taste. The
#: models that end up in this role here are small — a 500M VLM is what fits on
#: the hardware this app is named for — and a long structured instruction
#: ("copy code verbatim, label the question numbers, describe the diagrams")
#: pushes one straight into a repetition loop: asked to fill a page it cannot
#: fully resolve, it invents one. The same model, given the two sentences
#: below, transcribes a cropped integral exactly and reports only the headings
#: it can actually read off a full page.
#:
#: LaTeX is named because the alternative is worse: without it a small VLM
#: flattens a fraction into prose and the answering model solves the wrong
#: problem.
_VISION_PROMPT = (
    "Read this image and write out everything written in it, exactly as it appears, "
    "keeping the original line breaks, symbols and spacing. "
    "Write mathematics in LaTeX. Do not solve it, explain it, or add anything of your own. "
    "If part of it is too small or blurry to read, write [unreadable] there."
)

#: Room for a page of transcription and no more. Faithful readings measured out
#: at 30-400 tokens; past that the small models are looping rather than
#: reading, and every wasted token is CPU seconds the user is waiting through.
_VISION_MAX_TOKENS = 768

#: The vision pass is one blocking call in front of the answer, and it is the
#: slowest thing in the turn: encoding an image costs far more prompt work than
#: any text prompt, and on a CPU-only machine — the machine this app is for — a
#: full-page transcription runs for minutes. The default 120s read timeout cut
#: those off, and a cut-off hand-off degrades silently to "I can't see images".
_VISION_TIMEOUT_S = 900.0


#: What a turn means when it carries a file and no words.
#:
#: The composer lets an attachment be sent on its own, and the intent is
#: obvious to a person — but nothing was ever putting that intent into the
#: request, so the model received a file reference and no question and had to
#: guess. Measured against the 0.5B answerer, a bare attachment left it
#: floundering ("I don't have a screenshot") 2 times in 5; with the line below
#: it answered 5 of 5. Phrased to cover both halves of what people attach: a
#: picture to be described, and a problem to be worked.
_IMPLIED_IMAGE_QUESTION = "Describe what this image shows, and answer or solve anything it asks."
_IMPLIED_FILE_QUESTION = "Describe what this file contains, and answer or solve anything it asks."


def _implied_question(attachments: list[dict]) -> str:
    return _IMPLIED_IMAGE_QUESTION if _has_images(attachments) else _IMPLIED_FILE_QUESTION


def _has_images(attachments: list[dict]) -> bool:
    # The attachments engine hands back dicts, not objects — same shape the
    # HTTP layer returns.
    return any(a.get("kind") == "image" for a in attachments)


def _load_attachments(attachment_ids: list[str]) -> list:
    return [attachment_engine.get_attachment(aid) for aid in attachment_ids]


def _expand(message: dict, attachments: list, multimodal: bool) -> dict:
    """A ChatMessage dict with its attachment ids replaced by content the
    target model can actually read."""
    payload = {k: v for k, v in message.items() if k != "attachment_ids"}
    if not attachments:
        return payload
    text = message.get("content", "") or _implied_question(attachments)
    payload["content"] = attachment_engine.build_message_content(text, attachments, multimodal)
    return payload


def expand_message(message: dict, multimodal: bool) -> dict:
    """Load one message's attachments and replace the ids with content the
    target model can read.

    Images become image_url parts (only when a projector is loaded); documents
    become extracted text. Anything unreadable becomes an honest note saying so,
    rather than being dropped silently — the user should be able to see that
    their scanned PDF contributed nothing.
    """
    attachments = _load_attachments(list(message.get("attachment_ids") or []))
    return _expand(message, attachments, multimodal)


async def _describe_images(
    vision_artifact_id: str, attachments: list[dict]
) -> tuple[str | None, str | None]:
    """Ask the vision slot what is in the images.

    Returns `(description, error)` — exactly one of the two. A hand-off that
    errors must not take the whole turn down with it, but it must not vanish
    either: the failure is reported so the transcript can say the eyes could
    not read the image, instead of leaving the user with an answer that claims
    it cannot see and no way to tell why.
    """
    images = [a for a in attachments if a.get("kind") == "image"]
    if not images:
        return None, None
    content = attachment_engine.build_message_content(_VISION_PROMPT, images, multimodal=True)
    try:
        result = await backend.agenerate(
            [{"role": "user", "content": content}],
            # Low temperature on purpose: this is transcription, and a vision
            # model sampling freely invents plausible code and plausible digits.
            {"max_tokens": _VISION_MAX_TOKENS, "temperature": 0.1, "top_p": 0.9},
            model_artifact_id=vision_artifact_id,
            timeout_s=_VISION_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001 — degrade to the text-only path
        log.warning("Vision hand-off failed on %s: %s", vision_artifact_id, exc)
        return None, f"{type(exc).__name__}: {exc}"
    described = (result.get("content") or "").strip()
    if not described:
        return None, "the model returned an empty description"
    described, looped = trim_degenerate_tail(described)
    if looped:
        log.info("Vision description from %s was cut short at a repetition loop", vision_artifact_id)
        # A loop that started almost immediately means the model never read the
        # image at all — it found a phrase and got stuck on it. Handing that on
        # as a transcription is how "Cat Cuteness Cat Cuteness" becomes an
        # answer about cats. Report it as a failure instead, but carry what
        # little was read so nothing is hidden from the user.
        salvaged = described.split("\n\n[transcription stopped")[0].strip()
        if len(salvaged.split()) < _MIN_USABLE_WORDS:
            return None, (
                "it repeated one phrase instead of transcribing the image"
                + (f" — all it read was: {salvaged}" if salvaged else "")
            )
    return described, None


#: Below this many words before the loop began, the reading is not a partial
#: transcription — it is a model that got stuck on the first thing it saw.
_MIN_USABLE_WORDS = 12

#: Lines examined when deciding whether the tail of a description has stopped
#: being a transcription and started being a loop.
_LOOP_WINDOW = 12
#: How much of that window has to share one shape before it counts as a loop.
_LOOP_SHARE = 0.6


def _shape(line: str) -> str:
    """A line with its content abstracted away, leaving its skeleton.

    "e_{b} &= 13.0 \\" and "e_{c} &= 4.0 \\" are different strings and the same
    line, which is exactly what a looping model produces.
    """
    out = []
    previous_filler = False
    for char in line.strip():
        if char.isalnum():
            if not previous_filler:
                out.append("#")
                previous_filler = True
        else:
            out.append(char)
            previous_filler = False
    return "".join(out)


#: Word-level loop detection. A stuck model repeats a short phrase — "Cat
#: Cuteness Cat Cuteness Cat Cuteness…" — with no line breaks at all, so the
#: line-shape check below never sees it.
_MAX_LOOP_PERIOD = 20
#: How much of the tail has to be periodic before it counts.
_PERIODIC_SHARE = 0.9
#: Floors that keep genuine repetition out of the net: a transcribed table of
#: "| --- | --- |" or two identical lines of code repeat too, and briefly.
_MIN_LOOP_WORDS = 30
_MIN_LOOP_REPEATS = 6


def _trim_repeated_phrase(text: str) -> tuple[str, bool] | None:
    """Cut a tail that has collapsed into one phrase repeating.

    Works on the original string via word offsets rather than on a re-joined
    word list, so the transcription that came before the loop keeps its line
    breaks and indentation — which for code is most of its value.
    """
    words = [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", text)]
    if len(words) < _MIN_LOOP_WORDS:
        return None
    tokens = [w[0] for w in words]

    for period in range(1, _MAX_LOOP_PERIOD + 1):
        if len(tokens) < period * _MIN_LOOP_REPEATS:
            continue
        # Walk back from the end for as long as the text repeats with this period.
        index = len(tokens) - 1
        while index - period >= 0 and tokens[index] == tokens[index - period]:
            index -= 1
        run_start = index + 1
        run_length = len(tokens) - run_start
        if run_length < max(_MIN_LOOP_WORDS, period * _MIN_LOOP_REPEATS):
            continue
        unit = tokens[run_start : run_start + period]
        # Punctuation-only units are formatting ("---", "|"), not a stuck model.
        if not any(any(c.isalnum() for c in token) for token in unit):
            continue
        # Confirm against the whole run rather than trusting the walk alone.
        matches = sum(
            1 for i in range(run_start + period, len(tokens)) if tokens[i] == tokens[i - period]
        )
        total = len(tokens) - run_start - period
        if total <= 0 or matches / total < _PERIODIC_SHARE:
            continue
        # Keep everything before the loop plus one copy of the repeated phrase.
        cut = words[min(run_start + period, len(words)) - 1][2]
        kept = text[:cut].rstrip()
        return f"{kept}\n\n[transcription stopped here — the model began repeating itself]", True
    return None


def trim_degenerate_tail(text: str) -> tuple[str, bool]:
    """Cut a transcription off where it stops reading and starts repeating.

    Small vision models asked to read an image they cannot fully resolve tend
    to latch onto a line shape and emit it until they run out of tokens — a
    real reading followed by pages of invention. The useful part is the prefix,
    so this keeps that and says plainly where it stopped, rather than handing
    the answering model a wall of fabricated lines to reason over.

    Returns the text and whether anything was cut.
    """
    phrase = _trim_repeated_phrase(text)
    if phrase is not None:
        return phrase

    lines = text.splitlines()
    if len(lines) < _LOOP_WINDOW:
        return text, False

    shapes = [_shape(line) for line in lines]
    for start in range(len(lines) - _LOOP_WINDOW + 1):
        window = [s for s in shapes[start : start + _LOOP_WINDOW] if s]
        if len(window) < _LOOP_WINDOW:
            continue
        most_common = max(set(window), key=window.count)
        # A blank shape is punctuation-only ("---"), not a repeated statement.
        if not most_common.strip("#"):
            continue
        if window.count(most_common) / len(window) < _LOOP_SHARE:
            continue
        # Keep the first repeat — one example of the pattern is often real.
        first = next(
            (i for i in range(start, len(lines)) if shapes[i] == most_common), start
        )
        kept = "\n".join(lines[: first + 1]).rstrip()
        return (
            f"{kept}\n\n[transcription stopped here — the model began repeating itself]",
            True,
        )
    return text, False


def _expand_after_handoff(message: dict, attachments: list, vision_name: str) -> dict:
    """The last user message, for an answerer that cannot see but whose eyes
    already looked.

    The images are replaced by a line naming them, *not* by the attachments
    engine's "the loaded model has no vision support" note. That note is true
    of the responder and false of the turn, and a model told in one breath that
    the picture was read and in the next that it could not be read reliably
    answers with the second — which is exactly the "it says it can't see my
    screenshot" the hand-off exists to prevent.
    """
    payload = {k: v for k, v in message.items() if k != "attachment_ids"}
    images = [a for a in attachments if a.get("kind") == "image"]
    others = [a for a in attachments if a.get("kind") != "image"]

    parts: list[dict] = [
        {
            "type": "text",
            "text": (
                f"[image: {a.get('file_name') or 'attachment'} — read by {vision_name}, "
                "transcribed above]"
            ),
        }
        for a in images
    ]
    # Documents still expand normally; only the images were handed off.
    rest = attachment_engine.build_message_content(
        message.get("content", "") or _implied_question(attachments), others, multimodal=False
    )
    if isinstance(rest, str):
        if rest:
            parts.append({"type": "text", "text": rest})
    else:
        parts.extend(rest)

    payload["content"] = parts
    return payload


#: Rough characters per token. Deliberately low (real English text runs nearer
#: 4), because over-estimating the prompt costs a dropped turn and
#: under-estimating costs the whole request.
_CHARS_PER_TOKEN = 3.2

#: What one image is assumed to cost the model that can see it. Measured at
#: ~340 tokens for a full-page screenshot through SmolVLM's projector; rounded
#: up hard, since the true figure depends on the projector and the resolution.
_IMAGE_TOKEN_ESTIMATE = 800

#: Never handed to the model, so a slightly wrong estimate above still leaves
#: the request inside the window.
_CONTEXT_SAFETY_MARGIN = 128


def _estimate_tokens(content) -> int:
    """A deliberately rough size for one message's content."""
    if isinstance(content, str):
        return int(len(content) / _CHARS_PER_TOKEN) + 4
    total = 4
    for part in content or []:
        if part.get("type") == "image_url":
            total += _IMAGE_TOKEN_ESTIMATE
        else:
            total += int(len(part.get("text") or "") / _CHARS_PER_TOKEN)
    return total


def _fit_to_context(messages: list[dict], context_length: int, max_tokens: int) -> list[dict]:
    """Drop the oldest turns until the request plausibly fits the window.

    llama-server refuses a request longer than the context with a 400 rather
    than truncating it, so without this a chat simply stops working once it
    grows past the window — and the default context here is 4k, which a couple
    of image transcriptions can fill on their own.

    System turns are never dropped (they carry the system prompt and the vision
    hand-off), and neither is the message being answered. Between them, the
    oldest exchanges go first, which is the part of a conversation whose loss
    the user is least likely to notice.
    """
    budget = context_length - max_tokens - _CONTEXT_SAFETY_MARGIN
    if budget <= 0:
        # The answer alone is bigger than the window; nothing to trim towards.
        return messages

    sizes = [_estimate_tokens(m.get("content")) for m in messages]
    total = sum(sizes)
    if total <= budget:
        return messages

    # Indexes that may be dropped: everything except system turns and the last
    # message, oldest first.
    droppable = [
        i for i, m in enumerate(messages) if m.get("role") != "system" and i != len(messages) - 1
    ]
    dropped: set[int] = set()
    for index in droppable:
        if total <= budget:
            break
        dropped.add(index)
        total -= sizes[index]

    if dropped:
        log.info(
            "Trimmed %d old turn(s) to fit a %d-token context (est. %d tokens left)",
            len(dropped), context_length, total,
        )
    return [m for i, m in enumerate(messages) if i not in dropped]


async def run_turn(
    messages: list[dict],
    params: dict,
    responder_artifact_id: str | None = None,
) -> AsyncIterator[dict]:
    """Stream one turn, using the vision slot first where that helps.

    Yields the same `delta` / `done` / `error` records as the single-model path,
    plus an optional `handoff` record before the answer begins.
    """
    responder = backend._require_slot(responder_artifact_id)  # noqa: SLF001 — same package
    # By capability, not by label: any loaded model with a projector can be the
    # chat's eyes, whether or not anyone tagged it "vision".
    vision_slot = backend.vision_provider(exclude_artifact_id=responder.artifact_id)

    # Attachments belong to the last user message; earlier turns replay as the
    # text they already produced.
    last = messages[-1] if messages else {}
    attachment_ids = list(last.get("attachment_ids") or [])
    try:
        attachments = _load_attachments(attachment_ids) if attachment_ids else []
    except attachment_engine.AttachmentError as exc:
        # Named explicitly rather than left to the router's blanket handler, so
        # the user sees which file went missing instead of a bare exception.
        yield {"error": str(exc)}
        return

    handoff_note: str | None = None
    use_handoff = (
        app_settings.get("vision_handoff_enabled")
        and attachments
        and _has_images(attachments)
        and not responder.multimodal
        and vision_slot is not None
    )

    if use_handoff:
        assert vision_slot is not None
        # Announced before the wait, not after it. Reading an image is the
        # slowest step in the turn — minutes, on the CPU-only machines this app
        # exists for — and a silent gap of that length is indistinguishable
        # from a hang, which is what "the eyes don't work" usually means.
        yield {
            "handoff_started": {
                "role": "vision",
                "model_name": vision_slot["model_name"],
                "artifact_id": vision_slot["artifact_id"],
            }
        }
        description, failure = await _describe_images(vision_slot["artifact_id"], attachments)
        if description:
            handoff_note = description
        yield {
            "handoff": {
                "role": "vision",
                "model_name": vision_slot["model_name"],
                "artifact_id": vision_slot["artifact_id"],
                "content": description or (failure or "the image could not be read"),
                # A failed hand-off is announced too. Degrading in silence left
                # the user with an answer that says it cannot see the image and
                # no way to tell whether the eyes were missing, broken, or
                # simply never asked.
                "failed": description is None,
            }
        }

    expanded: list[dict] = []
    for index, message in enumerate(messages):
        is_last = index == len(messages) - 1
        message_attachments = attachments if is_last else []
        if is_last and handoff_note and message_attachments:
            assert vision_slot is not None
            expanded.append(
                _expand_after_handoff(message, message_attachments, vision_slot["model_name"])
            )
        else:
            expanded.append(_expand(message, message_attachments, responder.multimodal))

    if handoff_note:
        # Inserted as its own system turn rather than glued onto the user's
        # words, so the answerer can tell the user's question apart from
        # another model's observation of the picture.
        expanded.insert(
            max(0, len(expanded) - 1),
            {
                "role": "system",
                # Phrasing measured, not chosen. Against the 0.5B model this app
                # actually pairs with a vision slot, an earlier draft of this
                # note ordered the model not to claim it was unable to see —
                # and telling a small model what not to say is the most
                # reliable way to make it say exactly that: it refused 5 of 6
                # times. The calm, positive form below answered 7 of 8.
                "content": (
                    f"{vision_slot['model_name']} read the image(s) attached to the next message "
                    f"and transcribed them as:\n\n{handoff_note}\n\n"
                    "This transcription is the contents of the image. Answer the user's question "
                    "from it, working through any code or mathematics in full. If it does not "
                    "contain what you need, say which part is missing rather than inventing detail."
                ),
            },
        )

    requested_max = params.get("max_tokens") or app_settings.get("default_max_tokens")
    if "reasoning" in (responder.capabilities or []):
        floor = app_settings.get("reasoning_max_tokens")
        if floor is not None and requested_max < floor:
            requested_max = floor
            params = {**params, "max_tokens": requested_max}
    expanded = _fit_to_context(expanded, responder.context_length, requested_max)

    async for chunk in backend.stream(expanded, params, model_artifact_id=responder.artifact_id):
        yield chunk
