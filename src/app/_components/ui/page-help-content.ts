import type { HelpContent } from "./PageHelp";

/**
 * Phase 7 Step 6 — one place for every page's contextual help.
 *
 * `PageHeader` looks up content by `helpId`, so a page opts in with a single
 * string and the wording cannot drift between pages. Each entry is written
 * from the page's ACTUAL buttons and routes — no invented steps, no links to
 * destinations that do not exist. Links point only to pages the reader's role
 * already permits (the dashboard is staff-only, so every `nextStep` here is a
 * staff destination).
 */
export const PAGE_HELP: Record<string, HelpContent> = {
  dashboard: {
    id: "dashboard",
    title: "About your Dashboard",
    purpose:
      "This is your home screen. It shows how the business is doing right now and what needs your attention today.",
    tasks: [
      "Read Today's sales, transactions and your shift status at the top.",
      "Work through the Needs attention list — each row links to the fix.",
      "Use a Quick action to jump straight to the tool you need.",
    ],
    nextStep: { label: "Open the Point of Sale", href: "/pos" },
    note: "You are not clocked in? The dashboard reminds you so your hours and sales are recorded.",
  },
  inventory: {
    id: "inventory",
    title: "About Products & Stock",
    purpose:
      "Manage the products you sell, including prices, stock and images. Changes here flow straight to the Point of Sale.",
    tasks: [
      "Add a product so it can be sold in the Point of Sale.",
      "Edit a price, SKU, category or image.",
      "Filter the list by stock state — all, low or out of stock.",
      "Open Stock Count to compare physical stock with the system.",
    ],
    nextStep: { label: "Review low-stock items", href: "/inventory?status=low" },
  },
  categories: {
    id: "categories",
    title: "About Categories",
    purpose:
      "Group your products so they are easy to find and so each group can carry its own low-stock threshold.",
    tasks: [
      "Add a category to organise products.",
      "Set a low-stock threshold so the system warns you before a group runs out.",
      "Rename or remove a category when your range changes.",
    ],
    nextStep: { label: "Manage products", href: "/inventory" },
  },
  customers: {
    id: "customers",
    title: "About Customers",
    purpose:
      "Keep your customer list so you can attach sales to a customer, track loyalty points and manage store credit.",
    tasks: [
      "Add a customer, or open a row to edit details, record a payment, or view their statement.",
      "Search by name, email or phone; sort by debt, points, spending or last purchase.",
      "Page through the directory — the header shows the running total.",
    ],
    note: "An empty list just means no one has been added yet — select Add Customer to create the first profile; a name is enough to start.",
  },
  "customer-account": {
    id: "customer-account",
    title: "About a Customer Account",
    purpose:
      "See one customer's full account — what they owe, what they have paid, loyalty points and store credit.",
    tasks: [
      "Read the charges, payments, refunds, voids and adjustments behind the balance, plus loyalty activity.",
      "Narrow the window with From / To, then export the filtered statement as CSV or print it.",
    ],
    nextStep: { label: "Back to all customers", href: "/customers" },
    note: "An account only shows activity once the customer has a credit sale, payment or loyalty event.",
  },
  suppliers: {
    id: "suppliers",
    title: "About Suppliers",
    purpose:
      "Keep the businesses you buy stock from, with the details you need on your purchase orders.",
    tasks: [
      "Add a supplier you buy from.",
      "Edit contact details, address or notes.",
      "Delete a supplier you no longer use (products that referenced it simply lose the link).",
    ],
    nextStep: { label: "Go to Purchase Orders", href: "/purchasing" },
  },
  purchasing: {
    id: "purchasing",
    title: "About Purchase Orders",
    purpose:
      "Track what you have ordered from suppliers and receive stock against those orders.",
    tasks: [
      "Create a purchase order for a supplier.",
      "Open an order to see its items and progress.",
      "Receive stock to add items to inventory and record the history.",
    ],
    nextStep: { label: "Add a supplier first", href: "/suppliers" },
    note: "An empty list just means no orders yet — create your first order to start tracking deliveries.",
  },

  "purchase-order": {
    id: "purchase-order",
    title: "About this Purchase Order",
    purpose:
      "View one order: its items, what has been received so far, and what is still outstanding.",
    tasks: [
      "Review ordered, received and outstanding quantities.",
      "Receive stock against this order.",
      "Track receiving history as deliveries arrive.",
    ],
    nextStep: { label: "Back to all orders", href: "/purchasing" },
  },
  employees: {
    id: "employees",
    title: "About Employees",
    purpose:
      "Manage the people who use the system — their logins, roles and PINs.",
    tasks: [
      "Add an employee and set their role (Cashier, Manager, Admin).",
      "Change a role or reset a PIN.",
      "Deactivate someone who has left so they can no longer sign in.",
    ],
    nextStep: { label: "Go to Time & Attendance", href: "/dtr" },
    note: "Deactivating keeps past sales and attendance — it only blocks new sign-ins.",
  },
  dtr: {
    id: "dtr",
    title: "About Time & Attendance (DTR)",
    purpose:
      "Review employee attendance — clock-ins, clock-outs and breaks — and correct any missing punches.",
    tasks: [
      "Review each shift's clock in, clock out, breaks and worked time.",
      "Move the From / To dates to cover the period you need.",
      "Correct a missed punch with a reason; the change is kept in the audit trail.",
    ],
    nextStep: { label: "Manage employees", href: "/employees" },
    note: "Attendance records are created when staff clock in from the Point of Sale or My Activity.",
  },
  reports: {
    id: "reports",
    title: "About Sales Reports",
    purpose:
      "The end-of-day Z-Report for one date: how much you sold, how customers paid, and what's left after costs.",
    tasks: [
      "Pick the date, press Load, then read the day: revenue, net profit, transactions, payment breakdown, COGS and top products.",
      "Press Print Report for the close-out sheet, Export CSV for the daily summary, or Export sales to preview the filtered rows then download CSV or Excel.",
    ],
    nextStep: { label: "See the Dashboard summary", href: "/" },
  },
  analytics: {
    id: "analytics",
    title: "About Sales Analytics",
    purpose:
      "See how sales are trending — what's selling, which categories lead, and how the totals move over time.",
    tasks: [
      "Read the KPI tiles: revenue, orders, average sale and top category.",
      "Follow the trend in the sales chart, then compare categories in the donut.",
      "Check Top Selling Products to see what's moving.",
    ],
    nextStep: { label: "Back to the daily report", href: "/reports" },
  },
  accounting: {
    id: "accounting",
    title: "About Accounting",
    purpose:
      "See the money side — revenue, net profit and margin for the period you choose.",
    tasks: [
      "Pick a range to read revenue, costs and profit for that period.",
      "Scan the per-product profitability breakdown, ranked by profit.",
      "Check margin and tax to see what's actually kept.",
    ],
    nextStep: { label: "Go to Sales Reports", href: "/reports" },
  },
  "audit-log": {
    id: "audit-log",
    title: "About the Audit Log",
    purpose:
      "See a record of important actions — who did what, and when.",
    tasks: [
      "Filter by module, action, user or date range — or search the text of entries.",
      "Expand a row to see the before → after change details.",
      "Export the filtered view to CSV or Excel for review.",
    ],
    nextStep: { label: "Go to Reports", href: "/reports" },
  },
  settings: {
    id: "settings",
    title: "About Store Settings",
    purpose:
      "Set your store name, currency, tax and receipt details. These apply everywhere in the system.",
    tasks: [
      "Enter your store name and receipt information.",
      "Set the currency symbol and code, and the tax rate.",
      "Choose how dates and times are shown.",
    ],
    note: "Changes apply across the Point of Sale, receipts, dashboard and reports straight after saving.",
  },
  pos: {
    id: "pos",
    title: "How to make a sale",
    purpose:
      "Follow the steps left to right. Customer is optional for a walk-in sale.",
    tasks: [
      "Start shift to record your hours before selling.",
      "Search or scan a product to add it to the Current Order.",
      "Choose a customer for loyalty or store credit — or sell to a Walk-in.",
      "Pick a payment method, take the cash, and show the change.",
      "Complete Sale, then view or print the receipt.",
    ],
    note: "Your shift, attendance and transactions are linked from the header at the top of the screen.",
  },
};
