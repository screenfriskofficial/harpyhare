import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 rounded-[var(--window-radius)] bg-black/55 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:fill-mode-forwards data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

const PANEL_VIEWPORT_MAX_WIDTH = "95vw";

/** Ширина панели инлайном: Tailwind не соберёт `max-w-[min(Npx,95vw)]` из переменной. */
function panelMaxWidth(widthPx: number): string {
  return `min(${String(widthPx)}px, ${PANEL_VIEWPORT_MAX_WIDTH})`;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  panelWidthPx,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /** Желаемая ширина панели; на узком окне ограничена шириной вьюпорта. */
  panelWidthPx?: number;
}) {
  const { t } = useTranslation();
  const outsideCloseRef = React.useRef<HTMLButtonElement>(null);
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className="group fixed inset-0 z-50 flex items-center justify-center duration-200 outline-none data-[state=closed]:animate-out"
        {...props}
        onPointerDown={(e) => {
          props.onPointerDown?.(e);
          if (e.defaultPrevented) return;
          if (e.target === e.currentTarget) outsideCloseRef.current?.click();
        }}
      >
        <DialogPrimitive.Close ref={outsideCloseRef} aria-hidden tabIndex={-1} className="hidden" />
        <div
          data-slot="dialog-panel"
          style={panelWidthPx === undefined ? undefined : { maxWidth: panelMaxWidth(panelWidthPx) }}
          className={cn(
            "pointer-events-auto relative grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] gap-3.5 overflow-y-auto rounded-xl border bg-popover p-5 shadow-modal duration-200 outline-none group-data-[state=closed]:animate-out group-data-[state=closed]:fade-out-0 group-data-[state=closed]:fill-mode-forwards group-data-[state=closed]:zoom-out-95 group-data-[state=open]:animate-in group-data-[state=open]:fade-in-0 group-data-[state=open]:zoom-in-95 sm:max-w-lg",
            className,
          )}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="absolute top-4 right-4 rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t("common.close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title leading-none font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-body text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
