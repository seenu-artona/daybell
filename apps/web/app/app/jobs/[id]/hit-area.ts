/**
 * D137 draws 40px rows and a 40px section bar with 32px controls; D91 wants 44px targets. The studio app is desktop
 * and pointer only (D136), so controls look 32px and get a 44px hit area from an invisible pseudo-element (Seenu,
 * Q3 of step 2b). Add to any 32px-tall control. Rows and the bar themselves stay 40px.
 */
export const HIT_44 =
  "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";
