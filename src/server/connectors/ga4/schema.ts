/**
 * Validação Zod das respostas da GA4 Data API (`runReport`) — bloco B3.
 * Não confiar no shape da resposta externa.
 */
import { z } from "zod";

const header = z.object({ name: z.string() });

export const ga4RunReportPageSchema = z.object({
  dimensionHeaders: z.array(header).default([]),
  metricHeaders: z
    .array(z.object({ name: z.string(), type: z.string().optional() }))
    .default([]),
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string() })),
        metricValues: z.array(z.object({ value: z.string() })),
      }),
    )
    .optional(),
  rowCount: z.number().optional(),
  metadata: z
    .object({
      currencyCode: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .optional(),
});

export type Ga4RunReportPage = z.infer<typeof ga4RunReportPageSchema>;

/** Streams do conector GA4 e seus schemas. */
export const schemas = { report_daily: ga4RunReportPageSchema } as const;
