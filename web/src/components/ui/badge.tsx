import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // 設計系統 Badge：唯讀標記，--radius-sm、高 24px、caption 字級；不可點所以沒有 hover
  "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-xs font-semibold leading-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border bg-card text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        success: "border-transparent bg-green-100 text-green-600",
        warning: "border-transparent bg-yellow-100 text-yellow-800",
        info: "border-transparent bg-blue-100 text-blue-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
