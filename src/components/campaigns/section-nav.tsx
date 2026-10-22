/**
 * Navegação interna da área Campanhas: a lista de campanhas e o diagnóstico delas são
 * duas vistas dos MESMOS dados e do mesmo período — o link leva os filtros junto.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";

export function CampaignsSectionNav({ active, query }: { active: "list" | "diagnostics"; query: string }) {
  const item = (key: "list" | "diagnostics", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active === key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex gap-1 border-b pb-2" aria-label="Seções de Campanhas">
      {item("list", `/campanhas${query}`, "Campanhas")}
      {item("diagnostics", `/campanhas/diagnosticos${query}`, "Diagnóstico")}
    </nav>
  );
}
