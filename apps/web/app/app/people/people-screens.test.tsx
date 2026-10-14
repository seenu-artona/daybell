// @vitest-environment jsdom
import type { ClientListItem, Contact, Subject } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { StudioContext } from "../me-context";

// People (D150; Seenu's answers 1-5; ADR 0028) with the API faked: the pill tabs (Families only for people who see
// order data) with the section's line; Clients' columns (main contact, then its role muted; jobs right-aligned; latest
// job as a link; no money); Contacts' "Main" badge in words, its chips, footer and empty state by role; the contact
// form (a client for a new one, blanks sent as null, no client in a change, read-only for staff and photographers,
// errors on their own field, the main contact's box locked); Subjects' rows linking to the subject on their job, the
// Ordered pills and chips only for people who see orders, and the "n subjects across m jobs" footer; search text in a
// POST body, never a URL (D113).
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
const { ContactForm } = await import("./contact-form");
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
    const cells = [...(row?.querySelectorAll("td") ?? [])];
    // The name, then the role in a muted span of its own.
    const contactParts = [...(cells[1]?.querySelectorAll("span") ?? [])];
    expect(contactParts.map((p) => p.textContent)).toEqual(["Dana Ruiz", "· Office"]);
    expect(contactParts[1]?.className).toMatch(/\btext-muted\b/);
    expect(cells[1]?.textContent).toBe("Dana Ruiz · Office");
    // Jobs: the count, right-aligned under a right-aligned header.
    expect(cells[2]?.textContent).toBe("3");
    expect(cells[2]?.className).toMatch(/\btext-right\b/);
    expect(container.querySelectorAll("th")[2]?.className).toMatch(/\btext-right\b/);
    expect(row?.querySelector(`a[href="/app/jobs/${JOB1}"]`)?.textContent).toBe("Fall 2026");
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
    const badge = [...(rows[0]?.querySelectorAll("span") ?? [])].find(
      (el) => el.textContent === "Main",
    );
    expect(badge?.className).toMatch(/\bbg-primary-soft\b/);
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

describe("People › Contacts' empty state", () => {
  const empty = () => {
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/me/list-filters")) return ok({ chips: [] });
      return ok({ contacts: [], nextCursor: null, total: 0 });
    });
  };

  it("tells owners and admins how to add one", async () => {
    empty();
    await render(<ContactsPage />, "admin");
    expect(container.textContent).toContain(messages.app.contactsList.emptyManage);
  });

  it("just says there are none to staff and photographers", async () => {
    for (const role of ["staff", "photographer"] as const) {
      empty();
      await render(<ContactsPage />, role);
      expect(container.textContent).toContain(messages.app.contactsList.empty);
      expect(container.textContent).not.toContain(messages.app.contactsList.emptyManage);
    }
  });
});

describe("The contact form", () => {
  const MARK = "e0000000-0000-4000-8000-000000000002";
  const form = () => container.querySelector("form") as HTMLFormElement;
  const field = (label: string) =>
    [...container.querySelectorAll("label")].find((l) => l.textContent === label)?.control as
      | HTMLInputElement
      | undefined;
  const type = async (input: HTMLInputElement | undefined, value: string) =>
    act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const submit = async () => {
    await act(async () => form().requestSubmit());
    await wait(10);
  };
  const noteOf = (input: Element | null | undefined) =>
    document.getElementById(input?.getAttribute("aria-describedby") ?? "")?.textContent;
  const saved = (body?: Contact) =>
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/clients")) return ok({ clients: [client], nextCursor: null, total: 1 });
      return ok({ contact: body ?? contact(MARK, "Mark", false) });
    });
  const sent = (path: string) => api.mock.calls.find((c) => c[0] === path)?.[1];

  it("asks for a client for a new contact, and sends nothing without one", async () => {
    saved();
    await render(<ContactForm contact={null} onCancel={() => {}} onSaved={() => {}} />);
    await type(field("First name (optional)"), "Mark");
    await submit();
    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox?.getAttribute("aria-invalid")).toBe("true");
    expect(noteOf(combobox)).toBe(messages.validation.client);
    expect(api.mock.calls.some((c) => c[0] === "/contacts")).toBe(false);
  });

  it("adds a contact to the chosen client, sending blank fields as null", async () => {
    saved();
    const onSaved = vi.fn();
    await render(<ContactForm contact={null} onCancel={() => {}} onSaved={onSaved} />);
    const combobox = container.querySelector('[role="combobox"]') as HTMLInputElement;
    await act(async () => combobox.click());
    await wait(250);
    const option = container.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toContain("Lincoln SD");
    await act(async () => option.click());
    await type(field("First name (optional)"), "Mark");
    await type(field("Last name (optional)"), "   ");
    await submit();
    expect(sent("/contacts")).toEqual({
      method: "POST",
      body: {
        clientId: CLIENT,
        firstName: "Mark",
        lastName: null,
        role: null,
        email: null,
        phone: null,
        isMain: false,
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("changes a contact with a PATCH that never names a client", async () => {
    saved();
    await render(
      <ContactForm contact={contact(MARK, "Mark", false)} onCancel={() => {}} onSaved={() => {}} />,
    );
    await type(field("Last name (optional)"), "");
    await submit();
    const request = sent(`/contacts/${MARK}`) as { method: string; body: Record<string, unknown> };
    expect(request.method).toBe("PATCH");
    expect(request.body).not.toHaveProperty("clientId");
    expect(request.body).toMatchObject({ firstName: "Mark", lastName: null, phone: null });
  });

  it("shows the API's errors on their own fields", async () => {
    api.mockResolvedValue({
      ok: false,
      status: 400,
      code: "invalid_input",
      message: "",
      fields: { firstName: "validation.contactEmpty", clientId: "validation.client" },
    });
    await render(<ContactForm contact={null} onCancel={() => {}} onSaved={() => {}} />);
    // A client is chosen so the form gets as far as the API.
    api.mockImplementationOnce(async () => ok({ clients: [client], nextCursor: null, total: 1 }));
    const combobox = container.querySelector('[role="combobox"]') as HTMLInputElement;
    await act(async () => combobox.click());
    await wait(250);
    await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click());
    await submit();
    expect(noteOf(field("First name (optional)"))).toBe(messages.validation.contactEmpty);
    expect(field("First name (optional)")?.getAttribute("aria-invalid")).toBe("true");
    expect(noteOf(combobox)).toBe(messages.validation.client);
    expect(field("Last name (optional)")?.getAttribute("aria-invalid")).toBeNull();
  });

  it("locks the main contact's box: someone else is made main instead", async () => {
    await render(
      <ContactForm
        contact={contact("e0000000-0000-4000-8000-000000000001", "Dana", true)}
        onCancel={() => {}}
        onSaved={() => {}}
      />,
    );
    const box = field("Main contact for this client");
    expect(box?.checked).toBe(true);
    expect(box?.disabled).toBe(true);
    expect(noteOf(box)).toBe(messages.app.contactsList.form.mainLocked);
    await render(
      <ContactForm contact={contact(MARK, "Mark", false)} onCancel={() => {}} onSaved={() => {}} />,
    );
    expect(field("Main contact for this client")?.disabled).toBe(false);
    expect(noteOf(field("Main contact for this client"))).toBe(
      messages.app.contactsList.form.mainHelp,
    );
  });

  it("limits the names to 60 characters and the email to 254", async () => {
    await render(<ContactForm contact={null} onCancel={() => {}} onSaved={() => {}} />);
    expect(field("First name (optional)")?.maxLength).toBe(60);
    expect(field("Last name (optional)")?.maxLength).toBe(60);
    expect(field("Email (optional)")?.maxLength).toBe(254);
  });

  it("opens read-only for staff and photographers, from the Contacts list", async () => {
    for (const role of ["staff", "photographer"] as const) {
      answer(role);
      await render(<ContactsPage />, role);
      const name = [...container.querySelectorAll("tbody button")].find(
        (b) => b.textContent === "Mark Ruiz",
      ) as HTMLButtonElement;
      await act(async () => name.click());
      const dialog = container.querySelector("dialog[open]");
      expect(dialog?.querySelector("h2")?.textContent).toBe(
        messages.app.contactsList.form.viewTitle,
      );
      const inputs = [...(dialog?.querySelectorAll("input:not([type=checkbox])") ?? [])];
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.every((i) => (i as HTMLInputElement).readOnly)).toBe(true);
      const box = dialog?.querySelector<HTMLInputElement>("input[type=checkbox]");
      expect(box?.disabled).toBe(true);
      expect(
        [...(dialog?.querySelectorAll("button") ?? [])].map((b) => b.textContent),
      ).not.toContain(messages.app.contactsList.form.save);
      expect(dialog?.textContent).toContain(messages.app.contactsList.form.readOnlyNote);
    }
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
    // Ordered and Not ordered are pills with their words (D91): primary-soft and grey.
    const pill = (row: Element | null | undefined) =>
      row?.querySelectorAll("td")[3]?.firstElementChild;
    expect(pill(maya)?.textContent).toBe("Ordered");
    expect(pill(maya)?.className).toMatch(/\bbg-primary-soft\b/);
    const leo = container.querySelectorAll("tbody tr")[1];
    expect(pill(leo)?.textContent).toBe("Not ordered");
    expect(pill(leo)?.className).toMatch(/\bbg-subtle\b/);
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
