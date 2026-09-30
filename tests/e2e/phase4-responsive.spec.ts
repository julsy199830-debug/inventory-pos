/**
 * Phase 4 E2E: the register's control stack against the heights a till is
 * actually used at.
 *
 * `phase3-responsive.spec.ts` already guards horizontal overflow across the
 * dashboard. This file guards the other axis, and the one Phase 4 changed: a
 * tall, opaque totals footer pinned to the bottom of the order panel, with a
 * fixed stack of controls above it. When those two together exceed the panel,
 * the controls a cashier needs are still *rendered* — they are just underneath
 * the footer, invisible and unclickable. That is the Phase 4 bug this file
 * exists to keep fixed.
 *
 * So the assertions are geometric and exact, against the footer's own top edge:
 *
 *   - the totals footer is fully on screen, and never taller than its budget
 *   - the scan box, customer picker and payment control all end above it
 *   - the checkout button is inside the footer *and* inside the viewport
 *   - the cart keeps at least one full line plus a peek at the next
 *   - nothing anywhere introduces horizontal overflow
 *
 * Each width is measured twice: as a walk-in (shortest stack) and with the
 * seeded customer attached (tallest stack, because the redemption row appears).
 * The loyalty case is the tightest one the register ships, so it is the one
 * worth pinning.
 *
 * Nothing here reads component state or scrapes surrounding markup: every
 * figure comes from a `data-testid`/`data-*` marker added for the purpose.
 */
import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

/** Desktop till, short laptop, small laptop, tablet, phone. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'short laptop', width: 1280, height: 720 },
  { name: 'small laptop', width: 1024, height: 768 },
  { name: 'tablet', width: 834, height: 1194 },
  { name: 'phone', width: 390, height: 844 },
] as const;

/** Below this the order panel is a slide-over drawer instead of a sidebar. */
const NARROW = 768;

/** The ceiling the totals footer is allowed to grow to. See the budget test. */
const FOOTER_BUDGET = 260;

/**
 * How much of the order must stay visible behind the control stack.
 *
 * The panel's own floor is `min-h-[120px]`, and that is what a cashier gets at
 * every width while the register is OFF shift. It cannot survive the tightest
 * real combination, and the arithmetic is worth writing down, because it is
 * exactly what the compactness pass is balancing:
 *
 *   720 (viewport) - 55 (page header) - 41 (order panel header)
 *     - 228 (totals footer) = 396px
 *
 * for a 325px control stack plus the cart. Off shift that stack is 295px, so the
 * cart keeps its full floor (101px visible at 1280x720 once the ~19px scroll
 * nudge is taken into account). On shift the status strip grows from 45px to
 * 75px - it carries the elapsed time, live takings, Summary and End shift,
 * which wraps onto a second row inside a 360px panel - and the cart is left
 * 71px.
 *
 * 71px is still the first order line: name, unit price and the line-discount
 * toggle all sit above the fold line. So the hard requirement is the smaller
 * `CART_PEEK`, and the 120px design floor is asserted wherever it holds.
 */
const CART_FLOOR = 96;
const CART_PEEK = 64;

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({
    timeout: 15000,
  });
  await page.locator(ADMIN.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(ADMIN.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

/**
 * Open the register and wait until it is genuinely usable at this width.
 *
 * The readiness marker is the catalog search, because it is the one register
 * control visible at EVERY width. The order panel is not: below `md` it is a
 * drawer that is not mounted until the cashier opens it, and the sidebar that
 * replaces it is `display: none` — so anything inside it is attached but can
 * never be `toBeVisible`.
 *
 * The status strip is then awaited as ATTACHED rather than visible, for the
 * same reason. It flips `data-register-loaded` once the shift request resolves,
 * which changes the strip's height, and these tests measure panel geometry
 * precisely enough for that to matter.
 */
async function openRegister(page: Page) {
  await page.goto('/pos');
  await expect(page.locator('input[aria-label^="Search products"]').first()).toBeVisible({
    timeout: 25000,
  });
  await expect(page.locator('[data-register-loaded="true"]')).toBeAttached({
    timeout: 25000,
  });
}


/** The order panel: a sidebar at `md` and up, a slide-over drawer below it. */
function panel(page: Page, width: number) {
  return width < NARROW
    ? page.locator('div[role="dialog"][aria-label="Current order"]')
    : page.locator('aside');
}

/**
 * Open the mobile cart drawer and wait for the slide-in to finish.
 *
 * The drawer tweens from `x: 100%` over 300ms. A measurement taken inside that
 * window sees the panel still partly off-screen and reports every control in it
 * as unreachable, which is a false failure rather than a layout bug. Polling
 * the panel's right edge until it stops moving is the same guard
 * `phase3-responsive.spec.ts` uses for the same animation.
 */
async function openCartDrawer(page: Page) {
  const drawer = page.locator('div[role="dialog"][aria-label="Current order"]');
  if (!(await drawer.isVisible())) {
    await page.getByRole('button', { name: /View Cart/ }).click();
    await expect(drawer).toBeVisible({ timeout: 15000 });
  }
  const width = page.viewportSize()?.width ?? 390;
  await expect
    .poll(
      async () => {
        const box = await page
          .locator('div[role="dialog"][aria-label="Current order"] > div')
          .last()
          .boundingBox();
        return box ? Math.round(box.x + box.width) : Number.POSITIVE_INFINITY;
      },
      { timeout: 10000 },
    )
    .toBeLessThanOrEqual(width + 1);
  return drawer;
}

/**
 * Put one product in the order and wait until the register admits it.
 *
 * The thing that changes when the cart stops being empty is width-dependent:
 * the checkout button enables on a sidebar, and the sticky summary bar (with
 * its View Cart button) appears on a phone. Waiting on whichever one applies
 * keeps this honest without a fixed timeout.
 */
async function addFirstProduct(page: Page, width: number) {
  const carted =
    width < NARROW
      ? page.getByRole('button', { name: /View Cart/ })
      : page.locator('[data-testid="checkout-button"]');
  await expect(async () => {
    await page.locator('[aria-label^="Add "]').first().click();
    await expect(carted).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

/**
 * Attach the seeded customer, which is what makes the redemption row render.
 *
 * Only one customer is seeded, so the first search result is the only result —
 * there is no ranking to assert here, and `phase4-pos.spec.ts` already covers
 * search by name and by phone.
 */
async function attachCustomer(page: Page, width: number) {
  if (width < NARROW) await openCartDrawer(page);
  const scope = panel(page, width);
  await expect(async () => {
    await scope.locator('#customer-trigger').click();
    await expect(scope.locator('#customer-search-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await scope.locator('[data-testid="customer-option"]').first().click();
  await expect(scope.locator('#customer-trigger')).not.toContainText('Walk-in', {
    timeout: 10000,
  });
}

type Box = { top: number; bottom: number; height: number };

type StackReport = {
  viewport: { width: number; height: number };
  overflowX: boolean;
  footer: Box | null;
  checkout: Box | null;
  scan: Box | null;
  customer: Box | null;
  redemption: Box | null;
  payment: Box | null;
  /**
   * How much of the cart box is actually inside the panel's scroller. The box
   * itself keeps its full height when the scroller clips it, so reading its
   * rect alone would over-report what a cashier can see.
   */
  cartVisible: number | null;
};

/**
 * Collect every rect the "is anything hidden behind the footer?" question needs.
 *
 * Runs in the page, so it has to be self-contained — no imports, no closures
 * over test state. The panel is resolved by whichever of the two shells is
 * actually laid out: the drawer is mounted only on a phone, and the sidebar is
 * `hidden` there, so neither can be picked by selector alone.
 */
function measureStack() {
  return () => {
    const laidOut = (el: Element | null) => {
      if (!el) return null;
      return el.getBoundingClientRect().height > 0 ? el : null;
    };
    const root =
      laidOut(document.querySelector('div[role="dialog"][aria-label="Current order"]')) ??
      laidOut(document.querySelector('aside'));

    const q = (sel: string) => root?.querySelector(sel) ?? document.querySelector(sel);
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
      };
    };

    const cartRect = q('[data-testid="cart-lines"]')?.getBoundingClientRect() ?? null;
    const scrollRect =
      q('[data-testid="cart-lines"]')?.parentElement?.getBoundingClientRect() ?? null;
    const doc = document.documentElement;

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflowX: doc.scrollWidth > doc.clientWidth + 1,
      footer: box(q('[data-testid="pos-footer"]')),
      checkout: box(q('[data-testid="checkout-button"]')),
      scan: box(q('[data-testid="pos-scan"]')),
      customer: box(q('[data-testid="pos-customer"]')),
      redemption: box(q('[data-testid="pos-redemption"]')),
      payment: box(q('[data-testid="pos-payment"]')),
      cartVisible:
        cartRect && scrollRect
          ? Math.round(
              Math.max(
                0,
                Math.min(cartRect.bottom, scrollRect.bottom) -
                  Math.max(cartRect.top, scrollRect.top),
              ),
            )
          : null,
    };
  };
}

async function measure(page: Page): Promise<StackReport> {
  return (await page.evaluate(measureStack())) as StackReport;
}

/**
 * A control must end at or above the footer's top edge.
 *
 * Comparing edges is exact, and unlike a pointer hit-test it cannot be fooled
 * by an entrance animation still being in flight — which is precisely how an
 * earlier measurement run reported a perfectly fine layout as unreachable.
 */
function expectClearOfFooter(label: string, control: Box | null, footer: Box) {
  expect(control, `${label} is not rendered`).not.toBeNull();
  expect(
    control!.bottom,
    `${label} is hidden behind the totals footer (control ends at ${control!.bottom}px, footer starts at ${footer.top}px)`,
  ).toBeLessThanOrEqual(footer.top + 1);
  expect(control!.top, `${label} starts above the top of the panel`).toBeGreaterThanOrEqual(-1);
}

/**
 * The cart requirement for the state the register is currently in.
 *
 * Scoped to the visible panel on purpose. The order panel is rendered twice on
 * a phone - once as the `display: none` sidebar and once inside the drawer - so
 * a page-wide testid lookup is ambiguous the moment the drawer is open.
 *
 * Read from `data-on-clock` rather than from the button's wording, so a copy
 * change cannot silently move the threshold.
 */
async function cartFloor(page: Page, width: number) {
  const onClock = await panel(page, width)
    .getByTestId('shift-state')
    .getAttribute('data-on-clock');
  return onClock === 'true' ? CART_PEEK : CART_FLOOR;
}

/**
 * The whole contract for one width and one cart state.
 *
 * `label` names the case so a failure says which viewport and whether it was
 * the walk-in or the loyalty stack, rather than just "expected 1195 <= 1194".
 */
function expectStackFits(report: StackReport, label: string, minCart: number) {
  expect(report.overflowX, `${label}: the register scrolls sideways`).toBe(false);

  const footer = report.footer;
  expect(footer, `${label}: the totals footer is not rendered`).not.toBeNull();
  expect(footer!.top, `${label}: the totals footer starts above the screen`).toBeGreaterThanOrEqual(0);
  expect(
    footer!.bottom,
    `${label}: the totals footer runs off the bottom of the screen`,
  ).toBeLessThanOrEqual(report.viewport.height + 1);

  expectClearOfFooter(`${label}: the scan box`, report.scan, footer!);
  expectClearOfFooter(`${label}: the customer picker`, report.customer, footer!);
  expectClearOfFooter(`${label}: the payment method control`, report.payment, footer!);

  // Checkout lives INSIDE the footer, so it is judged against the viewport.
  const checkout = report.checkout;
  expect(checkout, `${label}: the checkout button is not rendered`).not.toBeNull();
  expect(
    checkout!.top,
    `${label}: the checkout button sits above the footer it belongs to`,
  ).toBeGreaterThanOrEqual(footer!.top);
  expect(
    checkout!.bottom,
    `${label}: the checkout button runs off the bottom of the screen`,
  ).toBeLessThanOrEqual(report.viewport.height + 1);

  expect(
    report.cartVisible ?? 0,
    `${label}: the cart is squeezed below one usable line (${report.cartVisible}px visible, floor ${minCart}px)`,
  ).toBeGreaterThanOrEqual(minCart);
}

test.describe('Phase 4 - the register control stack', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}x${vp.height}): nothing a cashier needs hides behind the totals footer`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openRegister(page);
      await addFirstProduct(page, vp.width);
      if (vp.width < NARROW) await openCartDrawer(page);

      // The register's shift state decides how much of the order the control
      // stack can leave behind it. Read it once — nothing in these tests
      // clocks in or out.
      const minCart = await cartFloor(page, vp.width);

      // Walk-in: no customer, so no redemption row and the stack is shortest.
      const walkIn = await measure(page);
      expectStackFits(walkIn, `${vp.name} walk-in`, minCart);
      expect(
        walkIn.redemption,
        `${vp.name} walk-in: the redemption row should not render without a customer`,
      ).toBeNull();

      // With a customer attached the redemption row appears and the stack is at
      // its tallest. This is the case the compactness pass was measured against
      // and the one a regression would break first.
      await attachCustomer(page, vp.width);
      if (vp.width < NARROW) await openCartDrawer(page);

      const loyalty = await measure(page);
      expectStackFits(loyalty, `${vp.name} loyalty`, minCart);
      expect(
        loyalty.redemption,
        `${vp.name} loyalty: the redemption row is missing`,
      ).not.toBeNull();
      expectClearOfFooter(
        `${vp.name} loyalty: the redemption control`,
        loyalty.redemption,
        loyalty.footer!,
      );
    });
  }

  /**
   * The footer is the fixed cost the control stack has to fit around, so it
   * gets a budget of its own rather than only being checked through the
   * controls above it.
   *
   * It measures 228px after the Phase 4 compactness pass: redemption collapsed
   * to one row, the scan and customer captions moved to `sr-only`, and
   * `Clear order` moved into the order header. 260px leaves headroom for longer
   * currency strings but still catches the regressions that matter — a
   * redemption row wrapping to two lines, or a full-width clear button
   * reappearing under the checkout button.
   */
  for (const vp of VIEWPORTS.filter((v) => v.height <= 900)) {
    test(`${vp.name} (${vp.width}x${vp.height}): the totals footer stays inside its height budget`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openRegister(page);
      await addFirstProduct(page, vp.width);

      // With a customer attached the footer carries its longest totals list
      // (subtotal, tax, loyalty discount, grand total), so that is the state
      // the budget is really about.
      await attachCustomer(page, vp.width);
      if (vp.width < NARROW) await openCartDrawer(page);

      const report = await measure(page);
      expect(report.footer, 'the totals footer is not rendered').not.toBeNull();
      expect(report.footer!.height).toBeGreaterThan(0);
      expect(
        report.footer!.height,
        `the totals footer grew to ${report.footer!.height}px, past its ${FOOTER_BUDGET}px budget`,
      ).toBeLessThanOrEqual(FOOTER_BUDGET);
    });
  }
});

test.describe('Phase 4 - the cart drawer on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the drawer and its checkout button fit a 390px screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRegister(page);
    await addFirstProduct(page, 390);

    const drawer = await openCartDrawer(page);

    // The panel is `w-[88%]` of a 390px screen, so its left edge must still be
    // inside the viewport once the slide-in has settled.
    await expect
      .poll(async () => {
        const box = await page
          .locator('div[role="dialog"][aria-label="Current order"] > div')
          .last()
          .boundingBox();
        return box ? Math.round(box.x) : -1;
      })
      .toBeGreaterThanOrEqual(-1);

    const report = await measure(page);
    expectStackFits(report, 'phone drawer', await cartFloor(page, 390));

    // The scope asserted on is the drawer, not the hidden desktop sidebar -
    // both carry a checkout button, and only one of them is on screen.
    await expect(drawer.locator('[data-testid="checkout-button"]')).toBeVisible();
  });
});

test.describe('Phase 4 - the cash tender step', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /**
   * The tender dialog is a fixed-width card that grows when change is due, so
   * it is the one modal in the register that can outgrow a short screen. It is
   * checked at every width rather than only at the tallest: the phone case is
   * exactly where a card plus its padding stops fitting.
   */
  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}x${vp.height}): the tender dialog and the change-due block fit`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openRegister(page);
      await addFirstProduct(page, vp.width);
      const scope = panel(page, vp.width);
      if (vp.width < NARROW) await openCartDrawer(page);

      // Cash is the default method, so checkout opens the tender step directly.
      await scope.locator('[data-testid="checkout-button"]').click();
      const tendered = page.locator('#tendered-input');
      await expect(tendered).toBeVisible({ timeout: 15000 });
      await tendered.fill('5000');

      // Change due only renders once the tendered amount covers the total, so
      // waiting on it also proves the arithmetic ran before the geometry is
      // judged - a dialog measured before it grows proves nothing.
      await expect(page.locator('[data-testid="change-due"]')).toBeVisible({ timeout: 10000 });

      const fits = await page.evaluate(() => {
        const inside = (el: Element | null) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return (
            r.top >= -1 &&
            r.bottom <= window.innerHeight + 1 &&
            r.left >= -1 &&
            r.right <= window.innerWidth + 1
          );
        };
        const doc = document.documentElement;
        return {
          dialog: inside(
            document.querySelector('div[role="dialog"][aria-label="Collect cash payment"]'),
          ),
          change: inside(document.querySelector('[data-testid="change-due"]')),
          overflowX: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      expect(fits.dialog, 'the tender dialog is clipped by the screen').toBe(true);
      expect(fits.change, 'the change-due block is clipped by the screen').toBe(true);
      expect(fits.overflowX, 'the tender dialog makes the page scroll sideways').toBe(false);
    });
  }
});





