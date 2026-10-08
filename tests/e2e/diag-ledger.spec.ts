import { test, expect } from '@playwright/test';

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator(ADMIN.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(ADMIN.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

/** Same flow as phase4-responsive.spec.ts so the numbers are comparable. */
async function setupLoyalty(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);
  await page.goto('/pos');
  await expect(page.locator('input[aria-label^="Search or scan"]').first()).toBeVisible({ timeout: 25000 });

  await expect(async () => {
    await page.locator('[aria-label^="Add "]').first().click();
    await expect(page.locator('[data-testid="cart-lines"] li').first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });

  const scope = page.locator('aside');
  await expect(async () => {
    await scope.locator('#customer-trigger').click();
    await expect(scope.locator('#customer-search-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await scope.locator('[data-testid="customer-option"]').first().click();
  await expect(scope.locator('#customer-trigger')).not.toContainText('Walk-in', { timeout: 10000 });
  await expect(scope.locator('[data-testid="pos-redemption"]')).toBeVisible({ timeout: 15000 });
}

/** Read-only geometry of the register at the current viewport. */
async function ledger(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector(s);
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
    };
    const header = q('header');
    const brand = header ? header.children[1] : null;
    const nav = brand ? brand.querySelector('nav') : null;
    const controls = header ? header.children[header.children.length - 1] : null;
    const cart = q('[data-testid="cart-lines"]');
    const cartRect = cart?.getBoundingClientRect() ?? null;
    const scroller = cart?.parentElement ?? null;
    const scrollRect = scroller?.getBoundingClientRect() ?? null;
    const aside = q('aside');
    return {
      header: box(header),
      brand: box(brand),
      nav: box(nav),
      navDisplay: nav ? getComputedStyle(nav).display : null,
      navWrap: nav ? getComputedStyle(nav).flexWrap : null,
      navChildren: nav
        ? Array.from(nav.children).map((c) => ({
            tag: c.tagName,
            text: (c.textContent || '').trim().slice(0, 30),
            h: Math.round(c.getBoundingClientRect().height),
            w: Math.round(c.getBoundingClientRect().width),
          }))
        : [],
      controls: box(controls),
      trigger: box(q('[data-testid="global-search-trigger"]')),
      aside: box(aside),
      asideHeader: aside ? box(aside.children[0]) : null,
      scroller: box(scroller),
      scrollerScrollH: scroller ? scroller.scrollHeight : null,
      scrollerScrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      shiftState: box(q('[data-testid="shift-state"]')),
      onClock: q('[data-testid="shift-state"]')?.getAttribute('data-on-clock'),
      scan: box(q('[data-testid="pos-scan"]')),
      customer: box(q('#customer-trigger')),
      redemption: box(q('[data-testid="pos-redemption"]')),
      payment: box(q('[data-testid="pos-payment"]')),
      cartLines: box(cart),
      cartVisible:
        cartRect && scrollRect
          ? Math.round(
              Math.max(0, Math.min(cartRect.bottom, scrollRect.bottom) - Math.max(cartRect.top, scrollRect.top)),
            )
          : null,
      footer: box(q('[data-testid="pos-footer"]')),
      docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

test('diag: full vertical ledger at 1280x720 loyalty', async ({ page }) => {
  await setupLoyalty(page);
  await page.waitForTimeout(800);

  const before = await ledger(page);
  console.log('LEDGER-BEFORE ' + JSON.stringify(before, null, 1));

  // Attribution WITHOUT touching the tree: hide only the Step 5 trigger and
  // re-measure. If the breadcrumb un-wraps and the cart recovers, the delta is
  // the trigger widening the header row — not the strip, not the footer.
  await page.addStyleTag({ content: '[data-testid="global-search-trigger"]{display:none !important;}' });
  await page.waitForTimeout(400);
  const after = await ledger(page);
  console.log('LEDGER-NO-TRIGGER ' + JSON.stringify(after, null, 1));

  console.log(
    'DELTA ' +
      JSON.stringify(
        {
          headerH: [before.header?.h, after.header?.h],
          navH: [before.nav?.h, after.nav?.h],
          navChildren: [before.navChildren, after.navChildren],
          controlsW: [before.controls?.w, after.controls?.w],
          brandW: [before.brand?.w, after.brand?.w],
          scrollerH: [before.scroller?.h, after.scroller?.h],
          cartVisible: [before.cartVisible, after.cartVisible],
          onClock: before.onClock,
          footerH: [before.footer?.h, after.footer?.h],
          scrollerScrollTop: [before.scrollerScrollTop, after.scrollerScrollTop],
        },
        null,
        1,
      ),
  );

  expect(before.header, 'header must render').not.toBeNull();
});
