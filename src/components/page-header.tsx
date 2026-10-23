import { cn } from "@/lib/utils";

/**
 * Cabeçalho de página (Design System v1.0).
 *
 * Título em `font-heading` (Cal Sans, peso 400) e em caixa normal; descrição em
 * cinza. Uma ação principal por tela vai em `actions`. Títulos de seção usam
 * `font-heading text-heading` direto no `<h2>`.
 */
export function PageHeader({
  title,
  description,
  badge,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="space-y-1.5">
        <h1 className="flex flex-wrap items-center gap-2 font-heading text-title">
          {title}
          {badge}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
