import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "S-Books Hosted Payments",
  description: "Public invoice payment pages for S-Books."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
