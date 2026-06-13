import { Link, useLocation } from "wouter";
import { IconH, IconM } from "./icons";
import { ReactNode, useState } from "react";
import { Menu, X } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { label: "Import", path: "/" },
    { label: "Viewer", path: "/viewer" },
    { label: "Bibliothek", path: "/bibliothek" },
    { label: "Koordinaten", path: "/koordinaten" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background pb-16">
      {/* Header */}
      <header className="h-[56px] bg-white border-b-2 border-accent flex items-center px-4 shrink-0 z-20 relative">
        <button 
          className="md:hidden mr-4 text-primary"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <X /> : <Menu />}
        </button>
        <div className="flex items-center gap-4">
          <IconH className="text-primary" />
          <div className="w-[1px] h-8 bg-[#CBD5E0]"></div>
          <div className="flex items-center text-primary text-[18px] tracking-[0.08em]">
            <span className="font-extrabold">HEER</span>
            <span className="font-normal ml-1">VIEWER</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`
          absolute md:static top-0 left-0 h-full w-[220px] bg-sidebar z-10 shrink-0
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          <nav className="flex flex-col py-4">
            {navItems.map((item) => {
              const active = location === item.path;
              return (
                <Link key={item.path} href={item.path} onClick={() => setSidebarOpen(false)}>
                  <div className={`
                    px-6 py-3 cursor-pointer text-sm font-medium transition-colors
                    ${active ? 'text-accent border-l-3 border-accent bg-[#b8cc5a26]' : 'text-white hover:bg-white/5 border-l-3 border-transparent'}
                  `}>
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-4 md:p-8">
          {children}
        </main>
      </div>

      {/* Bottom Bar */}
      <footer className="h-[64px] w-full bg-white fixed bottom-0 left-0 flex items-center justify-center z-30 border-t border-[#E2E8F0]">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="mg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7B2FFF"/>
                <stop offset="100%" stopColor="#B44FFF"/>
              </linearGradient>
            </defs>
            <path fill="url(#mg)" d="M2 18V6l4 0 6 8 6-8 4 0v12h-3V11l-5 7h-4l-5-7v7H2z"/>
          </svg>
          <span className="text-[14px] font-semibold" style={{ color: "#7B2FFF" }}>
            Built by{" "}
            <a
              href="https://migra.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-75 transition-opacity"
              style={{ color: "#7B2FFF" }}
            >
              Migra
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
