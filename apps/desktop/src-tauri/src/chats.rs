use crate::settings::write_atomic_owner_only;
use std::path::Path;

/// Отсутствующий файл — пустая строка (первый запуск), любая другая ошибка —
/// ошибка. Раньше и EACCES, и полузаписанный файл, и не-UTF-8 превращались в
/// `""`, фронт читал это как «чатов нет» и первым же сохранением писал один
/// пустой чат поверх файла.
pub fn load(path: &Path) -> std::io::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(json) => Ok(json),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e),
    }
}

pub fn save(path: &Path, json: &str) -> std::io::Result<()> {
    write_atomic_owner_only(path, json)
}

#[cfg(test)]
mod tests;
