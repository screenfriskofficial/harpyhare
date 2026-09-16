//! Замки, переживающие панику держателя.
//!
//! У `App` полтора десятка `std::sync::Mutex`, и почти каждый берётся
//! `.lock().unwrap()`. Паника под любым из них (баг в обработчике, отказ
//! платформы) отравляет мьютекс, и СЛЕДУЮЩИЙ `unwrap` — обычно в синхронной
//! команде на главном потоке — валит уже всё приложение. Отравленный замок
//! здесь просто открывается: состояние под ним может оказаться недописанным,
//! но это заведомо лучше, чем abort посреди интервью.

use std::sync::{Condvar, Mutex, MutexGuard, PoisonError, WaitTimeoutResult};
use std::time::Duration;

pub trait LockUnpoisoned<T> {
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T>;
}

impl<T> LockUnpoisoned<T> for Mutex<T> {
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The same rule for waiting on a `Condvar`: a guard that comes back poisoned
/// is opened rather than taking the consumer thread — and the recording — down.
pub trait WaitUnpoisoned {
    fn wait_unpoisoned<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T>;
    fn wait_timeout_unpoisoned<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        timeout: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult);
}

impl WaitUnpoisoned for Condvar {
    fn wait_unpoisoned<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T> {
        self.wait(guard).unwrap_or_else(PoisonError::into_inner)
    }

    fn wait_timeout_unpoisoned<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        timeout: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult) {
        self.wait_timeout(guard, timeout)
            .unwrap_or_else(PoisonError::into_inner)
    }
}
