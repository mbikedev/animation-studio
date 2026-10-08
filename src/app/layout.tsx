import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getPreferences } from "@/lib/preferences";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Animation Studio", template: "%s · Animation Studio" },
  description: "Studio web de vidéos animées à partir d'un portrait et d'un audio.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme, locale } = await getPreferences();
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} ${theme === "dark" ? "dark" : ""} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
