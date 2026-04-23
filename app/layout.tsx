import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Data Mapping",
  description: "CSV-driven stock chart mapping with TradingView Lightweight Charts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
