"""Ties a child process's lifetime to this one on Windows, so a hard-killed
Potato Core never leaves `llama-server` orphaned.

Windows has no automatic parent-death-kills-children behavior (unlike POSIX
process groups). We discovered this the hard way earlier in development: a
force-killed Tauri app left the Python core itself running and holding its
port. The correct fix is a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
— Windows kills every process assigned to the job as soon as the job's last
handle closes, which happens automatically when this process dies, graceful
or not. Implemented via ctypes rather than adding pywin32 as a dependency
for one function.
"""
from __future__ import annotations

import ctypes
import subprocess
import sys

from potato_core.logging_config import get_logger

log = get_logger("inference.process_group")

_job_handle: int | None = None


def assign(process: subprocess.Popen) -> None:
    """Best-effort: if this fails, the process just behaves as it did before
    (orphanable on a hard kill) — never block starting inference over it."""
    if sys.platform != "win32":
        return

    global _job_handle
    try:
        kernel32 = ctypes.windll.kernel32

        if _job_handle is None:
            _job_handle = kernel32.CreateJobObjectW(None, None)
            if not _job_handle:
                raise ctypes.WinError()

            JobObjectExtendedLimitInformation = 9

            class IO_COUNTERS(ctypes.Structure):
                _fields_ = [(f, ctypes.c_uint64) for f in
                            ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                             "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

            class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
                _fields_ = [
                    ("PerProcessUserTimeLimit", ctypes.c_int64),
                    ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", ctypes.c_uint32),
                    ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t),
                    ("ActiveProcessLimit", ctypes.c_uint32),
                    ("Affinity", ctypes.c_size_t),
                    ("PriorityClass", ctypes.c_uint32),
                    ("SchedulingClass", ctypes.c_uint32),
                ]

            class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
                _fields_ = [
                    ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                    ("IoInfo", IO_COUNTERS),
                    ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t),
                ]

            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

            info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel32.SetInformationJobObject(
                _job_handle, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info)
            ):
                raise ctypes.WinError()

        PROCESS_ALL_ACCESS = 0x1F0FFF
        handle = kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, process.pid)
        if not handle:
            raise ctypes.WinError()
        try:
            if not kernel32.AssignProcessToJobObject(_job_handle, handle):
                raise ctypes.WinError()
        finally:
            kernel32.CloseHandle(handle)

        log.debug("Assigned pid %d to kill-on-close job object", process.pid)
    except Exception:
        log.warning("Could not assign llama-server to a Windows job object — it may survive a hard kill", exc_info=True)
