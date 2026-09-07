//! Ties the Potato Core child process's lifetime to this one on Windows.
//!
//! Windows has no automatic parent-death-kills-children behavior. We hit
//! this directly during development: force-killing the app (Task Manager /
//! `Stop-Process -Force`) left `python.exe` running and holding the core's
//! port, because a hard kill skips Tauri's own `RunEvent::ExitRequested`
//! cleanup. A Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` fixes
//! this at the OS level: Windows kills every process assigned to the job as
//! soon as the job's last handle closes, which happens automatically when
//! this process dies — graceful or not.
//!
//! Potato Core applies the same fix one level down for its own
//! `llama-server` child (see `core/potato_core/engines/inference/process_group.py`).

use std::process::Child;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// Best-effort: on failure, the child just behaves as it did before (may
/// survive a hard kill) — never block startup over this.
pub fn assign_kill_on_close(child: &Child) -> windows::core::Result<()> {
    unsafe {
        let job = CreateJobObjectW(None, None)?;

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )?;

        let process_handle = HANDLE(child.as_raw_handle());
        AssignProcessToJobObject(job, process_handle)?;

        // Deliberately never CloseHandle(job): it must stay open for the
        // rest of this process's life so KILL_ON_JOB_CLOSE fires when *this*
        // process exits (graceful or hard-killed), not before. Windows
        // reclaims every handle we hold automatically on our own exit.
        Ok(())
    }
}

trait AsRawHandleExt {
    fn as_raw_handle(&self) -> *mut std::ffi::c_void;
}

impl AsRawHandleExt for Child {
    fn as_raw_handle(&self) -> *mut std::ffi::c_void {
        use std::os::windows::io::AsRawHandle;
        AsRawHandle::as_raw_handle(self)
    }
}
