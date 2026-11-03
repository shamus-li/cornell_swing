"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

function Tabs(props: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />
}

// Arrow keys choose a tab as they reach it.
function TabsList(props: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List data-slot="tabs-list" activateOnFocus {...props} />
}

function TabsTrigger(props: TabsPrimitive.Tab.Props) {
  return <TabsPrimitive.Tab data-slot="tabs-trigger" {...props} />
}

// Panels hold controls of their own, so the panel itself is not a stop when tabbing through the page.
function TabsContent(props: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" tabIndex={-1} {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
