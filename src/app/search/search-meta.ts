import {
  FileText,
  Package,
  ReceiptText,
  ShoppingBasket,
  User,
  UserCog,
} from "lucide-react";
import type { SearchGroups, SearchResultKind } from "./actions";

/** Icon + type word per result kind, shared by dialog + results list. */
export const KIND_META: Record<SearchResultKind, { label: string; Icon: typeof Package }> = {
  page: { label: "Page", Icon: FileText },
  product: { label: "Product", Icon: Package },
  customer: { label: "Customer", Icon: User },
  sale: { label: "Sale", Icon: ReceiptText },
  "purchase-order": { label: "Order", Icon: ShoppingBasket },
  employee: { label: "Staff", Icon: UserCog },
};

/** Group render order: records first, page shortcuts last. */
export const GROUP_ORDER: { key: keyof SearchGroups; title: string }[] = [
  { key: "customers", title: "Customers" },
  { key: "products", title: "Products" },
  { key: "sales", title: "Sales" },
  { key: "purchaseOrders", title: "Purchase Orders" },
  { key: "employees", title: "Staff" },
  { key: "pages", title: "Pages" },
];
