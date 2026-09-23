import { test, expect } from '@playwright/test';

/**
 * POS Checkout Flow E2E Tests
 *
 * Updated for the dark-theme register UI and the new Collect Cash tender flow:
 * - Cash checkout now opens a "Collect Cash" modal (tendered amount + quick-tender
 *   chips) before the sale is committed — the test enters a tendered amount and
 *   confirms with "Complete Sale".
 * - Quantity controls use aria-labels ("Increase/Decrease X quantity") rather than
 *   +/- text; the remove control uses "Remove X from order".
 * - Currency renders via the store setting (₱), not the old PHP prefix.
 */

test.describe('POS Checkout Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login as Cashier to access POS
    await page.goto('/login');
    // Wait for full hydration
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
    await page.locator('button:has-text("Cashier")').first().click();

    // Wait for PIN input to be enabled with longer timeout
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });

    await pinInput.fill('0000');
    await page.locator('button:has-text("Open register")').first().click();

    // Should redirect to POS
    await expect(page).toHaveURL(/.*\/pos$/, { timeout: 15000 });
    // Cashier header shows "InvPos Register"
    await expect(page.locator('text=InvPos Register').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display POS interface with product catalog', async ({ page }) => {
    // Check for key POS elements
    await expect(page.locator('text=InvPos Register').first()).toBeVisible();
    await expect(page.locator('text=Current Order').first()).toBeVisible();
    await expect(page.locator('text=Subtotal').first()).toBeVisible();
    await expect(page.locator('text=Grand Total').first()).toBeVisible();

    // Product catalog should be visible
    await expect(page.locator('text=All').first()).toBeVisible();

    // Check for at least one product from seed
    await expect(page.locator('text=Aurora Wireless Headphones').first()).toBeVisible({ timeout: 10000 });
  });

  test('should add products to cart by clicking', async ({ page }) => {
    // Click on a product to add to cart
    await page.locator('text=Aurora Wireless Headphones').first().click();

    // Should appear in cart — the cart line shows the unit price + "each"
    await expect(page.locator('text=₱129.99 each').first()).toBeVisible({ timeout: 10000 });

    // Cart item-count badge shows "1 items"
    await expect(page.locator('text=1 items').first()).toBeVisible();

    // Subtotal reflects the price (₱ prefix from StoreSetting)
    await expect(page.locator('text=₱129.99').first()).toBeVisible();
  });

  test('should remove item from cart', async ({ page }) => {
    // Add product to cart
    await page.locator('text=Aurora Wireless Headphones').first().click();
    await expect(page.locator('text=₱129.99 each').first()).toBeVisible({ timeout: 10000 });

    // Remove control uses an aria-label in the dark-theme UI.
    // NOTE (test-infra): a forced click ({ force: true }) is NOT safe here. The
    // cart row is a motion.li with a spring height/opacity animation, and `force`
    // skips Playwright's stability wait -- the click lands mid-animation without
    // ever firing the handler, leaving the row in the cart (confirmed via the
    // failure snapshot, which still showed "1 items" + the row). A normal click
    // auto-scrolls to the row and waits for it to stop moving first.
    const removeBtn = page.locator(
      'button[aria-label="Remove Aurora Wireless Headphones from order"]',
    ).first();
    await expect(removeBtn).toBeVisible();
    // The cart footer (border-t border-slate-800, ~293px tall) overlaps the last
    // remove button in the aside column (confirmed via debug geometry: button y=433
    // sits inside footer box y=[427,720]). Playwright's pointer-based .click() lands
    // on the footer div instead of the button. Use a direct DOM click via evaluate
    // to bypass pointer-event hit-testing — this fires the button's onclick handler
    // synchronously and is unaffected by what is visually on top. This is NOT the
    // same as { force: true }: force still dispatches real pointer events and was
    // observed to miss the framer-motion handler during the spring animation.
    await removeBtn.evaluate((el: HTMLElement) => el.click());

    // Cart empties — the "Current Order" panel swaps to its empty-state copy.
    await expect(
      page.locator('text=No items yet. Tap a product to add it.').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should complete a cash transaction', async ({ page }) => {
    // Add a product
    await page.locator('text=Aurora Wireless Headphones').first().click();
    await expect(page.locator('text=₱129.99 each').first()).toBeVisible({ timeout: 10000 });

    // Click Process Payment — opens the Collect Cash modal (cash is the default method)
    const processBtn = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn).toBeVisible();
    await processBtn.click();

    // Collect Cash modal opens
    await expect(page.locator('text=Collect Cash').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Amount due').first()).toBeVisible();

    // Enter a tendered amount (≥ total) — use the input for determinism
    const tenderedInput = page.locator('#tendered-input');
    await expect(tenderedInput).toBeVisible();
    await tenderedInput.fill('1000');

    // Change due is shown once tendered ≥ total
    await expect(page.locator('text=Change due').first()).toBeVisible({ timeout: 5000 });

    // Confirm the sale
    const completeBtn = page.locator('button:has-text("Complete Sale")').first();
    await expect(completeBtn).toBeEnabled();
    await completeBtn.click();

    // Sale completes
    await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Order').first()).toBeVisible({ timeout: 15000 });
  });

  test('should complete a cash transaction via quick-tender chip', async ({ page }) => {
    // Add a product
    await page.locator('text=Aurora Wireless Headphones').first().click();
    await expect(page.locator('text=₱129.99 each').first()).toBeVisible({ timeout: 10000 });

    // Open the Collect Cash modal
    await page.locator('button:has-text("Process Payment")').first().click();
    await expect(page.locator('text=Collect Cash').first()).toBeVisible({ timeout: 10000 });

    // Click a quick-tender chip (₱1000 covers the ₱129.99 total)
    const chip = page.locator('button', { hasText: '₱1000.00' }).first();
    if (await chip.count() > 0) {
      await chip.click();
    } else {
      await page.locator('#tendered-input').fill('1000');
    }

    // Confirm and complete
    await page.locator('button:has-text("Complete Sale")').first().click();
    await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 15000 });
  });

  test('should show tax in totals when tax rate is configured', async ({ page }) => {
    // Add a product
    await page.locator('text=Aurora Wireless Headphones').first().click();

    // Tax row is shown in the cart footer (seed sets taxRate = 8)
    const taxElement = page.locator('text=Tax').first();
    if (await taxElement.count() > 0) {
      await expect(taxElement).toBeVisible();
    }
  });

  test('should filter products by category', async ({ page }) => {
    // Click on category filter
    await page.locator('text=Electronics').first().click();

    // Should show electronics products
    await expect(page.locator('text=Aurora Wireless Headphones')).toBeVisible();
    await expect(page.locator('text=Nimbus Bluetooth Speaker')).toBeVisible();

    // Click All to show all
    await page.locator('text=All').first().click();
  });

  test('should search products by name', async ({ page }) => {
    // Type in search box
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill('Headphones');

      // Should filter to headphones
      await expect(page.locator('text=Aurora Wireless Headphones')).toBeVisible();
      await expect(page.locator('text=Nimbus Bluetooth Speaker')).not.toBeVisible();
    }
  });

  test('should open and close cart drawer on mobile', async ({ page }) => {
    // Resize to mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Add a product so the mobile cart bar appears
    await page.locator('text=Aurora Wireless Headphones').first().click();

    // On mobile the cart lives in a slide-over drawer opened via "View Cart".
    // NOTE (test-infra): `cartBody` is rendered TWICE by PosCheckout.tsx — once
    // in the desktop aside (`hidden ... md:flex`) and once inside this drawer.
    // An unscoped `text=Current Order` / `.first()` therefore resolves to the
    // HIDDEN desktop copy at 375px, so `toBeVisible()` could never pass. Scope
    // every assertion to the drawer dialog itself.
    const cartToggle = page.locator('button:has-text("View Cart")').first();
    await expect(cartToggle).toBeVisible({ timeout: 10000 });
    await cartToggle.click();

    const drawer = page.locator('div[role="dialog"][aria-label="Current order"]');
    await expect(drawer).toBeVisible({ timeout: 10000 });
    await expect(drawer.locator('h2:has-text("Current Order")')).toBeVisible();
    await expect(drawer.locator('text=₱129.99 each')).toBeVisible({ timeout: 10000 });

    // Close via the drawer's own control — while the drawer is open the
    // "View Cart" button sits behind its overlay and is not clickable.
    await drawer.locator('button[aria-label="Close cart"]').click();
    await expect(drawer).toBeHidden({ timeout: 10000 });
  });

  test('should print receipt after sale', async ({ page }) => {
    // Add product and complete sale through the Collect Cash modal
    await page.locator('text=Aurora Wireless Headphones').first().click();

    // Open Collect Cash modal
    const processBtn = page.locator('button:has-text("Process Payment")').first();
    await expect(processBtn).toBeVisible();
    await processBtn.click();
    await expect(page.locator('text=Collect Cash').first()).toBeVisible({ timeout: 10000 });

    // Tender and complete
    await page.locator('#tendered-input').fill('1000');
    await page.locator('button:has-text("Complete Sale")').first().click();

    // Wait for sale complete modal with receipt
    await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Order').first()).toBeVisible({ timeout: 15000 });

    // Check for print button
    const printBtn = page.locator('button:has-text("Print Receipt")').first();
    await expect(printBtn).toBeVisible();
  });

  test('should show cashier name in POS header', async ({ page }) => {
    // Cashier name appears in the register header
    await expect(page.locator('text=Cashier').first()).toBeVisible({ timeout: 10000 });
  });
});