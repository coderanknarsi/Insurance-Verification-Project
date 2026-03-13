"use client";

import { useState } from "react";
import {
  Shield,
  LayoutDashboard,
  ShieldCheck,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";

interface SidebarProps {
  userEmail: string;
  onSignOut: () => void;
  activeNav?: string;
  onNavChange?: (nav: string) => void;
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "verifications", label: "Verifications", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ userEmail, onSignOut, activeNav = "dashboard", onNavChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex flex-col h-screen bg-sidebar-bg border-r border-border-subtle transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
        collapsed ? "w-[68px]" : "w-[240px]"
      }`}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-border-subtle flex-shrink-0">
        <div className="w-8 h-8 bg-accent/20 rounded-lg flex items-center justify-center flex-shrink-0">
          <Shield className="w-4 h-4 text-accent" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold text-offwhite tracking-tight whitespace-nowrap">
            Auto Lien Tracker
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavChange?.(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? "bg-accent/15 text-accent"
                  : "text-carbon-light hover:text-offwhite hover:bg-white/[0.04]"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? "text-accent" : ""}`} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="px-3 py-2 border-t border-border-subtle">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-carbon-light hover:text-offwhite hover:bg-white/[0.04] transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4 flex-shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* User */}
      <div className="px-3 py-3 border-t border-border-subtle flex-shrink-0">
        <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-8 h-8 bg-surface rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-medium text-carbon-light">
              {userEmail.charAt(0).toUpperCase()}
            </span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs text-offwhite truncate">{userEmail}</p>
              <button
                onClick={onSignOut}
                className="flex items-center gap-1 text-[11px] text-carbon-light hover:text-red-400 transition-colors mt-0.5"
              >
                <LogOut className="w-3 h-3" />
                Sign out
              </button>
            </div>
          )}
          {collapsed && (
            <button
              onClick={onSignOut}
              className="absolute opacity-0"
              title="Sign out"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
