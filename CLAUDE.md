# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

Монорепозиторий **harpyhare** (Nx + npm workspaces, один общий `node_modules`): десктоп-приложение (macOS + Windows) и его лендинг.

| Проект          | Что это                                                                          | Своя документация                                     |
| --------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/desktop`  | Продукт: Tauri 2 + Rust-бэкенд + React 19. Системный звук → STT → ответ Claude    | **`apps/desktop/CLAUDE.md`** (подробно)               |
| `apps/landing`  | Одностраничный сайт со скачиванием (Next.js 16 App Router + React + Tailwind)     | —                                                     |

**Работаешь внутри `apps/desktop` — читай `apps/desktop/CLAUDE.md`.** Там вся архитектура приложения, инварианты Rust⇄TS-контракта, правила палитры и десятки «почему так, а не иначе». Этот файл — только про монорепо в целом.

Nx выводит проекты из npm-workspaces, а таргеты — из их `package.json`-скриптов; файлов `project.json` нет и заводить их не надо.

## Команды

```bash
npm install                                       # все воркспейсы разом

npx nx dev landing                                # лендинг (Next.js, http://localhost:3000)
cd apps/desktop && npm run tauri dev              # приложение целиком (Rust + фронт) — единственный способ увидеть UI

npx nx <target> <project>                         # build | lint | typecheck | test для одного проекта
npm run build | lint | typecheck | test           # то же самое для всех (nx run-many)
npx nx affected -t lint typecheck --uncommitted   # только затронутые проекты

npm run knip                                      # мёртвый код и зависимости, workspace-aware (knip.json)
npm run format                                    # prettier по всему репо
npm run presets:publish                           # config/presets.json → публичный блоб (нужен BLOB_READ_WRITE_TOKEN в .env.local)
```

Тесты — vitest в каждом проекте: `cd apps/desktop && npx vitest run src/hooks/useChats.test.ts` (один файл), `npx vitest run` (все). Rust-тесты живут отдельно: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`.

**Pre-commit (husky)** прогоняет три шага: `lint-staged` (prettier по застейдженным) → `nx affected -t typecheck lint --uncommitted` → `knip`. То есть коммит падает и от мёртвого экспорта, а не только от типов.

**CI — `.github/workflows/ci.yml`** (push в main **и в теги `v*`**, PR, ручной запуск): job на ubuntu гоняет `nx run-many -t typecheck lint test` + `knip`, job на macos-latest — `cargo test`, `git diff --exit-code apps/desktop/src/ipc/bindings.ts` и `clippy -D warnings`, job на windows-latest — `clippy --all-targets -D warnings`, а NSIS-установщик (артефакт `windows-installer`) собирает **только на теге `v*` и по `workflow_dispatch`**: job-level `BUILD_INSTALLER` гейтит и шаг сборки, и `upload-artifact`, на обычных пушах в main и на PR от Windows остаётся один clippy. Мотив — сборка стоила 7м33с из 13м55с всей джобы, а компиляцию под Windows и так держит clippy; **цена осознанна**: поломку именно бандлинга (конфиг NSIS, иконки, WebView2-бутстраппер) CI ловит теперь на теге или по ручному запуску, а не на коммите. **Windows-половину проверяет только CI**: установщик под Windows на macOS не собирается. **Тесты на windows-раннере не гоняются**: тестовый бинарь не стартует (`STATUS_ENTRYPOINT_NOT_FOUND` ещё до первого теста) — похоже на известную граблю крейта с `crate-type = ["cdylib", …]` (2026-09-05 `crate-type` сведён к `["rlib"]` — при следующем прогоне CI проверить, не ожил ли тест-бинарь на windows-раннере; локально Windows-половину теперь можно хотя бы скомпилировать: `cargo xwin clippy --target x86_64-pc-windows-msvc --all-targets`); компиляцию тестов там держит `clippy --all-targets`, а прогон и сверку контракта — macos-job. `Swatinem/rust-cache` в обеих джобах **восстанавливается везде, включая PR, но сохраняется только с main и с тегов** (`save-if`): запись кэша на windows-раннере занимала 2м49с против 23с на macOS — упаковка тысяч мелких файлов на NTFS; теги в условии намеренно, иначе релизная сборка (она идёт только на теге) каждый раз шла бы вхолодную. Первым шагом windows-джоба выводит workspace, `~/.cargo`, `~/.rustup` и `cargo.exe`/`rustc.exe`/`link.exe` из-под Defender (`continue-on-error`: не хватило прав на раннере — CI от этого падать не должен): один и тот же `clippy --all-targets` шёл 16с на macOS против 1м13с на Windows, и разница — антивирусное сканирование мелких файлов, которыми сыплют cargo и npm. Подпись апдейтера в CI включается, только если задан секрет `TAURI_SIGNING_PRIVATE_KEY`.

## Что связывает проекты

Приложения не импортируют код друг друга — общего пакета нет. Связей ровно три, и все они неочевидны из структуры папок:

1. **`config/presets.json` — один файл, два потребителя.** Его вшивает Rust (`include_str!` в `remote_presets.rs`, фолбэк, когда сеть недоступна) и импортирует фронт (`lib/presets.ts`). Правка формата ломает обе стороны сразу; публикация в блоб (`npm run presets:publish`) перекрывает вшитую копию в рантайме — но **только при не меньшей версии**: `remote_presets::apply` отказывается опускать пул ниже текущей, поэтому правка вшитого файла с бампом `version` работает локально ещё до публикации (см. `apps/desktop/CLAUDE.md`).

2. **Репозиторий релизов `screenfriskofficial/harpyhare-releases`.** `apps/desktop/scripts/release.mjs` публикует туда подписанный бандл и `latest.json`; апдейтер приложения тянет оттуда обновления, а лендинг спрашивает у GitHub Releases API последнюю версию **на сервере** (ISR, ревалидация раз в 30 минут — версия и ссылки попадают в HTML) и подбирает установщик под ОС посетителя по суффиксу имени ассета (`apps/landing/src/lib/release.ts`: `.dmg` против `-setup.exe`, апдейтерные `.nsis.zip`/`.app.tar.gz`/`.sig` и `latest.json` отсеиваются). Поэтому смена имени ассета в релиз-скрипте ломает и апдейтер, и кнопку «Скачать» на сайте. **Релиз двухплатформенный:** первый прогон создаёт релиз и тег, второй (тот же тег) версию не бампает, доливает свои ассеты и вливает свою платформу в существующий `latest.json` (`darwin-aarch64` / `windows-x86_64`). Второй прогон необязательно гнать на Windows-машине: `npm run release -- X.Y.Z --windows-setup <путь>` доливает Windows с mac, подписывая тем же ключом `-setup.exe` из артефактов CI-джобы windows (подпись апдейтера — minisign по байтам файла, хост сборки для неё безразличен). **Платформу нельзя оставлять невписанной в `latest.json`**: апдейтер на ней не «не находит обновлений», а реджектит `check()` с `TargetsNotFound` при каждом вызове, независимо от версии пользователя — механизм и следы бага в `apps/desktop/CLAUDE.md`.

3. **Прокси `screenfriskofficial/itech-relay`** (Cloudflare Worker, отдельный репозиторий) — через него идут запросы приложения в режиме кода доступа. Его инварианты описаны в `apps/desktop/CLAUDE.md`.

## knip

`knip.json` задаёт точки входа явно, потому что автоопределение здесь врёт: у desktop это `src/launcher.tsx` и `src/index.css` (второе окно приложения и Tailwind-слой), из проверки исключены `src/components/ui/**` (примитивы shadcn, часть добавлена впрок) и `src/ipc/bindings.ts` (генерируется из Rust). Добавляя окно или генерируемый артефакт, правь `knip.json` — иначе pre-commit будет ругаться на «мёртвый» код, который на самом деле живой. У landing своей секции нет намеренно: точки входа App Router (`page.tsx`, `layout.tsx`, `sitemap.ts`, `robots.ts`, `manifest.ts`) находит плагин knip для Next.js.

## Прочее

- Документации в репозитории больше нет, кроме двух `CLAUDE.md` (этот и `apps/desktop/CLAUDE.md`): `docs/`, `README.md` и оба README приложений удалены намеренно — знание живёт в них и в говорящих именах, а не в отдельных файлах.
- Корневые `dist/` и `src-tauri/` — артефакты, оставшиеся до разделения на воркспейсы: они в `.gitignore` и в сборке не участвуют. Настоящий Tauri-крейт — `apps/desktop/src-tauri`.
- `.env` и `.env.local` в корне: первый — фолбэк ключей API (читает и релизная сборка: cwd и `CARGO_MANIFEST_DIR/..`, подхваченный ключ персистится первым автосейвом лаунчера — осознанно), второй — токен публикации пресетов. Оба гитигнорятся.
