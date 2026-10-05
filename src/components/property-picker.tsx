"use client";

/**
 * Seletor de propriedade GA4 (bloco B2). Radio controlado: ao trocar, chama a
 * server action `selecionarPropriedade`; o `revalidatePath` re-renderiza a
 * página com o novo estado.
 */
import { useTransition } from "react";

import { selecionarPropriedade } from "@/app/(app)/conexoes/actions";

interface PropertyRow {
  id: string;
  externalId: string;
  displayName: string;
  timezone: string | null;
  isSelected: boolean;
}

export function PropertyPicker({ properties }: { properties: PropertyRow[] }) {
  const [pending, startTransition] = useTransition();

  if (properties.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma propriedade GA4 encontrada nesta conta.
      </p>
    );
  }

  return (
    <fieldset className="space-y-2" disabled={pending}>
      <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Propriedade a analisar
      </legend>
      {properties.map((p) => (
        <label
          key={p.id}
          className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[:checked]:border-foreground/40 has-[:checked]:bg-muted/40"
        >
          <input
            type="radio"
            name="ga4-property"
            className="mt-0.5"
            checked={p.isSelected}
            onChange={() =>
              startTransition(() => selecionarPropriedade(p.externalId))
            }
          />
          <span className="min-w-0">
            <span className="block font-medium">{p.displayName}</span>
            <span className="block text-xs text-muted-foreground">
              {p.externalId}
              {p.timezone ? ` · ${p.timezone}` : ""}
            </span>
          </span>
        </label>
      ))}
      {pending ? (
        <p className="text-xs text-muted-foreground">Salvando seleção…</p>
      ) : null}
    </fieldset>
  );
}
