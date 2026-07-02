import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AR Assets Studio",
  description: "為 AR 教學情境生成 AR 物件",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Pin version: unversioned unpkg served 4.3.x which spams console with debug logs. */}
        <Script type="module" src="https://unpkg.com/@google/model-viewer@4.0.0/dist/model-viewer.min.js" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}
