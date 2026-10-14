"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * Güvenli navigasyon linki.
 *
 * Next.js 16.3.0 istemci router'ı bu uygulamada sessizce no-op yapıyor
 * (Link tıklaması ve router.push hiçbir istek/vermeden yutuluyor — 2026-10-14
 * teşhisi: dev + prod, SW'siz, React 19 ile de aynı). Ta ki router güvenilir
 * çalışana kadar linkler BİLGİNÇ OLARAK tam sayfa navigasyonu kullanır:
 * tarayıcının kendi <a> davranışı, loading.tsx ve SSR HTML ile hızlıdır ve
 * her Next sürümünde çalışır.
 *
 * Yeniden SPA geçişine dönmek istersek tek yapmamız gereken burada
 * next/link'e dönüp kullanım yerlerini olduğu gibi bırakmak.
 */
export default function AppLink({
  href,
  children,
  ...rest
}: {
  href: string;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
