import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
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
        success: "bg-success/8 text-success dark:bg-success/12",
        warning: "bg-warning/8 text-warning dark:bg-warning/12",
        destructive:
          "bg-destructive/8 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/12 [a]:hover:bg-destructive/15",
        info: "bg-info/8 text-info dark:bg-info/12",
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
