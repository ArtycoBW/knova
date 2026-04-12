from __future__ import annotations

import json
from enum import StrEnum
from typing import Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ErrorSchema(StrictModel):
    code: str
    message: str
    request_id: str | None = None
    details: dict[str, Any] | None = None


class HealthStatus(StrEnum):
    ok = "ok"
    degraded = "degraded"
    failed = "failed"


class HealthResponse(StrictModel):
    status: Literal["ok"]
    timestamp: str


class ReadinessCheck(StrictModel):
    name: str
    status: HealthStatus
    details: dict[str, Any] | None = None


class ReadinessResponse(StrictModel):
    status: Literal["ok", "degraded"]
    timestamp: str
    checks: list[ReadinessCheck]


class ProviderKind(StrEnum):
    text = "text"
    embeddings = "embeddings"
    stt = "stt"
    tts = "tts"
    render = "render"
    video = "video"
    image = "image"


class ProviderDescriptor(StrictModel):
    id: str
    kind: ProviderKind
    enabled: bool
    routing_group: str | None = None
    capabilities: list[str]
    default_model_aliases: dict[str, str] = Field(default_factory=dict)


class ProviderListResponse(StrictModel):
    data: list[ProviderDescriptor]


class ModelModality(StrEnum):
    text = "text"
    embeddings = "embeddings"
    audio = "audio"
    video = "video"
    multimodal = "multimodal"


class ModelDescriptor(StrictModel):
    id: str
    alias: str
    provider: str
    modality: ModelModality
    capabilities: list[str]
    recommended_for: list[str] = Field(default_factory=list)
    context_window: int | None = None
    max_output_tokens: int | None = None
    dimensions: int | None = None


class ModelListResponse(StrictModel):
    data: list[ModelDescriptor]


class ExecutionMode(StrEnum):
    sync = "sync"
    async_ = "async"
    auto = "auto"


class ExecutionPriority(StrEnum):
    low = "low"
    normal = "normal"
    high = "high"


class ExecutionOptions(StrictModel):
    mode: ExecutionMode = Field(default=ExecutionMode.auto, alias="mode")
    priority: ExecutionPriority = Field(default=ExecutionPriority.normal)
    idempotency_key: str | None = None
    webhook_url: str | None = None
    callback_headers: dict[str, str] = Field(default_factory=dict)


class GenerationOptions(StrictModel):
    provider: str = "auto"
    model: str = "text-default"
    temperature: float | None = Field(default=None, ge=0)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_output_tokens: int | None = Field(default=None, ge=1)
    seed: int | None = None
    stop: list[str] = Field(default_factory=list)
    repair_structured_output: bool = True


class SourceInput(StrictModel):
    artifact_id: str | None = None
    document_id: str | None = None
    title: str | None = None
    mime_type: str | None = None
    text: str | None = None
    url: str | None = None
    chunk_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceRef(StrictModel):
    artifact_id: str | None = None
    document_id: str | None = None
    chunk_id: str | None = None
    title: str | None = None


class Citation(StrictModel):
    index: int | None = None
    label: str | None = None
    snippet: str | None = None
    source: SourceRef | None = None


class Usage(StrictModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class Artifact(StrictModel):
    id: str
    kind: str
    mime_type: str
    size: int | None = None
    checksum: str | None = None
    storage_uri: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    project_id: str | None = None
    created_at: str


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Job(StrictModel):
    id: str
    type: str
    status: JobStatus
    progress: float = Field(ge=0, le=100)
    request_id: str | None = None
    project_id: str | None = None
    provider: str | None = None
    model: str | None = None
    input_ref: dict[str, Any] = Field(default_factory=dict)
    result_ref: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[Artifact] = Field(default_factory=list)
    error: ErrorSchema | None = None
    created_at: str
    updated_at: str


class JobAcceptedResponse(StrictModel):
    job: Job


ChatContent: TypeAlias = str | list[dict[str, Any]]


class ChatMessage(StrictModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: ChatContent
    name: str | None = None
    tool_call_id: str | None = None


class ResponseFormat(StrictModel):
    type: Literal["text", "json_schema"] = "text"
    json_schema: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_schema_requirement(self) -> "ResponseFormat":
        if self.type == "json_schema" and not self.json_schema:
            raise ValueError("json_schema is required when response_format.type='json_schema'.")
        return self


class ChatCompletionRequest(StrictModel):
    model: str = "text-default"
    provider: str = "auto"
    messages: list[ChatMessage]
    temperature: float | None = Field(default=None, ge=0)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1)
    stream: bool = False
    response_format: ResponseFormat | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatCompletionChoice(StrictModel):
    index: int
    message: ChatMessage
    finish_reason: str | None = None


class ChatCompletionResponse(StrictModel):
    id: str
    object: Literal["chat.completion"]
    created: int
    model: str
    provider: str | None = None
    choices: list[ChatCompletionChoice]
    usage: Usage | None = None


class EmbeddingTaskType(StrEnum):
    retrieval_query = "retrieval_query"
    retrieval_document = "retrieval_document"
    semantic_similarity = "semantic_similarity"
    classification = "classification"
    clustering = "clustering"


class EmbeddingsRequest(StrictModel):
    model: str = "embedding-default"
    provider: str = "auto"
    input: str | list[str]
    dimensions: int | None = Field(default=None, ge=1)
    task_type: EmbeddingTaskType | None = None
    encoding_format: Literal["float"] = "float"


class EmbeddingData(StrictModel):
    object: Literal["embedding"]
    index: int
    embedding: list[float]


class EmbeddingsResponse(StrictModel):
    object: Literal["list"]
    data: list[EmbeddingData]
    model: str
    provider: str | None = None
    usage: Usage | None = None


class TimestampGranularity(StrEnum):
    segment = "segment"
    word = "word"


class TranscriptionSegment(StrictModel):
    id: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    speaker: str | None = None
    text: str | None = None


class TranscriptionResponse(StrictModel):
    text: str
    language: str | None = None
    duration_ms: int | None = None
    segments: list[TranscriptionSegment] = Field(default_factory=list)


class TranscriptionMultipartRequest(StrictModel):
    model: str = "stt-default"
    provider: str = "auto"
    language: str | None = None
    prompt: str | None = None
    response_format: Literal["json", "text", "srt", "verbose_json"] = "verbose_json"
    timestamp_granularities: list[TimestampGranularity] = Field(default_factory=list)
    diarization: bool = False
    speaker_count_hint: int | None = Field(default=None, ge=1)


class VoiceSelection(StrictModel):
    provider: str | None = None
    voice_id: str | None = None
    style: str | None = None
    gender_hint: str | None = None
    locale: str | None = None


class SpeechSegmentInput(StrictModel):
    id: str | None = None
    speaker: str | None = None
    text: str
    ssml: str | None = None
    voice: VoiceSelection | None = None


class SpeechSynthesisRequest(StrictModel):
    text: str | None = None
    segments: list[SpeechSegmentInput] = Field(default_factory=list)
    provider: str = "auto"
    model: str = "tts-default"
    voice: VoiceSelection | None = None
    output_format: Literal["mp3", "wav"] = "mp3"
    speaking_rate: float = 1.0
    style: str | None = None
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_input_payload(self) -> "SpeechSynthesisRequest":
        if not self.text and not self.segments:
            raise ValueError("Either text or segments is required.")
        return self


class SpeechSynthesisResponse(StrictModel):
    provider: str | None = None
    model: str | None = None
    duration_ms: int | None = None
    artifacts: list[Artifact]
    segments: list[SpeechSegmentInput] = Field(default_factory=list)


class ChatRagRequest(StrictModel):
    messages: list[ChatMessage]
    sources: list[SourceInput] = Field(default_factory=list)
    system_prompt: str | None = None
    style_preset: str | None = None
    citation_mode: Literal["none", "inline", "separate"] = "separate"
    answer_style: str | None = None
    max_sources: int | None = Field(default=None, ge=1)
    output_schema: dict[str, Any] | None = None
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class ChatRagResponse(StrictModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    usage: Usage | None = None


class CompareRequest(StrictModel):
    documents: list[SourceInput] = Field(min_length=2)
    mode: Literal["pairwise", "multi_document_summary", "diff_focus", "overlap_matrix"] = "pairwise"
    focus_topics: list[str] = Field(default_factory=list)
    output_schema: dict[str, Any] | None = None
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class CompareResponse(StrictModel):
    summary: str | None = None
    metrics: dict[str, float] = Field(default_factory=dict)
    common_topics: list[str] = Field(default_factory=list)
    unique_topics: list[dict[str, Any]] = Field(default_factory=list)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)
    evidence_map: list[dict[str, Any]] = Field(default_factory=list)


class MindmapNode(StrictModel):
    id: str
    label: str
    node_type: str | None = None
    summary: str | None = None
    tags: list[str] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)


class MindmapEdge(StrictModel):
    source: str
    target: str
    edge_type: str | None = None
    label: str | None = None


class MindmapGraph(StrictModel):
    nodes: list[MindmapNode]
    edges: list[MindmapEdge]


class MindmapRequest(StrictModel):
    prompt: str | None = None
    sources: list[SourceInput] = Field(default_factory=list)
    max_depth: int | None = Field(default=None, ge=1)
    target_branch_count: int | None = Field(default=None, ge=1)
    target_children_per_branch: int | None = Field(default=None, ge=1)
    layout_hint: str | None = None
    style_preset: str | None = None
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class MindmapResponse(StrictModel):
    graph: MindmapGraph
    summaries: list[str] = Field(default_factory=list)


class QuizQuestionType(StrEnum):
    single_choice = "single_choice"
    multiple_choice = "multiple_choice"
    true_false = "true_false"
    short_answer = "short_answer"
    match_pairs = "match_pairs"
    ordering = "ordering"
    fill_gap = "fill_gap"


class QuizQuestion(StrictModel):
    id: str
    type: str
    prompt: str
    options: list[dict[str, Any]] = Field(default_factory=list)
    correct_answer: str | list[str] | dict[str, Any] | None = None
    explanation: str | None = None
    tags: list[str] = Field(default_factory=list)
    difficulty: str | None = None
    estimated_time_seconds: int | None = None


class QuizRequest(StrictModel):
    prompt: str | None = None
    sources: list[SourceInput] = Field(default_factory=list)
    question_count: int | None = Field(default=None, ge=1)
    options_count: int | None = Field(default=None, ge=2)
    allowed_types: list[QuizQuestionType] = Field(default_factory=list)
    difficulty: str | None = None
    audience_level: str | None = None
    language: str | None = None
    time_limit_seconds: int | None = Field(default=None, ge=1)
    seed: int | None = None
    previous_questions: list[str] = Field(default_factory=list)
    explain_answers: bool = True
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class QuizResponse(StrictModel):
    title: str | None = None
    questions: list[QuizQuestion]
    scoring_rules: dict[str, Any] = Field(default_factory=dict)


class TableColumnSpec(StrictModel):
    key: str | None = None
    label: str | None = None
    data_type: str | None = None
    description: str | None = None


class TableRequest(StrictModel):
    sources: list[SourceInput] = Field(default_factory=list)
    target_columns: list[TableColumnSpec] = Field(default_factory=list)
    max_rows: int | None = Field(default=None, ge=1)
    typed_cells: bool = True
    output_format: Literal["json", "csv", "xlsx", "markdown"] = "json"
    aggregation_mode: str | None = None
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class TableResponse(StrictModel):
    columns: list[TableColumnSpec] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)


class InfographicRequest(StrictModel):
    prompt: str | None = None
    sources: list[SourceInput] = Field(default_factory=list)
    mode: Literal["single_chart", "multi_chart", "kpi_cards", "timeline_infographic", "comparison_board"] | None = None
    render_formats: list[Literal["png", "svg", "pdf"]] = Field(default_factory=list)
    palette_hint: str | None = None
    layout_hint: str | None = None
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class InfographicResponse(StrictModel):
    spec: dict[str, Any] = Field(default_factory=dict)
    narrative_summary: str | None = None
    captions: list[str] = Field(default_factory=list)
    palette: list[str] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)


class ReportSection(StrictModel):
    id: str | None = None
    title: str | None = None
    content: str | None = None


class ReportRequest(StrictModel):
    prompt: str | None = None
    sources: list[SourceInput] = Field(default_factory=list)
    template_id: str | None = None
    section_rules: dict[str, Any] = Field(default_factory=dict)
    tone: str | None = None
    length: str | None = None
    language: str | None = None
    citation_style: str | None = None
    output_formats: list[Literal["markdown", "html", "pdf", "docx"]] = Field(default_factory=list)
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class ReportResponse(StrictModel):
    title: str | None = None
    summary: str | None = None
    sections: list[ReportSection] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)


class ProjectStatus(StrEnum):
    draft = "draft"
    ready = "ready"
    rendering = "rendering"
    completed = "completed"
    archived = "archived"
    failed = "failed"


class ProjectType(StrEnum):
    presentation_project = "presentation_project"
    podcast_project = "podcast_project"
    video_project = "video_project"
    quiz_project = "quiz_project"
    report_project = "report_project"
    mindmap_project = "mindmap_project"


class ProjectSummary(StrictModel):
    id: str
    project_type: str
    title: str
    status: ProjectStatus | str
    version: int | None = None
    created_at: str
    updated_at: str


class ProjectListResponse(StrictModel):
    data: list[ProjectSummary]
    next_cursor: str | None = None


class ProjectCreateRequest(StrictModel):
    project_type: ProjectType
    title: str
    template_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    content: dict[str, Any] = Field(default_factory=dict)


class ProjectPatchRequest(StrictModel):
    title: str | None = None
    status: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    content: dict[str, Any] = Field(default_factory=dict)


class ExportRequest(StrictModel):
    formats: list[Literal["pptx", "pdf", "html", "mp4", "mp3", "wav", "srt", "json", "png", "svg"]]
    render_options: dict[str, Any] = Field(default_factory=dict)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class ExportResponse(StrictModel):
    project_id: str
    artifacts: list[Artifact]


class PresentationTaskRequest(StrictModel):
    prompt: str | None = None
    sources: list[SourceInput] = Field(default_factory=list)
    template_id: str | None = None
    slide_count_hint: int | None = Field(default=None, ge=1)
    audience: str | None = None
    tone: str | None = None
    language: str | None = None
    theme: str | None = None
    layout_strategy: str | None = None
    include_speaker_notes: bool = True
    output_formats: list[Literal["pptx", "pdf", "html", "mp4"]] = Field(default_factory=list)
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class PodcastTaskRequest(StrictModel):
    prompt: str | None = None
    sources: list[SourceInput] = Field(default_factory=list)
    template_id: str | None = None
    objective: str | None = None
    audience: str | None = None
    duration_hint_minutes: int | None = Field(default=None, ge=1)
    speaker_count: int | None = Field(default=None, ge=1)
    narrator_mode: bool = False
    voice_preferences: list[VoiceSelection] = Field(default_factory=list)
    music_policy: str | None = None
    render_formats: list[Literal["mp3", "wav", "srt", "json", "mp4"]] = Field(default_factory=list)
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class VideoTaskRequest(StrictModel):
    title: str | None = None
    mode: Literal["audiogram", "narrated_presentation", "scene_based_explainer"] | None = None
    source_project_id: str | None = None
    sources: list[SourceInput] = Field(default_factory=list)
    aspect_ratio: str | None = None
    caption_mode: Literal["none", "burned_in", "sidecar"] | None = None
    render_profile: dict[str, Any] = Field(default_factory=dict)
    scene_generation: dict[str, Any] = Field(default_factory=dict)
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class SlideBlock(StrictModel):
    kind: Literal["text", "bullet_list", "table", "chart", "quote", "image", "callout", "timeline", "comparison", "kpi_card"]
    data: dict[str, Any] = Field(default_factory=dict)


class Slide(StrictModel):
    id: str
    kind: str
    title: str
    subtitle: str | None = None
    blocks: list[SlideBlock] = Field(default_factory=list)
    speaker_notes: str | None = None
    source_refs: list[SourceRef] = Field(default_factory=list)
    layout: str | None = None
    visual_hints: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PresentationProject(StrictModel):
    id: str
    project_type: Literal["presentation_project"]
    title: str
    status: ProjectStatus | str
    version: int | None = None
    template_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    source_inputs: list[SourceInput] = Field(default_factory=list)
    theme: str | None = None
    slides: list[Slide]
    artifacts: list[Artifact] = Field(default_factory=list)
    created_at: str
    updated_at: str


class SpeakerProfile(StrictModel):
    id: str | None = None
    display_name: str | None = None
    role: str | None = None
    voice: VoiceSelection | None = None


class PodcastChapter(StrictModel):
    id: str | None = None
    title: str | None = None
    summary: str | None = None
    start_segment_id: str | None = None
    end_segment_id: str | None = None


class PodcastSegment(StrictModel):
    id: str
    chapter_id: str | None = None
    speaker: str | None = None
    text: str
    ssml: str | None = None
    voice: VoiceSelection | None = None
    duration_estimate_ms: int | None = None
    audio_artifact_id: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    status: Literal["draft", "voiced", "mixed"] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PodcastProject(StrictModel):
    id: str
    project_type: Literal["podcast_project"]
    title: str
    status: ProjectStatus | str
    version: int | None = None
    template_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    source_inputs: list[SourceInput] = Field(default_factory=list)
    speakers: list[SpeakerProfile] = Field(default_factory=list)
    chapters: list[PodcastChapter] = Field(default_factory=list)
    segments: list[PodcastSegment]
    voice_map: dict[str, dict[str, Any]] = Field(default_factory=dict)
    music_tracks: list[dict[str, Any]] = Field(default_factory=list)
    render_settings: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[Artifact] = Field(default_factory=list)
    created_at: str
    updated_at: str


class VideoScene(StrictModel):
    id: str
    title: str
    narration_text: str | None = None
    duration_ms: int | None = None
    asset_refs: list[SourceRef] = Field(default_factory=list)
    subtitle_text: str | None = None
    transition: str | None = None
    status: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class VideoProject(StrictModel):
    id: str
    project_type: Literal["video_project"]
    title: str
    status: ProjectStatus | str
    mode: Literal["audiogram", "narrated_presentation", "scene_based_explainer"]
    version: int | None = None
    template_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    source_inputs: list[SourceInput] = Field(default_factory=list)
    scenes: list[VideoScene]
    audio_tracks: list[dict[str, Any]] = Field(default_factory=list)
    subtitle_tracks: list[dict[str, Any]] = Field(default_factory=list)
    assets: list[dict[str, Any]] = Field(default_factory=list)
    render_profile: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[Artifact] = Field(default_factory=list)
    created_at: str
    updated_at: str


class GenericProject(StrictModel):
    id: str
    project_type: str
    title: str
    status: str
    version: int | None = None
    template_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    content: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[Artifact] = Field(default_factory=list)
    created_at: str
    updated_at: str


ProjectEnvelope: TypeAlias = PresentationProject | PodcastProject | VideoProject | GenericProject
PROJECT_ENVELOPE_ADAPTER = TypeAdapter(ProjectEnvelope)


class PresentationTaskResponse(StrictModel):
    project: PresentationProject


class PodcastTaskResponse(StrictModel):
    project: PodcastProject


class VideoTaskResponse(StrictModel):
    project: VideoProject


class AddSlideRequest(StrictModel):
    after_slide_id: str | None = None
    slide: Slide


class UpdateSlideRequest(StrictModel):
    move_after_slide_id: str | None = None
    slide_patch: dict[str, Any] = Field(default_factory=dict)


class RegenerateSlideRequest(StrictModel):
    instructions: str | None = None
    fields: list[Literal["title", "subtitle", "blocks", "speaker_notes", "visual_hints"]] = Field(default_factory=list)
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class UpdateSegmentRequest(StrictModel):
    speaker: str | None = None
    text: str | None = None
    ssml: str | None = None
    voice: VoiceSelection | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RerenderSegmentRequest(StrictModel):
    voice: VoiceSelection | None = None
    output_format: Literal["mp3", "wav"] | None = None
    speaking_rate: float | None = None
    style: str | None = None
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class UpdateSceneRequest(StrictModel):
    title: str | None = None
    narration_text: str | None = None
    duration_ms: int | None = None
    asset_refs: list[SourceRef] = Field(default_factory=list)
    subtitle_text: str | None = None
    transition: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RerenderSceneRequest(StrictModel):
    render_profile: dict[str, Any] = Field(default_factory=dict)
    regenerate_visuals: bool = False
    execution: ExecutionOptions = Field(default_factory=ExecutionOptions)


class JobListResponse(StrictModel):
    data: list[Job]
    next_cursor: str | None = None


class ArtifactListResponse(StrictModel):
    data: list[Artifact]
    next_cursor: str | None = None


class Template(StrictModel):
    id: str
    kind: str
    version: str
    system_prompt: str | None = None
    instructions: str | None = None
    defaults: dict[str, Any] = Field(default_factory=dict)
    schema: dict[str, Any] = Field(default_factory=dict)
    constraints: dict[str, Any] = Field(default_factory=dict)


class TemplateListResponse(StrictModel):
    data: list[Template]


def validate_project_envelope(payload: dict[str, Any]) -> ProjectEnvelope:
    project_type = payload.get("project_type")
    if project_type == ProjectType.presentation_project.value:
        return PresentationProject.model_validate(payload)
    if project_type == ProjectType.podcast_project.value:
        return PodcastProject.model_validate(payload)
    if project_type == ProjectType.video_project.value:
        return VideoProject.model_validate(payload)
    return GenericProject.model_validate(payload)


def dump_project_envelope(payload: dict[str, Any]) -> dict[str, Any]:
    return validate_project_envelope(payload).model_dump(mode="json", exclude_none=True)


def coerce_json_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=True)


def optional_dict_list(value: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return value or []
