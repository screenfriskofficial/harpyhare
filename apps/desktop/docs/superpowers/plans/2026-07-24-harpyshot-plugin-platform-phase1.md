# Платформа плагинов + harpyshot — Ф1 (ядро, локально) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Локальный рантайм нативных sidecar-плагинов в десктоп-приложении + первый плагин harpyshot (C), который по глобальному хоткею ⌘⇧S даёт выделить зону экрана и кладёт скриншот во вложения активного чата — всё работает end-to-end без сети (артефакт плагина ставится в кэш вручную скриптом).

**Architecture:** Хост (Rust) на старте синхронно читает реестр установленных плагинов из `~/Library/Application Support/com.audioservice.helper/plugins/` (манифесты, без запуска бинарей). Включённый плагин получает глобальный хоткей (жизненный цикл HUD, как PTT/toggle/суфлёр). Активация спавнит sidecar-процесс, шлёт `{"action":"activate"}` в stdin, читает одну строку JSON-результата из stdout, эмитит событие `plugin-result` во фронт; фронт строит вложение через существующий конвейер (`fileToAttachment`, даунскейл >5 МБ) и кладёт в черновик активного чата. Вкладка «Плагины» в лаунчере включает/выключает плагины и задаёт хоткей (per-plugin, хранится в `Settings.plugin_settings`).

**Tech Stack:** Rust (Tauri 2, tauri-specta, tokio, serde_json, base64), React 19 + TypeScript (Vitest, @testing-library/react, @tanstack/react-query), C (clang, ad-hoc codesign), macOS `screencapture -i`.

## Global Constraints

- **macOS only.** Захват зоны — системный `/usr/sbin/screencapture -i -x`.
- **Комментарии в коде запрещены полностью** (и в Rust, и в TS, и в C). Знание — в говорящих именах; «почему» — в CLAUDE.md/спеке, не в комментариях.
- **Хардкод запрещён.** Магические значения → именованные константы.
- **Контракт Rust⇄TS генерируется.** `src/ipc/bindings.ts` пишет `cargo test` (тест `bindings::tests`), руками не править. Поменял тип/команду на границе → `cargo test --manifest-path src-tauri/Cargo.toml --lib` перегенерит биндинги; только после этого `tsc` видит новое.
- **Публичные контракты меняются синхронно по обе стороны:** IPC-команды/события, serde-ключи, форматы на диске, строковый формат хоткеев.
- **Юнит-тесты Rust — в отдельном child-модуле:** в конце `src/plugins.rs` только `#[cfg(test)] mod tests;`, тело — `src/plugins/tests.rs` (`use super::*`).
- **Пути к бэкенду во фронте — прямой импорт из `@/ipc/commands`.** Своей копии `MODIFIER_COMBOS`/границ не заводить.
- **Палитра:** иконки в тулбаре монохромные `text-foreground`; primary — только индикаторы/заливки.
- **Sidecar подписан ad-hoc** (`codesign -s -`) — обязателен на arm64, иначе ядро убивает процесс. Скачанный/собранный бинарь после подписи не модифицировать.
- **Ф1 без сети:** артефакт harpyshot ставится в кэш локальным скриптом; автозагрузка/апдейты — Ф2/Ф3.
- Версия приложения-хоста — `0.9.0` (для `min_host_version`).

---

## Карта файлов

**Создаются (Rust, `apps/desktop/src-tauri/src/`):**
- `plugins.rs` — доменная логика (манифест, протокол, реестр, merge) + Tauri-команды `list_plugins`/`activate_plugin` + `on_activate` + спавн sidecar.
- `plugins/tests.rs` — юнит-тесты чистых функций `plugins.rs`.

**Меняются (Rust):**
- `lib.rs` — `pub mod plugins;` + синхронная загрузка реестра в `setup_app` после `manage`.
- `app_state.rs` — `PLUGIN_CACHE_DIR_NAME` + `plugin_cache_dir()` + поле `App.plugins` + инициализация в `build_app_state`.
- `settings.rs` — `PluginSetting` + поле `Settings.plugin_settings` + дефолт.
- `events.rs` — `PluginResultPayload` + хелперы `plugin_result`/`plugins_changed`.
- `window.rs` — `register_plugin_hotkeys`/`unregister_plugin_hotkeys` + `show_and_focus_main` + вызовы в `register/unregister_main_window_hotkeys`.
- `preferences.rs` — перерегистрация plugin-хоткеев в `reregister_changed_hotkeys`.
- `bindings.rs` — `plugins` в `use` + команды в `collect_commands!` + `.typ::<events::PluginResultPayload>()`, `.typ::<plugins::PluginDescriptor>()`, `.typ::<plugins::PluginState>()`, `.typ::<settings::PluginSetting>()` при необходимости.

**Меняются (Frontend, `apps/desktop/src/`):**
- `ipc/types.ts` — `PluginSetting` + `Settings.plugin_settings` + `DEFAULT_SETTINGS` копия + `EventMap` (`plugins-changed`, `plugin-result`).
- `ipc/commands.ts` — реэкспорт `listPlugins`, `activatePlugin`.
- `ipc/contract.test.ts` — `SameShape<PluginSetting, Rust.PluginSetting>`.
- `hooks/useChats.ts` — метод `addDraftImage`.
- `hooks/usePlugins.ts` — **создаётся** (query list_plugins + подписка plugin-result/plugins-changed).
- `App.tsx` — монтаж `usePlugins`, проброс списка плагинов в `AppComposer`.
- `components/Composer.tsx` — иконки плагинов в `ComposerToolbar` + пропсы.
- `lib/plugin-icons.ts` — **создаётся** (allowlist lucide-имён).
- `lib/query-client.ts` — ключ `plugins`.
- `features/launcher/tabs.ts` — вкладка `plugins`.
- `features/launcher/TabContent.tsx` — `case "plugins"`.
- `features/launcher/PluginsPanel.tsx` — **создаётся**.

**Создаются (плагин, вне репозитория harpyhare — будущий монорепо):**
- `~/harpyhare-plugins/plugins/harpyshot/harpyshot.c`
- `~/harpyhare-plugins/plugins/harpyshot/plugin.json`
- `~/harpyhare-plugins/plugins/harpyshot/build-install.sh`

**Документация:**
- `apps/desktop/CLAUDE.md` — раздел про рантайм плагинов, Settings 31→32, таблица модулей, список событий.

---

## Task 1: harpyshot C-sidecar + сборка/установка + проба №1 (screencapture/TCC)

**Files:**
- Create: `~/harpyhare-plugins/plugins/harpyshot/harpyshot.c`
- Create: `~/harpyhare-plugins/plugins/harpyshot/plugin.json`
- Create: `~/harpyhare-plugins/plugins/harpyshot/build-install.sh`

**Interfaces:**
- Produces: sidecar-бинарь `harpyshot-aarch64`/`harpyshot-x86_64`, установленный в `~/Library/Application Support/com.audioservice.helper/plugins/harpyshot/1.0.0/` вместе с `plugin.json`, и `installed.json = {"harpyshot":"1.0.0"}` — то, что Task 4 читает как реестр.
- Протокол: читает одну строку из stdin (в v1 игнорирует тело), печатает в stdout ровно одну строку JSON: `{"protocol":1,"kind":"image","media_type":"image/png","data_base64":"…"}` при успехе, `{"protocol":1,"kind":"none"}` при отмене (Esc / нет файла), `{"protocol":1,"kind":"error","message":"…"}` при сбое.

- [ ] **Step 1: Написать `harpyshot.c`**

Полный самодостаточный C (встроенный base64, `posix_spawn` на `screencapture`):

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <spawn.h>
#include <sys/wait.h>
#include <sys/stat.h>

extern char **environ;

static const char B64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char *b64_encode(const unsigned char *buf, size_t len) {
    size_t olen = 4 * ((len + 2) / 3);
    char *out = malloc(olen + 1);
    if (!out) return NULL;
    size_t i = 0, j = 0;
    while (i < len) {
        unsigned int o0 = buf[i++];
        unsigned int o1 = i < len ? buf[i++] : 0;
        unsigned int o2 = i < len ? buf[i++] : 0;
        unsigned int triple = (o0 << 16) | (o1 << 8) | o2;
        out[j++] = B64[(triple >> 18) & 0x3F];
        out[j++] = B64[(triple >> 12) & 0x3F];
        out[j++] = B64[(triple >> 6) & 0x3F];
        out[j++] = B64[triple & 0x3F];
    }
    size_t mod = len % 3;
    if (mod == 1) { out[olen - 1] = '='; out[olen - 2] = '='; }
    else if (mod == 2) { out[olen - 1] = '='; }
    out[olen] = '\0';
    return out;
}

static void emit_none(void) { printf("{\"protocol\":1,\"kind\":\"none\"}\n"); }
static void emit_error(const char *m) {
    printf("{\"protocol\":1,\"kind\":\"error\",\"message\":\"%s\"}\n", m);
}

int main(void) {
    char line[4096];
    (void)fgets(line, sizeof line, stdin);

    char tmpl[] = "/tmp/harpyshot-XXXXXX.png";
    int fd = mkstemps(tmpl, 4);
    if (fd < 0) { emit_error("mkstemps failed"); return 0; }
    close(fd);

    char *argv[] = {"/usr/sbin/screencapture", "-i", "-x", tmpl, NULL};
    pid_t pid;
    if (posix_spawn(&pid, argv[0], NULL, NULL, argv, environ) != 0) {
        unlink(tmpl); emit_error("spawn screencapture failed"); return 0;
    }
    int status;
    waitpid(pid, &status, 0);

    struct stat st;
    if (stat(tmpl, &st) != 0 || st.st_size == 0) {
        unlink(tmpl); emit_none(); return 0;
    }

    FILE *f = fopen(tmpl, "rb");
    if (!f) { unlink(tmpl); emit_error("open capture failed"); return 0; }
    unsigned char *data = malloc((size_t)st.st_size);
    if (!data) { fclose(f); unlink(tmpl); emit_error("oom"); return 0; }
    size_t got = fread(data, 1, (size_t)st.st_size, f);
    fclose(f);
    unlink(tmpl);
    if (got != (size_t)st.st_size) { free(data); emit_error("read capture failed"); return 0; }

    char *b64 = b64_encode(data, got);
    free(data);
    if (!b64) { emit_error("encode failed"); return 0; }
    printf("{\"protocol\":1,\"kind\":\"image\",\"media_type\":\"image/png\",\"data_base64\":\"%s\"}\n", b64);
    free(b64);
    return 0;
}
```

- [ ] **Step 2: Написать `plugin.json`**

```json
{
  "schema": 1,
  "id": "harpyshot",
  "name": "harpyshot",
  "description": "Скриншот выделенной зоны экрана во вложение",
  "version": "1.0.0",
  "icon": "crop",
  "capability": "attachment_source",
  "default_hotkey": "Cmd+Shift+S",
  "min_host_version": "0.9.0",
  "bin": { "aarch64": "harpyshot-aarch64", "x86_64": "harpyshot-x86_64" }
}
```

- [ ] **Step 3: Написать `build-install.sh`** (компиляция → ad-hoc-подпись → установка в кэш приложения)

```sh
#!/bin/sh
set -eu

ARCH=$(uname -m)
case "$ARCH" in
  arm64) KEY=aarch64 ;;
  x86_64) KEY=x86_64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac
BIN="harpyshot-$KEY"

clang -O2 -Wall -Werror -o "$BIN" harpyshot.c
codesign -s - "$BIN"

APP_SUPPORT="$HOME/Library/Application Support/com.audioservice.helper/plugins"
DEST="$APP_SUPPORT/harpyshot/1.0.0"
mkdir -p "$DEST"
cp "$BIN" "$DEST/"
cp plugin.json "$DEST/"
printf '{"harpyshot":"1.0.0"}\n' > "$APP_SUPPORT/installed.json"
echo "installed harpyshot 1.0.0 ($KEY) -> $DEST"
```

- [ ] **Step 4: Собрать и установить**

Run:
```bash
mkdir -p ~/harpyhare-plugins/plugins/harpyshot
# (поместить три файла выше в этот каталог)
cd ~/harpyhare-plugins/plugins/harpyshot && chmod +x build-install.sh && ./build-install.sh
```
Expected: `installed harpyshot 1.0.0 (aarch64) -> …/plugins/harpyshot/1.0.0`, и файлы `harpyshot-aarch64` + `plugin.json` лежат в кэше, `installed.json` создан.

- [ ] **Step 5: Проба №1 — screencapture + TCC (блокирующая)**

Run:
```bash
cd ~/harpyhare-plugins/plugins/harpyshot && printf '{"action":"activate"}\n' | ./harpyshot-aarch64 | head -c 120
```
Expected: появляется системный крест выделения; после выделения зоны в stdout идёт `{"protocol":1,"kind":"image","media_type":"image/png","data_base64":"iVBORw0K…` . Нажатие Esc вместо выделения → `{"protocol":1,"kind":"none"}`.

**Задокументировать вывод пробы** (в конце этого плана, раздел «Результат пробы №1»): спросила ли macOS разрешение «Запись экрана» у вызывающего (терминала/бинаря) или захват прошёл без запроса. Это определяет TCC-историю Ф3.

- [ ] **Step 6: Commit** — плагин вне репозитория harpyhare (в `~/harpyhare-plugins`), git-инициализация — Ф2. Здесь коммита в harpyhare нет; зафиксировать факт установки галочкой в плане.

---

## Task 2: Rust — модель манифеста + валидация

**Files:**
- Create: `apps/desktop/src-tauri/src/plugins.rs`
- Create: `apps/desktop/src-tauri/src/plugins/tests.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (добавить `pub mod plugins;`)

**Interfaces:**
- Produces: `PluginManifest { schema, id, name, description, version, icon, capability, default_hotkey, min_host_version, bin }`; `PluginCapability::AttachmentSource`; `PluginBins { aarch64: Option<String>, x86_64: Option<String> }` с методом `for_current_arch() -> Option<&str>`; `fn parse_manifest(bytes: &[u8]) -> Result<PluginManifest, String>`; `fn validate_manifest(&PluginManifest) -> Result<(), String>`; константа `CURRENT_ARCH_KEY: &str`.

- [ ] **Step 1: Объявить модуль в `lib.rs`**

В блоке `pub mod …;` (между `pub mod platform;` и `pub mod preferences;`) добавить строку:
```rust
pub mod plugins;
```

- [ ] **Step 2: Написать failing-тест** — `apps/desktop/src-tauri/src/plugins/tests.rs`

```rust
use super::*;

fn valid_manifest_json() -> &'static str {
    r#"{"schema":1,"id":"harpyshot","name":"harpyshot","description":"d",
        "version":"1.0.0","icon":"crop","capability":"attachment_source",
        "default_hotkey":"Cmd+Shift+S","min_host_version":"0.9.0",
        "bin":{"aarch64":"harpyshot-aarch64","x86_64":"harpyshot-x86_64"}}"#
}

#[test]
fn parses_and_validates_a_good_manifest() {
    let m = parse_manifest(valid_manifest_json().as_bytes()).expect("parse");
    assert_eq!(m.id, "harpyshot");
    assert_eq!(m.capability, PluginCapability::AttachmentSource);
    assert!(validate_manifest(&m).is_ok());
}

#[test]
fn rejects_bad_id() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.id = "Harpy Shot!".to_string();
    assert!(validate_manifest(&m).is_err());
}

#[test]
fn rejects_unknown_icon() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.icon = "definitely-not-a-lucide-icon".to_string();
    assert!(validate_manifest(&m).is_err());
}

#[test]
fn rejects_unparseable_hotkey() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.default_hotkey = "".to_string();
    assert!(validate_manifest(&m).is_err());
}

#[test]
fn rejects_bad_semver() {
    let mut m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    m.version = "1.x".to_string();
    assert!(validate_manifest(&m).is_err());
}
```

- [ ] **Step 3: Запустить — упадёт на отсутствии `plugins`**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: FAIL — `cannot find … plugins` / модуль пуст.

- [ ] **Step 4: Реализовать модель + валидацию** — начало `apps/desktop/src-tauri/src/plugins.rs`

```rust
use serde::{Deserialize, Serialize};

pub const CURRENT_ARCH_KEY: &str = std::env::consts::ARCH;

const ICON_ALLOWLIST: &[&str] = &["crop", "camera", "scissors", "image", "aperture"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum PluginCapability {
    AttachmentSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PluginBins {
    #[serde(default)]
    pub aarch64: Option<String>,
    #[serde(default)]
    pub x86_64: Option<String>,
}

impl PluginBins {
    pub fn for_current_arch(&self) -> Option<&str> {
        match CURRENT_ARCH_KEY {
            "aarch64" => self.aarch64.as_deref(),
            "x86_64" => self.x86_64.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PluginManifest {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub icon: String,
    pub capability: PluginCapability,
    pub default_hotkey: String,
    pub min_host_version: String,
    pub bin: PluginBins,
}

pub fn parse_manifest(bytes: &[u8]) -> Result<PluginManifest, String> {
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_valid_semver(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

pub fn validate_manifest(m: &PluginManifest) -> Result<(), String> {
    if !is_valid_id(&m.id) {
        return Err(format!("невалидный id плагина: {:?}", m.id));
    }
    if !is_valid_semver(&m.version) || !is_valid_semver(&m.min_host_version) {
        return Err(format!("невалидная версия: {} / {}", m.version, m.min_host_version));
    }
    if !ICON_ALLOWLIST.contains(&m.icon.as_str()) {
        return Err(format!("иконка вне allowlist: {:?}", m.icon));
    }
    if crate::hotkey::parse_hotkey(&m.default_hotkey).is_none() {
        return Err(format!("неразбираемый хоткей: {:?}", m.default_hotkey));
    }
    if m.bin.for_current_arch().is_none() {
        return Err(format!("нет бинаря для арх. {CURRENT_ARCH_KEY}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
```

- [ ] **Step 5: Запустить — зелёные**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: PASS (5 тестов).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/plugins.rs apps/desktop/src-tauri/src/plugins/tests.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(plugins): модель манифеста плагина + валидация"
```

---

## Task 3: Rust — парс результата протокола

**Files:**
- Modify: `apps/desktop/src-tauri/src/plugins.rs`
- Modify: `apps/desktop/src-tauri/src/plugins/tests.rs`

**Interfaces:**
- Produces: `enum PluginResult { Image { media_type, data_base64 }, Text { text }, None, Error { message } }`; `fn parse_result(stdout: &str) -> PluginResult` (пустой/битый stdout → `Error`).

- [ ] **Step 1: Failing-тест** — добавить в `plugins/tests.rs`

```rust
#[test]
fn parses_image_result() {
    let line = r#"{"protocol":1,"kind":"image","media_type":"image/png","data_base64":"AAAA"}"#;
    assert_eq!(
        parse_result(line),
        PluginResult::Image { media_type: "image/png".into(), data_base64: "AAAA".into() }
    );
}

#[test]
fn parses_none_result_ignoring_trailing_whitespace() {
    assert_eq!(parse_result("{\"protocol\":1,\"kind\":\"none\"}\n"), PluginResult::None);
}

#[test]
fn empty_or_garbage_stdout_is_error() {
    assert!(matches!(parse_result(""), PluginResult::Error { .. }));
    assert!(matches!(parse_result("not json"), PluginResult::Error { .. }));
}
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: FAIL — `parse_result`/`PluginResult` не найдены.

- [ ] **Step 3: Реализовать** — добавить в `plugins.rs` (после манифеста)

```rust
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginResult {
    Image { media_type: String, data_base64: String },
    Text { text: String },
    None,
    Error { message: String },
}

pub fn parse_result(stdout: &str) -> PluginResult {
    let line = stdout.trim();
    match serde_json::from_str::<PluginResult>(line) {
        Ok(r) => r,
        Err(e) => PluginResult::Error { message: format!("нераспознанный ответ плагина: {e}") },
    }
}
```

- [ ] **Step 4: Запустить — зелёные**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/plugins.rs apps/desktop/src-tauri/src/plugins/tests.rs
git commit -m "feat(plugins): парс результата протокола sidecar"
```

---

## Task 4: Rust — реестр из кэша + app_state + синхронная загрузка на старте

**Files:**
- Modify: `apps/desktop/src-tauri/src/plugins.rs`
- Modify: `apps/desktop/src-tauri/src/plugins/tests.rs`
- Modify: `apps/desktop/src-tauri/src/app_state.rs` (константа + `plugin_cache_dir` + поле `App.plugins` + инициализация)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (загрузка реестра после `manage`)

**Interfaces:**
- Consumes: `parse_manifest`/`validate_manifest` (Task 2).
- Produces: `struct InstalledPlugin { manifest: PluginManifest, dir: PathBuf, update_available: Option<String> }`; `fn load_registry(cache_dir: &Path) -> Vec<InstalledPlugin>`; `app_state::plugin_cache_dir(&AppHandle) -> PathBuf`; поле `App.plugins: Mutex<Vec<InstalledPlugin>>`.

- [ ] **Step 1: Failing-тест** — добавить в `plugins/tests.rs`

```rust
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static TMP_SEQ: AtomicU32 = AtomicU32::new(0);

fn unique_tmp_dir() -> PathBuf {
    let n = TMP_SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("harpyhare-plugins-test-{}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn install_fixture(cache: &PathBuf, id: &str, version: &str) {
    let dir = cache.join(id).join(version);
    fs::create_dir_all(&dir).unwrap();
    let manifest = valid_manifest_json().replace("\"harpyshot\"", &format!("\"{id}\""));
    fs::write(dir.join("plugin.json"), manifest).unwrap();
    fs::write(cache.join("installed.json"), format!("{{\"{id}\":\"{version}\"}}")).unwrap();
}

#[test]
fn loads_installed_plugin_from_cache() {
    let cache = unique_tmp_dir();
    install_fixture(&cache, "harpyshot", "1.0.0");
    let reg = load_registry(&cache);
    assert_eq!(reg.len(), 1);
    assert_eq!(reg[0].manifest.id, "harpyshot");
    assert_eq!(reg[0].dir, cache.join("harpyshot").join("1.0.0"));
    fs::remove_dir_all(&cache).ok();
}

#[test]
fn missing_cache_yields_empty_registry() {
    let cache = std::env::temp_dir().join("harpyhare-plugins-test-nope-xyz");
    assert!(load_registry(&cache).is_empty());
}
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: FAIL — `load_registry`/`InstalledPlugin` не найдены.

- [ ] **Step 3: Реализовать реестр** — добавить в `plugins.rs`

```rust
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const MANIFEST_FILE_NAME: &str = "plugin.json";
const INSTALLED_FILE_NAME: &str = "installed.json";

#[derive(Debug, Clone)]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub dir: PathBuf,
    pub update_available: Option<String>,
}

pub fn load_registry(cache_dir: &Path) -> Vec<InstalledPlugin> {
    let installed_raw = match std::fs::read(cache_dir.join(INSTALLED_FILE_NAME)) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let installed: BTreeMap<String, String> = match serde_json::from_slice(&installed_raw) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[plugins] битый installed.json: {e}");
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for (id, version) in installed {
        let dir = cache_dir.join(&id).join(&version);
        let bytes = match std::fs::read(dir.join(MANIFEST_FILE_NAME)) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[plugins] манифест {id}@{version} не читается: {e}");
                continue;
            }
        };
        let manifest = match parse_manifest(&bytes).and_then(|m| {
            validate_manifest(&m).map(|_| m)
        }) {
            Ok(m) if m.id == id => m,
            Ok(m) => {
                eprintln!("[plugins] id в манифесте ({}) != каталогу ({id})", m.id);
                continue;
            }
            Err(e) => {
                eprintln!("[plugins] манифест {id}@{version} невалиден: {e}");
                continue;
            }
        };
        out.push(InstalledPlugin { manifest, dir, update_available: None });
    }
    out
}
```

- [ ] **Step 4: app_state — путь кэша + поле + инициализация**

В `app_state.rs` рядом с константами имён файлов (после `CONTEXT_LIBRARY_FILE_NAME`):
```rust
const PLUGIN_CACHE_DIR_NAME: &str = "plugins";
```
Рядом с `context_library_path`:
```rust
pub fn plugin_cache_dir(app: &AppHandle) -> std::path::PathBuf {
    app_data_file(app, PLUGIN_CACHE_DIR_NAME)
}
```
В `struct App` (после `pub update_installing: AtomicBool,`):
```rust
    pub plugins: Mutex<Vec<crate::plugins::InstalledPlugin>>,
```
В `build_app_state` (в литерале `App { … }`, после `update_installing: AtomicBool::new(false),`):
```rust
        plugins: Mutex::new(Vec::new()),
```

- [ ] **Step 5: lib.rs — синхронная загрузка реестра после `manage`**

В `setup_app`, сразу после блока `handle.manage(app_state::build_app_state(…));` и ДО `window::create_launcher_window(…)`:
```rust
    let registry = plugins::load_registry(&app_state::plugin_cache_dir(handle));
    *handle.state::<App>().plugins.lock().unwrap() = registry;
```

- [ ] **Step 6: Запустить тесты + сборку**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: PASS (реестр-тесты зелёные).
Run: `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: компилируется (поле `App.plugins` инициализировано везде).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/plugins.rs apps/desktop/src-tauri/src/plugins/tests.rs apps/desktop/src-tauri/src/app_state.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(plugins): загрузка реестра плагинов из кэша на старте"
```

---
## Task 5: Settings — `plugin_settings` + `PluginSetting` (Rust ⇄ TS контракт)

**Files:**
- Modify: `apps/desktop/src-tauri/src/settings.rs` (тип + поле + дефолт)
- Modify: `apps/desktop/src/ipc/types.ts` (`PluginSetting` + поле + `DEFAULT_SETTINGS`)
- Modify: `apps/desktop/src/ipc/contract.test.ts` (`SameShape`)

**Interfaces:**
- Produces: Rust `PluginSetting { id: String, enabled: bool, hotkey: String }` + `Settings.plugin_settings: Vec<PluginSetting>`; TS `interface PluginSetting { id: string; enabled: boolean; hotkey: string }` + `Settings.plugin_settings: PluginSetting[]`.

- [ ] **Step 1: Rust — тип + поле + дефолт** в `settings.rs`

Рядом с `PromptPreset` (тем же набором derive):
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PluginSetting {
    pub id: String,
    pub enabled: bool,
    pub hotkey: String,
}
```
В `struct Settings` (после `pub scroll_modifier: String,`):
```rust
    pub plugin_settings: Vec<PluginSetting>,
```
В `impl Default for Settings` (после `scroll_modifier: …`):
```rust
            plugin_settings: Vec::new(),
```

- [ ] **Step 2: Перегенерировать биндинги (cargo test)**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: PASS; `apps/desktop/src/ipc/bindings.ts` перезаписан — в `SETTINGS_DEFAULTS` появилось `plugin_settings: []`, экспортирован тип `PluginSetting`.

- [ ] **Step 3: TS — `PluginSetting` + поле + `DEFAULT_SETTINGS`** в `ipc/types.ts`

После строки `export type { AppError, ImagePayload };` (или рядом с другими интерфейсами) добавить:
```typescript
export interface PluginSetting {
  id: string;
  enabled: boolean;
  hotkey: string;
}
```
В `interface Settings` (после `scroll_modifier: string;`):
```typescript
  plugin_settings: PluginSetting[];
```
В `DEFAULT_SETTINGS` добавить копию (специта печатает константу `readonly`, поле изменяемое — как с `prompt_presets`):
```typescript
export const DEFAULT_SETTINGS: Settings = {
  ...SETTINGS_DEFAULTS,
  prompt_presets: [...SETTINGS_DEFAULTS.prompt_presets],
  plugin_settings: [...SETTINGS_DEFAULTS.plugin_settings],
};
```

- [ ] **Step 4: Контракт-тест** — в `ipc/contract.test.ts`

В импорт из `./types` добавить `PluginSetting`:
```typescript
import type {
  AudioOutputDevice,
  EventMap,
  IdentityInfo,
  PluginSetting,
  RecorderState,
  Settings,
  UpdateInfo,
} from "./types";
```
В объект `contract` добавить строку:
```typescript
  PluginSetting: true satisfies SameShape<PluginSetting, Rust.PluginSetting>,
```

- [ ] **Step 5: typecheck**

Run: `cd apps/desktop && npm run typecheck`
Expected: PASS — формы совпадают, `DEFAULT_SETTINGS` собирается.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/settings.rs apps/desktop/src/ipc/types.ts apps/desktop/src/ipc/contract.test.ts apps/desktop/src/ipc/bindings.ts
git commit -m "feat(plugins): поле Settings.plugin_settings (Rust+TS контракт)"
```

---

## Task 6: Rust — команда `list_plugins` + `PluginDescriptor` + merge

**Files:**
- Modify: `apps/desktop/src-tauri/src/plugins.rs`
- Modify: `apps/desktop/src-tauri/src/plugins/tests.rs`
- Modify: `apps/desktop/src-tauri/src/bindings.rs`

**Interfaces:**
- Consumes: `InstalledPlugin` (Task 4), `settings::PluginSetting` (Task 5).
- Produces: `PluginDescriptor { id, name, description, version, icon, capability, enabled, hotkey, state }`; `enum PluginState { Ready, Downloading, UpdateAvailable }`; `fn merge_descriptor(&InstalledPlugin, &[settings::PluginSetting]) -> PluginDescriptor`; команда `list_plugins`.

- [ ] **Step 1: Failing-тест** — в `plugins/tests.rs`

```rust
use crate::settings::PluginSetting;

fn installed_fixture() -> InstalledPlugin {
    let m = parse_manifest(valid_manifest_json().as_bytes()).unwrap();
    InstalledPlugin { manifest: m, dir: PathBuf::from("/tmp/x"), update_available: None }
}

#[test]
fn merge_uses_manifest_defaults_when_no_user_setting() {
    let d = merge_descriptor(&installed_fixture(), &[]);
    assert_eq!(d.id, "harpyshot");
    assert!(!d.enabled);
    assert_eq!(d.hotkey, "Cmd+Shift+S");
    assert_eq!(d.state, PluginState::Ready);
}

#[test]
fn merge_prefers_user_setting() {
    let prefs = vec![PluginSetting { id: "harpyshot".into(), enabled: true, hotkey: "F7".into() }];
    let d = merge_descriptor(&installed_fixture(), &prefs);
    assert!(d.enabled);
    assert_eq!(d.hotkey, "F7");
}

#[test]
fn merge_falls_back_to_default_hotkey_when_user_hotkey_empty() {
    let prefs = vec![PluginSetting { id: "harpyshot".into(), enabled: true, hotkey: "".into() }];
    let d = merge_descriptor(&installed_fixture(), &prefs);
    assert_eq!(d.hotkey, "Cmd+Shift+S");
}
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: FAIL — `merge_descriptor`/`PluginDescriptor`/`PluginState` не найдены.

- [ ] **Step 3: Реализовать** — в `plugins.rs`

```rust
use tauri::{AppHandle, Manager};

use crate::app_state::{current_settings, App};
use crate::settings::PluginSetting;

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum PluginState {
    Ready,
    Downloading,
    UpdateAvailable,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub icon: String,
    pub capability: PluginCapability,
    pub enabled: bool,
    pub hotkey: String,
    pub state: PluginState,
}

pub fn merge_descriptor(p: &InstalledPlugin, prefs: &[PluginSetting]) -> PluginDescriptor {
    let pref = prefs.iter().find(|s| s.id == p.manifest.id);
    let enabled = pref.map(|s| s.enabled).unwrap_or(false);
    let hotkey = pref
        .map(|s| s.hotkey.clone())
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| p.manifest.default_hotkey.clone());
    let state = if p.update_available.is_some() {
        PluginState::UpdateAvailable
    } else {
        PluginState::Ready
    };
    PluginDescriptor {
        id: p.manifest.id.clone(),
        name: p.manifest.name.clone(),
        description: p.manifest.description.clone(),
        version: p.manifest.version.clone(),
        icon: p.manifest.icon.clone(),
        capability: p.manifest.capability.clone(),
        enabled,
        hotkey,
        state,
    }
}

#[tauri::command]
#[specta::specta]
pub fn list_plugins(app: AppHandle) -> Vec<PluginDescriptor> {
    let prefs = current_settings(&app).plugin_settings;
    let reg = app.state::<App>().plugins.lock().unwrap().clone();
    reg.iter().map(|p| merge_descriptor(p, &prefs)).collect()
}
```

- [ ] **Step 4: Регистрация в биндингах** — `bindings.rs`

В `use crate::{…}` добавить `plugins`:
```rust
use crate::{chat, events, plugins, preferences, recording, storage, system, window};
```
В `collect_commands![…]` добавить строку (перед закрывающей `]`):
```rust
            plugins::list_plugins,
```
В цепочку `.typ::<…>()` добавить:
```rust
        .typ::<plugins::PluginDescriptor>()
        .typ::<plugins::PluginState>()
        .typ::<plugins::PluginCapability>()
```

- [ ] **Step 5: Тесты + регенерация**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: PASS; `bindings.ts` перегенерирован — есть `commands.listPlugins`, типы `PluginDescriptor`/`PluginState`/`PluginCapability`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/plugins.rs apps/desktop/src-tauri/src/plugins/tests.rs apps/desktop/src-tauri/src/bindings.rs apps/desktop/src/ipc/bindings.ts
git commit -m "feat(plugins): команда list_plugins + merge реестра с настройками"
```

---

## Task 7: Rust — спавн sidecar + выполнение протокола

**Files:**
- Modify: `apps/desktop/src-tauri/src/plugins.rs`
- Modify: `apps/desktop/src-tauri/src/plugins/tests.rs`

**Interfaces:**
- Consumes: `PluginResult`/`parse_result` (Task 3).
- Produces: `async fn spawn_and_activate(bin_path: &Path) -> PluginResult` — пишет `{"action":"activate"}\n` в stdin, ждёт выхода (потолок-рипер), парсит stdout; `stderr` в лог.

- [ ] **Step 1: Failing-тест** — в `plugins/tests.rs` (фейковый sidecar = shell-скрипт, эхо-JSON)

```rust
use std::os::unix::fs::PermissionsExt;

fn write_fake_sidecar(body: &str) -> PathBuf {
    let dir = unique_tmp_dir();
    let path = dir.join("fake-sidecar");
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[tokio::test]
async fn spawn_reads_text_result() {
    let bin = write_fake_sidecar(r#"echo '{"protocol":1,"kind":"text","text":"hi"}'"#);
    let r = spawn_and_activate(&bin).await;
    assert_eq!(r, PluginResult::Text { text: "hi".into() });
}

#[tokio::test]
async fn spawn_of_missing_binary_is_error() {
    let r = spawn_and_activate(&PathBuf::from("/nonexistent/harpyshot-xyz")).await;
    assert!(matches!(r, PluginResult::Error { .. }));
}
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: FAIL — `spawn_and_activate` не найдена.

- [ ] **Step 3: Реализовать** — в `plugins.rs`

```rust
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const ACTIVATE_REQUEST: &[u8] = b"{\"protocol\":1,\"action\":\"activate\"}\n";
const ACTIVATION_CEILING: Duration = Duration::from_secs(300);

pub async fn spawn_and_activate(bin_path: &Path) -> PluginResult {
    let mut child = match tokio::process::Command::new(bin_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return PluginResult::Error { message: format!("спавн плагина: {e}") },
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(ACTIVATE_REQUEST).await;
    }
    let out = match tokio::time::timeout(ACTIVATION_CEILING, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return PluginResult::Error { message: format!("ожидание плагина: {e}") },
        Err(_) => return PluginResult::Error { message: "плагин не ответил (таймаут)".into() },
    };
    if !out.stderr.is_empty() {
        eprintln!("[plugin] {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    parse_result(&String::from_utf8_lossy(&out.stdout))
}
```

- [ ] **Step 4: Запустить — зелёные**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib plugins::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/plugins.rs apps/desktop/src-tauri/src/plugins/tests.rs
git commit -m "feat(plugins): спавн sidecar-процесса и выполнение протокола"
```

---

## Task 8: Rust — команда `activate_plugin` + события + показ HUD

**Files:**
- Modify: `apps/desktop/src-tauri/src/events.rs` (payload + хелперы)
- Modify: `apps/desktop/src-tauri/src/window.rs` (`show_and_focus_main`)
- Modify: `apps/desktop/src-tauri/src/plugins.rs` (`on_activate` + команда)
- Modify: `apps/desktop/src-tauri/src/bindings.rs` (команда + typ)

**Interfaces:**
- Consumes: `spawn_and_activate` (Task 7), `merge`/registry (Tasks 4/6).
- Produces: событие `plugin-result` (payload `PluginResultPayload { plugin_id, kind, media_type?, data_base64?, text? }`); событие `plugins-changed` (`()`); `pub async fn on_activate(&AppHandle, id: &str)`; команда `activate_plugin(app, id)`; `window::show_and_focus_main(&AppHandle)`.

- [ ] **Step 1: events.rs — payload + хелперы**

Добавить константы имён рядом с прочими (`EVENT_OFFICIAL_PRESETS_UPDATED`):
```rust
const EVENT_PLUGIN_RESULT: &str = "plugin-result";
const EVENT_PLUGINS_CHANGED: &str = "plugins-changed";
```
Payload-структура (рядом с прочими event-структурами):
```rust
#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginResultPayload {
    pub plugin_id: String,
    pub kind: String,
    pub media_type: Option<String>,
    pub data_base64: Option<String>,
    pub text: Option<String>,
}
```
Хелперы (рядом с прочими emit-функциями):
```rust
pub fn plugin_result(app: &AppHandle, payload: PluginResultPayload) {
    let _ = app.emit(EVENT_PLUGIN_RESULT, payload);
}

pub fn plugins_changed(app: &AppHandle) {
    let _ = app.emit(EVENT_PLUGINS_CHANGED, ());
}
```

- [ ] **Step 2: window.rs — показать/сфокусировать HUD**

Рядом с `on_toggle_visibility`:
```rust
pub fn show_and_focus_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}
```

- [ ] **Step 3: plugins.rs — `on_activate` + команда**

Константа медиатипов (рядом с `ICON_ALLOWLIST`):
```rust
const SUPPORTED_IMAGE_TYPES: &[&str] =
    &["image/jpeg", "image/png", "image/gif", "image/webp"];
```
Функции:
```rust
fn is_enabled(prefs: &[PluginSetting], id: &str) -> bool {
    prefs.iter().find(|s| s.id == id).map(|s| s.enabled).unwrap_or(false)
}

pub async fn on_activate(app: &AppHandle, id: &str) {
    let settings = current_settings(app);
    if !is_enabled(&settings.plugin_settings, id) {
        return;
    }
    let installed = app
        .state::<App>()
        .plugins
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.manifest.id == id)
        .cloned();
    let Some(installed) = installed else { return };
    let Some(bin_name) = installed.manifest.bin.for_current_arch() else { return };
    let bin_path = installed.dir.join(bin_name);

    match spawn_and_activate(&bin_path).await {
        PluginResult::Image { media_type, data_base64 } => {
            if !SUPPORTED_IMAGE_TYPES.contains(&media_type.as_str()) {
                eprintln!("[plugin:{id}] неподдерживаемый media_type: {media_type}");
                return;
            }
            crate::events::plugin_result(
                app,
                crate::events::PluginResultPayload {
                    plugin_id: id.to_string(),
                    kind: "image".to_string(),
                    media_type: Some(media_type),
                    data_base64: Some(data_base64),
                    text: None,
                },
            );
            crate::window::show_and_focus_main(app);
        }
        PluginResult::Text { text } => {
            crate::events::plugin_result(
                app,
                crate::events::PluginResultPayload {
                    plugin_id: id.to_string(),
                    kind: "text".to_string(),
                    media_type: None,
                    data_base64: None,
                    text: Some(text),
                },
            );
        }
        PluginResult::None => {}
        PluginResult::Error { message } => eprintln!("[plugin:{id}] {message}"),
    }
}

#[tauri::command]
#[specta::specta]
pub fn activate_plugin(app: AppHandle, id: String) {
    tauri::async_runtime::spawn(async move { on_activate(&app, &id).await });
}
```

- [ ] **Step 4: bindings.rs — команда + typ события**

В `collect_commands![…]` добавить:
```rust
            plugins::activate_plugin,
```
В цепочку `.typ::<…>()` добавить:
```rust
        .typ::<events::PluginResultPayload>()
```

- [ ] **Step 5: Компиляция + регенерация**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: PASS; `bindings.ts` содержит `commands.activatePlugin` и тип `PluginResultPayload`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/events.rs apps/desktop/src-tauri/src/window.rs apps/desktop/src-tauri/src/plugins.rs apps/desktop/src-tauri/src/bindings.rs apps/desktop/src/ipc/bindings.ts
git commit -m "feat(plugins): команда activate_plugin, событие plugin-result, показ HUD"
```

---

## Task 9: Rust — глобальные хоткеи плагинов (жизненный цикл HUD)

**Files:**
- Modify: `apps/desktop/src-tauri/src/window.rs` (register/unregister + вызовы)
- Modify: `apps/desktop/src-tauri/src/preferences.rs` (перерегистрация при смене настроек)

**Interfaces:**
- Consumes: `plugins::on_activate` (Task 8), реестр `App.plugins` (Task 4), `settings.plugin_settings` (Task 5).
- Produces: `window::register_plugin_hotkeys(&AppHandle, &Settings)` и `window::unregister_plugin_hotkeys(&AppHandle, &Settings)`.

- [ ] **Step 1: window.rs — register/unregister plugin-хоткеев**

Импорт вверху `window.rs` — добавить `plugins` и типы хоткея:
```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use crate::{events, hotkey, identity, platform, plugins, settings, window_geom};
```
(строку `use crate::{events, hotkey, identity, platform, settings, window_geom};` заменить на строку с `plugins`).

Функции (рядом с `register_main_window_hotkeys`):
```rust
pub fn register_plugin_hotkeys(app: &AppHandle, s: &settings::Settings) {
    let registry = app.state::<App>().plugins.lock().unwrap().clone();
    for p in &registry {
        let Some(ps) = s.plugin_settings.iter().find(|x| x.id == p.manifest.id) else { continue };
        if !ps.enabled {
            continue;
        }
        let Some(shortcut) = hotkey::parse_hotkey(&ps.hotkey) else { continue };
        let id = p.manifest.id.clone();
        let res = app.global_shortcut().on_shortcut(shortcut, move |app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                let app = app.clone();
                let id = id.clone();
                tauri::async_runtime::spawn(async move { plugins::on_activate(&app, &id).await });
            }
        });
        if let Err(e) = res {
            eprintln!("не удалось зарегистрировать хоткей плагина {}: {e}", p.manifest.id);
        }
    }
}

pub fn unregister_plugin_hotkeys(app: &AppHandle, s: &settings::Settings) {
    for ps in &s.plugin_settings {
        if let Some(shortcut) = hotkey::parse_hotkey(&ps.hotkey) {
            let _ = app.global_shortcut().unregister(shortcut);
        }
    }
}
```
`use crate::app_state::{current_settings, App};` уже есть в `window.rs` (используется `current_settings`); если `App` не импортирован — добавить его в этот `use`.

В конце `register_main_window_hotkeys` (после блока суфлёра):
```rust
    register_plugin_hotkeys(app, s);
```
В `unregister_main_window_hotkeys` (после `hotkey::unregister_esc(app);`):
```rust
    unregister_plugin_hotkeys(app, s);
```

- [ ] **Step 2: preferences.rs — перерегистрация при смене `plugin_settings`**

В `reregister_changed_hotkeys` (после блока суфлёра, перед `Ok(())`):
```rust
    if old.plugin_settings != new.plugin_settings {
        crate::window::unregister_plugin_hotkeys(app, old);
        crate::window::register_plugin_hotkeys(app, new);
    }
```
(ранний выход `if main_window(app).is_none()` в начале функции уже покрывает plugin-хоткеи — из лаунчера регистрация не трогается.)

- [ ] **Step 3: Сборка + clippy**

Run: `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets`
Expected: без ошибок/варнингов.

- [ ] **Step 4: Ручной смоук (после Ф1-фронта — Task 11+)** — отложенная проверка; отметить здесь как зависимость: включённый harpyshot по ⌘⇧S должен активироваться и при неактивном фокусе HUD.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/window.rs apps/desktop/src-tauri/src/preferences.rs
git commit -m "feat(plugins): глобальные хоткеи плагинов по жизненному циклу HUD"
```

---
## Task 10: Frontend — события `plugin-*` + `useChats.addDraftImage`

**Files:**
- Modify: `apps/desktop/src/ipc/types.ts` (`EventMap`)
- Modify: `apps/desktop/src/hooks/useChats.ts` (`addDraftImage`)
- Modify: `apps/desktop/src/hooks/useChats.test.ts` (тест)

**Interfaces:**
- Produces: `EventMap["plugin-result"]`, `EventMap["plugins-changed"]`; `ChatsApi.addDraftImage(id: string, dataUrl: string, mediaType: string): Promise<void>` — строит `File` из dataURL и прогоняет через существующий `fileToAttachmentOrNull` (даунскейл >5 МБ), кладёт в черновик.

- [ ] **Step 1: EventMap** — в `ipc/types.ts`, в `interface EventMap` (после `"official-presets-updated": PromptPreset[];`):
```typescript
  "plugins-changed": null;
  "plugin-result": {
    pluginId: string;
    kind: string;
    mediaType: string | null;
    dataBase64: string | null;
    text: string | null;
  };
```

- [ ] **Step 2: Failing-тест** — в `useChats.test.ts` (внутри `describe("useChats", …)`)
```typescript
  it("addDraftImage добавляет вложение в черновик активного чата", async () => {
    vi.useRealTimers();
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    await act(async () => {
      await result.current.addDraftImage(id, dataUrl, "image/png");
    });
    expect(result.current.active.draftAttachments).toHaveLength(1);
    expect(result.current.active.draftAttachments[0]?.payload.media_type).toBe("image/png");
  });
```

- [ ] **Step 3: Запустить — упадёт**

Run: `cd apps/desktop && npx vitest run src/hooks/useChats.test.ts`
Expected: FAIL — `addDraftImage` не существует.

- [ ] **Step 4: Реализовать** — в `useChats.ts`

Хелпер (рядом с `fileToAttachmentOrNull`, без `fetch` — через `atob`, чтобы путь без даунскейла был детерминирован в jsdom):
```typescript
const DATA_URL_BASE64_MARKER = ";base64,";
const SCREENSHOT_FILE_NAME = "screenshot";

function dataUrlToFile(dataUrl: string, mediaType: string): File {
  const markerIdx = dataUrl.indexOf(DATA_URL_BASE64_MARKER);
  const base64 = markerIdx >= 0 ? dataUrl.slice(markerIdx + DATA_URL_BASE64_MARKER.length) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], SCREENSHOT_FILE_NAME, { type: mediaType });
}
```
Метод в `useChats` (рядом с `addDraftAttachments`):
```typescript
  const addDraftImage = useCallback(
    async (id: string, dataUrl: string, mediaType: string) => {
      if (acceptedNewAttachments(draftAttachmentCount(id), 1) < 1) return;
      const att = await fileToAttachmentOrNull(dataUrlToFile(dataUrl, mediaType));
      if (att) appendDraftAttachment(id, att);
    },
    [draftAttachmentCount, appendDraftAttachment],
  );
```
В `interface ChatsApi` (после `addDraftAttachments`):
```typescript
  addDraftImage: (id: string, dataUrl: string, mediaType: string) => Promise<void>;
```
В возвращаемый объект (после `addDraftAttachments,`):
```typescript
    addDraftImage,
```

- [ ] **Step 5: Запустить — зелёный + typecheck**

Run: `cd apps/desktop && npx vitest run src/hooks/useChats.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/ipc/types.ts apps/desktop/src/hooks/useChats.ts apps/desktop/src/hooks/useChats.test.ts
git commit -m "feat(plugins): события plugin-result/plugins-changed + addDraftImage"
```

---

## Task 11: Frontend — хук `usePlugins` + реэкспорт команд + монтаж в App

**Files:**
- Modify: `apps/desktop/src/ipc/commands.ts` (реэкспорт)
- Modify: `apps/desktop/src/lib/query-client.ts` (ключ)
- Create: `apps/desktop/src/hooks/usePlugins.ts`
- Create: `apps/desktop/src/hooks/usePlugins.test.ts`
- Modify: `apps/desktop/src/App.tsx` (монтаж хука)

**Interfaces:**
- Consumes: `listPlugins`/`activatePlugin` (commands), `EventMap["plugin-result"]`/`["plugins-changed"]` (Task 10).
- Produces: `usePlugins(onImage: (dataUrl: string, mediaType: string) => void): PluginDescriptor[]`.

- [ ] **Step 1: Реэкспорт команд** — в `ipc/commands.ts`, в блок `export const { … } = commands;` (по алфавиту):
```typescript
  activatePlugin,
```
```typescript
  listPlugins,
```

- [ ] **Step 2: Ключ react-query** — в `lib/query-client.ts`, в объект `queryKeys` (после `identities: …`):
```typescript
  plugins: ["plugins"] as const,
```

- [ ] **Step 3: Failing-тест** — `apps/desktop/src/hooks/usePlugins.test.ts`
```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listPlugins = vi.fn();
vi.mock("@/ipc/commands", () => ({ listPlugins: () => listPlugins() }));

const handlers: Record<string, (p: unknown) => void> = {};
vi.mock("@/ipc/events", () => ({
  onEvent: (name: string, h: (p: unknown) => void) => {
    handlers[name] = h;
    return () => delete handlers[name];
  },
}));

import { usePlugins } from "./usePlugins";

afterEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("usePlugins", () => {
  it("отдаёт список из list_plugins и роутит plugin-result image в onImage", async () => {
    listPlugins.mockResolvedValue([
      { id: "harpyshot", name: "harpyshot", description: "d", version: "1.0.0",
        icon: "crop", capability: "attachment_source", enabled: true, hotkey: "Cmd+Shift+S",
        state: "ready" },
    ]);
    const onImage = vi.fn();
    const { result } = renderHook(() => usePlugins(onImage), { wrapper });
    await waitFor(() => {
      expect(result.current).toHaveLength(1);
    });
    handlers["plugin-result"]?.({
      pluginId: "harpyshot", kind: "image", mediaType: "image/png",
      dataBase64: "AAAA", text: null,
    });
    expect(onImage).toHaveBeenCalledWith("data:image/png;base64,AAAA", "image/png");
  });
});
```

- [ ] **Step 4: Запустить — упадёт**

Run: `cd apps/desktop && npx vitest run src/hooks/usePlugins.test.ts`
Expected: FAIL — `usePlugins` не существует.

- [ ] **Step 5: Реализовать** — `apps/desktop/src/hooks/usePlugins.ts`
```typescript
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { PluginDescriptor } from "@/ipc/bindings";
import { listPlugins } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import { queryKeys } from "@/lib/query-client";

export function usePlugins(
  onImage: (dataUrl: string, mediaType: string) => void,
): PluginDescriptor[] {
  const query = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: listPlugins,
    staleTime: Infinity,
  });

  const onImageRef = useRef(onImage);
  useEffect(() => {
    onImageRef.current = onImage;
  }, [onImage]);

  useEffect(
    () =>
      onEvent("plugin-result", (p) => {
        if (p.kind === "image" && p.dataBase64 !== null && p.mediaType !== null) {
          onImageRef.current(`data:${p.mediaType};base64,${p.dataBase64}`, p.mediaType);
        }
      }),
    [],
  );

  const qc = useQueryClient();
  useEffect(
    () =>
      onEvent("plugins-changed", () => {
        void qc.invalidateQueries({ queryKey: queryKeys.plugins });
      }),
    [qc],
  );

  return query.data ?? [];
}
```

- [ ] **Step 6: Монтаж в App** — в `App.tsx`

Импорты: добавить `activatePlugin` в существующий импорт из `@/ipc/commands`; добавить `import { usePlugins } from "@/hooks/usePlugins";`.
В теле `App()` рядом с прочими хуками (после `const chats = useChats();` есть `chatsRef` ниже — монтаж ставить ПОСЛЕ определения `chatsRef = useLatestRef(chats)`):
```typescript
  const onPluginImage = useCallback(
    (dataUrl: string, mediaType: string) => {
      void chatsRef.current.addDraftImage(chatsRef.current.activeId, dataUrl, mediaType);
    },
    [chatsRef],
  );
  const plugins = usePlugins(onPluginImage);
```

- [ ] **Step 7: Запустить — зелёный + typecheck**

Run: `cd apps/desktop && npx vitest run src/hooks/usePlugins.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/ipc/commands.ts apps/desktop/src/lib/query-client.ts apps/desktop/src/hooks/usePlugins.ts apps/desktop/src/hooks/usePlugins.test.ts apps/desktop/src/App.tsx
git commit -m "feat(plugins): хук usePlugins + монтаж в App"
```

---

## Task 12: Frontend — иконки плагинов в тулбаре HUD

**Files:**
- Create: `apps/desktop/src/lib/plugin-icons.ts`
- Create: `apps/desktop/src/lib/plugin-icons.test.ts`
- Modify: `apps/desktop/src/components/Composer.tsx` (пропсы + рендер иконок)
- Modify: `apps/desktop/src/App.tsx` (проброс в `AppComposer` → `Composer`)

**Interfaces:**
- Consumes: `plugins` из `usePlugins` (Task 11), `activatePlugin` (commands).
- Produces: `pluginIcon(name: string): LucideIcon`; `ComposerProps.plugins: { id: string; name: string; icon: string }[]` + `ComposerProps.onActivatePlugin: (id: string) => void`.

- [ ] **Step 1: Failing-тест** — `apps/desktop/src/lib/plugin-icons.test.ts`
```typescript
import { Crop } from "lucide-react";
import { describe, expect, it } from "vitest";
import { pluginIcon } from "./plugin-icons";

describe("pluginIcon", () => {
  it("возвращает компонент для известного имени", () => {
    expect(pluginIcon("crop")).toBe(Crop);
  });
  it("фолбэк на Crop для неизвестного имени", () => {
    expect(pluginIcon("nope")).toBe(Crop);
  });
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd apps/desktop && npx vitest run src/lib/plugin-icons.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать allowlist** — `apps/desktop/src/lib/plugin-icons.ts` (набор ДОЛЖЕН совпадать с Rust `ICON_ALLOWLIST` в `plugins.rs`)
```typescript
import { Aperture, Camera, Crop, Image, Scissors, type LucideIcon } from "lucide-react";

const PLUGIN_ICONS: Record<string, LucideIcon> = {
  crop: Crop,
  camera: Camera,
  scissors: Scissors,
  image: Image,
  aperture: Aperture,
};

export function pluginIcon(name: string): LucideIcon {
  return PLUGIN_ICONS[name] ?? Crop;
}
```

- [ ] **Step 4: Composer — пропсы + рендер**

В `ComposerProps` (после `models: ModelInfo[];`):
```typescript
  plugins: { id: string; name: string; icon: string }[];
  onActivatePlugin: (id: string) => void;
```
Импорт вверху `Composer.tsx`: `import { pluginIcon } from "@/lib/plugin-icons";`.
В `ComposerToolbarProps` (тип) добавить те же два поля через пересечение — проще: расширить `Pick<ComposerProps, …>` в `ComposerToolbarProps`, добавив `"plugins" | "onActivatePlugin"`:
```typescript
type ComposerToolbarProps = RequestParamsProps &
  Pick<
    ComposerProps,
    | "onClearHistory"
    | "showRetry"
    | "onRetry"
    | "streaming"
    | "onStop"
    | "onSend"
    | "plugins"
    | "onActivatePlugin"
  > & {
    hasContext: boolean;
    onOpenContext: () => void;
  };
```
В `ComposerToolbar`, сразу после `<RequestParamsPopover … />` и перед `<div className="flex-1" />`:
```tsx
      {props.plugins.map((p) => {
        const Icon = pluginIcon(p.icon);
        return (
          <Button
            key={p.id}
            variant="ghost"
            size="icon-compact"
            onClick={() => {
              props.onActivatePlugin(p.id);
            }}
            title={p.name}
            aria-label={p.name}
          >
            <Icon />
          </Button>
        );
      })}
```
В `Composer` (в JSX `<ComposerToolbar … />`) пробросить два пропса:
```tsx
          plugins={props.plugins}
          onActivatePlugin={props.onActivatePlugin}
```

- [ ] **Step 5: App — проброс списка**

В `AppComposerProps` добавить:
```typescript
  plugins: { id: string; name: string; icon: string }[];
  onActivatePlugin: (id: string) => void;
```
В деструктуризацию параметров `AppComposer` добавить `plugins, onActivatePlugin`, и в `<Composer … />` пробросить:
```tsx
      plugins={plugins}
      onActivatePlugin={onActivatePlugin}
```
В `App()` вычислить тулбар-список (после `const plugins = usePlugins(onPluginImage);`):
```typescript
  const toolbarPlugins = useMemo(
    () =>
      plugins
        .filter((p) => p.enabled && p.capability === "attachment_source")
        .map((p) => ({ id: p.id, name: p.name, icon: p.icon })),
    [plugins],
  );
```
В месте рендера `<AppComposer … />` добавить:
```tsx
          plugins={toolbarPlugins}
          onActivatePlugin={(id) => void activatePlugin(id)}
```

- [ ] **Step 6: Тест + typecheck**

Run: `cd apps/desktop && npx vitest run src/lib/plugin-icons.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/lib/plugin-icons.ts apps/desktop/src/lib/plugin-icons.test.ts apps/desktop/src/components/Composer.tsx apps/desktop/src/App.tsx
git commit -m "feat(plugins): иконки включённых плагинов в тулбаре HUD"
```

---

## Task 13: Frontend — вкладка «Плагины» в лаунчере

**Files:**
- Modify: `apps/desktop/src/features/launcher/tabs.ts`
- Modify: `apps/desktop/src/features/launcher/TabContent.tsx`
- Create: `apps/desktop/src/features/launcher/PluginsPanel.tsx`
- Create: `apps/desktop/src/features/launcher/PluginsPanel.test.tsx`

**Interfaces:**
- Consumes: `SectionProps { draft, set }` (contract.ts), `listPlugins` (commands), `HotkeyCapture`, `SwitchRow`/`Field`.
- Produces: вкладка `plugins`; `PluginsPanel({ draft, set }: SectionProps)`.

- [ ] **Step 1: Вкладка** — в `tabs.ts`

В импорт lucide добавить `Puzzle`:
```typescript
import {
  Keyboard,
  KeyRound,
  Library,
  MessageSquareText,
  Palette,
  Puzzle,
  SlidersHorizontal,
  VenetianMask,
  type LucideIcon,
} from "lucide-react";
```
В массив `LAUNCHER_TABS` (после `presets`):
```typescript
  { id: "plugins", label: "Плагины", icon: Puzzle },
```

- [ ] **Step 2: Failing-тест** — `apps/desktop/src/features/launcher/PluginsPanel.test.tsx`
```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";

const listPlugins = vi.fn();
vi.mock("@/ipc/commands", () => ({ listPlugins: () => listPlugins() }));

import { PluginsPanel } from "./PluginsPanel";

afterEach(() => {
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("PluginsPanel", () => {
  it("рисует плагин и переключение вызывает set с полной записью", async () => {
    listPlugins.mockResolvedValue([
      { id: "harpyshot", name: "harpyshot", description: "d", version: "1.0.0",
        icon: "crop", capability: "attachment_source", enabled: false,
        hotkey: "Cmd+Shift+S", state: "ready" },
    ]);
    const set = vi.fn();
    const draft: Settings = { ...DEFAULT_SETTINGS };
    render(createElement(PluginsPanel, { draft, set }), { wrapper });
    await waitFor(() => {
      expect(screen.getByText("harpyshot")).toBeInTheDocument();
    });
    act(() => {
      screen.getByRole("switch").click();
    });
    expect(set).toHaveBeenCalledWith("plugin_settings", [
      { id: "harpyshot", enabled: true, hotkey: "Cmd+Shift+S" },
    ]);
  });
});
```

- [ ] **Step 3: Запустить — упадёт**

Run: `cd apps/desktop && npx vitest run src/features/launcher/PluginsPanel.test.tsx`
Expected: FAIL — `PluginsPanel` не существует.

- [ ] **Step 4: Реализовать** — `apps/desktop/src/features/launcher/PluginsPanel.tsx`
```typescript
import { useQuery } from "@tanstack/react-query";
import { listPlugins } from "@/ipc/commands";
import type { PluginSetting } from "@/ipc/types";
import { queryKeys } from "@/lib/query-client";
import type { SectionProps } from "./contract";
import { Field, SectionGroup, SwitchRow } from "./fields";
import { HotkeyCapture } from "./HotkeyCapture";

function upsertPluginSetting(list: PluginSetting[], entry: PluginSetting): PluginSetting[] {
  const idx = list.findIndex((p) => p.id === entry.id);
  if (idx >= 0) return list.map((p, i) => (i === idx ? entry : p));
  return [...list, entry];
}

export function PluginsPanel({ draft, set }: SectionProps) {
  const { data } = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: listPlugins,
    staleTime: Infinity,
  });
  const descriptors = data ?? [];

  if (descriptors.length === 0) {
    return (
      <SectionGroup title="Плагины">
        <p className="text-caption text-muted-foreground">
          Плагинов пока нет. Они подкачиваются автоматически.
        </p>
      </SectionGroup>
    );
  }

  return (
    <SectionGroup title="Плагины">
      {descriptors.map((d) => {
        const pref = draft.plugin_settings.find((p) => p.id === d.id);
        const enabled = pref?.enabled ?? d.enabled;
        const hotkey = pref?.hotkey || d.hotkey;
        return (
          <div key={d.id} className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0">
            <SwitchRow
              checked={enabled}
              onCheckedChange={(v) => {
                set("plugin_settings", upsertPluginSetting(draft.plugin_settings, {
                  id: d.id,
                  enabled: v,
                  hotkey,
                }));
              }}
            >
              <span className="font-medium">{d.name}</span>
            </SwitchRow>
            <p className="text-caption text-muted-foreground">{d.description}</p>
            <Field label="Хоткей">
              <HotkeyCapture
                value={hotkey}
                onChange={(hk) => {
                  set("plugin_settings", upsertPluginSetting(draft.plugin_settings, {
                    id: d.id,
                    enabled,
                    hotkey: hk,
                  }));
                }}
              />
            </Field>
          </div>
        );
      })}
    </SectionGroup>
  );
}
```

- [ ] **Step 5: Подключить вкладку** — в `TabContent.tsx`

Импорт: `import { PluginsPanel } from "./PluginsPanel";`.
В `switch (tab)` добавить (перед закрывающей `}`):
```tsx
    case "plugins":
      return <PluginsPanel draft={draft} set={set} />;
```
(TypeScript-исчерпывающесть закрытого union `TabId` заставит добавить этот case после Step 1.)

- [ ] **Step 6: Тест + typecheck + lint**

Run: `cd apps/desktop && npx vitest run src/features/launcher/PluginsPanel.test.tsx && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/features/launcher/tabs.ts apps/desktop/src/features/launcher/TabContent.tsx apps/desktop/src/features/launcher/PluginsPanel.tsx apps/desktop/src/features/launcher/PluginsPanel.test.tsx
git commit -m "feat(plugins): вкладка «Плагины» в лаунчере (тумблер + хоткей)"
```

---

## Task 14: Полный прогон + документация + ручной e2e

**Files:**
- Modify: `apps/desktop/CLAUDE.md`

- [ ] **Step 1: Полный прогон проверок**

Run:
```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
cd apps/desktop && npm run typecheck && npm run lint && npx vitest run
cd ../.. && npm run knip
```
Expected: всё зелёное. (knip не должен ругаться на новые экспортируемые символы — они используются.)

- [ ] **Step 2: Ручной e2e-смоук** (единственный способ увидеть UI — `npm run tauri dev`)

Run: `cd apps/desktop && npm run tauri dev`
Проверить:
1. Лаунчер → вкладка «Плагины»: виден harpyshot, тумблер, хоткей `⌘⇧S`.
2. Включить harpyshot → «Запустить».
3. В HUD под чатом рядом с иконками — иконка harpyshot (crop).
4. Клик по иконке ИЛИ ⌘⇧S (даже при фокусе вне HUD) → крест выделения → выделить зону → HUD в фокусе, скриншот-вложение в черновике активного чата.
5. Esc в режиме выделения → ничего не добавилось, ошибок нет.
6. Выключить harpyshot в лаунчере → иконка пропала, ⌘⇧S больше не перехватывается.

- [ ] **Step 3: Обновить `apps/desktop/CLAUDE.md`**

- В разделе Settings: «Settings (31 поле)» → «Settings (32 поля)»; добавить абзац: `plugin_settings: {id,enabled,hotkey}[]` — per-plugin состояние платформы плагинов (по образцу `prompt_presets`); дефолт пусто; свежескачанный плагин выключен.
- В таблицу модулей Rust добавить строку: `plugins.rs | рантайм sidecar-плагинов: реестр из кэша, спавн процесса + stdio/JSON-протокол, merge с настройками, команды list_plugins/activate_plugin`.
- В список событий (раздел «События») добавить `plugin-result`, `plugins-changed`.
- Кратко описать инвариант: манифест читается без запуска бинаря; icon-allowlist во фронте (`lib/plugin-icons`) обязан совпадать с Rust `ICON_ALLOWLIST`; sidecar подписан ad-hoc; хоткеи плагинов регистрируются в `register_main_window_hotkeys` (жизненный цикл HUD) и перерегистрируются в `set_settings`. Сослаться на спек `docs/superpowers/specs/2026-07-24-harpyshot-plugin-platform-design.md` (фазы Ф2/Ф3 — распространение и апдейты).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/CLAUDE.md
git commit -m "docs: рантайм плагинов + harpyshot (Ф1) в CLAUDE.md"
```

---

## Результат пробы №1 (заполнить на Task 1, Step 5)

- `screencapture -i -x` даёт PNG выбранной зоны: **[да/нет]**
- Отмена (Esc) → `kind:"none"`: **[да/нет]**
- macOS запросила «Запись экрана» у вызывающего процесса: **[да/нет]** →
  - если **нет** — TCC-проблема снята, апдейты (Ф3) не переспросят разрешение;
  - если **да** — при ad-hoc-подписи апдейт harpyshot будет переспрашивать; заложить заметку в UI (Ф3) и предупредить в CLAUDE.md.

## Заметки самопроверки плана (spec coverage)

- Компоненты спека 1–8 покрыты: рантайм (T2–4,6–9), манифест (T2), протокол (T3,7), Settings-контракт (T5), команды/события (T6,8), хоткеи (T9), harpyshot-sidecar (T1), UI таб+иконки (T12,13).
- Оба потока спека: активация (T1,7,8,9,10,11,12), старт (T4).
- Ф2/Ф3 (распространение, апдейты) НЕ входят в этот план намеренно — отдельные планы поверх готового ядра. `PluginState::{Downloading,UpdateAvailable}` заведены заранее (стабильный тип), но в Ф1 всегда `Ready`.
- Инвариант палитры, генерируемый контракт, ad-hoc-подпись, «манифест без запуска» — в Global Constraints и в задачах.


