#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT_NAME = "Spotify";
const ASSET_SLUG = "Spotify";
const RELEASES_REPO = "screenfriskofficial/harpyhare-releases";
const RELEASES_REPO_URL = `https://github.com/${RELEASES_REPO}`;

const PKG_PATH = join(ROOT, "package.json");
const LOCKFILE_PATH = join(ROOT, "../../package-lock.json");
const TAURI_CONF_PATH = join(ROOT, "src-tauri/tauri.conf.json");
const CARGO_TOML_PATH = join(ROOT, "src-tauri/Cargo.toml");
const BUNDLE_DIR = join(ROOT, "src-tauri/target/release/bundle");
const RELEASE_ASSETS_DIR = join(BUNDLE_DIR, "release-assets");
const LATEST_MANIFEST_NAME = "latest.json";

const DEFAULT_SIGNING_KEY_PATH = join(homedir(), ".tauri/itech.key");
const keyPath = process.env.ITECH_SIGNING_KEY ?? DEFAULT_SIGNING_KEY_PATH;
const keyPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const VERSION_PARTS = 3;
const JSON_INDENT = 2;
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const STDOUT_TARGET = "-";

const UPDATER_ARCH_BY_NODE_ARCH = { arm64: "aarch64", x64: "x86_64" };
const BUNDLE_ARCH_BY_NODE_ARCH = { arm64: "aarch64", x64: "x64" };

const MACOS_HOST = {
  updaterOs: "darwin",
  updaterBundle: () => join(BUNDLE_DIR, `macos/${PRODUCT_NAME}.app.tar.gz`),
  updaterAsset: ({ version, updaterArch }) => `${ASSET_SLUG}_${version}_${updaterArch}.app.tar.gz`,
  installerBundle: ({ version, bundleArch }) =>
    join(BUNDLE_DIR, `dmg/${PRODUCT_NAME}_${version}_${bundleArch}.dmg`),
  installerAsset: ({ version, bundleArch }) => `${ASSET_SLUG}_${version}_${bundleArch}.dmg`,
};

const windowsSetupBundle = ({ version, bundleArch }) =>
  join(BUNDLE_DIR, `nsis/${PRODUCT_NAME}_${version}_${bundleArch}-setup.exe`);
const windowsSetupAsset = ({ version, updaterArch }) =>
  `${ASSET_SLUG}_${version}_${updaterArch}-setup.exe`;

const WINDOWS_HOST = {
  updaterOs: "windows",
  updaterBundle: windowsSetupBundle,
  updaterAsset: windowsSetupAsset,
  installerBundle: windowsSetupBundle,
  installerAsset: windowsSetupAsset,
};

const HOST_BY_NODE_PLATFORM = { darwin: MACOS_HOST, win32: WINDOWS_HOST };

const PREBUILT_WINDOWS_NODE_ARCH = "x64";
const PREBUILT_WINDOWS_TARGET = {
  host: WINDOWS_HOST,
  updaterArch: UPDATER_ARCH_BY_NODE_ARCH[PREBUILT_WINDOWS_NODE_ARCH],
  bundleArch: BUNDLE_ARCH_BY_NODE_ARCH[PREBUILT_WINDOWS_NODE_ARCH],
};

const die = (msg) => {
  console.error(`${ANSI_RED}ошибка:${ANSI_RESET} ${msg}`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
const NODE_CLI_IS_SHELL_SCRIPT_ON = "win32";
const runNodeCli = (tool, args, opts = {}) =>
  run(tool, args, { ...opts, shell: process.platform === NODE_CLI_IS_SHELL_SCRIPT_ON });
const capture = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();
const writeJson = (path, data) =>
  writeFileSync(path, JSON.stringify(data, null, JSON_INDENT) + "\n");

const withUpdaterPlatform = (target) => ({
  ...target,
  updaterPlatform: `${target.host.updaterOs}-${target.updaterArch}`,
});

const resolveTarget = (prebuiltWindowsSetup) => {
  if (prebuiltWindowsSetup) return withUpdaterPlatform(PREBUILT_WINDOWS_TARGET);
  const host = HOST_BY_NODE_PLATFORM[process.platform];
  const updaterArch = UPDATER_ARCH_BY_NODE_ARCH[process.arch];
  const bundleArch = BUNDLE_ARCH_BY_NODE_ARCH[process.arch];
  if (!host || !updaterArch || !bundleArch) {
    die(`сборка релиза не поддерживается на ${process.platform}/${process.arch}`);
  }
  return withUpdaterPlatform({ host, updaterArch, bundleArch });
};

const flagValue = (argv, flag) => {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : (argv[idx + 1] ?? "");
};

const parseCliArgs = (argv) => {
  const version = argv[0];
  const notes = flagValue(argv, "--notes") ?? "";
  const prebuiltWindowsSetup = flagValue(argv, "--windows-setup");
  if (!version || !VERSION_RE.test(version)) {
    die(
      'укажи версию: npm run release -- 0.2.0 [--notes "Что нового"] [--windows-setup путь/к/setup.exe]',
    );
  }
  return { version, notes, prebuiltWindowsSetup };
};

const readVersionedConfigs = () => {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  const conf = JSON.parse(readFileSync(TAURI_CONF_PATH, "utf8"));
  return { pkg, conf };
};

const assertVersionsInSync = (pkg, conf) => {
  const current = pkg.version;
  if (
    conf.version !== current ||
    !readFileSync(CARGO_TOML_PATH, "utf8").includes(`version = "${current}"`)
  ) {
    die(`версии рассинхронизированы: package.json=${current}, tauri.conf.json=${conf.version}`);
  }
  return current;
};

const isNewerVersion = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < VERSION_PARTS; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

const releaseExists = (version) => {
  try {
    execFileSync("gh", ["release", "view", `v${version}`, "--repo", RELEASES_REPO], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const assertToolingReady = () => {
  if (capture("git", ["status", "--porcelain"]) !== "") {
    die("git-дерево не чистое — закоммить или отложи изменения");
  }
  if (!existsSync(keyPath)) die(`нет ключа подписи ${keyPath}`);
  run("gh", ["auth", "status"], { stdio: "ignore" });
};

const assertReadyToCreate = (version, current) => {
  if (!isNewerVersion(version, current)) die(`версия ${version} не новее текущей ${current}`);
};

const assertReadyToAppend = (version, current) => {
  if (version !== current) {
    die(
      `релиз v${version} уже есть, но локальная версия ${current} — переключись на тег v${version}`,
    );
  }
};

const requirePublishedManifest = (version, updaterPlatform) => {
  const manifest = fetchPublishedManifest(version);
  if (!manifest) {
    die(`не читается ${LATEST_MANIFEST_NAME} релиза v${version} — долив затёр бы чужие платформы`);
  }
  if (manifest.platforms?.[updaterPlatform]) {
    die(`в релизе v${version} уже есть платформа ${updaterPlatform}`);
  }
  return manifest;
};

const bumpVersions = (pkg, conf, current, version) => {
  pkg.version = version;
  writeJson(PKG_PATH, pkg);
  conf.version = version;
  writeJson(TAURI_CONF_PATH, conf);
  writeFileSync(
    CARGO_TOML_PATH,
    readFileSync(CARGO_TOML_PATH, "utf8").replace(
      `version = "${current}"`,
      `version = "${version}"`,
    ),
  );
  runNodeCli("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
};

const buildSignedBundle = () => {
  runNodeCli("npm", ["run", "tauri", "build"], {
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: keyPath,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: keyPassword,
    },
  });
};

const assertArtifactsExist = (artifacts) => {
  for (const f of new Set(Object.values(artifacts))) {
    if (!existsSync(f)) die(`сборка не дала артефакт ${f}`);
  }
  return artifacts;
};

const collectBuildArtifacts = ({ host, version, updaterArch, bundleArch }) => {
  const naming = { version, updaterArch, bundleArch };
  const updaterSrc = host.updaterBundle(naming);
  return assertArtifactsExist({
    updaterSrc,
    signatureSrc: `${updaterSrc}.sig`,
    installerSrc: host.installerBundle(naming),
  });
};

const collectPrebuiltSetup = (setupPath, version) => {
  if (!existsSync(setupPath)) die(`нет установщика ${setupPath}`);
  if (!basename(setupPath).includes(`_${version}_`)) {
    die(`установщик ${basename(setupPath)} собран не из версии ${version}`);
  }
  runNodeCli("npx", ["tauri", "signer", "sign", "-f", keyPath, "-p", keyPassword, setupPath]);
  return assertArtifactsExist({
    updaterSrc: setupPath,
    signatureSrc: `${setupPath}.sig`,
    installerSrc: setupPath,
  });
};

const fetchPublishedManifest = (version) => {
  try {
    const raw = capture("gh", [
      "release",
      "download",
      `v${version}`,
      "--repo",
      RELEASES_REPO,
      "--pattern",
      LATEST_MANIFEST_NAME,
      "--output",
      STDOUT_TARGET,
    ]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const assetUrl = (version, assetName) =>
  `${RELEASES_REPO_URL}/releases/download/v${version}/${assetName}`;

const prepareReleaseAssets = ({
  host,
  version,
  notes,
  published,
  updaterPlatform,
  updaterArch,
  bundleArch,
  updaterSrc,
  signatureSrc,
  installerSrc,
}) => {
  mkdirSync(RELEASE_ASSETS_DIR, { recursive: true });
  const naming = { version, updaterArch, bundleArch };
  const updaterAsset = host.updaterAsset(naming);
  const installerAsset = host.installerAsset(naming);
  const uploadedAssets = [...new Set([updaterAsset, installerAsset, LATEST_MANIFEST_NAME])];
  copyFileSync(updaterSrc, join(RELEASE_ASSETS_DIR, updaterAsset));
  copyFileSync(installerSrc, join(RELEASE_ASSETS_DIR, installerAsset));

  const latest = {
    version,
    notes: published?.notes ?? notes,
    pub_date: published?.pub_date ?? new Date().toISOString(),
    platforms: {
      ...(published?.platforms ?? {}),
      [updaterPlatform]: {
        signature: readFileSync(signatureSrc, "utf8").trim(),
        url: assetUrl(version, updaterAsset),
      },
    },
  };
  writeJson(join(RELEASE_ASSETS_DIR, LATEST_MANIFEST_NAME), latest);
  return uploadedAssets.map((name) => join(RELEASE_ASSETS_DIR, name));
};

const createGithubRelease = ({ version, notes, assetPaths }) => {
  run("gh", [
    "release",
    "create",
    `v${version}`,
    "--repo",
    RELEASES_REPO,
    "--title",
    `${PRODUCT_NAME} ${version}`,
    "--notes",
    notes,
    ...assetPaths,
  ]);
};

const appendToGithubRelease = ({ version, assetPaths }) => {
  run("gh", [
    "release",
    "upload",
    `v${version}`,
    "--repo",
    RELEASES_REPO,
    "--clobber",
    ...assetPaths,
  ]);
};

const commitAndTag = (version) => {
  run("git", [
    "add",
    "package.json",
    LOCKFILE_PATH,
    TAURI_CONF_PATH,
    CARGO_TOML_PATH,
    "src-tauri/Cargo.lock",
  ]);
  run("git", ["commit", "-m", `release: v${version}`]);
  run("git", ["tag", `v${version}`]);
};

const { version, notes, prebuiltWindowsSetup } = parseCliArgs(process.argv.slice(2));
const { host, updaterArch, bundleArch, updaterPlatform } = resolveTarget(prebuiltWindowsSetup);
const { pkg, conf } = readVersionedConfigs();
const current = assertVersionsInSync(pkg, conf);
assertToolingReady();

const appending = releaseExists(version);
if (appending) {
  assertReadyToAppend(version, current);
} else if (prebuiltWindowsSetup) {
  die(`релиза v${version} ещё нет — создай его на macOS, установщик доливается вторым вызовом`);
} else {
  assertReadyToCreate(version, current);
}
const published = appending ? requirePublishedManifest(version, updaterPlatform) : null;

console.log(`\n${PRODUCT_NAME} ${current} → ${version} (${updaterPlatform})\n`);
if (!appending) bumpVersions(pkg, conf, current, version);
if (!prebuiltWindowsSetup) buildSignedBundle();

const artifacts = prebuiltWindowsSetup
  ? collectPrebuiltSetup(prebuiltWindowsSetup, version)
  : collectBuildArtifacts({ host, version, updaterArch, bundleArch });
const assetPaths = prepareReleaseAssets({
  host,
  version,
  notes,
  published,
  updaterPlatform,
  updaterArch,
  bundleArch,
  ...artifacts,
});

if (appending) {
  appendToGithubRelease({ version, assetPaths });
} else {
  createGithubRelease({ version, notes, assetPaths });
  commitAndTag(version);
}

console.log(`\nготово: ${RELEASES_REPO_URL}/releases/tag/v${version}`);
if (appending) {
  console.log(`платформа ${updaterPlatform} добавлена в релиз`);
} else {
  console.log("не забудь: git push && git push --tags");
  console.log(`вторую платформу добавь тем же вызовом на её машине: npm run release -- ${version}`);
  console.log(
    `либо отсюда, установщиком из CI: npm run release -- ${version} --windows-setup путь/к/setup.exe`,
  );
}
