use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub struct SpeedEstimator {
    samples: VecDeque<(Instant, i64)>,
    window: Duration,
    min_sample: Duration,
}

impl SpeedEstimator {
    pub fn new(initial_bytes: i64) -> Self {
        let mut samples = VecDeque::new();
        samples.push_back((Instant::now(), initial_bytes.max(0)));
        Self {
            samples,
            window: Duration::from_secs(5),
            min_sample: Duration::from_millis(850),
        }
    }

    pub fn update(&mut self, bytes: i64) -> i64 {
        let now = Instant::now();
        let bytes = bytes.max(0);
        self.samples.push_back((now, bytes));
        while self.samples.len() > 2 {
            let Some((time, _)) = self.samples.get(1) else {
                break;
            };
            if now.duration_since(*time) > self.window {
                self.samples.pop_front();
            } else {
                break;
            }
        }
        let Some((start_time, start_bytes)) = self.samples.front().copied() else {
            return 0;
        };
        let elapsed = now.duration_since(start_time);
        if elapsed < self.min_sample {
            return 0;
        }
        let delta = bytes.saturating_sub(start_bytes);
        if delta <= 0 {
            return 0;
        }
        (delta as f64 / elapsed.as_secs_f64()) as i64
    }

    pub fn eta(total: i64, processed: i64, speed_bps: i64) -> Option<i64> {
        if processed >= total && total > 0 {
            return Some(0);
        }
        if total <= 0 || processed <= 0 || speed_bps <= 0 {
            return None;
        }
        let remaining = total.saturating_sub(processed).max(0);
        Some((remaining + speed_bps - 1) / speed_bps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eta_requires_real_speed() {
        assert_eq!(SpeedEstimator::eta(100, 0, 0), None);
        assert_eq!(SpeedEstimator::eta(100, 50, 10), Some(5));
        assert_eq!(SpeedEstimator::eta(100, 100, 10), Some(0));
    }
}
