import { createContext, useContext } from "react";

export const TaskJourneyContext = createContext(null);

/**
 * Returns the app-shell task journey, or null when a feature is rendered standalone.
 */
export function useTaskJourney() {
  return useContext(TaskJourneyContext);
}
