/**
 * Health check — prova que a aplicação sobe e responde.
 *
 * Route Handlers no Next 16 não são cacheados por padrão e rodam a cada
 * requisição, então o timestamp sempre reflete o momento da chamada.
 * Deliberadamente sem dependências (não toca no banco nem em env) para
 * funcionar mesmo antes de qualquer configuração de serviço externo.
 */
export async function GET() {
  return Response.json({
    status: "ok",
    service: "v0-saas",
    block: "A0",
    timestamp: new Date().toISOString(),
  });
}
