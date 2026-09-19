import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maria — Siruma AI Tourism Ambassador",
  description: "Meet Maria, an interactive voice and text tourism ambassador for Siruma.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-PH">
      <body className="antialiased">{children}</body>
    </html>
  );
}
