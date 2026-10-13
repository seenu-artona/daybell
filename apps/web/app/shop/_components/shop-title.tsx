"use client";

import { useEffect } from "react";

/**
 * The page's title (WCAG 2.4.2; code review S3): each shop page names itself, so the browser tab and Next's route
 * announcer (which reads document.title after each navigation) say where the parent is. The pages are client
 * components, so it is set from an effect, and set again if Next's own metadata rewrites the head afterwards.
 */
export function ShopTitle({ children }: { children: string }) {
  useEffect(() => {
    const apply = () => {
      if (document.title !== children) document.title = children;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [children]);
  return null;
}
