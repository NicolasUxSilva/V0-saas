"use client";

/**
 * Sistema de estados reutilizável (bloco A3).
 *
 * Toda tela que carrega dados usa estes quatro componentes, sempre com o mesmo
 * visual e a mesma semântica:
 *  - LoadingState  : esqueleto enquanto carrega
 *  - EmptyState    : sem dados ainda, com um CTA
 *  - ErrorState    : falhou, com "tentar de novo"
 *  - PartialState  : carregou, mas incompleto (faixa de aviso, não tela cheia)
 */
import type { LucideIcon } from "lucide-react";
import { Inbox, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function StateShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LoadingState({
  label = "Carregando…",
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <StateShell>
      <Icon className="size-6 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </StateShell>
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  description,
  retryable = true,
  onRetry,
}: {
  title?: string;
  description?: string;
  retryable?: boolean;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const retry = onRetry ?? (() => router.refresh());
  return (
    <StateShell className="border-destructive/40">
      <TriangleAlert className="size-6 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {retryable ? (
        <Button variant="outline" size="sm" onClick={retry}>
          <RefreshCw className="size-4" />
          Tentar de novo
        </Button>
      ) : null}
    </StateShell>
  );
}

export function PartialState({
  description = "Alguns dados podem estar incompletos.",
  retryable = false,
  onRetry,
}: {
  description?: string;
  retryable?: boolean;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const retry = onRetry ?? (() => router.refresh());
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
      <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />
      <span className="text-muted-foreground">{description}</span>
      {retryable ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7"
          onClick={retry}
        >
          Atualizar
        </Button>
      ) : null}
    </div>
  );
}
