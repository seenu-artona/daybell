/**
 * What a key press in the menu search box does (D137, D138; ADR 0013). Pure, so it can be tested without a browser.
 * Enter does nothing while a search is pending: the list on screen may belong to older text, and opening it would
 * take the person somewhere they didn't ask for.
 */
export type SearchKeyAction = "next" | "previous" | "open" | "close" | "clear" | null;

export interface SearchKeyState {
  /** How many options the list shows. */
  options: number;
  /** An option is highlighted. */
  hasActive: boolean;
  /** A search for the current text hasn't answered yet. */
  loading: boolean;
  /** The results panel is showing. */
  panelOpen: boolean;
}

export function searchKeyAction(key: string, state: SearchKeyState): SearchKeyAction {
  switch (key) {
    case "ArrowDown":
      return state.options > 0 ? "next" : null;
    case "ArrowUp":
      return state.options > 0 ? "previous" : null;
    case "Enter":
      return state.hasActive && !state.loading ? "open" : null;
    case "Escape":
      return state.panelOpen ? "close" : "clear";
    default:
      return null;
  }
}
