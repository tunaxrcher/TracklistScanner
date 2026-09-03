import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { HydrationGuard } from "@/components/HydrationGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tracklist Scanner",
  description: "Scan media for songs with Shazam + ACRCloud, then grab them from DJ Pool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Inline on purpose: when Chrome restores a tab it reuses cached JS
            chunks without revalidating, so a `next dev` server whose code
            changed meanwhile ships HTML that its stale chunks can't hydrate.
            The React tree never mounts, no API call is made and the page is
            a dead shell. If we're in that state after a history navigation,
            reload once (a real reload revalidates the chunks). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
var nav=performance.getEntriesByType("navigation")[0];
if(!nav||nav.type!=="back_forward"||sessionStorage.getItem("hydration-reloaded"))return;
setTimeout(function(){
  if(document.documentElement.dataset.hydrated)return;
  sessionStorage.setItem("hydration-reloaded","1");
  fetch("/api/health?stale-restore=1",{keepalive:true}).catch(function(){});
  location.reload();
},3000);
})();`,
          }}
        />
        <HydrationGuard />
        {children}
      </body>
    </html>
  );
}
