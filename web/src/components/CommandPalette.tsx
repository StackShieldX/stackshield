import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_ROUTES, type NavRoute } from "./Sidebar";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filtered = useMemo<NavRoute[]>(() => {
    if (!query.trim()) return NAV_ROUTES;
    const lower = query.toLowerCase();
    return NAV_ROUTES.filter((r) => r.label.toLowerCase().includes(lower));
  }, [query]);

  // Reset state when palette opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus the input after the portal renders
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp selected index when results change
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(filtered.length - 1, 0)));
  }, [filtered]);

  const navigateTo = useCallback(
    (route: NavRoute) => {
      navigate(route.path);
      onClose();
    },
    [navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            filtered.length > 0 ? (i + 1) % filtered.length : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) =>
            filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0,
          );
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            navigateTo(filtered[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, navigateTo, onClose],
  );

  if (!open) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-surface-950/60 backdrop-blur-sm pt-[15vh]"
      onClick={onClose}
    >
      {/* Palette container */}
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-surface-800 px-4 py-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5 text-surface-500"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-surface-100 placeholder:text-surface-500 outline-none"
          />
          <kbd className="rounded border border-surface-700 bg-surface-800 px-1.5 py-0.5 font-mono text-[10px] text-surface-500">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <ul className="max-h-64 overflow-y-auto py-2" role="listbox">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-surface-500">
              No results found.
            </li>
          )}
          {filtered.map((route, i) => (
            <li
              key={route.path}
              role="option"
              aria-selected={i === selectedIndex}
              className={`mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                i === selectedIndex
                  ? "bg-accent-600/15 text-accent-400"
                  : "text-surface-300 hover:bg-surface-800"
              }`}
              onClick={() => navigateTo(route)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="shrink-0">{route.icon}</span>
              <span className="font-medium">{route.label}</span>
              <span className="ml-auto text-xs text-surface-500">{route.path}</span>
            </li>
          ))}
        </ul>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-surface-800 px-4 py-2 text-[11px] text-surface-500">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-surface-700 bg-surface-800 px-1 py-px font-mono">
              ↑↓
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-surface-700 bg-surface-800 px-1 py-px font-mono">
              ↵
            </kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-surface-700 bg-surface-800 px-1 py-px font-mono">
              esc
            </kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  );
}
