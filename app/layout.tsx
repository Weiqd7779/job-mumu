import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "求職姆姆",
    template: "%s｜求職姆姆",
  },
  description:
    "用可追溯的職缺統計、公司薪資與公開職場訊號，準備下一份工作。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    title: "求職姆姆｜台灣職缺證據分析",
    description: "以程式統計 JD，結合公開薪資、論壇訊號與 Agent 建議。",
    images: [
      {
        url: "/job-mumu-social.png",
        width: 1731,
        height: 907,
        alt: "求職姆姆的職缺證據帳本",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/job-mumu-social.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
