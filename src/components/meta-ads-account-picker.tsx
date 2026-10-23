"use client";

/**
 * Seletor de conta de anúncios do Meta Ads. Espelha o `GoogleAdsAccountPicker`: radio
 * controlado; ao trocar, chama `selecionarContaMetaAds`; o `revalidatePath` re-renderiza
 * a página com o novo estado.
 */
import { useTransition } from "react";

import { selecionarContaMetaAds } from "@/app/(app)/conexoes/actions";

interface AccountRow {
  id: string;
  externalId: string;
  displayName: string;
  timezone: string | null;
  currency: string | null;
  isSelected: boolean;
}

export function MetaAdsAccountPicker({ accounts }: { accounts: AccountRow[] }) {
  const [pending, startTransition] = useTransition();

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma conta de anúncios encontrada para esta autorização. Confirme que o usuário que
        autorizou tem acesso a uma conta de anúncios e reconecte.
      </p>
    );
  }

  return (
    <fieldset className="space-y-2" disabled={pending}>
      <legend className="text-label text-muted-foreground">
        Conta de anúncios a analisar
      </legend>
      {accounts.map((a) => (
        <label
          key={a.id}
          className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[:checked]:border-foreground/40 has-[:checked]:bg-muted/40"
        >
          <input
            type="radio"
            name="meta-ads-account"
            className="mt-0.5"
            checked={a.isSelected}
            onChange={() => startTransition(() => selecionarContaMetaAds(a.externalId))}
          />
          <span className="min-w-0">
            <span className="block font-medium">{a.displayName}</span>
            <span className="block text-xs text-muted-foreground">
              {a.externalId}
              {a.timezone ? ` · ${a.timezone}` : ""}
              {a.currency ? ` · ${a.currency}` : ""}
            </span>
          </span>
        </label>
      ))}
      {pending ? <p className="text-xs text-muted-foreground">Salvando seleção…</p> : null}
    </fieldset>
  );
}
