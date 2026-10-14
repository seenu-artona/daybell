// @vitest-environment jsdom
import type { ClientListItem, Contact, Subject } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { StudioContext } from "../me-context";

// People (D150; Seenu's answers 1-5; ADR 0028) with the API faked: the pill tabs (Families only for people who see
// order data) with the section's line; Clients' columns (main contact · role, jobs, latest job as a link, no money);
// Contacts' "Main" badge in words, its chips and footer; Subjects' rows linking to the child on their job, the Ordered
// column and chips only for people who see orders, and the "n subjects across m jobs" footer; search text in a POST
// body, never a URL (D113).
const { push, replace, address } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  address: { search: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(address.search),
  usePathname: () => "/app/people",
}));
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", async (original) => ({
  ...(await original<typeof import("@/lib/client-api")>()),
  api: (path: string, init?: { method?: string; body?: unknown }) => api(path, init),
}));

const { PeoplePage } = await import("./people-page");
const { default: ClientsPage } = await import("./clients/page");
const { default: ContactsPage } = await import("./contacts/page");
const { default: SubjectsPage } = await import("./subjects/page");
const { default: FamiliesPage } = await import("./families/page");

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB1 = "a0000000-0000-4000-8000-000000000001";
const JOB2 = "a0000000-0000-4000-8000-000000000002";
const CLIENT = "c0000000-0000-4000-8000-000000000001";
const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
type Role = "owner" | "admin" | "staff" | "photographer";
const me = (role: Role) => ({
  email: "owner@example.test",
  studio: { id: STUDIO, name: "North Peak Photo", role, region: "ca" },
});

const client: ClientListItem = {
  id: CLIENT,
  name: "Lincoln SD",
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
  city: "Toronto",
  region: "ON",
  country: "CA",
  contactFirstName: "Dana",
  contactLastName: "Ruiz",
  contactPhone: null,
  contactEmail: "office@lincoln.example",
  notes: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  mainContact: {
    id: "e0000000-0000-4000-8000-000000000001",
    firstName: "Dana",
    lastName: "Ruiz",
    role: "Office",
    email: "office@lincoln.example",
  },
  jobCount: 3,
  latestJob: { id: JOB1, name: "Fall 2026", pictureDay: "2026-10-01" },
};
const contact = (id: string, first: string, isMain: boolean): Contact => ({
  id,
  clientId: CLIENT,
  clientName: "Lincoln SD",
  firstName: first,
  lastName: "Ruiz",
  role: "Office manager",
  email: `${first.toLowerCase()}@lincoln.example`,
  phone: null,
  isMain,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});
const subject = (id: string, first: string, job: string, paid: boolean | null): Subject => ({
  id,
  firstName: first,
  lastName: "Johnson",
  className: first === "Maya" ? "Grade 3" : null,
  job: { id: job, name: job === JOB1 ? "Lincoln Fall 2026" : "Hillcrest Fall 2026" },
  hasPaidOrder: paid,
});

/** The API: the person's saved chips are empty; each list answers with its fixture. */
function answer(role: Role = "owner") {
  api.mockImplementation(async (path: string) => {
    if (path.startsWith("/me/list-filters")) return ok({ chips: [] });
    if (path.startsWith("/clients")) return ok({ clients: [client], nextCursor: null, total: 1 });
    if (path.startsWith("/contacts"))
      return ok({
        contacts: [
          contact("e0000000-0000-4000-8000-000000000001", "Dana", true),
          contact("e0000000-0000-4000-8000-000000000002", "Mark", false),
        ],
        nextCursor: null,
        total: 2,
      });
    if (path.startsWith("/subjects")) {
      const sees = role !== "photographer";
      return ok({
        subjects: [
          subject("b0000000-0000-4000-8000-000000000001", "Maya", JOB1, sees ? true : null),
          subject("b0000000-0000-4000-8000-000000000002", "Leo", JOB2, sees ? false : null),
        ],
        nextCursor: null,
        total: 2,
        jobs: 2,
      });
    }
    return { ok: false, status: 404, code: "not_found", message: "", fields: {} };
  });
}

let root: Root;
let container: HTMLDivElement;
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function render(ui: ReactNode, role: Role = "owner") {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        <StudioContext.Provider value={{ me: me(role) as never, version: 0, changed: () => {} }}>
          {ui}
        </StudioContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await wait(20);
}
const tabs = () => [
  ...(container.querySelector('nav[aria-label="People sections"]')?.querySelectorAll("a") ?? []),
];
const chips = (label: string) => [
  ...(container.querySelector(`nav[aria-label="${label}"]`)?.querySelectorAll("a") ?? []),
];
const headers = () => [...container.querySelectorAll("th")].map((th) => th.textContent?.trim());
const footer = () => container.querySelector("section > div:last-child")?.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.mockReset();
  push.mockReset();
  replace.mockReset();
  address.search = "";
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("People's tabs (answer 5)", () => {
  it("are Clients, Contacts, Families and Subjects as links, the current one marked, with its line", async () => {
    await render(
      <PeoplePage current="contacts">
        <p />
      </PeoplePage>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("People");
    expect(tabs().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Clients", "/app/people/clients"],
      ["Contacts", "/app/people/contacts"],
      ["Families", "/app/people/families"],
      ["Subjects", "/app/people/subjects"],
    ]);
    expect(
      tabs()
        .filter((a) => a.getAttribute("aria-current") === "page")
        .map((a) => a.textContent),
    ).toEqual(["Contacts"]);
    expect(container.textContent).toContain("The people you work with at each client");
  });

  it("leave Families out for photographers (answer 2)", async () => {
    await render(
      <PeoplePage current="clients">
        <p />
      </PeoplePage>,
      "photographer",
    );
    expect(tabs().map((a) => a.textContent)).toEqual(["Clients", "Contacts", "Subjects"]);
  });

  it("Families is coming soon, and takes photographers to Clients", async () => {
    await render(<FamiliesPage />, "staff");
    expect(container.querySelector("h2")?.textContent).toBe(
      messages.app.soon.title.replace("{section}", "Families"),
    );
    await render(<FamiliesPage />, "photographer");
    expect(replace).toHaveBeenCalledWith("/app/people/clients");
  });
});

describe("People › Clients (answer 1)", () => {
  it("shows the client, its main contact with role, its jobs and its latest job as a link", async () => {
    answer();
    await render(<ClientsPage />);
    expect(headers()).toEqual(["Client", "Main contact", "Jobs", "Latest job"]);
    const row = container.querySelector("tbody tr");
    expect(row?.textContent).toContain("Dana Ruiz · Office");
    expect(row?.querySelector(`a[href="/app/jobs/${JOB1}"]`)?.textContent).toBe("Fall 2026");
    expect(row?.textContent).toContain("3");
    expect(chips("Show clients").map((a) => a.textContent)).toEqual(["All"]);
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent === "New client"),
    ).toBe(true);
    expect(footer()).toContain("1 client");
    expect(container.textContent).not.toMatch(/\$|School\b/);
  });
});

describe("People › Contacts (answer 3)", () => {
  it("marks the main contact with the word Main, and offers All and Main contacts", async () => {
    answer();
    await render(<ContactsPage />);
    expect(headers()).toEqual(["Name", "Role", "Client", "Email"]);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0]?.textContent).toContain("Dana Ruiz");
    expect(rows[0]?.textContent).toContain("Main");
    expect(rows[1]?.textContent).not.toContain("Main");
    expect(chips("Show contacts").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["All", "/app/people/contacts"],
      ["Main contacts", "/app/people/contacts?show=main"],
    ]);
    expect(footer()).toContain("2 contacts");
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent === "New contact"),
    ).toBe(true);
  });

  it("asks for main contacts by the address's chip, and has no New contact for staff", async () => {
    answer();
    address.search = "show=main";
    await render(<ContactsPage />, "staff");
    expect(api.mock.calls.map((c) => c[0])).toContain("/contacts?show=main");
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent === "New contact"),
    ).toBe(false);
  });
});

describe("People › Subjects (answer 4)", () => {
  it("lists children across jobs, linked to the child on their job, with Ordered for people who see orders", async () => {
    answer();
    await render(<SubjectsPage />);
    expect(headers()).toEqual(["Name", "Class", "Job", "Ordered"]);
    const maya = container.querySelector("tbody tr");
    expect(
      maya?.querySelector(
        `a[href="/app/jobs/${JOB1}/people?child=b0000000-0000-4000-8000-000000000001"]`,
      )?.textContent,
    ).toBe("Maya Johnson");
    expect(maya?.querySelector(`a[href="/app/jobs/${JOB1}"]`)?.textContent).toBe(
      "Lincoln Fall 2026",
    );
    expect(maya?.textContent).toContain("Grade 3");
    expect(maya?.textContent).toContain("Ordered");
    expect(container.querySelectorAll("tbody tr")[1]?.textContent).toContain("Not ordered");
    expect(chips("Show subjects").map((a) => a.textContent)).toEqual([
      "All",
      "Ordered",
      "Not ordered",
    ]);
    expect(footer()).toContain("2 subjects across 2 jobs");
    expect(container.textContent).not.toContain("Family");
  });

  it("gives photographers no Ordered column and no order chips", async () => {
    answer("photographer");
    await render(<SubjectsPage />, "photographer");
    expect(headers()).toEqual(["Name", "Class", "Job"]);
    expect(chips("Show subjects").map((a) => a.textContent)).toEqual(["All"]);
    address.search = "show=notOrdered";
    await render(<SubjectsPage />, "photographer");
    expect(replace).toHaveBeenCalledWith("/app/people/subjects", { scroll: false });
  });

  it("searches with the name in a POST body, never in a URL (D113)", async () => {
    answer();
    await render(<SubjectsPage />);
    const open = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Search subjects",
    );
    await act(async () => open?.click());
    const box = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(box, "maya");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(350);
    const searched = api.mock.calls.find((c) => c[0] === "/subjects/search");
    expect(searched?.[1]).toEqual({ method: "POST", body: { q: "maya" } });
    expect(api.mock.calls.every((c) => !String(c[0]).includes("maya"))).toBe(true);
  });
});
