"use client";

import { createContext, useContext } from "react";
import type { ActionResult } from "@/lib/action-result";

/** Lets panels inside the report form save pending edits before changing the case on the server. */
export const SaveDraftContext = createContext<(() => Promise<boolean>) | null>(null);

export function useSaveDraft() {
  return useContext(SaveDraftContext);
}

export const DraftVersionContext = createContext<(() => number) | null>(null);
export function useDraftVersion() {
  return useContext(DraftVersionContext);
}

export type ServerChange = <T>(change: (version: number) => Promise<ActionResult<T>>) => Promise<ActionResult<T>>;
export const ServerChangeContext = createContext<ServerChange | null>(null);
export function useServerChange() {
  return useContext(ServerChangeContext);
}
