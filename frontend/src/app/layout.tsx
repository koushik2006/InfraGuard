import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { AppProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "InfraGuard — structural-health early warning (simulated)",
  description: "Decision support for structural-health monitoring. Simulated data. Not a safety certification.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
