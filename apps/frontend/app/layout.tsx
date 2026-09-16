import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "secThing — SEC research workbench",
  description: "A local-first, evidence-first SEC filing research workbench.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
