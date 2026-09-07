import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "ReturnWell GP Referrals",
  description: "Find, send and track allied health referrals.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "ReturnWell GP Referrals",
    description: "Find, send and track allied health referrals",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "ReturnWell GP Referrals",
    description: "Find, send and track allied health referrals",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
