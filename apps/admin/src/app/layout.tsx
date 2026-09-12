import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "AI Content Engine",
  description: "Multi-site WordPress content orchestration",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">AI Content Engine</div>
            <nav>
              <a href="/">Overview</a>
              <a href="/sites">Sites</a>
              <a href="/content">Content</a>
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
