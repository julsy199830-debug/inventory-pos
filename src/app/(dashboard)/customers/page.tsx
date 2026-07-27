import { prisma } from '@/lib/db'
import AddCustomerDialog from './AddCustomerDialog'
import EditCustomerDialog from './EditCustomerDialog'
import DeleteCustomerButton from './DeleteCustomerButton'

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <AddCustomerDialog />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Name
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Email
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Phone
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Address
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Loyalty Points
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {customer.name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {customer.email ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {customer.phone ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {customer.address ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {customer.loyaltyPoints}
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex gap-2">
                    <EditCustomerDialog customer={customer} />
                    <DeleteCustomerButton id={customer.id} />
                  </div>
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-gray-500"
                >
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
