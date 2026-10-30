import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Lora, Newsreader } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SpeculationRules from "@/components/site/SpeculationRules";
import { siteUrl } from "@/lib/route";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const lora = Lora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-lora", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Bare Acts of India – Full Text of Central Acts",
    template: "%s | Jurinex Bare Acts",
  },
  description:
    "Read the full bare act text of Indian central acts – BNS, BNSS, BSA, Constitution and more – section by section.",
  applicationName: "Jurinex Bare Acts",
  openGraph: {
    type: "website",
    siteName: "Jurinex",
    locale: "en_IN",
  },
  twitter: { card: "summary" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable} ${newsreader.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-white font-body text-nx-ink">
        <Header />
        {/* The header is fixed and 5rem tall, like the React app's PublicPageShell. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-8 pt-28 sm:px-8 sm:pb-10 sm:pt-30">{children}</main>
        <Footer />
        <SpeculationRules />
      </body>
    </html>
  );
}
