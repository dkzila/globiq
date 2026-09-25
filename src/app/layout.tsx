import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "GlobIQ — Next-Gen Global GK & Current Affairs Platform",
    template: "%s | GlobIQ",
  },
  description:
    "One unified, multilingual, personalised knowledge system for general learners and exam aspirants — replacing GK books, magazines and GK-only coaching.",
  keywords: ["GlobIQ", "GK", "General Knowledge", "Current Affairs", "Exam Preparation", "Mock Tests", "Quizzes"],
  applicationName: "GlobIQ",
  openGraph: {
    title: "GlobIQ — Next-Gen Global GK & Current Affairs Platform",
    description: "Personalised, exam-centric GK and current affairs — one canonical knowledge system.",
    siteName: "GlobIQ",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GlobIQ — Next-Gen Global GK & Current Affairs Platform",
    description: "Personalised, exam-centric GK and current affairs — one canonical knowledge system.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
