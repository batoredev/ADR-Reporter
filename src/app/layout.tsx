import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s · ADR Reporter",
    default: "ADR Reporter",
  },
  description: "AI-assisted adverse drug reaction reporting and institutional verification (fictional prototype).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
