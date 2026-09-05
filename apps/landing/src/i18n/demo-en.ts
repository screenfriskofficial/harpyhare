import type { DemoCopy } from "./demo-types";

export const demoEn: DemoCopy = {
  frameLabel: "Interactive demo of the app interface",
  ask: "Ask by voice:",
  caption:
    "A working mock-up: the answers are pre-recorded and nothing leaves your browser. In the real app this window floats above everything else, and during a screen share only you can see it.",
  disclosure:
    "The app itself currently ships with a Russian interface; this mock-up is translated.",
  newChatTitle: "New chat",
  version: "0.16.0",

  chats: [
    {
      id: "chat-1",
      title: "Interview",
      messages: [
        {
          role: "user",
          text: "How is optimistic locking different from pessimistic locking?",
        },
        {
          role: "assistant",
          text: "Pessimistic locking takes the lock up front: `SELECT … FOR UPDATE`, and everyone else waits. Optimistic locking takes no lock — it reads the row version and, on write, checks the version has not changed, rolling the transaction back if it has.\n\n- Pessimistic when conflicts are frequent and a retry is expensive: charging money, reserving stock.\n- Optimistic when conflicts are rare: editing a profile, a document draft.\n\nMost product scenarios have few conflicts, so I default to optimistic and add a retry at the service level.",
        },
      ],
      followUps: {
        more: "There is a third option people tend to forget — an application-level lock: a Postgres advisory lock or a distributed lock in Redis.\n\n- It is for conflicts that are about a whole operation rather than one row: recomputing warehouse stock, a nightly reconciliation.\n- The price is an external dependency and a mandatory TTL: a lock with no expiry survives a crashed process forever.\n- Inside the database the optimistic version is easier to take from `xmin` than from a counter: the column is already there.\n\nAnd one UX note: when an optimistic transaction rolls back, show the user the fresh data and ask them to retry instead of silently overwriting.",
        shorter:
          "Pessimistic locks the row up front and makes everyone else wait; optimistic checks the version on write and rolls back the conflict. Default to optimistic with a retry, pessimistic only for money and stock.",
        code: "Optimistic locking on a version counter — the whole rule fits in one `UPDATE`:\n\n```sql\nUPDATE orders\n   SET status = 'paid', version = version + 1\n WHERE id = $1 AND version = $2;\n-- 0 rows updated = someone got there first, re-read and retry\n```\n\nPessimistic — the same scenario, but with a lock held to the end of the transaction:\n\n```sql\nBEGIN;\nSELECT * FROM orders WHERE id = $1 FOR UPDATE;\nUPDATE orders SET status = 'paid' WHERE id = $1;\nCOMMIT;\n```",
      },
    },
    {
      id: "chat-2",
      title: "Client call",
      messages: [
        {
          role: "user",
          text: "The client is asking why the integration takes three weeks instead of three days",
        },
        {
          role: "assistant",
          text: "Three days is only the happy path: get a token and send one request.\n\nThe rest of the time goes into everything that shows up in production:\n\n- Retries and idempotency, so a duplicated webhook does not create a second order.\n- Data reconciliation: their catalogue and ours have to agree, otherwise the gaps surface in reports.\n- Monitoring and alerts — otherwise we hear about a broken integration from the client.\n\nI can split it in two: a working end-to-end flow on staging in a week, then resilience and production load.",
        },
      ],
      followUps: {
        more: "Week by week, so the estimate stops looking made up:\n\n- Week one — the end-to-end flow on staging: token, order creation, status webhook. That is the “three days” — plus two for access and agreeing on formats.\n- Week two — resilience: retries with an idempotency key, timeout handling, scheduled catalogue reconciliation.\n- Week three — production: monitoring, alerts, a dashboard of discrepancies and a run at real volume.\n\nIf the date matters more, we cut week three: reconciliation stays manual and alerts go to email. But we say so up front, not quietly.",
        shorter:
          "Three days is one happy request. The rest is retries, reconciliation and monitoring — without them the integration breaks in its first week. Two stages: a working flow on staging in a week, production by week three.",
        code: 'The bulk of the “extra two weeks” is an idempotent webhook receiver, so a retry cannot create a second order:\n\n```ts\nexport async function handleWebhook(event: WebhookEvent) {\n  const key = event.id; // the provider resends the same id on retry\n  const seen = await db.query(\n    "INSERT INTO webhook_log (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id",\n    [key],\n  );\n  if (seen.rowCount === 0) return; // already handled\n  await applyOrderStatus(event.orderId, event.status);\n}\n```\n\nWithout that table every provider retry would turn into a duplicate order.',
      },
    },
    {
      id: "chat-3",
      title: "New chat",
      messages: [],
      followUps: null,
    },
  ],

  prompts: [
    {
      chip: "How would you scale it?",
      question: "So how would you scale the service to a million users?",
      answer:
        "I would start by splitting the load: read replicas for the database, a cache for hot data, a queue for heavy operations. Once writes become the bottleneck — shard by user.\n\n- First I measure instead of guessing: the query profile, the slowest calls, the read-to-write ratio.\n- Then I take the cheap wins: indexes, N+1 queries, batching instead of one call per item.\n- Only after that do I go horizontal, where you start paying for consistency.\n\nA million users on its own says nothing — what matters is how many are active at once and what their load profile looks like.",
      followUps: {
        more: "Each step unpacked:\n\n- Read replicas absorb 80% of the traffic but bring replication lag: right after a write the user may not see their own change. Fixed by reading from the primary for a couple of seconds after a write.\n- Cache only what you can afford to lose: profiles, the catalogue, counters. Invalidate on events, not on TTL, or you get stale data that never refreshes.\n- The queue flattens peaks: reports, emails and recalculations go to the background while the user response stays fast.\n- Sharding comes last: it breaks joins and cross-user transactions, so I pick the key so that 95% of queries stay inside one shard.",
        shorter:
          "Measure first, then take the cheap wins — indexes, N+1, cache and a queue. Horizontal scaling and sharding only once writes become the bottleneck.",
        code: "The most common first step — remove the N+1 and see what the database is actually spending time on:\n\n```sql\n-- before: one query per order\nSELECT * FROM order_items WHERE order_id = $1;\n\n-- after: one query per page of orders\nSELECT * FROM order_items\n WHERE order_id = ANY($1::bigint[])\n ORDER BY order_id, id;\n```\n\nAnd before sharding — check what is really hot:\n\n```sql\nSELECT query, calls, mean_exec_time\n  FROM pg_stat_statements\n ORDER BY total_exec_time DESC\n LIMIT 10;\n```",
      },
    },
    {
      chip: "Hardest bug you fixed",
      question: "Tell me about the hardest bug you have had to fix.",
      answer:
        "A race in token refresh: two parallel requests went for a refresh at the same time, the second one received an already revoked token and logged the user out.\n\nIt only reproduced under load — in the logs it looked like random logouts for about one percent of users.\n\nI fixed it by coalescing: the refresh lives behind a single in-flight promise per user and everyone else awaits its result. Plus a test that deliberately fires two refreshes at once.",
      followUps: {
        more: "How I tracked it down, step by step:\n\n- Statistics first: the logouts were not random — they clustered in the first seconds after a token expired. That already pointed at a race rather than the network.\n- Then tracing: I added a request id to both calls and saw the refresh going out twice, tens of milliseconds apart.\n- Reproduction: it never happened locally, so I wrote a test with an artificial delay in the provider’s response.\n\nAfter the fix I added a “repeated refreshes per minute” metric — a regression now shows on a chart instead of in complaints.",
        shorter:
          "A race in token refresh: two requests went for a refresh at once and the second got a revoked token. Fixed with a single in-flight promise per user and a test that fires two refreshes together.",
        code: "Coalescing parallel refreshes into one request:\n\n```ts\nconst inflight = new Map<string, Promise<Token>>();\n\nexport function refreshToken(userId: string): Promise<Token> {\n  const pending = inflight.get(userId);\n  if (pending) return pending; // the second caller waits for the first\n  const request = doRefresh(userId).finally(() => inflight.delete(userId));\n  inflight.set(userId, request);\n  return request;\n}\n```\n\nThe test fires two `refreshToken` calls at once and asserts `doRefresh` ran exactly once.",
      },
    },
    {
      chip: "Which task queue?",
      question: "Which task queue would you pick, and why?",
      answer:
        "If a queue already exists in the infrastructure, I take it instead of introducing another moving part.\n\n- At small volumes a Postgres table with `SELECT … FOR UPDATE SKIP LOCKED` is enough: transactions, observability and backups are already there.\n- When you need fan-out and replaying the stream — Kafka.\n- When you need delayed jobs and priorities rather than an event stream — RabbitMQ or SQS.\n\nThe deciding factor is not throughput but what happens on failure: what a retry looks like, where the dead-letter queue lives, and how you put a job back by hand.",
      followUps: {
        more: "What I actually look at when choosing:\n\n- Delivery guarantees: at-least-once is almost always enough, but then handlers must be idempotent. Exactly-once is promised by many and delivered by few.\n- Ordering: whether you need it at all. Kafka keeps order within a partition, SQS FIFO within a group, a Postgres table — however you sort it.\n- Delayed jobs and priorities: Kafka has none out of the box, RabbitMQ and SQS do.\n- Operations: who fixes it at three in the morning. A Postgres table is fixed with the same SQL as everything else.\n\nSo I start with Postgres and migrate only when the numbers demand it.",
        shorter:
          "Take what the infrastructure already has. To start — a Postgres table with SKIP LOCKED; Kafka for fan-out and replay; RabbitMQ or SQS for delayed jobs and priorities.",
        code: "A queue on a Postgres table — a worker claims a job without blocking its neighbours:\n\n```sql\nWITH next AS (\n  SELECT id FROM jobs\n   WHERE status = 'queued' AND run_at <= now()\n   ORDER BY priority DESC, run_at\n   FOR UPDATE SKIP LOCKED\n   LIMIT 1\n)\nUPDATE jobs j\n   SET status = 'running', started_at = now()\n  FROM next\n WHERE j.id = next.id\nRETURNING j.*;\n```\n\nAfter three failures the job moves to `status = 'dead'` — that is the dead-letter queue without a separate system.",
      },
    },
  ],

  fallbackAnswer:
    "This is a demo copy of the interface: the answers here are pre-recorded and no request reaches Claude.\n\nIn the app a real answer streams into this spot — driven by the system audio of a call, a lecture or a video, with the chat history and the selected pre-prompt.",

  launcher: {
    statusReady: "Ready to launch",
    statusLaunching: "Starting the main window…",
    launch: "Launch",
    launching: "Starting…",
    screens: {
      contexts: {
        label: "Contexts",
        description: "Reference material you can mix into a chat's system prompt.",
      },
      presets: {
        label: "Pre-prompts",
        description: "Text that goes at the very start of the system prompt.",
      },
      settings: {
        label: "Settings",
        description: "API access, speech recognition, keys, behaviour and appearance.",
      },
      permissions: {
        label: "Permissions",
        description: "System permissions without which parts of the app do not work.",
      },
      updates: {
        label: "Updates",
        description: "The installed version and how to get a newer one.",
      },
    },
    settings: {
      groups: {
        api: { title: "API access", description: "Your own keys or an access code." },
        stt: {
          title: "Speech recognition",
          description: "What to listen to, and from where, while the record key is held.",
        },
        hotkeys: {
          title: "Keyboard shortcuts",
          description: "Any combination; conflicts are resolved for you.",
        },
        window: {
          title: "Window",
          description: "How to move and resize the window from the keyboard.",
        },
        behavior: { title: "Behaviour" },
        appearance: { title: "Appearance" },
      },
      anthropicKey: "Anthropic key",
      groqKey: "Groq key",
      groqKeyHint: "Speech recognition",
      language: "Language",
      languages: ["Auto-detect", "Russian", "English"],
      translate: "Translate into English",
      captureDevice: "Capture device",
      captureDevices: ["System default", "MacBook Pro Speakers", "AirPods Pro"],
      buffer: "Background buffer",
      bufferHint: "Picks up what was said before you pressed the record key",
      bufferLength: "Buffer length",
      secondsUnit: "s",
      hotkeys: [
        {
          label: "Record a question",
          hint: "Hold while the other person is speaking",
          combo: "F9",
        },
        { label: "Show / hide the window", combo: "⌘⇧ H" },
        { label: "Teleprompter", combo: "F10" },
        { label: "Capture a screen region", combo: "⌘⇧ S" },
      ],
      moveModifier: "Move modifier",
      moveStep: "Move step",
      screenShareVisible: "Visible during screen sharing",
      screenShareVisibleHint: "By default the window stays out of any capture",
      autoSend: "Send as soon as the transcript is ready",
      autoPreview: "Open the HTML preview of an answer",
      theme: "Theme",
      themes: { gray: "Grey", black: "Black" },
      chatFontSize: "Chat text size",
    },
    contexts: {
      addFile: "Add a file",
      addFolder: "Folder",
      selectedCount: "Selected",
      remove: "Remove material",
      folders: ["Project Atlas", "General"],
      docs: [
        {
          id: "d1",
          name: "Service architecture.md",
          size: "18 KB",
          folder: "Project Atlas",
          text: "The service is split in three: an API gateway, queue workers and a scheduler. The gateway owns HTTP and auth, workers pull jobs from Postgres with SKIP LOCKED, the scheduler enqueues delayed jobs once a minute. The parts talk only through the database and the queue — no direct calls.",
        },
        {
          id: "d2",
          name: "Schema and migrations.md",
          size: "9 KB",
          folder: "Project Atlas",
          text: "Tables: orders, order_items, payments. Migrations go through sqitch and every one must be reversible. The version column on orders is there for optimistic locking: updates run with WHERE version = $expected.",
        },
        {
          id: "d3",
          name: "Contract — SLA.pdf",
          size: "240 KB",
          folder: "Project Atlas",
          text: "Availability 99.9% per month, incident response within 30 minutes, recovery within 4 hours. Planned maintenance is agreed 48 hours ahead. Penalty: 5% of the monthly fee per hour of downtime beyond the limit.",
        },
        {
          id: "d4",
          name: "Resume.pdf",
          size: "86 KB",
          folder: "General",
          text: "Backend engineer, 6 years. Go and TypeScript, Postgres and Kafka. The last two years — a payments platform: idempotent webhooks, bank reconciliation, migrating a monolith to services without pausing sales.",
        },
        {
          id: "d5",
          name: "Glossary.md",
          size: "4 KB",
          folder: "General",
          text: "Idempotency — retrying a request with the same key yields the same result. Dead-letter — the queue a job lands in after its retries are exhausted. Fan-out — one event delivered to several consumers.",
        },
      ],
    },
    presets: {
      add: "Add a pre-prompt",
      activeBadge: "used in new chats",
      items: [
        {
          name: "Speech transcript",
          text: "Answer briefly and to the point. The user's text is a transcript of someone else's speech and may contain recognition errors: reconstruct the meaning instead of asking again.",
        },
        {
          name: "Interview",
          text: "You are helping in a technical interview. Answer in the first person, as the candidate: a short claim first, then two or three supporting points. No filler, no preambles.",
        },
        {
          name: "Client call",
          text: "Phrase the answer so it can be said out loud: no lists of jargon, plain sentences, concrete timelines and next steps.",
        },
      ],
    },
    permissions: {
      group: {
        title: "System permissions",
        description:
          "Requested only when you press the button — macOS prompts never appear on their own.",
      },
      optionalBadge: "optional",
      granted: "Permission granted",
      openSettings: "Settings",
      grant: "Grant",
      items: [
        {
          id: "audio",
          label: "System audio recording",
          hint: "Without it the app cannot hear the other person — launching is blocked.",
          required: true,
        },
        {
          id: "screen",
          label: "Screen recording",
          hint: "Only needed for capturing a screen region.",
          required: false,
        },
      ],
    },
    updates: {
      group: { title: "Version", description: "Updates arrive as a signed bundle." },
      checking: "Checking…",
      latest: "You are on the latest version",
      auto: "Checked automatically every six hours",
      check: "Check",
    },
  },

  hud: {
    thinking: "Thinking…",
    secondsSuffix: "s",
    empty: {
      title: "The chat will appear here",
      recordHint: "hold — records and transcribes speech",
      screenshotHint: "a screen region straight into the question",
    },
    jumpToBottom: "↓ Down",
    modes: {
      chat: { label: "Chat", description: "Conversation with the model" },
      notes: { label: "Notes", description: "Search your own material" },
      modePrefix: "Mode: ",
    },
    tabs: {
      nav: "Chats",
      chat: "Chat",
      closeChat: "Close the chat together with its history",
      newChat: "New chat",
      duplicate: "Duplicate chat — same settings, no messages",
    },
    dock: {
      open: "Actions",
      close: "Close actions",
      copyLast: "Copy the last answer",
      teleprompter: "Teleprompter",
      models: "Models",
      screenShareVisible: "Visible in screen share — click to hide",
      screenShareHidden: "Hidden from screen share — click to show",
      hotkeys: "Keyboard shortcuts",
      mini: "Collapse to mini mode",
      stop: "Stop — back to the launcher",
    },
    contextUsage: "Chat context: used by the last request",
    message: {
      copy: "Copy message",
      resend: "Resend (everything below is replaced by a new answer)",
      remove: "Delete message",
    },
    code: {
      lines: ["line", "lines", "lines"],
      wrapOn: "Wrap long lines",
      wrapOff: "Do not wrap lines",
      copy: "Copy block",
      copied: "Copied",
      unknown: "code",
    },
    hotkeyGroups: [
      {
        title: "Recording",
        rows: [
          { label: "record system audio", combo: "⌘R" },
          { label: "cancel recording", combo: "Esc" },
        ],
      },
      {
        title: "Sending",
        rows: [
          { label: "send", combo: "⌘⏎" },
          { label: "stop the answer", combo: "Esc" },
          { label: "capture a screen region", combo: "⌘⇧S" },
          { label: "quick action", combo: "⌘ 1…9" },
          { label: "focus the input", combo: "⌘⇧D" },
          { label: "send from the input", combo: "⏎" },
          { label: "new line", combo: "⇧⏎" },
          { label: "paste a screenshot", combo: "⌘V" },
        ],
      },
      {
        title: "Window",
        rows: [
          { label: "collapse or expand", combo: "⌘⇧H" },
          { label: "move", combo: "⌘ ←→↑↓" },
          { label: "resize", combo: "⌘⇧ ←→↑↓" },
          { label: "opacity", combo: "⌘⇧ + −" },
        ],
      },
      {
        title: "Chat",
        rows: [
          { label: "font size", combo: "⌘ [ ]" },
          { label: "scroll the chat", combo: "⌥ ←→↑↓" },
          { label: "duplicate chat", combo: "⌘⇧N" },
          { label: "model menu", combo: "⌘⇧M" },
          { label: "teleprompter", combo: "⌘T" },
        ],
      },
      {
        title: "Notes",
        rows: [
          { label: "notes mode", combo: "⌘⇧L" },
          { label: "through search suggestions", combo: "↑↓" },
          { label: "open a note", combo: "⏎" },
          { label: "step back, up to the chat", combo: "Esc" },
        ],
      },
      {
        title: "Teleprompter",
        rows: [
          { label: "close the teleprompter", combo: "Esc" },
          { label: "pause", combo: "␣" },
        ],
      },
    ],
    quickActions: [
      { id: "more", title: "More detail", prompt: "Tell me more" },
      { id: "shorter", title: "Shorter", prompt: "Make it shorter" },
      { id: "code", title: "Code example", prompt: "Show me a code example" },
    ],
    quickActionModifier: "⌘",
    composer: {
      placeholder: "The transcript lands here — or type a question yourself",
      clearHistory: "Clear the chat history",
      chatContext: "Chat context",
      screenshot: "Capture a screen region",
      requestParams: "Request parameters",
      stopAnswer: "Stop the answer",
      send: "Send",
      sendShortcut: "⏎",
      model: "Model",
      thinking: "Thinking",
      webSearch: "Web search",
      preset: "Pre-prompt",
      noPreset: "No pre-prompt",
      presets: ["Speech transcript", "Interview", "Client call"],
      missingKey: "no key",
    },
    models: {
      title: "Models",
      searchPlaceholder: "Find a model…",
      empty: "Nothing found.",
      voiceHeading: "Voice model",
      answerHeading: "Answer model",
      voice: [
        { id: "groq", label: "Groq · Whisper", locked: false },
        { id: "openai", label: "OpenAI · gpt-4o mini", locked: false },
        { id: "xai", label: "Grok · Speech-to-Text", locked: true },
        { id: "deepgram", label: "Deepgram · Nova-3", locked: true },
      ],
      groups: [
        {
          id: "anthropic",
          label: "Claude",
          locked: false,
          models: [
            { id: "claude-opus-4-8", label: "Opus 4.8" },
            { id: "claude-sonnet-5", label: "Sonnet 5" },
            { id: "claude-haiku-4-5", label: "Haiku 4.5" },
          ],
        },
        {
          id: "openai",
          label: "OpenAI",
          locked: false,
          models: [
            { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
            { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
            { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
            { id: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
            { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
          ],
        },
        {
          id: "xai",
          label: "Grok",
          locked: true,
          models: [
            { id: "grok-4.6", label: "Grok 4.6" },
            { id: "grok-4.5", label: "Grok 4.5" },
            { id: "grok-4.3", label: "Grok 4.3" },
          ],
        },
      ],
    },
    context: {
      title: "Chat context",
      fromLibrary: "From the library",
      selectedCount: "selected",
      ownText: "Your own text",
      ownTextHint:
        "Reference text unique to this chat — goes into the system prompt of every request together with the selected material.",
      ownTextPlaceholder: "Paste reference material here",
      cancel: "Cancel",
      save: "Save",
    },
    teleprompter: {
      empty: "No answer for the teleprompter",
      pause: "Pause",
      play: "Play",
      restart: "From the top",
      speed: "Speed",
      font: "Font",
      close: "Close",
    },
    mini: {
      recording: "Recording",
      transcribing: "Transcribing…",
      streaming: "Answering…",
      unread: "Answer ready",
      expand: "Expand the window",
    },
    notes: {
      searchPlaceholder: "Search notes",
      importTitle: "Add files to notes",
      nothingFound: "Nothing found",
      nothingFoundHint: "Search matches word prefixes and forgives a typo.",
      addToContext: "Add to chat context",
      removeFromContext: "Remove from chat context",
      back: "Back to the list (Esc)",
      copy: "Copy the note text",
      matches: "Matches:",
      noFolder: "No folder",
    },
  },
};
