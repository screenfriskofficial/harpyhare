//! Замки, переживающие панику держателя.
//!
//! У `App` полтора десятка `std::sync::Mutex`, и почти каждый берётся
//! `.lock().unwrap()`. Паника под любым из них (баг в обработчике, отказ
//! платформы) отравляет мьютекс, и СЛЕДУЮЩИЙ `unwrap` — обычно в синхронной
//! команде на главном потоке — валит уже всё приложение. Отравленный замок
//! здесь просто открывается: состояние под ним может оказаться недописанным,
//! но это заведомо лучше, чем abort посреди интервью.

use std::sync::{Mutex, MutexGuard, PoisonError};

pub trait LockUnpoisoned<T> {
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T>;
}

impl<T> LockUnpoisoned<T> for Mutex<T> {
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
