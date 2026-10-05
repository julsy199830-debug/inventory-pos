import { getCustomers } from "./actions";
import { CustomersClient } from "./CustomersClient";
import { getFormatSettings } from "@/lib/store-config";

export const metadata = { title: "Customers — InvPos" };

export default async function CustomersPage() {
  const [result, format] = await Promise.all([getCustomers(), getFormatSettings()]);
  const rows = result.ok ? result.data : [];

  // Phase 6: the store's currency/date settings travel to the client island, so
  // the list, the payment dialog and the statement all print the same amounts.
  return <CustomersClient initialRows={rows} format={format} />;
}
