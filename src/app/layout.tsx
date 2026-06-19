import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hero AI · Content Engine",
  description: "แดชบอร์ดสร้างคอนเทนต์โซเชียลด้วย AI",
};

// ป้องกันธีมกระพริบตอนโหลด — ตั้ง class ก่อน React hydrate
const themeScript = `
(function(){
  try {
    var s = localStorage.getItem('theme');
    var d = s ? s === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (d) document.documentElement.classList.add('dark');
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
