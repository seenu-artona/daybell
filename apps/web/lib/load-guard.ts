/**
 * Keeps a paged list's answers in order (D144 fix round). A first-page load (a new view, filter or search) starts a new
 * generation: answers from older generations, first pages or "Show more" pages alike, are dropped. "Show more" runs one
 * at a time and never while a first page is loading, so a double click can't fetch the same page twice and an older
 * list's next page can't land on a newer one.
 */
export interface LoadTicket {
  /** Call when the answer arrives: true if it still belongs to the list on screen (then use it), false to drop it. */
  finish: () => boolean;
}

export interface LoadGuard {
  /** A first-page load. Always starts; makes every earlier ticket stale. */
  first: () => LoadTicket;
  /** A "Show more" load, or null while a page is already loading. */
  more: () => LoadTicket | null;
}

export function createLoadGuard(): LoadGuard {
  let generation = 0;
  let firstPending = false;
  let morePending = false;
  return {
    first() {
      const mine = ++generation;
      firstPending = true;
      morePending = false;
      return {
        finish() {
          if (mine !== generation) return false;
          firstPending = false;
          return true;
        },
      };
    },
    more() {
      if (firstPending || morePending) return null;
      const mine = generation;
      morePending = true;
      return {
        finish() {
          if (mine !== generation) return false;
          morePending = false;
          return true;
        },
      };
    },
  };
}
