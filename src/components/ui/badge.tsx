import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // Neutro por padrão: badge só ganha cor quando comunica um estado.
        // Translúcido para continuar visível sobre linhas selecionadas/hover.
        default:
          "bg-foreground/6 text-foreground dark:bg-foreground/10 [a]:hover:bg-foreground/10",
        secondary:
          "bg-foreground/6 text-foreground dark:bg-foreground/10 [a]:hover:bg-foreground/10",
        // Estados semânticos: fundo de baixa intensidade + texto na cor do estado.
        success: "bg-success-subtle text-success",
        warning: "bg-warning-subtle text-warning",
        destructive:
          "bg-destructive-subtle text-destructive focus-visible:ring-destructive/40",
        info: "bg-info-subtle text-info",
        outline:
          "border-border text-foreground [a]:hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
