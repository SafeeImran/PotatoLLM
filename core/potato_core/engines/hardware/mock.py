"""Mock hardware provider for development on machines without a target GPU, or for
UI testing. Values are deliberately labeled so mock data can never be mistaken for
a real measurement (spec section 43/44).
"""
from __future__ import annotations

from potato_core.schemas.hardware import CpuInfo, GpuInfo, HardwareSnapshot, MemoryInfo, StorageInfo


class MockHardwareProvider:
    def detect(self) -> HardwareSnapshot:
        return HardwareSnapshot(
            os_name="Windows",
            os_version="[MOCK] 10.0.22631",
            cpu=CpuInfo(
                model="[MOCK] AMD Ryzen 9 7900X",
                vendor="AuthenticAMD",
                cores=12,
                threads=24,
                architecture="AMD64",
                instruction_sets=["avx", "avx2", "fma"],
                utilization_pct=23.0,
            ),
            gpu=GpuInfo(
                vendor="NVIDIA",
                model="[MOCK] GeForce RTX 4080",
                vram_mb=16384,
                driver_version="[MOCK] 551.23",
                utilization_pct=17.0,
                temp_c=48.0,
            ),
            memory=MemoryInfo(total_mb=32768, available_mb=21504),
            storage=StorageInfo(total_gb=1863.0, available_gb=742.5),
            compute_backend="CUDA",
            is_mock=True,
        )

    def poll_live(self) -> HardwareSnapshot:
        snap = self.detect()
        return snap
