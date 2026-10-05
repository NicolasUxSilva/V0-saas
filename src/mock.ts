/**
 * Dados mockados para validar a UI do bloco A4 (tela Diagnóstico).
 *
 * Não é o produto — os componentes leem daqui até o bloco C5, quando passam a
 * ler `insights` reais do banco. Os objetos seguem exatamente `src/lib/insight.ts`
 * para que a troca seja trivial.
 *
 * O conjunto cobre de propósito as 4 seções da tela (qualidade de dados,
 * críticos, atenção, oportunidades) para revisão de layout. Alguns detectores
 * aqui (channel-opportunity, emerging-growth) só entram no motor pós-1º teste.
 */
import type { DiagnosticoData } from "@/lib/insight";

const WINDOW = {
  start: "2026-08-01",
  end: "2026-08-28",
  comparedTo: "28 dias anteriores",
} as const;

export const mockDiagnostico: DiagnosticoData = {
  lastSyncedAt: "2026-08-28T10:12:00.000Z",
  lastSyncStatus: "success",
  window: WINDOW,
  insights: [
    // ── Qualidade dos dados ────────────────────────────────────────────
    {
      id: "dq-1",
      dedupeKey: "data-quality:high_not_set_share",
      detector: "data-quality",
      kind: "data_quality",
      severity: "attention",
      status: "open",
      title:
        "42% das sessões estão sem origem definida ((not set) / (direct))",
      impact: null,
      explanation:
        "No período, 53.900 de 128.400 sessões (42%) caem em (not set) ou (direct)/(none). Acima de 40%, a atribuição por canal fica pouco confiável.",
      hypothesis:
        "Provável ausência de UTMs em campanhas e/ou tags de referência perdidas. Enquanto isso, insights que dependem de canal/origem ficam suprimidos ou com confiança reduzida.",
      evidence: {
        metricLabel: "Sessões sem origem",
        current: 53_900,
        previous: 41_200,
        deltaPct: 0.308,
        format: "count",
        test: "Compartilhamento do total: 42,0% vs. 33,1% no período anterior",
        breakdown: [
          { label: "(direct) / (none)", contributionPct: 0.61, detail: "32.900 sessões" },
          { label: "(not set)", contributionPct: 0.39, detail: "21.000 sessões" },
        ],
      },
      window: WINDOW,
      responsibleDimension: null,
      confidence: "alta",
      confidenceBasis: "amostra 128,4k sessões · 97% de completude (150+/180 dias)",
      recommendedAction:
        "Padronizar UTMs nas campanhas pagas e de e-mail; revisar a configuração de referral exclusions no GA4. Reavaliar os insights de canal após a correção.",
      priorityScore: 82,
      rating: null,
      detectedAt: "2026-08-28T10:12:00.000Z",
    },

    // ── Problemas críticos ────────────────────────────────────────────
    {
      id: "p-1",
      dedupeKey: "conversion-efficiency-drop:Organic Search",
      detector: "conversion-efficiency-drop",
      kind: "problem",
      severity: "critical",
      status: "open",
      title: "Conversões caíram 27% nos últimos 28 dias",
      impact: {
        value: 140,
        unit: "conversions",
        basis: "conversões a menos vs. o período anterior",
        isEstimate: true,
      },
      explanation:
        "As conversões (key events) do site caíram de 5.355 para 3.910 no período, uma queda de 27,0%. O volume de sessões ficou praticamente estável (−5,1%).",
      hypothesis:
        "Provável gargalo: perda de eficiência no tráfego de Organic Search. Esse canal responde por 71% da queda — sua taxa de conversão caiu de 3,4% para 2,1%, enquanto suas sessões variaram pouco (−3%).",
      evidence: {
        metricLabel: "Conversões (key events)",
        current: 3_910,
        previous: 5_355,
        baseline: 5_140,
        deltaPct: -0.27,
        format: "count",
        test: "z de 2 proporções (taxa de conversão): z = −4,1 (p < 0,001)",
        breakdown: [
          {
            label: "Organic Search",
            contributionPct: 0.71,
            detail: "taxa 3,4% → 2,1%; sessões −3%",
          },
          {
            label: "Direct",
            contributionPct: 0.18,
            detail: "taxa 5,1% → 4,4%",
          },
          { label: "Demais canais", contributionPct: 0.11, detail: "estáveis" },
        ],
      },
      window: WINDOW,
      responsibleDimension: { name: "canal", value: "Organic Search", share: 0.71 },
      confidence: "alta",
      confidenceBasis:
        "z = −4,1 · 47,8k sessões orgânicas/período · efeito estável nas 2 metades da janela",
      recommendedAction:
        "Investigar as landing pages orgânicas que perderam conversão no período e cruzar com mudanças de conteúdo, template ou SEO. Priorizar as 5 páginas de maior tráfego orgânico.",
      priorityScore: 91,
      rating: null,
      detectedAt: "2026-08-28T10:12:00.000Z",
    },
    {
      id: "p-2",
      dedupeKey: "traffic-volume-drop:Paid Search",
      detector: "traffic-volume-drop",
      kind: "problem",
      severity: "critical",
      status: "open",
      title: "Sessões de Paid Search caíram 41% a partir de 12/08",
      impact: {
        value: 8_900,
        unit: "sessions",
        basis: "sessões abaixo do esperado pela linha de base",
        isEstimate: true,
      },
      explanation:
        "Sessões de Paid Search caíram de 21.700 para 12.800 no período (−41%), com uma quebra clara em 12/08. Antes disso a série estava dentro da faixa histórica.",
      hypothesis:
        "Provável causa: redução de volume em Paid Search — pausa de campanha, corte de orçamento ou perda de aprovação de anúncios a partir de 12/08. A queda é de volume, não de eficiência (a taxa de conversão do canal se manteve em ~4,2%).",
      evidence: {
        metricLabel: "Sessões — Paid Search",
        current: 12_800,
        previous: 21_700,
        baseline: 20_950,
        deltaPct: -0.41,
        format: "count",
        test: "z robusto vs. baseline diária (mediana + MAD): z = −5,3",
        breakdown: [
          { label: "google / cpc", contributionPct: 0.86, detail: "−7.650 sessões" },
          { label: "bing / cpc", contributionPct: 0.14, detail: "−1.250 sessões" },
        ],
      },
      window: WINDOW,
      responsibleDimension: {
        name: "fonte / mídia",
        value: "google / cpc",
        share: 0.86,
      },
      confidence: "alta",
      confidenceBasis: "z = −5,3 · quebra de degrau detectada em 12/08 · 98% de completude",
      recommendedAction:
        "Confirmar no Google Ads se houve pausa, alteração de orçamento ou reprovação de anúncios em 12/08. Se intencional, ajustar as metas do período; se não, reativar.",
      priorityScore: 88,
      rating: null,
      detectedAt: "2026-08-28T10:12:00.000Z",
    },

    // ── Pontos de atenção ────────────────────────────────────────────
    {
      id: "a-1",
      dedupeKey: "conversion-efficiency-drop:mobile",
      detector: "conversion-efficiency-drop",
      kind: "problem",
      severity: "attention",
      status: "open",
      title: "Taxa de conversão no mobile caiu de 2,6% para 2,1%",
      impact: {
        value: 45,
        unit: "conversions",
        basis: "conversões a menos no mobile vs. período anterior",
        isEstimate: true,
      },
      explanation:
        "No dispositivo mobile, a taxa de conversão caiu de 2,6% para 2,1% (−19%), com o volume de sessões mobile estável. No desktop a taxa se manteve (4,4% → 4,3%).",
      hypothesis:
        "Provável perda de eficiência específica do mobile — regressão de performance, layout ou etapa de checkout na versão mobile. Não há sinal equivalente no desktop.",
      evidence: {
        metricLabel: "Taxa de conversão — mobile",
        current: 0.021,
        previous: 0.026,
        deltaPct: -0.19,
        format: "rate",
        test: "z de 2 proporções: z = −2,4 (p = 0,016)",
        breakdown: [
          { label: "mobile", contributionPct: 0.94, detail: "2,6% → 2,1%" },
          { label: "tablet", contributionPct: 0.06, detail: "leve queda" },
        ],
      },
      window: WINDOW,
      responsibleDimension: { name: "dispositivo", value: "mobile", share: 0.94 },
      confidence: "media",
      confidenceBasis: "z = −2,4 · 71,9k sessões mobile/período · 95% de completude",
      recommendedAction:
        "Medir Core Web Vitals do mobile no período e revisar o funil de checkout mobile em busca de regressões recentes.",
      priorityScore: 63,
      rating: null,
      detectedAt: "2026-08-28T10:12:00.000Z",
    },
    {
      id: "a-2",
      dedupeKey: "traffic-volume-drop:Referral",
      detector: "traffic-volume-drop",
      kind: "problem",
      severity: "attention",
      status: "open",
      title: "Tráfego de Referral caiu 18% no período",
      impact: {
        value: 1_600,
        unit: "sessions",
        basis: "sessões de referral abaixo do período anterior",
        isEstimate: false,
      },
      explanation:
        "Sessões de Referral caíram de 8.900 para 7.300 (−18%). A queda é gradual ao longo do período, sem uma data de quebra clara.",
      hypothesis:
        "Provável perda de links de origem ou queda de tráfego em sites parceiros. Concentrada em 2 domínios de referência que juntos explicam 63% da variação.",
      evidence: {
        metricLabel: "Sessões — Referral",
        current: 7_300,
        previous: 8_900,
        baseline: 8_600,
        deltaPct: -0.18,
        format: "count",
        test: "z robusto vs. baseline: z = −2,1 · sem degrau (declínio gradual)",
        breakdown: [
          { label: "parceiro-a.com", contributionPct: 0.38 },
          { label: "parceiro-b.com", contributionPct: 0.25 },
          { label: "cauda longa", contributionPct: 0.37 },
        ],
      },
      window: WINDOW,
      responsibleDimension: { name: "origem", value: "parceiro-a.com", share: 0.38 },
      confidence: "media",
      confidenceBasis: "z = −2,1 · 8,3k sessões de referral/período · 96% de completude",
      recommendedAction:
        "Verificar se os links em parceiro-a.com e parceiro-b.com continuam ativos e apontando corretamente. Retomar contato com os parceiros se necessário.",
      priorityScore: 54,
      rating: null,
      detectedAt: "2026-08-28T10:12:00.000Z",
    },

    // ── Oportunidades ────────────────────────────────────────────────
    {
      id: "o-1",
      dedupeKey: "channel-opportunity:Organic Social",
      detector: "channel-opportunity",
      kind: "opportunity",
      severity: "attention",
      status: "open",
      title:
        "Organic Social converte a 4,8%, mas é só 3% das sessões",
      impact: {
        value: 260,
        unit: "conversions",
        basis: "conversões/mês potenciais se dobrar a participação, à taxa atual",
        isEstimate: true,
      },
      explanation:
        "Organic Social tem taxa de conversão de 4,8% — acima da média do site (3,0%) — mas responde por apenas 3.850 das 128.400 sessões (3%). É um segmento eficiente e subinvestido.",
      hypothesis:
        "O canal converte bem de forma consistente há 8 semanas. Ampliar o volume mantendo a taxa adicionaria conversões com CAC provavelmente menor que a média.",
      evidence: {
        metricLabel: "Taxa de conversão — Organic Social",
        current: 0.048,
        previous: 0.047,
        deltaPct: 0.02,
        format: "rate",
        test: "taxa 4,8% vs. média do site 3,0% · estável nas últimas 8 semanas",
        breakdown: [
          { label: "instagram", contributionPct: 0.66 },
          { label: "linkedin", contributionPct: 0.27 },
          { label: "outros", contributionPct: 0.07 },
        ],
      },
      window: WINDOW,
      responsibleDimension: { name: "canal", value: "Organic Social", share: 1 },
      confidence: "media",
      confidenceBasis: "3,85k sessões/período · taxa estável (8 semanas) · 96% de completude",
      recommendedAction:
        "Testar aumento de frequência/investimento em conteúdo de Instagram e LinkedIn, monitorando se a taxa de conversão se mantém à medida que o volume cresce.",
      priorityScore: 58,
      rating: null,
      detectedAt: "2026-08-28T10:12:00.000Z",
    },
    {
      id: "o-2",
      dedupeKey: "emerging-growth:Email",
      detector: "emerging-growth",
      kind: "opportunity",
      severity: "attention",
      status: "open",
      title: "Conversões via Email cresceram 34% de forma consistente",
      impact: {
        value: 190,
        unit: "conversions",
        basis: "conversões a mais via Email vs. período anterior",
        isEstimate: false,
      },
      explanation:
        "Conversões atribuídas a Email subiram de 560 para 750 (+34%), com crescimento em 4 das últimas 4 semanas. Sessões de Email cresceram 21% no mesmo intervalo.",
      hypothesis:
        "Crescimento sustentado (não um pico), impulsionado tanto por mais volume quanto por leve ganho de taxa (2,9% → 3,2%). Indica um canal com espaço para escalar.",
      evidence: {
        metricLabel: "Conversões — Email",
        current: 750,
        previous: 560,
        baseline: 580,
        deltaPct: 0.34,
        format: "count",
        test: "regressão linear sobre 8 semanas: inclinação positiva significativa (p = 0,004)",
        breakdown: [
          { label: "efeito volume", contributionPct: 0.68, detail: "+21% sessões" },
          { label: "efeito eficiência", contributionPct: 0.32, detail: "taxa 2,9% → 3,2%" },
        ],
      },
      window: WINDOW,
      responsibleDimension: { name: "canal", value: "Email", share: 1 },
      confidence: "alta",
      confidenceBasis: "crescimento em 4/4 semanas · p = 0,004 · 12,1k sessões de e-mail/período",
      recommendedAction:
        "Aumentar a cadência de envios e segmentar as réguas que mais converteram no período. Acompanhar taxa de descadastro para não sacrificar a base.",
      priorityScore: 61,
      rating: null,
      detectedAt: "2026-08-28T10:12:00.000Z",
    },
  ],

  supportMetrics: [
    {
      key: "sessions",
      label: "Sessões",
      current: 128_400,
      previous: 135_300,
      deltaPct: -0.051,
      format: "count",
    },
    {
      key: "users",
      label: "Usuários",
      current: 98_200,
      previous: 100_800,
      deltaPct: -0.026,
      format: "count",
    },
    {
      key: "key_events",
      label: "Conversões (key events)",
      current: 3_910,
      previous: 5_355,
      deltaPct: -0.27,
      format: "count",
    },
    {
      key: "conversion_rate",
      label: "Taxa de conversão",
      current: 0.0305,
      previous: 0.0396,
      deltaPct: -0.23,
      format: "rate",
    },
  ],

  // Só o motor real (USE_MOCK=false) preenche isto — ver diagnostico/data.ts.
  analysis: null,
};
