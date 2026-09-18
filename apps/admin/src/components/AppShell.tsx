"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { ToastHost } from "@/components/ToastHost";
import { api, getToken, setToken } from "@/lib/api";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (pathname?.startsWith("/login")) {
      setReady(true);
      return;
    }
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    api("/auth/me")
      .then(() => setReady(true))
      .catch(() => {
        setToken(null);
        router.replace("/login");
      });
  }, [pathname, router]);

  if (pathname?.startsWith("/login")) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  function logout() {
    api("/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
    setToken(null);
    router.replace("/login");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">AI Content Engine</div>
        <nav className="topbar-nav" aria-label="Primary">
          <Link href="/" className={pathname === "/" ? "active" : ""}>
            Dashboard
          </Link>
          <Link href="/sites" className={pathname === "/sites" ? "active" : ""}>
            Sites
          </Link>
          <Link
            href="/maintenance"
            className={pathname === "/maintenance" ? "active" : ""}
          >
            Maintenance
          </Link>
        </nav>
        <button type="button" className="ghost logout-btn" onClick={logout}>
          Log out
        </button>
      </header>
      <main className="main">{children}</main>
      <ToastHost />
    </div>
  );
}
