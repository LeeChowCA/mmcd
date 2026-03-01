import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMCD Search",
  description:
    "Search specifications, requirements, and procedures across municipal construction PDF documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
