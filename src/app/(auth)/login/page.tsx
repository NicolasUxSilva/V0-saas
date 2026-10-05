import { redirect } from "next/navigation";

import { getSession, signIn } from "@/server/auth";

export const metadata = { title: "Entrar — v0-saas" };

const wrap: React.CSSProperties = {
  maxWidth: "22rem",
  margin: "0 auto",
  padding: "5rem 1.5rem",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  lineHeight: 1.55,
};

const button: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.625rem 1rem",
  border: "1px solid #d0d0d0",
  borderRadius: "0.5rem",
  background: "#fff",
  color: "#111",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

export default async function LoginPage() {
  const session = await getSession();
  if (session?.user) redirect("/");

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
        v0-saas
      </h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Entre para acessar o diagnóstico.
      </p>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button type="submit" style={button}>
          Entrar com Google
        </button>
      </form>
    </main>
  );
}
