"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { cn } from "cn";

const TabContext = createContext<{ value: string; id: string } | null>(null);

export function WorkspaceTabs({
  tabs,
  defaultValue,
  children,
  label = "Workspace sections",
}: {
  tabs: { value: string; label: string }[];
  defaultValue?: string;
  children: ReactNode;
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? tabs[0]?.value ?? "");
  const id = useId();
  return (
    <TabContext value={{ value, id }}>
      <div className="space-y-5">
        <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b">
          {tabs.map((tab, index) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`${id}-${tab.value}-tab`}
              aria-controls={`${id}-${tab.value}-panel`}
              aria-selected={value === tab.value}
              tabIndex={value === tab.value ? 0 : -1}
              onClick={() => setValue(tab.value)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (next >= 0) {
                  event.preventDefault();
                  setValue(tabs[next].value);
                  document.getElementById(`${id}-${tabs[next].value}-tab`)?.focus();
                }
              }}
              className={cn(
                "min-h-12 shrink-0 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                value === tab.value && "border-primary text-primary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {children}
      </div>
    </TabContext>
  );
}

export function WorkspaceTabPanel({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const context = useContext(TabContext);
  if (!context) throw new Error("WorkspaceTabPanel requires WorkspaceTabs");
  return (
    <div
      role="tabpanel"
      id={`${context.id}-${value}-panel`}
      aria-labelledby={`${context.id}-${value}-tab`}
      hidden={context.value !== value}
      className={className}
    >
      {children}
    </div>
  );
}
