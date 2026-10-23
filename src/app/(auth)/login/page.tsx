import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { ThemeToggleGroup } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { getSession, signIn } from "@/server/auth";

export const metadata = { title: "Entrar — The Seed" };

export default async function LoginPage() {
  const session = await getSession();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm space-y-8">
        <Logo className="h-7" />
        <div className="space-y-1">
          <h1 className="font-heading text-title">Entrar</h1>
          <p className="text-sm text-muted-foreground">
            Entre para acessar o diagnóstico.
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" size="lg" className="w-full">
            Entrar com Google
          </Button>
        </form>
      </div>
      <ThemeToggleGroup className="mt-16" />
    </main>
  );
}
