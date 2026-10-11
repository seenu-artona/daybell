export type StepKey = "studio" | "team" | "brand" | "products" | "payouts" | "job";

export interface Step {
  key: StepKey;
  href?: string;
  done: boolean;
  soon: boolean;
}

/** The "Get ready to sell" steps (D127). Steps for sections not built yet are marked soon and never done. */
export function checklistSteps(state: { hasTeam: boolean; hasJob: boolean }): Step[] {
  return [
    { key: "studio", done: true, soon: false },
    { key: "team", href: "/app/settings", done: state.hasTeam, soon: false },
    { key: "brand", done: false, soon: true },
    { key: "products", done: false, soon: true },
    { key: "payouts", done: false, soon: true },
    { key: "job", href: "/app/jobs?new=1", done: state.hasJob, soon: false },
  ];
}
