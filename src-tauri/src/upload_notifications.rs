use crate::domain::TransferJob;
use serde::Serialize;
use std::collections::BTreeMap;

fn active(job: &TransferJob) -> bool {
    matches!(job.status.as_str(), "waiting" | "analyzing" | "copying" | "ready" | "queued" | "uploading" | "confirming" | "retry_wait" | "running")
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadNotice {
    pub active: bool,
    pub total: usize,
    pub completed: usize,
    pub pending: usize,
    pub failed: usize,
    pub paused: usize,
    pub cancelled: usize,
    pub percent: Option<u8>,
    pub processed_bytes: i64,
    pub total_bytes: i64,
    pub speed_bps: i64,
    pub eta_seconds: Option<i64>,
    pub current_file_name: Option<String>,
    pub phase: String,
}

#[derive(Default)]
pub(crate) struct UploadTracker {
    jobs: BTreeMap<String, TransferJob>,
    was_active: bool,
}

impl UploadTracker {
    pub fn snapshot(&mut self, all: &[TransferJob], now: i64) -> Option<UploadNotice> {
        let running: Vec<_> = all.iter().filter(|j| j.direction == "upload" && active(j)).collect();
        if running.is_empty() && !self.was_active { return None; }
        if !self.was_active && running.iter().all(|j| !self.jobs.contains_key(&j.id)) {
            self.jobs.clear();
        }
        let latest_jobs: BTreeMap<_, _> = all.iter().filter(|j| j.direction == "upload").map(|j| (j.id.as_str(), j)).collect();
        for job in &running { self.jobs.insert(job.id.clone(), (*job).clone()); }
        for job in self.jobs.values_mut() {
            if let Some(latest) = latest_jobs.get(job.id.as_str()) {
                *job = (*latest).clone();
            } else if active(job) {
                job.status = "cancelled".into();
            }
        }
        let mut notice = UploadNotice {
            active: !running.is_empty(), total: self.jobs.len(), completed: 0, pending: 0,
            failed: 0, paused: 0, cancelled: 0, percent: None, processed_bytes: 0,
            total_bytes: 0, speed_bps: 0, eta_seconds: None, current_file_name: None,
            phase: "waiting".into(),
        };
        let mut known_sizes = true;
        for job in self.jobs.values() {
            match job.status.as_str() {
                "completed" | "duplicate" => notice.completed += 1,
                "failed" => notice.failed += 1,
                "paused" => notice.paused += 1,
                "cancelled" => { notice.cancelled += 1; continue; }
                _ => notice.pending += 1,
            }
            let size = job.total_bytes.max(0);
            known_sizes &= size > 0;
            notice.total_bytes = notice.total_bytes.saturating_add(size);
            let bytes = match job.status.as_str() {
                "completed" | "duplicate" => size,
                // Local staging is not uploaded data.
                "waiting" | "analyzing" | "copying" | "ready" | "queued" => 0,
                _ => job.processed_bytes.clamp(0, size),
            };
            notice.processed_bytes = notice.processed_bytes.saturating_add(bytes);
            if job.status == "uploading" {
                notice.current_file_name.get_or_insert_with(|| job.file_name.clone());
                notice.phase = "uploading".into();
                if now.saturating_sub(job.updated_at) <= 5 {
                    notice.speed_bps = notice.speed_bps.saturating_add(job.speed_bps.max(0));
                }
            } else if notice.phase != "uploading" && active(job) {
                notice.phase = job.status.clone();
            }
        }
        let finished = notice.completed == notice.total && notice.total > 0;
        if finished { notice.percent = Some(100); }
        else if known_sizes && notice.total_bytes > 0 {
            notice.percent = Some(((notice.processed_bytes as f64 / notice.total_bytes as f64 * 100.0) as u8).min(99));
        }
        let remaining = notice.total_bytes.saturating_sub(notice.processed_bytes);
        if known_sizes && notice.speed_bps > 0 && remaining > 0 && notice.paused == 0 && notice.failed == 0 {
            notice.eta_seconds = Some(remaining / notice.speed_bps + i64::from(remaining % notice.speed_bps != 0));
        }
        self.was_active = notice.active;
        Some(notice)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job(id: &str, status: &str, bytes: i64) -> TransferJob {
        TransferJob { id: id.into(), file_name: format!("{id}.mp4"), direction: "upload".into(), progress: 0,
            status: status.into(), phase: status.into(), speed_label: String::new(), processed_bytes: bytes,
            total_bytes: 100, speed_bps: 10, eta_seconds: None, attempts: 0, max_attempts: 5,
            error: None, can_pause: true, can_retry: false, can_cancel: true, started_at: Some(100), updated_at: 100 }
    }
    #[test]
    fn excludes_downloads_history_and_counts_current_batch() {
        let mut tracker = UploadTracker::default();
        let mut download = job("download", "downloading", 80); download.direction = "download".into();
        let notice = tracker.snapshot(&[job("old", "completed", 100), download, job("a", "uploading", 50), job("b", "queued", 100)], 100).unwrap();
        assert_eq!((notice.total, notice.completed, notice.pending), (2, 0, 2));
        assert_eq!((notice.total_bytes, notice.processed_bytes, notice.percent), (200, 50, Some(25)));
        assert_eq!(notice.eta_seconds, Some(15));
    }
    #[test]
    fn completion_keeps_batch_denominator_and_is_emitted_once() {
        let mut tracker = UploadTracker::default();
        tracker.snapshot(&[job("a", "uploading", 50), job("b", "queued", 0)], 100);
        let halfway = tracker.snapshot(&[job("a", "completed", 100), job("b", "uploading", 50)], 100).unwrap();
        assert_eq!((halfway.completed, halfway.percent), (1, Some(75)));
        let jobs = [job("a", "completed", 100), job("b", "completed", 100)];
        let done = tracker.snapshot(&jobs, 100).unwrap();
        assert!(!done.active); assert_eq!((done.total, done.completed, done.percent), (2, 2, Some(100)));
        assert!(tracker.snapshot(&jobs, 100).is_none());
    }
    #[test]
    fn paused_failed_cancelled_are_not_success_and_resume_is_supported() {
        for status in ["paused", "failed", "cancelled"] {
            let mut tracker = UploadTracker::default();
            tracker.snapshot(&[job("a", "uploading", 50)], 100);
            let stopped = tracker.snapshot(&[job("a", status, 50)], 100).unwrap();
            assert!(!stopped.active); assert_eq!(stopped.completed, 0); assert_ne!(stopped.percent, Some(100));
            assert!(tracker.snapshot(&[job("a", "uploading", 60)], 100).unwrap().active);
        }
    }
    #[test]
    fn unknown_sizes_stale_speed_and_confirmation_do_not_fake_eta_or_completion() {
        let mut tracker = UploadTracker::default();
        let stale = tracker.snapshot(&[job("a", "uploading", 50)], 106).unwrap();
        assert_eq!((stale.speed_bps, stale.eta_seconds), (0, None));
        let confirming = tracker.snapshot(&[job("a", "confirming", 100)], 106).unwrap();
        assert_eq!(confirming.percent, Some(99)); assert_eq!(confirming.eta_seconds, None);
        let mut unknown = job("b", "analyzing", 0); unknown.total_bytes = 0;
        let notice = tracker.snapshot(&[unknown], 106).unwrap();
        assert_eq!((notice.percent, notice.eta_seconds), (None, None));
    }
    #[test]
    fn independent_batch_does_not_inherit_old_errors() {
        let mut tracker = UploadTracker::default();
        tracker.snapshot(&[job("a", "uploading", 50)], 100);
        tracker.snapshot(&[job("a", "failed", 50)], 100);
        let notice = tracker.snapshot(&[job("a", "failed", 50), job("b", "uploading", 20)], 100).unwrap();
        assert_eq!((notice.total, notice.failed, notice.percent), (1, 0, Some(20)));
    }
}
