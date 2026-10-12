import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import {
  Badge,
  Banner,
  Button,
  buttonVariants,
  Card,
  CardRow,
  CardTitle,
  Celebration,
  CodeInput,
  clampPercent,
  cn,
  contrastRatio,
  Field,
  IconButton,
  IconChip,
  iconButtonVariants,
  JobProgress,
  MIN_UI_CONTRAST,
  MoneyStat,
  OptionCard,
  PhotoTile,
  ShopFrame,
  SideMenu,
  SideMenuItem,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Toast,
  uiColorOn,
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

  it("a sheet card has 24px corners and no border; its rows are hairlines", async () => {
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
    expect(sheet.className).toMatch(/\brounded-xl\b/);
    expect(sheet.className).not.toMatch(/\bborder\b/);
    expect(screen.getByText("One").className).toMatch(/\bborder-b\b/);
    expect(screen.getByText("One").className).toMatch(/\bmin-h-14\b/);
    await expectNoA11yViolations(container);
  });
});
