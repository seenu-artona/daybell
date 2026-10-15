// @vitest-environment jsdom
import type { Job, RosterChild } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { PersonRecord } from "./person-record";

// A person's record on Subjects (D153; ADR 0029, review fixes 6): a card never printed says so and offers Print QR
// card; after a print the record reads its facts again and shows when it was printed, with Print again. The parent
// email is masked.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const CHILD: RosterChild = {
  id: "c0000000-0000-4000-8000-000000000001",
  jobId: "j0000000-0000-4000-8000-000000000001",
  group: { id: "g1", name: "Room 1" },
  firstName: "Leo",
  lastName: "Martin",
  studentId: "102941",
  grade: null,
  parentEmail: "maria.martin@gmail.com",
  doNotPhotograph: false,
  doNotPublish: false,
  schoolProvided: true,
  accessCode: "K7QM-4XPA",
  duplicate: false,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  photoCount: 0,
  hasPaidOrder: false,
};
const JOB = { id: CHILD.jobId, status: "draft", closesAt: null } as unknown as Job;

let root: Root;
let container: HTMLDivElement;
let printed: string | null = null;
beforeEach(() => {
  printed = null;
  api.mockImplementation(async (path: string) => {
    if (path.includes("/facts"))
      return { ok: true, data: { facts: { cardPrintedAt: printed, photographedAt: null } } };
    if (path.includes("/tagging/photos"))
      return { ok: true, data: { photos: [], nextCursor: null } };
    return { ok: true, data: { orders: [], nextCursor: null } };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  api.mockReset();
});

describe("a person's record (D153)", () => {
  it("a card never printed offers Print QR card; after printing it shows Printed and Print again", async () => {
    const onPrintCard = vi.fn(async () => {
      printed = "2026-09-20T14:00:00Z";
    });
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
          <PersonRecord
            child={CHILD}
            job={JOB}
            word="class"
            canEdit
            seesOrders
            focusKey={null}
            printedKey={0}
            onUnfold={() => {}}
            onEdit={() => {}}
            onRemove={() => {}}
            onPrintCard={onPrintCard}
          />
        </NextIntlClientProvider>,
      );
    });
    const card = [...container.querySelectorAll("section")].find((s) =>
      s.textContent?.startsWith("QR card"),
    ) as HTMLElement;
    expect(card.textContent).toContain("K7QM-4XPA");
    expect(card.textContent).not.toContain("Printed");
    const button = [...card.querySelectorAll("button")].find(
      (b) => b.textContent === "Print QR card",
    ) as HTMLButtonElement;
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(onPrintCard).toHaveBeenCalledOnce();
    expect(api.mock.calls.filter(([p]) => String(p).includes("/facts"))).toHaveLength(2);
    expect(card.textContent).toContain("Printed");
    expect(card.textContent).toContain("Print again");
    // The parent email is masked (Seenu, Oct 14).
    expect(container.textContent).toContain("m•••@gmail.com");
    expect(container.textContent).not.toContain("maria.martin");
  });

  it("someone marked Do not photograph has no card to print, but their access code still shows", async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
          <PersonRecord
            child={{ ...CHILD, doNotPhotograph: true }}
            job={JOB}
            word="class"
            canEdit
            seesOrders
            focusKey={null}
            printedKey={0}
            onUnfold={() => {}}
            onEdit={() => {}}
            onRemove={() => {}}
            onPrintCard={async () => {}}
          />
        </NextIntlClientProvider>,
      );
    });
    const card = [...container.querySelectorAll("section")].find((s) =>
      s.textContent?.startsWith("QR card"),
    ) as HTMLElement;
    expect(card.textContent).toContain("K7QM-4XPA");
    expect(card.textContent).toContain("No QR card: marked Do not photograph.");
    expect(card.querySelectorAll("button")).toHaveLength(0);
  });
});
