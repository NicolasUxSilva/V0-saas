import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Aviso em linha (faixa). As cores vêm só dos tokens de estado
 * (`--{estado}`, `--{estado}-subtle`, `--{estado}-border`), iguais aos dos
 * badges. O texto do aviso fica na cor normal; o estado aparece na borda, no
 * fundo suave e no ícone.
 */
const alertVariants = cva(
  "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm text-foreground [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-border bg-card [&>svg]:text-muted-foreground",
        success: "border-success-border bg-success-subtle [&>svg]:text-success",
        warning: "border-warning-border bg-warning-subtle [&>svg]:text-warning",
        destructive:
          "border-destructive-border bg-destructive-subtle [&>svg]:text-destructive",
        info: "border-info-border bg-info-subtle [&>svg]:text-info",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Alert, alertVariants }
