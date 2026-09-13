# harpyhare

Desktop AI assistant for macOS and Windows. The app captures system audio, converts speech to text, and sends the transcript and optional screenshots to an LLM.

Built with Tauri 2, Rust, React 19, TypeScript, Vite, and Nx.

## Features

- System audio capture with push-to-talk
- Speech-to-text via Deepgram, Groq Whisper, or OpenAI
- Streaming answers from Anthropic, OpenAI, xAI, Xclis, or OpenRouter
- OpenRouter Claude Haiku and Sonnet models
- Context library and reusable presets
- Screenshot attachments
- Configurable global shortcuts
- Compact always-on-top HUD
- Separate launcher for settings and startup
- Automatic application updates

## Supported platforms

- Windows 10 version 2004 or newer
- macOS 14.2 or newer

The application is built natively for the current operating system. Build the Windows installer on Windows and the macOS bundle on macOS.

## Prerequisites

Install the following tools before starting:

- [Node.js](https://nodejs.org/) 20 or newer
- npm
- [Rust](https://rustup.rs/) stable toolchain
- Platform dependencies required by [Tauri 2](https://v2.tauri.app/start/prerequisites/)

On Windows, this includes Microsoft C++ Build Tools and WebView2. On macOS, install the Xcode Command Line Tools:

```bash
xcode-select --install
```

## Installation

Clone the repository and install all workspace dependencies:

```bash
git clone https://github.com/saint1437/harpyhare.git
cd harpyhare
npm install
```

API keys and application settings can be entered in the launcher UI.

OpenRouter uses a personal API key. In the launcher, enter it under API access
and then choose an OpenRouter Claude Haiku or Sonnet model in the HUD model menu.
The optional environment variable for local development is `OPENROUTER_API_KEY`.

For local development, API keys may also be placed in a root `.env` file. Environment files are ignored by Git and must never be committed.

## Development

Run the complete desktop application with hot reload:

```bash
npm --workspace apps/desktop run tauri dev
```

Alternatively:

```bash
cd apps/desktop
npm run tauri dev
```

Do not use `npm run dev` by itself to test the application. It starts only the Vite frontend, while the UI requires the native Tauri backend.

## Production build

From the repository root:

```bash
npm --workspace apps/desktop run tauri build
```

Build artifacts are written to:

```text
apps/desktop/src-tauri/target/release/bundle/
```

Typical outputs:

- Windows: NSIS `*-setup.exe` installer
- macOS: `.app` bundle and `.dmg` image

To compile only the frontend:

```bash
npm --workspace apps/desktop run build
```

## Checks

Run all frontend checks from the repository root:

```bash
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run knip
```

Apply formatting:

```bash
npm run format
```

Run Rust tests and lints:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --release
```

## Project structure

```text
apps/
  desktop/       Tauri desktop application
    src/         React frontend
    src-tauri/   Rust backend and native integration
  landing/       Next.js landing page
config/
  presets.json   Shared application presets
scripts/         Repository-level utility scripts
```

The repository uses npm workspaces and Nx. Dependencies are installed once in the repository root.

## Useful commands

```bash
# Run the landing page at http://localhost:3000
npx nx dev landing

# Build every workspace
npm run build

# Test only the desktop workspace
npm --workspace apps/desktop test

# Lint and automatically fix the desktop workspace
npm --workspace apps/desktop run lint:fix
```

## Notes

- The app needs permission to capture audio.
- Global shortcuts are active while the HUD is running.
- The frontend and Rust backend communicate through generated typed IPC bindings.
- On Windows, the production installer is NSIS-based and installs for the current user.
