import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeAccessCode } from "@/lib/access-code";

export interface AccessCodeFormProps {
  onRedeem: (code: string) => Promise<string | null>;
  autoFocus?: boolean;
}

export function AccessCodeForm({ onRedeem, autoFocus }: AccessCodeFormProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmpty = normalizeAccessCode(code) === "";

  const activate = () => {
    if (submitting || isEmpty) return;
    setSubmitting(true);
    setError(null);
    void onRedeem(code)
      .then((message) => {
        setError(message);
        if (message === null) setCode("");
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          value={code}
          disabled={submitting}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") activate();
          }}
        />
        <Button onClick={activate} disabled={submitting || isEmpty}>
          {submitting ? t("launcher.access.activating") : t("launcher.access.activate")}
        </Button>
      </div>
      {error !== null && <span className="text-caption text-destructive">{error}</span>}
    </div>
  );
}
