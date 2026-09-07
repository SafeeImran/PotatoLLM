/**
 * Mirrors core/potato_core/schemas/hardware.py — this file is the frontend
 * half of the IPC contract. Keep field names identical to the Pydantic
 * models (snake_case) rather than translating, so the two sides never drift
 * silently out of sync.
 */

export type ComputeBackend = "CUDA" | "ROCm" | "Metal" | "CPU" | "Unknown";

export interface CpuInfo {
  model: string;
  vendor: string;
  cores: number | null;
  threads: number | null;
  architecture: string;
  instruction_sets: string[];
}

export interface GpuInfo {
  vendor: string;
  model: string;
  vram_mb: number | null;
  driver_version: string;
  utilization_pct: number | null;
  temp_c: number | null;
}

export interface MemoryInfo {
  total_mb: number | null;
  available_mb: number | null;
}

export interface StorageInfo {
  total_gb: number | null;
  available_gb: number | null;
}

export interface HardwareSnapshot {
  os_name: string;
  os_version: string;
  cpu: CpuInfo;
  gpu: GpuInfo;
  memory: MemoryInfo;
  storage: StorageInfo;
  compute_backend: ComputeBackend;
  is_mock: boolean;
}

export interface PotatoScoreResult {
  score: number;
  classification: string;
  breakdown: Record<string, number>;
}

export interface HardwareProfileResponse {
  id: string;
  created_at: string;
  snapshot: HardwareSnapshot;
  potato_score: PotatoScoreResult;
}

export type CompatibilityLevel = "GREEN" | "YELLOW" | "RED";

export interface FitEstimate {
  quantization: string;
  context_length: number;
  estimated_vram_mb: number;
  estimated_ram_mb: number;
  compatibility: CompatibilityLevel;
  recommended_backend: string;
  recommended_gpu_offload_pct: number;
}

export interface Recommendation {
  model_id: string;
  potato_score: number;
  potato_classification: string;
  recommended: FitEstimate;
  all_options: FitEstimate[];
  is_mock_hardware: boolean;
}

export interface MakeItPotatoResult {
  status: "ready" | "preparing";
  recommendation: Recommendation;
  artifact_id?: string | null;
  step?: "downloading" | "downloading_fp16_source" | "quantizing" | null;
  job?: { job_id: string; status: string; progress: number } & Record<string, unknown>;
}

export interface Dataset {
  id: string;
  name: string;
  file_path: string;
  format: string;
  example_count: number | null;
  estimated_tokens: number | null;
  avg_tokens: number | null;
  max_tokens: number | null;
  duplicate_pct: number | null;
  valid_pct: number | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number;
  kind: "image" | "document" | "file";
  message_id: string | null;
  created_at: string;
}

export interface SliderConfig {
  training_intensity: number;
  learning_rate: number;
  training_time: number;
  model_adaptation: number;
  memory_usage: number;
}

export interface Hyperparameters {
  learning_rate: number;
  epochs: number;
  lora_rank: number;
  lora_alpha: number;
  lora_dropout: number;
  batch_size: number;
  gradient_accumulation_steps: number;
  warmup_ratio: number;
  max_seq_length: number;
  scheduler: string;
}

export interface MLDependencyStatus {
  available: boolean;
  missing: string[];
  install_hint: string;
}

export interface TrainingJob {
  job_id: string;
  status: string;
  progress: number;
  error: string | null;
  base_model_id: string;
  base_model_name: string;
  dataset_id: string;
  dataset_name: string;
  config: { sliders: SliderConfig; hyperparameters: Hyperparameters };
  current_epoch: number;
  total_epochs: number | null;
  current_loss: number | null;
  learning_rate: number | null;
  output_adapter_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Build {
  id: string;
  name: string;
  base_model_id: string;
  base_model_name: string;
  model_artifact_id: string;
  quantization: string | null;
  size_bytes: number | null;
  backend: string;
  gpu_offload_layers: number | null;
  context_length: number | null;
  last_benchmark_tokens_per_sec: number | null;
  created_at: string;
  updated_at: string;
}

export interface UsageSummary {
  tokens_today: number;
  prompt_tokens_today: number;
  completion_tokens_today: number;
  avg_tokens_per_sec_today: number | null;
  avg_ttft_seconds_today: number | null;
  generations_today: number;
  total_tokens_all_time: number;
  total_sessions: number;
  total_generations: number;
}

export interface ModelUsageBreakdown {
  model_id: string;
  model_name: string;
  total_tokens: number;
  generations: number;
  avg_tokens_per_sec: number | null;
}

export interface DailyUsagePoint {
  date: string;
  tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  generations: number;
  avg_tokens_per_sec: number | null;
  avg_ttft_seconds: number | null;
}

export interface RecentSession {
  session_id: string;
  model_id: string | null;
  model_name: string | null;
  total_tokens: number;
  generations: number;
  avg_tokens_per_sec: number | null;
  avg_ttft_seconds: number | null;
  duration_seconds: number | null;
  started_at: string;
  last_activity_at: string;
}

export interface BenchmarkResult {
  id: string;
  model_artifact_id: string | null;
  build_id: string | null;
  tokens_per_sec: number | null;
  prompt_tokens_per_sec: number | null;
  ttft_seconds: number | null;
  total_latency_seconds: number | null;
  cpu_util_pct: number | null;
  gpu_util_pct: number | null;
  vram_mb: number | null;
  ram_mb: number | null;
  temp_c: number | null;
  context_length: number | null;
  backend: string | null;
  created_at: string;
  sample_count: number | null;
}

export interface QuantizationJob {
  job_id: string;
  model_id: string;
  source_artifact_id: string;
  target_quant: string;
  status: string;
  progress: number;
  output_artifact_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuantizationEstimate {
  input_bytes: number;
  estimated_output_bytes: number;
  estimated_savings_pct: number;
}

export interface ModelSummary {
  id: string;
  name: string;
  family: string;
  parameter_count: string;
  architecture: string;
  context_length: number;
  license: string;
  source: string;
  model_url: string;
  supported_backends: string[];
  supported_quant_formats: string[];
  finetune_support: boolean;
  est_ram_mb: number;
  est_vram_mb: number;
  recommended_quantizations: string[];
  description: string;
  tags: string[];
  capabilities: string[];
  fp16_available: boolean;
}

export type DownloadStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface DownloadJob {
  job_id: string;
  model_id: string;
  model_name: string;
  variant: "quantized" | "fp16";
  status: DownloadStatus;
  progress: number; // 0-1
  bytes_downloaded: number;
  bytes_total: number | null;
  speed_bps: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailableModel {
  artifact_id: string;
  model_id: string;
  model_name: string;
  quantization: string | null;
  size_bytes: number | null;
  context_length: number;
  /** Its mmproj projector is on disk, so this model can read images. */
  multimodal: boolean;
}

export type FlashAttentionMode = "auto" | "on" | "off";
export type KvCacheType = "f16" | "q8_0" | "q4_0";

/**
 * The load-time llama.cpp knobs. Every field is optional and every one has an
 * "Auto" position, so the UI sends only what the user pinned: `-1` GPU layers,
 * `0` threads and `0` batch size all mean "decide for me" on the server, which
 * then falls back to the saved setting and finally to hardware detection.
 */
export interface RuntimeOptions {
  context_length?: number;
  threads?: number;
  gpu_layers?: number;
  batch_size?: number;
  flash_attention?: FlashAttentionMode;
  kv_cache_type?: KvCacheType;
}

/** What a loaded llama-server was actually started with. */
export interface ResolvedRuntime {
  context_length: number;
  threads: number;
  /** "auto" when llama.cpp itself decides how much fits in VRAM. */
  gpu_layers: number | "auto";
  batch_size: number | null;
  flash_attention: string;
  kv_cache_type: string;
}

/** Hardware-derived values behind each "Auto" control. */
export interface RuntimeDefaults {
  threads: number;
  cpu_cores: number | null;
  cpu_threads: number | null;
  gpu_layers: number | "auto";
  /** Both halves willing: the machine has a GPU AND this llama.cpp build can use it. */
  gpu_available: boolean;
  /** A GPU exists on the machine, whether or not the vendored binary can reach it. */
  gpu_detected: boolean;
  /** Compute devices the vendored binary lists; null when it could not be asked. */
  backend_devices: string[] | null;
  gpu_model: string | null;
  vram_mb: number | null;
  compute_backend: string;
  batch_size: number | null;
  flash_attention: string;
  kv_cache_type: string;
  context_length: number;
}

/** The duty a loaded model holds in a multi-model chat. */
export type SlotRole = "primary" | "vision" | "code" | "reasoning" | "member";

/**
 * What to ask for when loading. "auto" lets the engine work the role out from
 * what the model can do and what is already loaded — the default, so a chat
 * orchestrates without the user having to learn the role scheme.
 */
export type RequestedRole = SlotRole | "auto";

/** One resident model — its own llama-server process. */
export interface LoadedSlot {
  artifact_id: string;
  model_id: string;
  model_name: string;
  role: SlotRole;
  context_length: number;
  multimodal: boolean;
  runtime: ResolvedRuntime;
  capabilities?: string[];
  parameter_count?: string;
}

export interface InferenceStatus {
  loaded: boolean;
  model_artifact_id: string | null;
  model_name: string | null;
  context_length: number | null;
  /** llama-server was started with --mmproj — image attachments will be read. */
  multimodal: boolean;
  /** Null while nothing is loaded — there is no running server to describe. */
  runtime?: ResolvedRuntime | null;
  /**
   * Every resident model. The fields above describe the primary slot and are
   * kept so single-model callers need no changes.
   */
  slots?: LoadedSlot[];
  primary_artifact_id?: string | null;
  max_slots?: number;
}

export interface PackMember {
  model_id: string;
  model_name: string;
  role: SlotRole;
  /** Why this model is in this pack, in one line. */
  why: string;
  parameter_count: string;
  capabilities: string[];
  vision: boolean;
  estimated_vram_mb: number;
  estimated_ram_mb: number;
  downloaded: boolean;
}

export interface ModelPack {
  id: string;
  name: string;
  tagline: string;
  description: string;
  members: PackMember[];
  missing_from_catalog: string[];
  /** Summed across members — a pack is loaded all at once. */
  total_estimated_vram_mb: number;
  total_estimated_ram_mb: number;
  context_length: number;
  /** Null until a hardware scan has run. */
  compatibility: CompatibilityLevel | null;
  recommended_backend: string | null;
  downloaded_count: number;
  member_count: number;
}

export interface PacksResponse {
  packs: ModelPack[];
  recommended_pack_id: string | null;
  has_hardware_profile: boolean;
  is_mock_hardware: boolean;
}

export interface PackDownloadResult {
  pack_id: string;
  queued_model_ids: string[];
  already_downloaded_model_ids: string[];
  job_ids: string[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /**
   * Attachments travel as ids, not bytes: the core already holds the file, and
   * it expands them into text/image content parts at generate time.
   */
  attachment_ids?: string[];
}

export interface GenerationParams {
  temperature: number;
  top_p: number;
  top_k: number;
  max_tokens: number;
  min_p: number;
  repeat_penalty: number;
  repeat_last_n: number;
  /** -1 asks llama.cpp for a fresh random seed on every request. */
  seed: number;
  stop?: string[];
  /** Which loaded model answers. Omitted means the primary slot. */
  responder_artifact_id?: string | null;
}

export interface InferenceStats {
  prompt_tokens?: number | null;
  prompt_tokens_per_sec?: number | null;
  completion_tokens?: number | null;
  tokens_per_sec?: number | null;
  ttft_ms?: number | null;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
}

export interface LogsResponse {
  entries: LogEntry[];
  total_matched: number;
  file_exists: boolean;
}

export interface LogFileInfo {
  path: string;
  exists: boolean;
  size_bytes: number;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface DiagnosticCheck {
  name: string;
  status: CheckStatus;
  message: string;
  fix: string | null;
}

export interface DiagnosticsResponse {
  checks: DiagnosticCheck[];
  all_pass: boolean;
  has_failures: boolean;
}

export interface StorageSummary {
  models_bytes: number;
  datasets_bytes: number;
  attachments_bytes: number;
  cache_bytes: number;
  logs_bytes: number;
  database_bytes: number;
  total_bytes: number;
  models_gb: number;
  datasets_gb: number;
  attachments_gb: number;
  cache_gb: number;
  logs_gb: number;
  database_gb: number;
  total_gb: number;
  data_dir: string;
  models_dir: string;
  datasets_dir: string;
  attachments_dir: string;
  cache_dir: string;
  logs_dir: string;
  disk_total_bytes: number;
  disk_free_bytes: number;
  disk_used_bytes: number;
  disk_total_gb: number;
  disk_free_gb: number;
  disk_status: "ok" | "low" | "critical";
  low_disk_warning_gb: number;
  low_disk_critical_gb: number;
}

export interface StoredModel {
  artifact_id: string;
  model_id: string;
  model_name: string;
  quantization: string | null;
  format: string;
  status: string;
  file_path: string;
  exists: boolean;
  size_bytes: number | null;
  created_at: string;
  in_use: boolean;
  used_by_builds: string[];
}

export interface StoredDataset {
  dataset_id: string;
  name: string;
  format: string;
  file_path: string;
  exists: boolean;
  size_bytes: number | null;
  example_count: number | null;
  created_at: string;
}

export interface UntrackedFile {
  file_path: string;
  relative_path: string;
  size_bytes: number;
  is_partial_download: boolean;
}

export interface MissingArtifact {
  artifact_id: string;
  model_id: string;
  model_name: string;
  quantization: string | null;
  file_path: string;
  recorded_size_bytes: number | null;
}

export interface OrphanReport {
  untracked_files: UntrackedFile[];
  missing_artifacts: MissingArtifact[];
  untracked_bytes: number;
}

export interface DeleteArtifactResult {
  artifact_id: string;
  file_deleted: boolean;
  freed_bytes: number;
  deleted_builds: string[];
}

export interface PurgeResult {
  purged_artifact_ids: string[];
  deleted_builds: string[];
}

export type SettingType = "bool" | "int" | "float" | "string" | "enum";

export interface SettingDefinition {
  key: string;
  section: string;
  label: string;
  description: string;
  type: SettingType;
  default: unknown;
  minimum: number | null;
  maximum: number | null;
  options: string[];
  unit: string | null;
  /** What this value actually changes, named from its real consumer. */
  effect: string;
}

export interface ResolvedSetting {
  value: unknown;
  is_default: boolean;
}

export type SettingsMap = Record<string, ResolvedSetting>;
