"""Real hardware detection. Every field falls back to "Unknown"/None on failure —
never fabricate a number. See spec section 9.
"""
from __future__ import annotations

import platform
import shutil

import psutil

from potato_core.config import settings
from potato_core.logging_config import get_logger
from potato_core.schemas.hardware import CpuInfo, GpuInfo, HardwareSnapshot, MemoryInfo, StorageInfo

log = get_logger("hardware.real")

# Instruction sets worth surfacing for LLM inference (AVX family matters most for CPU fallback perf).
_INTERESTING_FLAGS = ["avx", "avx2", "avx512f", "sse4_1", "sse4_2", "fma", "f16c"]


def _detect_cpu() -> CpuInfo:
    vendor = "Unknown"
    model = "Unknown"
    architecture = platform.machine() or "Unknown"
    flags: list[str] = []
    try:
        import cpuinfo  # py-cpuinfo

        info = cpuinfo.get_cpu_info()
        model = info.get("brand_raw", "Unknown") or "Unknown"
        vendor = info.get("vendor_id_raw", "Unknown") or "Unknown"
        raw_flags = set(info.get("flags", []) or [])
        flags = [f for f in _INTERESTING_FLAGS if f in raw_flags]
    except Exception:
        log.warning("py-cpuinfo detection failed", exc_info=True)

    try:
        cores = psutil.cpu_count(logical=False)
        threads = psutil.cpu_count(logical=True)
    except Exception:
        log.warning("psutil CPU count failed", exc_info=True)
        cores = None
        threads = None

    return CpuInfo(
        model=model,
        vendor=vendor,
        cores=cores,
        threads=threads,
        architecture=architecture,
        instruction_sets=flags,
    )


def _cpu_utilization() -> float | None:
    try:
        # interval=None: non-blocking, compares against the last call (or
        # process-start baseline on the very first call — psutil primes this
        # automatically on import). Fine for both a one-off poll_live() call
        # and a benchmark loop polling every 200ms.
        return psutil.cpu_percent(interval=None)
    except Exception:
        log.warning("psutil CPU utilization read failed", exc_info=True)
        return None


def _detect_memory() -> MemoryInfo:
    try:
        vm = psutil.virtual_memory()
        return MemoryInfo(total_mb=vm.total // (1024 * 1024), available_mb=vm.available // (1024 * 1024))
    except Exception:
        log.warning("psutil memory detection failed", exc_info=True)
        return MemoryInfo()


def _detect_storage() -> StorageInfo:
    try:
        usage = shutil.disk_usage(settings.data_dir)
        return StorageInfo(
            total_gb=round(usage.total / (1024**3), 1),
            available_gb=round(usage.free / (1024**3), 1),
        )
    except Exception:
        log.warning("disk usage detection failed", exc_info=True)
        return StorageInfo()


def _detect_gpu() -> tuple[GpuInfo, str]:
    """Returns (GpuInfo, compute_backend). Falls back to CPU-only when no NVIDIA GPU/driver is present."""
    try:
        import pynvml

        pynvml.nvmlInit()
        try:
            count = pynvml.nvmlDeviceGetCount()
            if count == 0:
                return GpuInfo(vendor="None detected"), "CPU"

            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="ignore")
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            driver = pynvml.nvmlSystemGetDriverVersion()
            if isinstance(driver, bytes):
                driver = driver.decode("utf-8", errors="ignore")

            util_pct: float | None
            temp_c: float | None
            try:
                util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                util_pct = float(util.gpu)
            except Exception:
                util_pct = None
            try:
                temp_c = float(pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU))
            except Exception:
                temp_c = None

            gpu = GpuInfo(
                vendor="NVIDIA",
                model=name,
                vram_mb=int(mem.total // (1024 * 1024)),
                driver_version=driver,
                utilization_pct=util_pct,
                temp_c=temp_c,
            )
            return gpu, "CUDA"
        finally:
            pynvml.nvmlShutdown()
    except Exception:
        log.info("No NVIDIA GPU detected via NVML — falling back to CPU-only backend")
        return GpuInfo(vendor="None detected"), "CPU"


class RealHardwareProvider:
    def detect(self) -> HardwareSnapshot:
        gpu, backend = _detect_gpu()
        return HardwareSnapshot(
            os_name=platform.system() or "Unknown",
            os_version=platform.version() or "Unknown",
            cpu=_detect_cpu(),
            gpu=gpu,
            memory=_detect_memory(),
            storage=_detect_storage(),
            compute_backend=backend,
            is_mock=False,
        )

    def poll_live(self) -> HardwareSnapshot:
        # Cheap path: skip the CPU brand/flags lookup, just refresh utilization-ish fields.
        gpu, backend = _detect_gpu()
        return HardwareSnapshot(
            os_name=platform.system() or "Unknown",
            os_version=platform.version() or "Unknown",
            cpu=CpuInfo(utilization_pct=_cpu_utilization()),
            gpu=gpu,
            memory=_detect_memory(),
            storage=_detect_storage(),
            compute_backend=backend,
            is_mock=False,
        )
