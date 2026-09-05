import { useEffect, useRef, useState } from "react";
import { setPreviewHtml } from "@/ipc/commands";
import { previewUrl } from "@/ipc/preview";

/**
 * HTML уходит в Rust, а iframe получает URL с номером версии: ответ старой
 * отправки, пришедший после новой, не должен подменить свежее превью.
 */
export function usePreviewSrc(html: string): string {
  const [src, setSrc] = useState("");
  const nonce = useRef(0);

  useEffect(() => {
    if (html === "") {
      setSrc("");
      return;
    }
    nonce.current += 1;
    const version = nonce.current;
    void setPreviewHtml(html).then(() => {
      if (version === nonce.current) setSrc(previewUrl(version));
    });
  }, [html]);

  return src;
}
