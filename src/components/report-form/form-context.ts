"use client";

import { createContext, useContext } from "react";

/** Lets panels inside the report form save pending edits before changing the case on the server. */
export const SaveDraftContext = createContext<(() => Promise<boolean>) | null>(null);

export function useSaveDraft() {
  return useContext(SaveDraftContext);
}
