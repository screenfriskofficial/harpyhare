import { STT_PROVIDERS as GENERATED_STT_PROVIDERS } from "@/ipc/bindings";
import type { ApiKeyId } from "./api-keys";

export interface SttProviderOption {
  /** Stored in `Settings.stt_provider`. */
  id: string;
  label: string;
  keyId: ApiKeyId;
}

/**
 * Derived from the generated registry — never hand-written.
 *
 * A vendor added to `stt/registry.rs` appears in the launcher select and in the
 * HUD model menu with no TypeScript at all. Only the fields a picker needs
 * cross the boundary: hosts and paths are marked `#[specta(skip)]` on the Rust
 * side, because the frontend chooses a vendor and never dials one.
 *
 * The annotation is load-bearing the same way it is for `MODEL_PROVIDERS`:
 * specta prints the constant `as const`, so a row naming a key the app has no
 * field for fails `tsc` here rather than locking the vendor silently.
 */
export const STT_PROVIDERS: readonly SttProviderOption[] = GENERATED_STT_PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
  keyId: p.keyId,
}));

/** The default vendor — first row of the registry, as `default_spec()` in Rust. */
const DEFAULT_PROVIDER_KEY_ID: ApiKeyId = GENERATED_STT_PROVIDERS[0].keyId;

/**
 * The key a vendor needs, falling back to the default vendor's for an id the
 * registry does not know — the frontend half of `stt::registry::resolve`.
 */
export function sttProviderKeyId(provider: string): ApiKeyId {
  return STT_PROVIDERS.find((p) => p.id === provider)?.keyId ?? DEFAULT_PROVIDER_KEY_ID;
}
