import { getCustomers } from "./actions";
import { CustomersClient } from "./CustomersClient";

export const metadata = { title: "Customers — JuLs POS" };

export default async function CustomersPage() {
  const result = await getCustomers();
  const rows = result.ok ? result.data : [];

  return <CustomersClient initialRows={rows} />;
}
