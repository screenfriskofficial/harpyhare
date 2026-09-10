export const diagnosticsEn = {
  copy: "Copy diagnostic report",
  copied: "Diagnostic report copied",
  clear: "Clear history",
  empty: "Checks, requests and errors from this app session will appear here.",
  privacy:
    "Reports contain version, providers, error codes, request IDs and timings. Text, recordings, keys and device names are excluded. History is kept only until the app closes.",
  loadFailed: "Could not load diagnostics. Try again.",
  timings: "Stage timings",
  milliseconds: "{{value, number}} ms",
  capture: "Recording duration",
  processing: "Recognition after recording",
  headers: "Until HTTP response",
  requestPreparation: "From start to request dispatch",
  requestWait: "Sending and waiting for HTTP response",
  requestKind: {
    catalog: "Model catalogue",
    speech: "Transcription",
    answer: "Model response",
    speechStream: "Transcription stream",
    other: "Request",
  },
  firstText: "Until first text",
  total: "Total",
  timingHint:
    "HTTP response and first-text times are measured from the operation start and are not additive. Streaming recognition uploads during recording. Waiting to send manually is excluded from answer timings.",
  viaRelay: "Access code",
  direct: "Personal key",
  success: "Successful",
  session: "App session",
  preflight: "Pre-interview check",
  retryAfter: "The service recommends waiting {{seconds}} s",
  noRequestId: "The service did not return a request ID",
  kind: { capture: "Audio capture", transcription: "Transcription", answer: "Model response" },
  errors: {
    billing: {
      title: "Billing or quota issue",
      action:
        "Check the selected provider's balance and account limits. If using an access code, contact its issuer.",
    },
    dailyLimit: {
      title: "Daily limit reached",
      action: "The access code limit resets at the next UTC day. You can use a personal API key.",
    },
    rateLimited: {
      title: "Request limit reached",
      action:
        "Wait before retrying. Check account limits if this persists, or choose another provider.",
    },
    serviceUnavailable: {
      title: "Service temporarily unavailable",
      action:
        "Retry shortly or choose another provider. Include a diagnostic report when reporting a recurring issue.",
    },
    timeout: {
      title: "Response timed out",
      action:
        "Retry or choose another model. For transcription, shorten the recording; check your connection and VPN.",
    },
    accessDenied: {
      title: "Access denied",
      action:
        "Check model, project and region permissions in your provider account. For an access code, check its allowed usage.",
    },
    modelUnavailable: {
      title: "Model unavailable",
      action: "Refresh the model list and choose a model available to your key or access code.",
    },
    requestTooLarge: {
      title: "Request too large",
      action:
        "Shorten the recording or reduce attachments. For a long conversation, start a new chat with the necessary context.",
    },
    badApiKey: {
      title: "Check your API key",
      action: "Open Settings → API access and check the selected provider's key.",
    },
    badAccessCode: {
      title: "Invalid access code",
      action: "Open Settings → API access and enter a valid access code.",
    },
    network: {
      title: "No connection",
      action: "Check your internet connection and VPN, then retry.",
    },
    permission: {
      title: "Audio permission required",
      action: "Grant system permission for the selected audio source, then retry.",
    },
    silence: {
      title: "No speech detected",
      action:
        "Speak a test phrase into your microphone. For system audio, play speech in a call or video and check the selected device.",
    },
    api: {
      title: "Request failed",
      action:
        "Check the model and request settings. HTTP response details are available in the diagnostic report.",
    },
    retryable: {
      title: "Please retry",
      action:
        "Wait for the current operation to finish, then retry. Copy a report if this persists.",
    },
    cancelled: { title: "Cancelled", action: "You can run the check again when ready." },
    internal: {
      title: "App or device error",
      action:
        "Check the audio device connection and selected source. Copy a report if this persists.",
    },
  },
};

export const preflightEn = {
  eyebrow: "Before your interview",
  title: "Let's check everything works",
  description: "A short check of your selected audio sources, transcription and response model.",
  run: "Check everything",
  rerun: "Check again",
  cancel: "Stop check",
  cancelling: "Stopping…",
  ready: "Check passed",
  needsAttention: "Some results need attention",
  cancelled: "Check stopped",
  stale: "Settings changed — run the check again.",
  intro:
    "After starting, speak into your microphone and play speech in a call or video for system audio. The check makes requests to your selected providers and uses their normal quota.",
  phrase:
    "Example: ‘Connection test. Explain how a message queue works.’ Any other phrase works too.",
  snapshot: "Results apply to the selected model and settings at the time of the check.",
  model: "Model to check",
  settings: "Configure",
  diagnostics: "Open diagnostics",
  launch: "Start interview",
  configured: "Configured",
  unconfigured: "Setup needed",
  notTested: "Not checked yet",
  skipped: "Skipped",
  passed: "Working",
  failed: "Needs attention",
  disabled: "Disabled in settings",
  noModels: "Add an API key or access code to choose a model.",
  remaining: "{{seconds}} s remaining",
  level: "Level: {{source}}",
  stage: {
    preparing: "Preparing and checking permissions…",
    recording: "Recording an audio sample…",
    transcribing: "Checking speech recognition…",
    answering: "Waiting for the test response…",
  },
  step: {
    systemAudio: "System audio",
    microphone: "Microphone",
    transcription: "Speech recognition",
    answer: "Model response",
  },
};
