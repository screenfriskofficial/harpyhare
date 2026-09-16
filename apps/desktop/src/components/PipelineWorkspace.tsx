import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { SettingSelect } from "@/features/launcher/fields";
import { PipelineEditor } from "@/features/pipelines/PipelineEditor";
import { usePreparationDependency } from "@/features/pipelines/usePreparationDependency";
import { usePipelineRun } from "@/hooks/usePipelineRun";
import type { PipelinesApi } from "@/hooks/usePipelines";
import type { ModelInfo } from "@/lib/models";
import type { Pipeline, PipelineInput, PipelineKind } from "@/lib/pipeline-types";
import { createPipeline, pipelinesOfKind, semanticPipelineFingerprint } from "@/lib/pipelines";
import { Button } from "./ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "./ui/form";
import { Input } from "./ui/input";
import { SelectItem } from "./ui/select";

interface Props {
  api: PipelinesApi;
  /** The launcher's view of the library and presets; no chat, no message. */
  input: PipelineInput;
  models: ModelInfo[];
}

const NO_PREPARATION_VALUE = "none";

/** The two inputs of a test run; neither is saved. */
interface TestRunForm {
  sample: string;
  preparationId: string;
}

const TEST_RUN_DEFAULTS: TestRunForm = { sample: "", preparationId: "" };

/** Which pipeline the last test run was for; its fingerprint is known once the input was resolved. */
interface RunAttempt {
  pipelineId: string;
  fingerprint?: string;
}

/**
 * The builder screen of the launcher. Pipelines are edited and test-run here;
 * a chat picks them in the HUD's request parameters. A message pipeline that
 * reads the chat context can be tested together with a prompt pipeline, the
 * way the HUD chains them on send.
 */
export function PipelineWorkspace({ api, input, models }: Props) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState("");
  const [removed, setRemoved] = useState<Pipeline | null>(null);
  const run = usePipelineRun();
  const preparationRun = usePipelineRun();
  const busy = run.busy || preparationRun.busy;
  const [attempt, setAttempt] = useState<RunAttempt | undefined>();
  const selected =
    api.library.pipelines.find((item) => item.id === selectedId) ?? api.library.pipelines[0];
  // A message node reads the sample; a pipeline without one runs on an empty
  // input just fine. The requirement is shown on the field itself, at once —
  // a disabled Run button says nothing about which field is holding it back.
  const needsMessage =
    selected?.kind === "message" &&
    selected.nodes.some((node) => node.kind === "message" && node.enabled);
  const schema = useMemo(
    () =>
      z
        .object({ sample: z.string(), preparationId: z.string() })
        .refine((values) => !needsMessage || values.sample.trim() !== "", {
          path: ["sample"],
          message: t("pipelines.workspace.sampleRequired"),
        }),
    [needsMessage, t],
  );
  const form = useForm<TestRunForm>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: TEST_RUN_DEFAULTS,
  });
  const { sample, preparationId } = form.watch();
  useEffect(() => {
    void form.trigger("sample");
  }, [form, schema]);
  const testInput = useMemo<PipelineInput>(
    () =>
      sample.trim() === ""
        ? input
        : {
            ...input,
            message: { role: "user", text: sample, images: input.message?.images ?? [] },
          },
    [input, sample],
  );
  const { readsChatContext, dependency, preparation, effectiveInput, resolveInput } =
    usePreparationDependency(
      api.library.pipelines,
      selected,
      preparationId,
      testInput,
      preparationRun,
    );
  const execute = async () => {
    if (!selected || busy) return;
    setAttempt({ pipelineId: selected.id });
    const executionInput = await resolveInput();
    if (!executionInput) return;
    setAttempt({
      pipelineId: selected.id,
      fingerprint: semanticPipelineFingerprint(selected, executionInput),
    });
    await run.run(selected, executionInput);
  };
  // A run's progress, result, failure and staleness belong to the pipeline it
  // was started for; another pipeline opens on a clean slate.
  const ownAttempt =
    attempt !== undefined && attempt.pipelineId === selected?.id ? attempt : undefined;

  if (api.error)
    return (
      <div role="alert" className="space-y-3 text-body">
        <p>{api.error}</p>
        <Button onClick={api.reload}>{t("pipelines.workspace.retryLoad")}</Button>
      </div>
    );
  if (!api.loaded)
    return (
      <p role="status" className="text-body text-muted-foreground">
        {t("pipelines.workspace.loading")}
      </p>
    );

  const add = (kind: PipelineKind) => {
    const pipeline = createPipeline(
      kind,
      kind === "prompt" ? t("pipelines.workspace.newPrompt") : t("pipelines.workspace.newMessage"),
    );
    pipeline.nodes = pipeline.nodes.map((node) => ({
      ...node,
      name: t(`pipelines.nodeTypes.${node.kind}`),
    }));
    api.put(pipeline);
    setSelectedId(pipeline.id);
  };
  const prompts = pipelinesOfKind(api.library.pipelines, "prompt");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {selected ? (
            <SettingSelect
              size="default"
              ariaLabel={t("pipelines.workspace.pipeline")}
              value={selected.id}
              disabled={busy}
              onValueChange={setSelectedId}
            >
              {api.library.pipelines.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id}>
                  {pipeline.name || t("common.unnamed")} ·{" "}
                  {t(`pipelines.workspace.kind.${pipeline.kind}`)}
                </SelectItem>
              ))}
            </SettingSelect>
          ) : (
            <p className="text-body text-muted-foreground">{t("pipelines.workspace.none")}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            add("prompt");
          }}
        >
          <Plus />
          {t("pipelines.workspace.addPrompt")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            add("message");
          }}
        >
          <Plus />
          {t("pipelines.workspace.addMessage")}
        </Button>
        {selected && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title={t("pipelines.workspace.remove")}
            aria-label={t("pipelines.workspace.remove")}
            onClick={() => {
              setRemoved(selected);
              api.remove(selected.id);
            }}
          >
            <Trash2 />
          </Button>
        )}
        {removed && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              api.put(removed);
              setSelectedId(removed.id);
              setRemoved(null);
            }}
          >
            <Undo2 />
            {t("pipelines.workspace.undoRemove")}
          </Button>
        )}
      </div>
      {!selected ? (
        <div className="rounded-lg border border-dashed p-6 text-body text-muted-foreground">
          {t("pipelines.workspace.empty")}
        </div>
      ) : (
        <>
          <Input
            aria-label={t("pipelines.workspace.name")}
            disabled={busy}
            value={selected.name}
            onChange={(event) => {
              api.put({ ...selected, name: event.target.value });
            }}
          />
          {selected.kind === "message" && (
            <Form {...form}>
              <form
                className="grid items-start gap-2 md:grid-cols-2"
                onSubmit={(event) => {
                  void form.handleSubmit(() => execute())(event);
                }}
              >
                <FormField
                  control={form.control}
                  name="sample"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("pipelines.workspace.sample")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={busy}
                          placeholder={t("pipelines.workspace.samplePlaceholder")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {readsChatContext && (
                  <FormField
                    control={form.control}
                    name="preparationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("pipelines.workspace.preparation")}</FormLabel>
                        <SettingSelect
                          size="default"
                          ariaLabel={t("pipelines.workspace.preparation")}
                          value={dependency ? dependency.id : NO_PREPARATION_VALUE}
                          disabled={busy}
                          onValueChange={(value) => {
                            field.onChange(value === NO_PREPARATION_VALUE ? "" : value);
                          }}
                        >
                          <SelectItem value={NO_PREPARATION_VALUE}>
                            {t("pipelines.workspace.noPreparation")}
                          </SelectItem>
                          {prompts.map((pipeline) => (
                            <SelectItem key={pipeline.id} value={pipeline.id}>
                              {pipeline.name || t("common.unnamed")}
                            </SelectItem>
                          ))}
                        </SettingSelect>
                      </FormItem>
                    )}
                  />
                )}
              </form>
            </Form>
          )}
          {dependency && (
            <p role="status" className="text-caption text-muted-foreground">
              {preparationRun.busy
                ? t("pipelines.workspace.preparing")
                : preparation
                  ? t("pipelines.workspace.prepared", { name: dependency.name })
                  : t("pipelines.workspace.preparationPending", { name: dependency.name })}
            </p>
          )}
          <PipelineEditor
            // A remount resets selection, panels and undo history with the pipeline.
            key={selected.id}
            pipeline={selected}
            onChange={api.put}
            input={effectiveInput}
            models={models}
            busy={busy}
            results={ownAttempt ? run.results : undefined}
            result={ownAttempt ? run.result : null}
            error={ownAttempt ? (preparationRun.error ?? run.error) : null}
            resultFingerprint={ownAttempt?.fingerprint}
            onRun={() => {
              void execute();
            }}
            onCancel={() => {
              preparationRun.cancel();
              run.cancel();
            }}
          />
        </>
      )}
    </div>
  );
}
