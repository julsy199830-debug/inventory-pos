import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InvPos",
  description: "Inventory & Point of Sale",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-700">
        {children}
        {/* App-wide toasts: checkout success, barcode scan errors, stock
            updates. Mounted once at the root so they surface on both /pos
            (register) and every dashboard page. */}
        <Toaster
          theme="light"
          richColors
          position="top-center"
          toastOptions={{
            classNames: {
              toast:
                "rounded-xl border border-slate-200 bg-white text-slate-800 shadow-lg shadow-slate-900/10",
            },
          }}
        />
      </body>
    </html>
  );
}
