import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    // Wait for full hydration
    await page.waitForLoadState('networkidle');
    // Wait for the login form to be visible
    await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display login page with user selection and PIN input', async ({ page }) => {
    // Check for logo/branding
    await expect(page.locator('img[alt="InvPos"]').first()).toBeVisible();
    
    // Check for user selection
    await expect(page.locator('text=Who are you?').first()).toBeVisible();
    
    // Check for PIN input label
    await expect(page.locator('text=Enter your PIN').first()).toBeVisible();
    
    // Check for submit button (disabled initially)
    const submitBtn = page.locator('button:has-text("Open register")').first();
    await expect(submitBtn).toBeDisabled();
  });

  test('should successfully login with valid admin credentials', async ({ page }) => {
    // Select Admin user
    await page.locator('button:has-text("Admin")').first().click();
    
    // Wait for PIN input to be enabled with longer timeout
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });
    
    // Enter valid PIN
    await pinInput.fill('1234');
    
    // Submit button should now be enabled
    const submitBtn = page.locator('button:has-text("Open register")').first();
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    
    // Submit login
    await submitBtn.click();
    
    // Should redirect to dashboard (or / since admin is not cashier)
    await expect(page).toHaveURL(/.*\/$/, { timeout: 15000 });
  });

  test('should successfully login with valid cashier credentials', async ({ page }) => {
    // Select Cashier user
    await page.locator('button:has-text("Cashier")').first().click();
    
    // Wait for PIN input to be enabled with longer timeout
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });
    
    // Enter valid PIN
    await pinInput.fill('0000');
    
    // Submit button should now be enabled
    const submitBtn = page.locator('button:has-text("Open register")').first();
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    
    // Submit login
    await submitBtn.click();
    
    // Should redirect to POS
    await expect(page).toHaveURL(/.*\/pos$/, { timeout: 15000 });
  });

  test('should show error with invalid PIN', async ({ page }) => {
    // Select Admin user
    await page.locator('button:has-text("Admin")').first().click();
    
    // Wait for PIN input to be enabled with longer timeout
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });
    
    // Enter invalid PIN
    await pinInput.fill('9999');
    
    // Submit login
    await page.locator('button:has-text("Open register")').first().click();
    
    // Should show error
    await expect(page.locator('text=Incorrect employee or PIN')).toBeVisible({ timeout: 10000 });
  });

  test('should show error with invalid PIN for cashier', async ({ page }) => {
    // Select Cashier user
    await page.locator('button:has-text("Cashier")').first().click();
    
    // Wait for PIN input to be enabled with longer timeout
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });
    
    // Enter invalid PIN
    await pinInput.fill('9999');
    
    // Submit login
    await page.locator('button:has-text("Open register")').first().click();
    
    // Should show error
    await expect(page.locator('text=Incorrect employee or PIN')).toBeVisible({ timeout: 10000 });
  });

  test('should show error when PIN is too short', async ({ page }) => {
    // Select Admin user
    await page.locator('button:has-text("Admin")').first().click();
    
    // Wait for PIN input to be enabled with longer timeout
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });
    
    // Enter PIN with less than 4 digits
    await pinInput.fill('123');
    
    // Submit button should still be disabled
    const submitBtn = page.locator('button:has-text("Open register")').first();
    await expect(submitBtn).toBeDisabled({ timeout: 5000 });
  });

  test('should clear error when selecting different user', async ({ page }) => {
    // Select Admin user and enter invalid PIN
    await page.locator('button:has-text("Admin")').first().click();
    
    // Wait for PIN input to be enabled with longer timeout
    let pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });
    
    await pinInput.fill('9999');
    await page.locator('button:has-text("Open register")').first().click();
    await expect(page.locator('text=Incorrect employee or PIN')).toBeVisible({ timeout: 10000 });
    
    // Select Cashier user - error should clear
    await page.locator('button:has-text("Cashier")').first().click();
    
    // Wait for PIN input to be enabled again with longer timeout
    pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });
    
    await expect(page.locator('text=Incorrect employee or PIN')).not.toBeVisible({ timeout: 10000 });
    // PIN should be cleared
    await expect(pinInput).toHaveValue('', { timeout: 5000 });
  });
});