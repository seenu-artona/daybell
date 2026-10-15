// @vitest-environment jsdom
import type { Job, PhotoGroup, RosterChild } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { JobContext, type JobContextValue } from "../../job-context";
import { PeopleLines } from "../people-lines";
import { ReviewContext, type ReviewContextValue } from "../review-context";
import { DeleteGroupDialog, MembersDialog } from "./group-dialogs";

// Round 6 review fixes (D156; ADR 0030): Delete asks where the photos go when the database says the group has some
// after all (groups.hasPhotos); Add or remove people keeps the ticks when the Groups list reloads; Show more people
// says when the next page couldn't be read and offers Try again.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let root: Root;
let container: HTMLDivElement;
const JOB = { id: "j", classLabel: "Homeroom", status: "draft" } as unknown as Job;
const jobContext = { job: JOB } as unknown as JobContextValue;
async function render(ui: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        <JobContext.Provider value={jobContext}>{ui}</JobContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  api.mockReset();
});

const group = (over: Partial<PhotoGroup> = {}): PhotoGroup => ({
  id: "g1",
  name: "Choir",
  members: 1,
  photos: 0,
  ordered: null,
  ...over,
});
const radios = () => [...document.querySelectorAll("input[type=radio]")];

describe("Delete group", () => {
  it("asks where the photos go when the database says the group has some (groups.hasPhotos)", async () => {
    api.mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: "conflict",
      message: "",
      fields: { form: "groups.hasPhotos" },
    });
    await render(
      <DeleteGroupDialog
        group={group()}
        groups={[group(), group({ id: "g2", name: "Band" })]}
        open
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(radios()).toHaveLength(0);
    expect(document.body.textContent).toContain("It has no photos.");
    const submit = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Delete group",
    ) as HTMLButtonElement;
    await act(async () => submit.click());
    expect(api).toHaveBeenCalledWith("/groups/g1", { method: "DELETE" });
    expect(radios()).toHaveLength(2);
    expect(document.body.textContent).toContain("Its photos go to");
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "This group has photos now. Choose where they go.",
    );
  });
});

describe("Add or remove people", () => {
  const person = (id: string, first: string, inChoir: boolean): RosterChild =>
    ({
      id,
      firstName: first,
      lastName: "Lee",
      class: null,
      groups: inChoir ? [{ id: "g1", name: "Choir" }] : [],
    }) as unknown as RosterChild;

  it("keeps the ticks when the Groups list reloads (a new object, the same group)", async () => {
    api.mockResolvedValue({
      ok: true,
      data: { children: [person("c1", "Ava", true), person("c2", "Ben", false)], nextCursor: null },
    });
    const ui = (g: PhotoGroup) => (
      <MembersDialog jobId="j" group={g} open onClose={() => {}} onSaved={() => {}} />
    );
    await render(ui(group()));
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes().map((b) => b.checked)).toEqual([true, false]);
    // The class column reads in the job's own word (ADR 0030, call 29).
    expect(document.body.textContent).toContain("No Homeroom");
    await act(async () => boxes()[1]?.click());
    expect(boxes().map((b) => b.checked)).toEqual([true, true]);
    await render(ui(group({ members: 1, photos: 3 })));
    expect(boxes().map((b) => b.checked)).toEqual([true, true]);
  });
});

describe("Show more people", () => {
  const review = {
    jobId: "j",
    canEdit: false,
    canUndoCard: false,
    version: 0,
    checked: new Map(),
    toggle: vi.fn(),
    move: vi.fn(),
    openGive: vi.fn(),
    openPhoto: vi.fn(),
    reconcile: vi.fn(),
    startLoad: () => () => {},
  } as unknown as ReviewContextValue;
  const line = (id: string, first: string) => ({
    id,
    firstName: first,
    lastName: "Lee",
    photos: 1,
    cardPhotos: 0,
    strip: [],
  });

  it("says when the next page couldn't be read, and Try again loads it", async () => {
    api
      .mockResolvedValueOnce({
        ok: true,
        // A full first page of 50 (the view shows 50 at a time), with more to come.
        data: {
          people: Array.from({ length: 50 }, (_, i) => line(`c${i}`, `Kid${i}`)),
          nextCursor: "c49",
          total: 51,
        },
      })
      .mockResolvedValueOnce({ ok: false, status: 500, code: "internal", message: "", fields: {} })
      .mockResolvedValueOnce({
        ok: true,
        data: { people: [line("c50", "Ben")], nextCursor: null, total: 51 },
      });
    await render(
      <ReviewContext.Provider value={review}>
        <PeopleLines groupId={null} />
      </ReviewContext.Provider>,
    );
    const button = (name: string) =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === name);
    await act(async () => button("Show more people")?.click());
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "We couldn't load more people.",
    );
    await act(async () => button("Try again")?.click());
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.textContent).toContain("Ben Lee");
  });
});
