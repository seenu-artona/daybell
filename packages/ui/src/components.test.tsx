import { act, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Badge,
  Banner,
  Button,
  buttonVariants,
  Card,
  CardRow,
  CardTitle,
  Celebration,
  ClickableRow,
  CONFETTI_MS,
  CodeInput,
  ConfettiBurst,
  clampPercent,
  cn,
  contrastRatio,
  Field,
  IconButton,
  IconChip,
  iconButtonVariants,
  JobProgress,
  ListCard,
  MainTab,
  MainTabs,
  MIN_UI_CONTRAST,
  MoneyStat,
  OptionCard,
  PageHeader,
  PhotoTile,
  RowChevron,
  RowChevronHead,
  SearchToggle,
  ShopFrame,
  SideMenu,
  SideMenuItem,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Toast,
  uiColorOn,
  ViewBar,
  ViewTab,
  ViewTabs,
} from "./index";

async function expectNoA11yViolations(container: HTMLElement) {
  // Colour contrast is checked against the tokens in tokens.test.ts; jsdom cannot compute it.
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe("components", () => {
  it("render together with no accessibility violations", async () => {
    const { container } = render(
      <main>
        <SideMenu label="Main" brand="Daybell">
          <SideMenuItem href="/jobs" current>
            Jobs
          </SideMenuItem>
          <SideMenuItem href="/orders" count={12} countLabel="12 new orders">
            Orders
          </SideMenuItem>
        </SideMenu>
        <Button>Publish job</Button>
        <Field label="Job name" help="Parents see this." />
        <Field label="Access code" error="Codes need 6 characters." />
        <Badge tone="selling">Selling</Badge>
        <Card>
          <CardTitle>Lincoln Elementary</CardTitle>
        </Card>
        <Table>
          <thead>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead numeric>Total</TableHead>
            </TableRow>
          </thead>
          <tbody>
            <TableRow>
              <TableCell>#10234</TableCell>
              <TableCell numeric>$84.00</TableCell>
            </TableRow>
          </tbody>
        </Table>
        <MoneyStat label="Sales this season" cents={4826000} currency="USD" animate={false} />
        <JobProgress title="Lincoln" percent={68} label="Sales goal" />
        <Celebration
          title="You're live!"
          announcement="You're live!"
          body="Parents can order now."
        />
        <Banner tone="danger" title="Card declined">
          Ask the parent to try another card.
        </Banner>
        <Toast>New order</Toast>
        <PhotoTile
          image={<img src="data:," alt="Ava, pose 1" />}
          tag="Pose 1"
          watermark="NORTH PEAK"
        />
        <ShopFrame
          studioName="North Peak Photo"
          studioInitials="NP"
          studioColor="navy"
          cartLabel="Cart, 0 items"
          footer="Secure checkout"
        >
          <CodeInput
            value="LINC"
            onChange={() => {}}
            label="Access code"
            charLabel={(n) => `Character ${n}`}
          />
          <OptionCard name="pk" title="Family" price="$54" flag="Most popular" defaultChecked />
        </ShopFrame>
      </main>,
    );
    await expectNoA11yViolations(container);
  });

  it("names an option by its title alone, and describes it by the rest (WCAG 4.1.2)", () => {
    render(<OptionCard name="pk" title="Family" description="2 prints" price="$54" />);
    const radio = screen.getByRole("radio", { name: "Family" });
    expect(
      radio
        .getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent),
    ).toEqual(["2 prints", "$54"]);
  });

  it("marks an input invalid and links the error message", () => {
    render(<Field label="Access code" error="Codes need 6 characters." />);
    const input = screen.getByLabelText("Access code");
    expect(input).toHaveProperty("ariaInvalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByText("Codes need 6 characters.").id,
    );
  });

  it("shows the money figure once to screen readers", () => {
    render(<MoneyStat label="Sales" cents={4826000} currency="USD" animate={false} />);
    expect(screen.getAllByText("$48,260")).toHaveLength(2);
  });

  it("has an info badge tone, apart from the job status tones", () => {
    render(<Badge tone="info">Default</Badge>);
    const badge = screen.getByText("Default", { exact: true });
    expect(badge.className).toMatch(/\bbg-info-soft\b/);
    expect(badge.className).toMatch(/\btext-info\b/);
  });

  it("clamps progress", () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("picks white text on a dark studio colour", () => {
    const { container } = render(
      <ShopFrame studioName="NP" studioInitials="NP" studioColor="navy" cartLabel="Cart" footer="f">
        x
      </ShopFrame>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--color-on-studio")).toBe("#ffffff");
  });

  it("keeps type sizes when a colour class follows (tailwind-merge)", () => {
    expect(cn("text-caption text-muted")).toBe("text-caption text-muted");
    expect(cn("text-body text-h1")).toBe("text-h1");
  });

  it("falls back to charcoal for an unknown studio colour", () => {
    const { container } = render(
      // @ts-expect-error simulating a bad value from storage
      <ShopFrame studioName="NP" studioInitials="NP" studioColor="red;" cartLabel="Cart" footer="f">
        x
      </ShopFrame>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--color-studio")).toBe("#1c1c1e");
  });

  it("darkens a light studio colour for focus rings until it reaches 3:1", () => {
    const ring = uiColorOn("#f2b33d");
    expect(contrastRatio(ring, "#ffffff")).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    expect(uiColorOn("#4338ca")).toBe("#4338ca");
  });

  it("fills access-code boxes without gaps", () => {
    let value = "LI";
    const { rerender } = render(
      <CodeInput
        value={value}
        onChange={(v) => {
          value = v;
        }}
        label="Code"
        charLabel={(n) => `Character ${n}`}
      />,
    );
    const box5 = screen.getByLabelText("Character 5");
    box5.focus();
    expect(document.activeElement).toBe(screen.getByLabelText("Character 3"));
    rerender(
      <CodeInput
        value={value}
        onChange={() => {}}
        label="Code"
        charLabel={(n) => `Character ${n}`}
      />,
    );
  });

  it("buttons default to type=button so they never submit a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("button");
  });

  it("table scroll box contains absolutely positioned content such as sr-only text", () => {
    // jsdom has no layout, so check the class that makes the scroll box the containing block (D72).
    render(
      <Table>
        <tbody>
          <TableRow>
            <TableCell>#10234</TableCell>
          </TableRow>
        </tbody>
      </Table>,
    );
    const box = screen.getByRole("table").parentElement;
    expect(box?.className).toMatch(/\brelative\b/);
    expect(box?.className).toMatch(/\boverflow-x-auto\b/);
  });
});

describe("D137 layout pieces", () => {
  it("a flat table has no box but still scrolls inside itself", () => {
    render(
      <Table variant="flat">
        <tbody>
          <TableRow>
            <TableCell>Maya</TableCell>
          </TableRow>
        </tbody>
      </Table>,
    );
    const box = screen.getByRole("table").parentElement;
    expect(box?.className).toMatch(/\brelative\b/);
    expect(box?.className).toMatch(/\boverflow-x-auto\b/);
    expect(box?.className).not.toMatch(/\bborder\b/);
    expect(box?.className).not.toMatch(/\brounded/);
  });

  it("a folded menu shows icons only, and every item keeps its name", async () => {
    const { container } = render(
      <SideMenu label="Main" folded>
        <SideMenuItem href="/jobs" icon={<svg />} current folded>
          Jobs
        </SideMenuItem>
        <SideMenuItem href="/orders" icon={<svg />} tag="Soon" folded>
          Orders
        </SideMenuItem>
      </SideMenu>,
    );
    expect(screen.getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Orders Soon" })).toBeDefined();
    expect(screen.getByText("Jobs").className).toContain("sr-only");
    expect(screen.getByText("Soon").className).toContain("sr-only");
    expect(screen.getByRole("navigation", { name: "Main" }).className).toContain("w-16");
    await expectNoA11yViolations(container);
  });
});

describe("D140 job page pieces", () => {
  it("an icon button is round, 44px, named by its label, and has a visible focus ring", async () => {
    const { container } = render(
      <main>
        <IconButton label="More actions">
          <svg aria-hidden="true" />
        </IconButton>
      </main>,
    );
    const button = screen.getByRole("button", { name: "More actions" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toMatch(/\bsize-11\b/);
    expect(button.className).toMatch(/\brounded-full\b/);
    expect(button.className).toMatch(/focus-visible:outline-2/);
    await expectNoA11yViolations(container);
  });

  it("an icon button can render a link (the job header's back button)", () => {
    render(
      <IconButton asChild label="All jobs">
        <a href="/app/jobs">
          <svg aria-hidden="true" />
        </a>
      </IconButton>,
    );
    const link = screen.getByRole("link", { name: "All jobs" });
    expect(link.getAttribute("type")).toBeNull();
    expect(link.className).toMatch(/\bsize-11\b/);
  });

  it("requires a label for an icon button (type check)", () => {
    // @ts-expect-error label is required: an icon-only button needs a name.
    const element = <IconButton>x</IconButton>;
    expect(element).toBeDefined();
  });

  it("the canvas tone sits on white cards and panels", () => {
    expect(iconButtonVariants({ tone: "canvas" })).toMatch(/\bbg-canvas\b/);
    expect(iconButtonVariants()).toMatch(/\bbg-surface\b/);
  });

  it("an icon chip is always hidden from screen readers, whatever is passed", () => {
    const { container } = render(
      <IconChip tone="lime" data-testid="chip">
        <svg />
      </IconChip>,
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.className).toMatch(/\bbg-lime-soft\b/);
    expect(chip.className).toMatch(/\bsize-9\.5\b/);
  });

  it("an initials avatar is a round chip", () => {
    const { container } = render(
      <IconChip tone="info" shape="round">
        MJ
      </IconChip>,
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.className).toMatch(/\brounded-full\b/);
  });

  it("a pill button is fully round; the pill's rounding and padding win over the size's", () => {
    const classes = buttonVariants({ variant: "white", shape: "pill" });
    expect(classes).toMatch(/\brounded-full\b/);
    expect(classes).not.toMatch(/\brounded-md\b/);
    expect(classes).toMatch(/\bpx-5\b/);
    expect(classes).not.toMatch(/px-\[18px\]/);
    expect(classes).toMatch(/\bmin-h-11\b/);
    expect(classes).toMatch(/\bbg-surface\b/);
    render(<Button shape="pill">Start selling</Button>);
    const button = screen.getByRole("button", { name: "Start selling" });
    expect(button.className).toMatch(/\bbg-primary\b/);
    expect(button.className).toMatch(/\brounded-full\b/);
  });

  it("a sheet card has 20px corners, a soft shadow and no border; its rows are hairlines (D144)", async () => {
    const { container } = render(
      <main>
        <Card variant="sheet" asChild>
          <section aria-label="To-dos">
            <CardRow>One</CardRow>
            <CardRow>Two</CardRow>
          </section>
        </Card>
      </main>,
    );
    const sheet = screen.getByRole("region", { name: "To-dos" });
    expect(sheet.className).toMatch(/\brounded-list\b/);
    expect(sheet.className).toMatch(/\bshadow-card\b/);
    expect(sheet.className).not.toMatch(/\bborder\b/);
    expect(screen.getByText("One").className).toMatch(/\bborder-b\b/);
    expect(screen.getByText("One").className).toMatch(/\bmin-h-14\b/);
    await expectNoA11yViolations(container);
  });
});

function Search({ initial = "", onSubmit }: { initial?: string; onSubmit?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <main>
      <SearchToggle
        label="Search children"
        value={value}
        onChange={setValue}
        {...(onSubmit ? { onSubmit } : {})}
      />
    </main>
  );
}

describe("D144 list pieces", () => {
  it("main tabs: a navigation of links, the current one ink, white and bold with aria-current", async () => {
    const { container } = render(
      <main>
        <MainTabs label="Job sections">
          <MainTab href="/a" current>
            Overview
          </MainTab>
          <MainTab href="/b">Subjects</MainTab>
        </MainTabs>
      </main>,
    );
    expect(screen.getByRole("navigation", { name: "Job sections" })).toBeDefined();
    const current = screen.getByRole("link", { name: "Overview" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toMatch(/\bbg-ink\b/);
    expect(current.className).toMatch(/\btext-on-primary\b/);
    expect(current.className).toMatch(/\bfont-bold\b/);
    expect(current.className).toMatch(/\bh-11\b/);
    const other = screen.getByRole("link", { name: "Subjects" });
    expect(other.getAttribute("aria-current")).toBeNull();
    expect(other.className).toMatch(/\btext-muted\b/);
    expect(other.className).not.toMatch(/\bfont-bold\b/);
    // A page's first row (D145, amends D144): with many views (Orders), the row scrolls sideways.
    const nav = screen.getByRole("navigation", { name: "Job sections" });
    expect(nav.querySelector("ul")?.className).toMatch(/\boverflow-x-auto\b/);
    await expectNoA11yViolations(container);
  });

  it("view bar: a page's first row has no line under it; a second level under pill tabs does", () => {
    render(
      <main>
        <ViewBar data-testid="main" actions={<button type="button">New job</button>} />
        <ViewBar data-testid="sub" variant="sub" actions={<button type="button">Upload</button>} />
      </main>,
    );
    expect(screen.getByTestId("main").className).not.toMatch(/\bborder-b\b/);
    expect(screen.getByTestId("sub").className).toMatch(/\bborder-b\b/);
    expect(screen.getByTestId("sub").className).toMatch(/\bborder-line-canvas\b/);
  });

  it("view tabs: aria-current, bold, and a dash hidden from screen readers; the bar puts actions on the right in order", async () => {
    const { container } = render(
      <main>
        <ViewBar
          variant="sub"
          tabs={
            <ViewTabs label="Order views">
              <ViewTab href="?status=" current>
                All
              </ViewTab>
              <ViewTab href="?status=paid">Paid</ViewTab>
            </ViewTabs>
          }
          actions={
            <>
              <button type="button">Delivery: Any</button>
              <button type="button">Print QR cards</button>
              <button type="button">New job</button>
            </>
          }
        />
      </main>,
    );
    const all = screen.getByRole("link", { name: "All" });
    expect(all.getAttribute("aria-current")).toBe("page");
    expect(all.className).toMatch(/\bfont-bold\b/);
    expect(all.className).toMatch(/\bh-14\b/);
    expect(screen.getByRole("link", { name: "Paid" }).getAttribute("aria-current")).toBeNull();
    const dashes = container.querySelectorAll("[data-view-dash]");
    expect(dashes).toHaveLength(1);
    expect(dashes[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Delivery: Any",
      "Print QR cards",
      "New job",
    ]);
    const nav = screen.getByRole("navigation", { name: "Order views" });
    expect(nav.querySelector("ul")?.className).toMatch(/\boverflow-x-auto\b/);
    await expectNoA11yViolations(container);
  });

  it("search toggle: a named button that opens a search box with focus in it", async () => {
    const { container } = render(<Search />);
    const button = screen.getByRole("button", { name: "Search children" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // No aria-controls while the box doesn't exist: it would point at nothing.
    expect(button.hasAttribute("aria-controls")).toBe(false);
    expect(button.className).toMatch(/\bsize-11\b/);
    fireEvent.click(button);
    const box = screen.getByRole("searchbox", { name: "Search children" });
    expect(document.activeElement).toBe(box);
    await expectNoA11yViolations(container);
  });

  it("search toggle: leaving an empty box closes it without taking focus back", () => {
    render(<Search />);
    fireEvent.click(screen.getByRole("button", { name: "Search children" }));
    fireEvent.blur(screen.getByRole("searchbox"));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Search children" })).toBeDefined();
  });

  it("search toggle: Escape on an empty box closes it and returns focus to the button", () => {
    render(<Search />);
    fireEvent.click(screen.getByRole("button", { name: "Search children" }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search children" }));
  });

  it("search toggle: stays open while it holds text, even on blur and Escape", () => {
    render(<Search />);
    fireEvent.click(screen.getByRole("button", { name: "Search children" }));
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "Maya" } });
    fireEvent.blur(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByRole("searchbox")).toBeDefined();
  });

  it("search toggle: starts open with a value, and submits on Enter when asked", () => {
    const onSubmit = vi.fn();
    render(<Search initial="7KQ2" onSubmit={onSubmit} />);
    const box = screen.getByRole("searchbox", { name: "Search children" });
    expect(screen.getByRole("search")).toBeDefined();
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledWith("7KQ2");
  });

  it("clickable row: a click on the row activates it; clicks on its link, button or checkbox don't", async () => {
    const onActivate = vi.fn();
    const { container } = render(
      <main>
        <ListCard footer="3 jobs">
          <Table variant="list">
            <thead>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Pick</TableHead>
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              <ClickableRow onActivate={onActivate}>
                <TableCell>
                  <a href="/jobs/1" className="group-hover:underline">
                    Lincoln
                  </a>
                </TableCell>
                <TableCell>
                  <label>
                    <input type="checkbox" /> Select Lincoln
                  </label>
                  <button type="button">Make default</button>
                </TableCell>
                <RowChevron />
              </ClickableRow>
            </tbody>
          </Table>
        </ListCard>
      </main>,
    );
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    expect(row.className).toMatch(/\bcursor-pointer\b/);
    expect(row.className).toMatch(/hover:bg-canvas/);
    fireEvent.click(screen.getByRole("cell", { name: "Lincoln" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: "Lincoln" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Lincoln" }));
    fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    // A click that ends a text selection is the selection's, not the row's.
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "Linc",
    } as Selection);
    fireEvent.click(screen.getByRole("cell", { name: "Lincoln" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    selection.mockRestore();
    // Ctrl- or Cmd-click opens the row's main link in a new tab, like the link itself would.
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(screen.getByRole("cell", { name: "Lincoln" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("cell", { name: "Lincoln" }), { metaKey: true });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/1$/), "_blank", "noopener");
    expect(onActivate).toHaveBeenCalledTimes(1);
    open.mockRestore();
    const chevron = row.lastElementChild as HTMLElement;
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
    expect(chevron.className).toMatch(/\btext-line-strong\b/);
    expect(screen.getByText("3 jobs").className).toMatch(/\btext-muted\b/);
    const card = container.querySelector("section") as HTMLElement;
    expect(card.className).toMatch(/\brounded-list\b/);
    expect(card.className).toMatch(/\bshadow-card\b/);
    await expectNoA11yViolations(container);
  });

  it("page header: a list page has its h1; a record has a back button, its h1 and actions", async () => {
    const { container, rerender } = render(
      <main>
        <PageHeader title="Jobs" />
      </main>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Jobs" }).className).toMatch(
      /\btext-h1\b/,
    );
    rerender(
      <main>
        <PageHeader
          variant="record"
          title="Lincoln Elementary"
          back={
            <IconButton asChild label="All jobs">
              <a href="/app/jobs">
                <svg aria-hidden="true" />
              </a>
            </IconButton>
          }
          status={<Badge tone="selling">Selling</Badge>}
          details="School · Sep 24"
          actions={<Button shape="pill">Close shop</Button>}
        />
      </main>,
    );
    const h1 = screen.getByRole("heading", { level: 1, name: "Lincoln Elementary" });
    expect(h1.className).toMatch(/\btext-job-title\b/);
    expect(screen.getByRole("link", { name: "All jobs" }).className).toMatch(/\bsize-11\b/);
    expect(screen.getByText("School · Sep 24")).toBeDefined();
    expect(screen.getByRole("button", { name: "Close shop" })).toBeDefined();
    await expectNoA11yViolations(container);
  });

  it("quiet buttons and icon buttons have no fill until hovered, and stay 44px", () => {
    const quiet = buttonVariants({ variant: "quiet" });
    expect(quiet).toMatch(/\bbg-transparent\b/);
    expect(quiet).toMatch(/\bhover:bg-surface\b/);
    expect(quiet).toMatch(/\bmin-h-11\b/);
    expect(iconButtonVariants({ tone: "quiet" })).toMatch(/\bbg-transparent\b/);
  });

  it("cn lets a later radius or shadow token replace an earlier one", () => {
    expect(cn("rounded-xl shadow-sm", "rounded-list shadow-card")).toBe("rounded-list shadow-card");
  });
});

describe("ConfettiBurst (D75, D91)", () => {
  const motion = (reduce: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query })),
    );
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("draws nothing at all when reduced motion is asked for, and is done at once", () => {
    motion(true);
    const onDone = vi.fn();
    const { container } = render(<ConfettiBurst onDone={onDone} />);
    expect(container.innerHTML).toBe("");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("bursts for 1–2 seconds in token colours, hidden from assistive technology and clicks, then goes", async () => {
    vi.useFakeTimers();
    motion(false);
    const onDone = vi.fn();
    const { container } = render(
      <main>
        <ConfettiBurst onDone={onDone} />
      </main>,
    );
    const burst = container.querySelector("[data-confetti]") as HTMLElement;
    expect(burst.getAttribute("aria-hidden")).toBe("true");
    expect(burst.className).toMatch(/\bpointer-events-none\b/);
    expect(burst.className).toMatch(/\bmotion-reduce:hidden\b/);
    const pieces = [...burst.querySelectorAll("span")];
    expect(pieces.length).toBe(40);
    for (const piece of pieces) {
      expect(piece.className).toMatch(/\bbg-(primary|lime|info|warning)\b/);
      expect(piece.getAttribute("style")).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
    expect(CONFETTI_MS).toBeGreaterThanOrEqual(1000);
    expect(CONFETTI_MS).toBeLessThanOrEqual(2000);
    act(() => {
      vi.advanceTimersByTime(CONFETTI_MS + 200);
    });
    expect(container.querySelector("[data-confetti]")).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
