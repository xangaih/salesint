import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DIBBS RFQ Finder",
  description: "Find the DLA RFQs that match your business",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen text-sm antialiased">{children}</body>
    </html>
  );
}
