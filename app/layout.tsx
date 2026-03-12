import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scale Technics | MMCD Intelligence Workspace",
  description:
    "Search construction specifications, inspect cited PDF pages, and ask an evidence-linked MMCD agent.",
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
