import { NavLink } from "react-router-dom";

/** Navigation route definition used by both Sidebar and CommandPalette. */
export interface NavRoute {
  path: string;
  label: string;
  icon: React.ReactNode;
}

// Inline SVG icons to avoid adding a dependency.
// Each icon is a 20x20 SVG matching the Heroicons "mini" style.

function DashboardIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function TargetsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-1.5 0a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0zm-3 0a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0zm-3.5 1.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PipelinesIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path
        fillRule="evenodd"
        d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z"
        clipRule="evenodd"
      />
      <path
        fillRule="evenodd"
        d="M6 10a.75.75 0 01.75-.75h9.546l-1.048-1.047a.75.75 0 111.06-1.06l2.353 2.353a.748.748 0 010 1.06l-2.353 2.354a.75.75 0 11-1.06-1.06l1.048-1.05H6.75A.75.75 0 016 10z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** All navigable routes used across the app. */
export const NAV_ROUTES: NavRoute[] = [
  { path: "/", label: "Dashboard", icon: <DashboardIcon /> },
  { path: "/scan", label: "New Scan", icon: <ScanIcon /> },
  { path: "/history", label: "History", icon: <HistoryIcon /> },
  { path: "/targets", label: "Targets", icon: <TargetsIcon /> },
  { path: "/pipelines", label: "Pipelines", icon: <PipelinesIcon /> },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-5 w-5 transition-transform duration-200 ${
        collapsed ? "rotate-180" : ""
      }`}
    >
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={`flex flex-col border-r border-surface-800 bg-surface-900 transition-all duration-200 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo / brand */}
      <div className="flex h-14 items-center gap-2 border-b border-surface-800 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-600 text-sm font-bold text-white">
          S
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold text-surface-100 whitespace-nowrap">
            StackShield
          </span>
        )}
      </div>

      {/* Navigation links */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {NAV_ROUTES.map((route) => (
          <NavLink
            key={route.path}
            to={route.path}
            end={route.path === "/"}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent-600/15 text-accent-400"
                  : "text-surface-400 hover:bg-surface-800 hover:text-surface-200"
              } ${collapsed ? "justify-center" : ""}`
            }
            title={collapsed ? route.label : undefined}
          >
            <span className="shrink-0">{route.icon}</span>
            {!collapsed && <span>{route.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Keyboard shortcut hint */}
      {!collapsed && (
        <div className="border-t border-surface-800 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <kbd className="rounded border border-surface-700 bg-surface-800 px-1.5 py-0.5 font-mono text-[10px] text-surface-400">
              Cmd+K
            </kbd>
            <span>Command palette</span>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-surface-800 px-2 py-2">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center rounded-lg p-2 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>
    </aside>
  );
}
