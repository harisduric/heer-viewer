import { create } from "zustand";
import type { ParsedExecution } from "@workspace/api-client-react";

interface AppState {
  parsedExecution: ParsedExecution | null;
  setParsedExecution: (data: ParsedExecution | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  parsedExecution: null,
  setParsedExecution: (data) => set({ parsedExecution: data }),
}));

// Expose in dev so Playwright/testing can seed state without a real PDF import
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__appStore = useAppStore;
}
