"use client";

import { usePathname } from "next/navigation";
import AppLink from "./AppLink";
import { useAuth } from "../lib/auth";

/**
 * Mobil alt tab bar — sabit (sticky footer) ikon menü.
 * Masaüstünde gizli (lg:), mobilde ekrana yapışık alt barda 5 temel ekran.
 * "Daha fazla" yerine sade tutuldu: Anasayfa, Sinyal, Grafik, Emirler, Ayarlar.
 */
const TABS = [
  { href: "/", label: "Ana", icon: "⌂" },
  { href: "/firsatlar", label: "Sinyal", icon: "◎" },
  { href: "/grafik", label: "Grafik", icon: "📈" },
  { href: "/emirler", label: "Emir", icon: "⧗" },
  { href: "/ayarlar", label: "Ayar", icon: "⚙" },
];

const ADMIN_TAB = { href: "/kullanicilar", label: "Kullanıcı", icon: "☺" };

export default function MobileTabBar() {
  const pathname = usePathname();
  const { role } = useAuth();
  const tabs = role === "admin" ? [...TABS.slice(0, 4), ADMIN_TAB, TABS[4]] : TABS;

  return (
    <nav
      aria-label="Mobil menü"
      className="odak-mobile-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <AppLink
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[10px] font-medium transition-colors ${
                active ? "text-accent" : "text-ink-400"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid h-7 w-12 place-items-center rounded-lg text-base leading-none transition-colors ${
                  active ? "bg-accent-soft" : ""
                }`}
              >
                {tab.icon}
              </span>
              <span className="truncate">{tab.label}</span>
            </AppLink>
          );
        })}
      </div>
    </nav>
  );
}
