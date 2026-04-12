from __future__ import annotations

import math
import random
import re
from collections import Counter
from itertools import zip_longest
from typing import Any


STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
    "this",
    "these",
    "those",
    "was",
    "were",
    "will",
    "can",
    "should",
    "have",
    "has",
    "had",
    "about",
    "into",
    "your",
    "their",
    "его",
    "ее",
    "это",
    "как",
    "для",
    "что",
    "или",
    "над",
    "при",
    "если",
    "это",
    "так",
    "все",
    "всех",
    "без",
    "под",
    "после",
    "перед",
    "было",
    "быть",
    "есть",
    "когда",
    "если",
    "также",
    "может",
}


def extract_source_texts(sources: list[dict[str, Any]] | None) -> list[str]:
    rows: list[str] = []
    for source in sources or []:
        text = str(source.get("text") or "").strip()
        if text:
            rows.append(text)
            continue
        title = str(source.get("title") or source.get("document_id") or source.get("artifact_id") or "").strip()
        if title:
            rows.append(title)
    return rows


def fallback_topic(prompt: str | None, sources: list[dict[str, Any]] | None) -> str:
    if prompt and prompt.strip():
        return prompt.strip().splitlines()[0][:120]
    texts = extract_source_texts(sources)
    return texts[0][:120] if texts else "Generated project"


def sentence_split(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [chunk.strip(" -\t\r\n") for chunk in chunks if chunk.strip()]


def summarize_text(text: str, max_sentences: int = 2) -> str:
    sentences = sentence_split(text)
    if not sentences:
        return ""
    return " ".join(sentences[:max_sentences])


def tokenize(text: str) -> list[str]:
    return re.findall(r"[A-Za-zА-Яа-я0-9_]{3,}", text.lower())


def top_keywords(text: str, limit: int = 10) -> list[str]:
    counter = Counter(token for token in tokenize(text) if token not in STOP_WORDS)
    return [token for token, _ in counter.most_common(limit)]


def jaccard_similarity(left: str, right: str) -> float:
    left_tokens = set(tokenize(left))
    right_tokens = set(tokenize(right))
    if not left_tokens and not right_tokens:
        return 1.0
    if not left_tokens or not right_tokens:
        return 0.0
    return round(len(left_tokens & right_tokens) / len(left_tokens | right_tokens), 4)


def build_chat_rag(
    messages: list[dict[str, Any]],
    sources: list[dict[str, Any]] | None,
    answer_style: str | None = None,
) -> dict[str, Any]:
    user_messages = [str(msg.get("content", "")) for msg in messages if msg.get("role") == "user"]
    question = user_messages[-1] if user_messages else fallback_topic(None, sources)
    source_texts = extract_source_texts(sources)
    stitched = " ".join(source_texts)
    answer = summarize_text(stitched, max_sentences=3)
    if not answer:
        answer = f"Answer for: {question}"
    if answer_style:
        answer = f"[{answer_style}] {answer}"
    citations = []
    for index, source in enumerate(sources or [], start=1):
        snippet = summarize_text(str(source.get("text", "")), max_sentences=1)
        citations.append(
            {
                "index": index,
                "label": source.get("title") or f"Source {index}",
                "snippet": snippet,
                "source": {
                    "artifact_id": source.get("artifact_id"),
                    "document_id": source.get("document_id"),
                    "chunk_id": source.get("chunk_id"),
                    "title": source.get("title"),
                },
            }
        )
    return {
        "answer": answer,
        "citations": citations,
        "follow_up_questions": [f"What is the next step for {keyword}?" for keyword in top_keywords(question + " " + stitched, 3)],
    }


def build_compare(documents: list[dict[str, Any]], mode: str, focus_topics: list[str] | None = None) -> dict[str, Any]:
    texts = extract_source_texts(documents)
    combined = " ".join(texts)
    common = set(tokenize(texts[0])) if texts else set()
    for text in texts[1:]:
        common &= set(tokenize(text))
    focus_topics = [topic.lower() for topic in (focus_topics or []) if topic]
    unique_topics = []
    for index, text in enumerate(texts):
        other_tokens = set()
        for other_index, other_text in enumerate(texts):
            if other_index == index:
                continue
            other_tokens |= set(tokenize(other_text))
        current_tokens = set(top_keywords(text, 12))
        unique_topics.append({"document_index": index, "topics": sorted(current_tokens - other_tokens)})
    metrics = {
        f"doc_{index + 1}_length": float(len(text.split()))
        for index, text in enumerate(texts)
    }
    if len(texts) >= 2:
        metrics["similarity"] = jaccard_similarity(texts[0], texts[1])
    conflicts = []
    for left_index, left in enumerate(texts):
        for right_index, right in enumerate(texts[left_index + 1 :], start=left_index + 1):
            if ("not " in left.lower()) != ("not " in right.lower()):
                conflicts.append(
                    {
                        "documents": [left_index, right_index],
                        "description": "Different polarity detected between compared texts.",
                    }
                )
    evidence_map = [
        {"topic": keyword, "documents": [index for index, text in enumerate(texts) if keyword in tokenize(text)]}
        for keyword in top_keywords(combined, 8)
    ]
    summary = summarize_text(combined, max_sentences=4)
    if mode == "multi_document_summary":
        metrics["document_count"] = float(len(texts))
        summary = summarize_text(combined, max_sentences=min(6, max(2, len(texts))))
        evidence_map = [
            {
                "topic": keyword,
                "documents": [index for index, text in enumerate(texts) if keyword in tokenize(text)],
                "focus": keyword in focus_topics,
            }
            for keyword in top_keywords(combined, 10)
        ]
    if mode == "diff_focus":
        interesting = focus_topics or top_keywords(combined, 5)
        conflicts = [
            {
                "topic": topic,
                "documents": [index for index, text in enumerate(texts) if topic in tokenize(text)],
                "description": f"Review differences around '{topic}'.",
            }
            for topic in interesting
        ]
        evidence_map = [
            {
                "topic": topic,
                "snippets": [summarize_text(text, 1) for text in texts if topic in tokenize(text)],
            }
            for topic in interesting
        ]
    if mode == "overlap_matrix":
        evidence_map = [
            {
                "pair": [left_index, right_index],
                "similarity": jaccard_similarity(texts[left_index], texts[right_index]),
            }
            for left_index in range(len(texts))
            for right_index in range(left_index + 1, len(texts))
        ]
    return {
        "summary": summary,
        "metrics": metrics,
        "common_topics": sorted(list(common))[:10],
        "unique_topics": unique_topics,
        "conflicts": conflicts,
        "evidence_map": evidence_map,
    }


def build_mindmap(
    prompt: str | None,
    sources: list[dict[str, Any]] | None,
    max_depth: int | None,
    target_branch_count: int | None,
    target_children_per_branch: int | None,
) -> dict[str, Any]:
    topic = fallback_topic(prompt, sources)
    source_text = " ".join(extract_source_texts(sources))
    keywords = top_keywords(f"{topic} {source_text}", limit=max(target_branch_count or 5, 5) * max(target_children_per_branch or 2, 2))
    branch_count = target_branch_count or 5
    child_count = target_children_per_branch or 2
    nodes = [{"id": "root", "label": topic, "node_type": "root", "summary": summarize_text(source_text or topic), "tags": [], "sources": []}]
    edges = []
    summaries = []
    for branch_index in range(branch_count):
        label = keywords[branch_index] if branch_index < len(keywords) else f"branch-{branch_index + 1}"
        node_id = f"branch_{branch_index + 1}"
        nodes.append({"id": node_id, "label": label.title(), "node_type": "branch", "summary": f"Focus area for {label}.", "tags": [label], "sources": []})
        edges.append({"source": "root", "target": node_id, "edge_type": "contains", "label": "branch"})
        summaries.append(f"{label.title()} expands the main topic.")
        if (max_depth or 2) < 2:
            continue
        for child_index in range(child_count):
            keyword_index = branch_count + branch_index * child_count + child_index
            child_label = keywords[keyword_index] if keyword_index < len(keywords) else f"{label}-{child_index + 1}"
            child_id = f"{node_id}_child_{child_index + 1}"
            nodes.append(
                {
                    "id": child_id,
                    "label": child_label.title(),
                    "node_type": "leaf",
                    "summary": f"Sub-topic connected to {label}.",
                    "tags": [label, child_label],
                    "sources": [],
                }
            )
            edges.append({"source": node_id, "target": child_id, "edge_type": "extends", "label": "detail"})
    return {"graph": {"nodes": nodes, "edges": edges}, "summaries": summaries}


def build_quiz(request: dict[str, Any]) -> dict[str, Any]:
    prompt = request.get("prompt") or fallback_topic(None, request.get("sources"))
    source_text = " ".join(extract_source_texts(request.get("sources")))
    sentences = sentence_split(source_text or prompt) or [prompt]
    question_count = int(request.get("question_count") or 5)
    options_count = int(request.get("options_count") or 4)
    allowed_types = request.get("allowed_types") or ["single_choice"]
    previous_questions = {item.strip().lower() for item in request.get("previous_questions") or [] if str(item).strip()}
    generator = random.Random(request.get("seed"))
    sentence_pool = list(sentences)
    generator.shuffle(sentence_pool)
    questions = []
    for index in range(question_count):
        seed_sentence = sentence_pool[index % len(sentence_pool)]
        keywords = top_keywords(seed_sentence, max(options_count, 2) + 2)
        correct = keywords[0].title() if keywords else f"Option {index + 1}"
        prompt_text = f"What best matches this topic: {summarize_text(seed_sentence, 1)}"
        if prompt_text.lower() in previous_questions:
            prompt_text = f"How would you explain: {summarize_text(seed_sentence, 1)}"
        question_type = allowed_types[index % len(allowed_types)]
        option_labels = list(dict.fromkeys((keywords + [f"distractor {index + 1}", f"alternative {index + 1}"])[:options_count]))
        generator.shuffle(option_labels)
        options = [{"id": f"opt_{option_index + 1}", "label": value.title()} for option_index, value in enumerate(option_labels)]
        if not any(option["label"] == correct for option in options):
            options[0]["label"] = correct
        correct_answer: str | list[str] | dict[str, Any]
        if question_type == "multiple_choice":
            correct_answer = [options[0]["label"], options[min(1, len(options) - 1)]["label"]]
        elif question_type == "true_false":
            options = [{"id": "opt_true", "label": "True"}, {"id": "opt_false", "label": "False"}]
            correct_answer = "True"
        elif question_type == "short_answer":
            options = []
            correct_answer = summarize_text(seed_sentence, 1)
        elif question_type == "match_pairs":
            options = pair_options(keywords[: max(2, options_count)])
            correct_answer = {"pairs": options}
        elif question_type == "ordering":
            ordered = [keyword.title() for keyword in keywords[: max(2, options_count)]]
            options = [{"id": f"opt_{item_index + 1}", "label": label} for item_index, label in enumerate(reversed(ordered))]
            correct_answer = ordered
        elif question_type == "fill_gap":
            options = [{"id": f"opt_{option_index + 1}", "label": value.title()} for option_index, value in enumerate(option_labels)]
            correct_answer = correct
            prompt_text = f"Fill the gap with the best term: {correct[0]}____ in context of {summarize_text(seed_sentence, 1)}"
        else:
            correct_answer = correct
        questions.append(
            {
                "id": f"question_{index + 1}",
                "type": question_type,
                "prompt": prompt_text,
                "options": options,
                "correct_answer": correct_answer,
                "explanation": summarize_text(seed_sentence, 1) if request.get("explain_answers", True) else None,
                "tags": top_keywords(seed_sentence, 3),
                "difficulty": request.get("difficulty") or "medium",
                "estimated_time_seconds": max(20, len(seed_sentence.split()) * 3),
            }
        )
    return {
        "title": f"Quiz: {prompt[:80]}",
        "questions": questions,
        "scoring_rules": {
            "mode": "equal_weight",
            "question_count": question_count,
            "time_limit_seconds": request.get("time_limit_seconds"),
        },
    }


def build_table(request: dict[str, Any]) -> dict[str, Any]:
    sources = request.get("sources") or []
    source_text = "\n".join(extract_source_texts(sources))
    lines = [line.strip() for line in source_text.splitlines() if line.strip()]
    target_columns = request.get("target_columns") or []
    columns = target_columns or [
        {"key": "row", "label": "Row", "data_type": "string"},
        {"key": "value", "label": "Value", "data_type": "string"},
    ]
    max_rows = int(request.get("max_rows") or max(1, min(len(lines), 20)))
    rows = []
    if len(columns) >= 2:
        first_column = columns[0].get("key") or "column_1"
        second_column = columns[1].get("key") or "column_2"
        for index, line in enumerate(lines[:max_rows], start=1):
            first_value: Any = index if request.get("typed_cells", True) else str(index)
            rows.append({first_column: first_value, second_column: line})
    else:
        only_column = columns[0].get("key") or "value"
        rows = [{only_column: line} for line in lines[:max_rows]]
    if request.get("aggregation_mode") == "count" and rows:
        rows.append({"summary": f"row_count={len(rows)}"})
    return {"columns": columns, "rows": rows, "artifacts": []}


def build_infographic(request: dict[str, Any]) -> dict[str, Any]:
    prompt = request.get("prompt") or fallback_topic(None, request.get("sources"))
    source_text = " ".join(extract_source_texts(request.get("sources")))
    keywords = top_keywords(f"{prompt} {source_text}", 5)
    mode = request.get("mode") or "single_chart"
    block_kind = {
        "single_chart": "chart",
        "multi_chart": "chart",
        "kpi_cards": "kpi_card",
        "timeline_infographic": "timeline",
        "comparison_board": "comparison",
    }.get(mode, "chart")
    spec = {
        "mode": mode,
        "title": prompt[:120],
        "blocks": [
            {"kind": block_kind, "label": keyword.title(), "value": index + 1}
            for index, keyword in enumerate(keywords)
        ],
        "layout_hint": request.get("layout_hint"),
        "palette_hint": request.get("palette_hint"),
    }
    return {
        "spec": spec,
        "narrative_summary": summarize_text(source_text or prompt, 3),
        "captions": [f"{keyword.title()} matters for the overall story." for keyword in keywords[:4]],
        "palette": ["#0F766E", "#F59E0B", "#1D4ED8", "#DC2626", "#6D28D9"],
        "artifacts": [],
    }


def build_report(request: dict[str, Any]) -> dict[str, Any]:
    prompt = request.get("prompt") or fallback_topic(None, request.get("sources"))
    source_texts = extract_source_texts(request.get("sources"))
    template_id = request.get("template_id") or "report.default"
    section_rules = request.get("section_rules") or {}
    section_titles = list(section_rules.keys()) if section_rules else []
    sections = []
    citations = []
    for index, text in enumerate(source_texts[: max(3, len(section_titles) or 5)], start=1):
        title = section_titles[index - 1] if index - 1 < len(section_titles) else f"Section {index}"
        tone = request.get("tone") or "neutral"
        content = summarize_text(text, 3)
        if request.get("length") == "long":
            content = summarize_text(text, 5)
        sections.append({"id": f"section_{index}", "title": title, "content": f"[{tone}] {content}".strip()})
        citations.append(
            {
                "index": index,
                "label": f"Source {index}",
                "snippet": summarize_text(text, 1),
                "source": {"title": f"Source {index}"},
            }
        )
    if not sections:
        sections.append({"id": "section_1", "title": "Overview", "content": prompt})
    return {
        "title": f"{template_id}: {prompt[:120]}",
        "summary": summarize_text(" ".join(source_texts) or prompt, 2),
        "sections": sections,
        "citations": citations,
        "artifacts": [],
    }


def build_presentation_payload(request: dict[str, Any]) -> dict[str, Any]:
    prompt = request.get("prompt") or fallback_topic(None, request.get("sources"))
    source_text = " ".join(extract_source_texts(request.get("sources")))
    sentences = sentence_split(source_text or prompt) or [prompt]
    slide_count = int(request.get("slide_count_hint") or 5)
    slides = []
    for index in range(slide_count):
        sentence = sentences[index % len(sentences)]
        bullets = top_keywords(sentence, 4) or [f"point {index + 1}"]
        slides.append(
            {
                "id": f"slide_{index + 1}",
                "kind": "content",
                "title": sentence[:80],
                "subtitle": request.get("audience") or request.get("tone"),
                "blocks": [
                    {"kind": "bullet_list", "data": {"items": [bullet.title() for bullet in bullets]}},
                    {"kind": "text", "data": {"content": summarize_text(sentence, 1)}},
                ],
                "speaker_notes": summarize_text(sentence, 2) if request.get("include_speaker_notes", True) else "",
                "source_refs": [],
                "layout": request.get("layout_strategy") or "standard",
                "visual_hints": {"theme": request.get("theme"), "keywords": bullets},
                "metadata": {},
            }
        )
    return {
        "project_format_version": "1.0",
        "source_inputs": request.get("sources") or [],
        "theme": request.get("theme") or "knova-default",
        "slides": slides,
    }


def build_podcast_payload(request: dict[str, Any]) -> dict[str, Any]:
    prompt = request.get("prompt") or fallback_topic(None, request.get("sources"))
    source_text = " ".join(extract_source_texts(request.get("sources")))
    sentence_groups = sentence_split(source_text or prompt) or [prompt]
    speaker_count = int(request.get("speaker_count") or 1)
    if request.get("narrator_mode"):
        speaker_count = 1
    speakers = [
        {
            "id": f"speaker_{index + 1}",
            "display_name": f"Speaker {index + 1}",
            "role": "narrator" if index == 0 else "guest",
            "voice": (request.get("voice_preferences") or [{}])[index % max(len(request.get("voice_preferences") or [{}]), 1)],
        }
        for index in range(speaker_count)
    ]
    segments = []
    for index, sentence in enumerate(sentence_groups[: max(3, speaker_count * 3)], start=1):
        speaker = speakers[(index - 1) % len(speakers)]
        segments.append(
            {
                "id": f"segment_{index}",
                "chapter_id": "chapter_1",
                "speaker": speaker["id"],
                "text": sentence,
                "ssml": None,
                "voice": speaker.get("voice") or None,
                "duration_estimate_ms": max(2000, len(sentence.split()) * 420),
                "audio_artifact_id": None,
                "start_ms": None,
                "end_ms": None,
                "status": "draft",
                "metadata": {},
            }
        )
    return {
        "project_format_version": "1.0",
        "source_inputs": request.get("sources") or [],
        "speakers": speakers,
        "chapters": [{"id": "chapter_1", "title": prompt[:80], "summary": summarize_text(source_text or prompt, 2)}],
        "segments": segments,
        "voice_map": {speaker["id"]: speaker.get("voice") or {} for speaker in speakers},
        "music_tracks": [],
        "render_settings": {"music_policy": request.get("music_policy")},
    }


def build_video_payload(request: dict[str, Any], mode: str | None = None) -> dict[str, Any]:
    chosen_mode = mode or request.get("mode") or "scene_based_explainer"
    title = request.get("title") or fallback_topic(None, request.get("sources"))
    source_text = " ".join(extract_source_texts(request.get("sources")))
    scenes = []
    for index, sentence in enumerate((sentence_split(source_text or title) or [title])[:5], start=1):
        transition = "cut" if chosen_mode == "audiogram" else "fade"
        scenes.append(
            {
                "id": f"scene_{index}",
                "title": sentence[:80],
                "narration_text": sentence,
                "duration_ms": max(2000, len(sentence.split()) * 350),
                "asset_refs": [],
                "subtitle_text": sentence,
                "transition": transition,
                "status": "draft",
                "metadata": {},
            }
        )
    return {
        "project_format_version": "1.0",
        "mode": chosen_mode,
        "source_inputs": request.get("sources") or [],
        "scenes": scenes,
        "audio_tracks": [],
        "subtitle_tracks": [],
        "assets": [],
        "render_profile": request.get("render_profile") or {"aspect_ratio": request.get("aspect_ratio", "16:9")},
    }


def regenerate_slide_content(slide: dict[str, Any], instructions: str | None, fields: list[str] | None) -> dict[str, Any]:
    target_fields = set(fields or ["title", "subtitle", "blocks", "speaker_notes", "visual_hints"])
    updated = dict(slide)
    suffix = instructions or "refined"
    if "title" in target_fields:
        updated["title"] = f"{slide.get('title', 'Slide')} ({suffix})"
    if "subtitle" in target_fields:
        updated["subtitle"] = f"{slide.get('subtitle') or 'Updated'}"
    if "blocks" in target_fields:
        blocks = updated.get("blocks") or []
        blocks.append({"kind": "callout", "data": {"content": f"Adjusted with instructions: {suffix}"}})
        updated["blocks"] = blocks
    if "speaker_notes" in target_fields:
        updated["speaker_notes"] = f"{slide.get('speaker_notes') or ''}\nAdjusted: {suffix}".strip()
    if "visual_hints" in target_fields:
        hints = dict(updated.get("visual_hints") or {})
        hints["adjustment"] = suffix
        updated["visual_hints"] = hints
    return updated


def build_rows_markdown(columns: list[dict[str, Any]], rows: list[dict[str, Any]]) -> str:
    headers = [column.get("label") or column.get("key") or f"column_{index + 1}" for index, column in enumerate(columns)]
    keys = [column.get("key") or header.lower() for header, column in zip(headers, columns)]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        values = [str(row.get(key, "")) for key in keys]
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def pair_options(items: list[str]) -> list[dict[str, str]]:
    return [{"left": left, "right": right or ""} for left, right in zip_longest(items[::2], items[1::2], fillvalue="")]


def clamp(value: int, lower: int, upper: int) -> int:
    return max(lower, min(value, upper))


def estimate_audio_duration_ms(text: str, words_per_minute: int = 145) -> int:
    word_count = max(1, len(text.split()))
    return math.ceil(word_count / words_per_minute * 60_000)
