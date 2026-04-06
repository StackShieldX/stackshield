import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";

/** Breakpoint (px) below which the sidebar auto-collapses. */
const COLLAPSE_BREAKPOINT = 768;

export default function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.innerWidth < COLLAPSE_BREAKPOINT,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Auto-collapse sidebar on narrow viewports
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${COLLAPSE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setSidebarCollapsed(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Global keyboard shortcut for command palette (Cmd+K / Ctrl+K)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
