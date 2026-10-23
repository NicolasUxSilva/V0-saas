import { Download, Info, MoreHorizontal, Search } from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { EmptyState, ErrorState, PartialState } from "@/components/states";
import { ThemeToggleGroup } from "@/components/theme-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { requireWorkspace } from "@/server/auth";

export const metadata = { title: "Design system (dev) — The Seed" };

/**
 * Página de revisão (dev) do Design System v1.0: uma tela-modelo montada só com
 * os componentes compartilhados, nos dois temas. Não faz parte do produto e não
 * mostra dados — números são marcadores (0,00) para avaliar tipografia.
 */

const METRICS = ["Métrica A", "Métrica B", "Métrica C", "Métrica D"];

const ROWS = [
  { name: "Linha", state: "success", label: "Sucesso", value: "0.000,00" },
  { name: "Linha selecionada", state: "default", label: "Neutro", value: "000,00", selected: true },
  { name: "Linha", state: "warning", label: "Alerta", value: "00,00" },
  { name: "Linha", state: "destructive", label: "Erro", value: "0,00" },
  { name: "Linha", state: "info", label: "Informação", value: "0,00" },
] as const;

const TOKENS = [
  "bg-background",
  "bg-sidebar",
  "bg-card",
  "bg-popover",
  "bg-secondary",
  "bg-border",
  "bg-muted-foreground",
  "bg-foreground",
  "bg-primary",
  "bg-success",
  "bg-warning",
  "bg-destructive",
  "bg-info",
];

export default async function DevDesignSystemPage() {
  await requireWorkspace();

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Cabeçalho da página: uma ação principal, o resto neutro. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="font-mono text-caption text-muted-foreground">
              dev · design system v1.0
            </p>
            <h1 className="text-title">Tela-modelo</h1>
            <p className="text-sm text-muted-foreground">
              Componentes compartilhados em uso real. Referência:
              docs/design-system.md.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggleGroup />
            <Button variant="outline">
              <Download />
              Exportar
            </Button>
            <Button>Ação principal</Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64 space-y-1.5">
            <Label htmlFor="ds-search">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="ds-search" placeholder="Nome" className="pl-8" />
            </div>
          </div>
          <div className="w-44 space-y-1.5">
            <Label>Período</Label>
            <Select defaultValue="a">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">Opção A</SelectItem>
                <SelectItem value="b">Opção B</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="ds-invalid">Com erro</Label>
            <Input id="ds-invalid" aria-invalid defaultValue="Valor" />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="ds-disabled">Desabilitado</Label>
            <Input id="ds-disabled" disabled placeholder="Indisponível" />
          </div>
          <Button variant="ghost">Limpar</Button>
        </div>

        {/* Métricas: hierarquia por tamanho e peso, sem cor. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {METRICS.map((label) => (
            <Card key={label} size="sm">
              <CardContent className="space-y-1">
                <p className="text-label text-muted-foreground">{label}</p>
                <p className="text-metric tabular-nums">0.000,00</p>
                <p className="text-caption text-muted-foreground tabular-nums">
                  0,0% vs. período anterior
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabela */}
        <Card>
          <CardHeader>
            <CardTitle>Tabela</CardTitle>
            <CardDescription>
              Linhas neutras; cor só no estado. Seleção em cinza.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROWS.map((row, i) => (
                  <TableRow
                    key={i}
                    data-state={"selected" in row ? "selected" : undefined}
                  >
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant={row.state}>{row.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{row.value}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" aria-label="Mais ações">
                        <MoreHorizontal />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Estados */}
        <PartialState description="Aviso parcial: parte dos dados pode estar incompleta." />
        <div className="grid gap-3 sm:grid-cols-2">
          <EmptyState
            title="Nada por aqui ainda"
            description="Estado vazio, com uma ação neutra."
            action={<Button variant="outline">Configurar</Button>}
          />
          <ErrorState description="Estado de erro." />
        </div>

        {/* Sobreposições e ações secundárias */}
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" aria-label="Ajuda" />}
            >
              <Info />
            </TooltipTrigger>
            <TooltipContent>Dica de contexto</TooltipContent>
          </Tooltip>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              Abrir modal
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Título do modal</DialogTitle>
                <DialogDescription>Descrição do modal.</DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>
              Abrir painel lateral
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Painel lateral</SheetTitle>
                <SheetDescription>Descrição do painel.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
          <Button variant="secondary">Neutra</Button>
          <Button variant="destructive">Destrutiva</Button>
          <Button disabled>Desabilitada</Button>
          <Button variant="link">Link</Button>
        </div>

        {/* Referência compacta de tokens */}
        <div className="flex items-center gap-3 border-t pt-6">
          <LogoMark className="size-6" />
          <div className="flex flex-1 gap-1">
            {TOKENS.map((cls) => (
              <div
                key={cls}
                title={cls}
                className={`h-6 flex-1 rounded-sm ring-1 ring-border ${cls}`}
              />
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
