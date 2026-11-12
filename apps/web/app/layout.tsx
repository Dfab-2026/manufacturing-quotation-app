import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ForgeQuote", template: "%s | ForgeQuote" },
  description: "Secure manufacturing RFQ, costing and quotation platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
