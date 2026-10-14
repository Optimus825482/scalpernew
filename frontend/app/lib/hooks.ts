"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJSON } from "./api";
import { useVisibleInterval } from "./useVisibleInterval";

export type PollState<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/**
 * Aynı GET uç noktası için uçuş-hâlinde istek paylaşımı + kısa TTL önbelleği.
 * Birden çok bileşen aynı ucu yokluyorsa (ör. `/api/binance/settings` hem
 * PortfolioStrip hem ActiveTradesTable) tarayıcıya tek istek gider; sayfa
 * görünürlüğü geri geldiğinde aynı anda tetiklenen yoklamalar da birleşir.
 */
const sharedGets = new Map<string, { promise: Promise<unknown>; at: number }>();
const SHARE_MS = 2_000;

function sharedGet<T>(path: string): Promise<T> {
  const now = Date.now();
  const existing = sharedGets.get(path);
  if (existing && now - existing.at <= SHARE_MS) return existing.promise as Promise<T>;
  const promise: Promise<unknown> = getJSON<T>(path);
  sharedGets.set(path, { promise, at: now });
  // Paylaşılan girdinin reddi tek başına "unhandled rejection" doğurmasın;
  // girdi TTL dolduğunda temizlenir.
  promise.catch(() => {}).then(() => {
    if (sharedGets.get(path)?.promise === promise && Date.now() - now > SHARE_MS) sharedGets.delete(path);
  });
  return promise as Promise<T>;
}

/**
 * GET + periyodik yenileme, ZAMAN AŞIMLI.
 *
 * Neden timeout: bazı backend uçları (ör. `/api/daily-rising/state`, gönderilmiş
 * liste yokken canlı kombine taramaya düşer) onlarca saniye askıda kalabiliyor.
 * Tarayıcı `fetch`'inin varsayılan zaman aşımı yoktur → asılı istek `loading`
 * durumunu sonsuza dek açık bırakır ve sayfa iskelet üstünde donar. AbortController
 * ile sınırlıyoruz; aşılırsa `error` yazılır ve arayüz yaşamaya devam eder.
 */
export function usePoll<T>(path: string | null, intervalMs: number | null, timeoutMs = 12_000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    if (!path) return;
    // Zaman aşımı artık AbortController yerine Promise.race ile: paylaşılan
    // istek tek seferde tamamlanır, çağrı kendi aşımında hata alır.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DOMException(`Zaman aşımı (${timeoutMs / 1000}sn) — sunucu yanıt vermedi`, "AbortError")), timeoutMs);
    });
    // Yarışı kazanan istek olursa zaman aşımı promise'i reddeder; ayrıca
    // dinleyip sessize alarak "unhandled rejection" önlenir.
    timeout.catch(() => {});
    Promise.race([sharedGet<T>(path), timeout])
      .then((value) => {
        if (!mounted.current) return;
        setData(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!mounted.current) return;
        if (reason instanceof DOMException && reason.name === "AbortError") {
          setError(`Zaman aşımı (${timeoutMs / 1000}sn) — sunucu yanıt vermedi`);
        } else {
          setError(reason instanceof Error ? reason.message : "Bağlantı hatası");
        }
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        if (mounted.current) setLoading(false);
      });
  }, [path, timeoutMs]);

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    reload();
  }, [path, reload]);

  useVisibleInterval(reload, intervalMs);

  return { data, error, loading, reload };
}
