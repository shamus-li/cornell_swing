import * as React from "react"
import { cn } from "@shared/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border border-border bg-background shadow-xs", className)} {...props} />
}
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-wrap items-center justify-between gap-3 p-4", className)} {...props} />
}
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-title" className={cn("text-base font-semibold", className)} {...props} />
}
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-4", className)} {...props} />
}

export { Card, CardContent, CardHeader, CardTitle }
