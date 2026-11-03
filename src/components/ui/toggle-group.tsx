"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cn } from "../../lib/utils"

const variants = { segmented: "segmented", chips: "filter-chips" }

function ToggleGroup<Value extends string>({ variant, className, ...props }: ToggleGroupPrimitive.Props<Value> & { variant: keyof typeof variants }) {
  return <ToggleGroupPrimitive data-slot="toggle-group" className={cn(variants[variant], className)} {...props} />
}

// One choice, always made: pressing the chosen item leaves it chosen.
function ToggleChoice<Value extends string>({ value, onValueChange, ...props }: Omit<React.ComponentProps<typeof ToggleGroup<Value>>, "value" | "onValueChange" | "multiple"> & { value: Value; onValueChange: (value: Value) => void }) {
  return <ToggleGroup value={[value]} onValueChange={([next]) => { if (next) onValueChange(next) }} {...props} />
}

function ToggleGroupItem<Value extends string>(props: TogglePrimitive.Props<Value>) {
  return <TogglePrimitive data-slot="toggle-group-item" {...props} />
}

export { ToggleChoice, ToggleGroup, ToggleGroupItem }
