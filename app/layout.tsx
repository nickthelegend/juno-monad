import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Juno API",
  description: "The API behind Juno — every post is a market, on Monad.",
  robots: { index: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
