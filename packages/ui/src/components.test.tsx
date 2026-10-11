import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardTitle,
  Celebration,
  CodeInput,
  clampPercent,
  Field,
  JobProgress,
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
        <Celebration title="You're live!" body="Parents can order now." />
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
          studioColor="#4338ca"
          cartLabel="Cart, 0 items"
          footer="Powered by Daybell"
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

  it("clamps progress", () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("picks white text on a dark studio colour", () => {
    const { container } = render(
      <ShopFrame
        studioName="NP"
        studioInitials="NP"
        studioColor="#4338ca"
        cartLabel="Cart"
        footer="f"
      >
        x
      </ShopFrame>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--color-on-studio")).toBe("#ffffff");
  });

  it("buttons default to type=button so they never submit a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("button");
  });
});
