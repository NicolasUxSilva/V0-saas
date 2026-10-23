"use client";

/**
 * Shell da aplicação (bloco A3): sidebar de navegação + topbar.
 *
 * Deliberadamente enxuto e neutro, no estilo de referência (trysoro.com):
 * sidebar clara com itens arredondados (ativo em cinza), cabeçalho flutuante e
 * seletor de tema (Claro / Escuro / Sistema) no menu do usuário. Ver
 * docs/design-system.md.
 */
import { LayoutDashboard, LogOut, Megaphone, Plug, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Logo } from "@/components/brand/logo";
import { ThemeMenuGroup } from "@/components/theme-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/diagnostico", label: "Diagnóstico", icon: LayoutDashboard },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/advisor", label: "Advisor", icon: Sparkles },
  { href: "/conexoes", label: "Conexões", icon: Plug },
] as const;

export interface AppShellUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface AppShellProps {
  children: React.ReactNode;
  user: AppShellUser;
  workspaceName: string;
  lastSyncLabel?: string | null;
  signOutAction: () => void | Promise<void>;
}

function initials(user: AppShellUser): string {
  const base = user.name?.trim() || user.email?.trim() || "?";
  const parts = base.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

export function AppShell({
  children,
  user,
  workspaceName,
  lastSyncLabel,
  signOutAction,
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-[4.5rem] items-center px-5">
          <Link
            href="/"
            aria-label="The Seed — início"
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Logo className="h-5" />
          </Link>
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 transition-colors",
                    active && "text-sidebar-primary",
                  )}
                  aria-hidden
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabeçalho flutuante: cartão arredondado com borda fina. */}
        <div className="sticky top-0 z-20 bg-background px-6 pt-4 pb-2">
          <header className="flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 shadow-xs">
            <span className="truncate text-sm font-medium">{workspaceName}</span>
            <span className="ml-auto rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              {lastSyncLabel ?? "Sem sincronização"}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Menu do usuário"
              >
                <Avatar size="sm">
                  {user.image ? (
                    <AvatarImage src={user.image} alt="" />
                  ) : null}
                  <AvatarFallback>{initials(user)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <span className="block text-sm font-medium">
                    {user.name ?? "Usuário"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {user.email ?? "—"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ThemeMenuGroup />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void signOutAction()}
                >
                  <LogOut className="size-4" aria-hidden />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
        </div>

        <main className="min-w-0 flex-1 px-6 pt-8 pb-12">{children}</main>
      </div>
    </div>
  );
}
