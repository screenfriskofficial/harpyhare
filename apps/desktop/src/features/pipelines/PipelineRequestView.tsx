import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessageDto } from "@/ipc/types";
import type { PipelineModelRequest } from "@/lib/pipeline-types";

/** Raw request text, kept literal on purpose: what the model receives is exactly this. */
function RequestText({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-md bg-background p-2 font-sans text-caption leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function RequestMessage({ message }: { message: ChatMessageDto }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-hint text-muted-foreground">{t(`pipelines.roles.${message.role}`)}</p>
      <RequestText>{message.text || t("pipelines.editor.emptyText")}</RequestText>
      {message.images.length > 0 && (
        <p className="text-caption text-muted-foreground">
          {t("pipelines.editor.images")}: {message.images.length}
        </p>
      )}
    </div>
  );
}

/** Images stay as counts; raw payloads make the inspector unreadable and expose no useful input. */
export function PipelineRequestView({
  request,
  complete,
  executed,
}: {
  request: PipelineModelRequest;
  complete: boolean;
  executed: boolean;
}) {
  const { t } = useTranslation();
  const history = request.messages.slice(0, -1);
  const user = request.messages.at(-1);
  const onOff = (enabled: boolean) =>
    enabled ? t("pipelines.editor.enabled") : t("pipelines.editor.disabled");
  return (
    <details open className="rounded-md border bg-surface p-2">
      <summary className="text-body font-medium">
        {executed ? t("pipelines.editor.requestSent") : t("pipelines.editor.requestPreview")}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {!complete ? (
          <p className="text-caption text-muted-foreground">
            {t("pipelines.editor.requestPartial")}
          </p>
        ) : (
          !executed && (
            <p className="text-caption text-muted-foreground">
              {t("pipelines.editor.requestReady")}
            </p>
          )
        )}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-caption">
          <dt className="text-muted-foreground">{t("pipelines.editor.model")}</dt>
          <dd className="break-words">{request.model}</dd>
          <dt className="text-muted-foreground">{t("pipelines.editor.thinking")}</dt>
          <dd>{onOff(request.options.thinking)}</dd>
          <dt className="text-muted-foreground">{t("pipelines.editor.web")}</dt>
          <dd>{onOff(request.options.webSearch)}</dd>
        </dl>
        <div className="flex flex-col gap-1.5">
          <h4 className="text-caption font-medium">{t("pipelines.editor.requestSystem")}</h4>
          <RequestText>{request.system || t("pipelines.editor.emptyText")}</RequestText>
        </div>
        <details>
          <summary className="text-caption font-medium">
            {t("pipelines.editor.requestHistory")}: {history.length}
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {history.map((message, index) => (
              <RequestMessage key={index} message={message} />
            ))}
          </div>
        </details>
        <div className="flex flex-col gap-1.5">
          <h4 className="text-caption font-medium">{t("pipelines.editor.requestUser")}</h4>
          {user ? (
            <RequestMessage message={user} />
          ) : (
            <p className="text-caption text-muted-foreground">{t("pipelines.editor.emptyText")}</p>
          )}
        </div>
      </div>
    </details>
  );
}
