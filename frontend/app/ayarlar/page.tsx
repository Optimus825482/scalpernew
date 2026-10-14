"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE, apiRequest, getJSON } from "../lib/api";
import { usePoll } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import type { BinanceSettings, Profile, UserPreferences } from "../lib/types";
import { Button, Card, SectionHeader, Skeleton, Toggle } from "../components/ui";

/**
 * AYARLAR — Profil · Bildirim tercihleri · Binance API anahtarları.
 *
 * Bildirim tercihleri `user_prefs` katmanında saklanır (uygulama-içi / ses /
 * WhatsApp aç-kapat + telefon). Binance anahtarları kullanıcı bazlı, şifreli
 * olarak DB'ye yazılır; bir kez girildiğinde tekrar girilmez (maskeli gösterilir).
 */
export default function AyarlarPage() {
  const { username } = useAuth();
  const profile = usePoll<Profile>("/api/profile", null);
  const binance = usePoll<BinanceSettings>("/api/binance/settings", 30_000);
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [prefsErr, setPrefsErr] = useState<string | null>(null);

  // Tercihleri bir kez yükle.
  useEffect(() => {
    getJSON<{ preferences: UserPreferences }>("/api/user/preferences")
      .then((r) => setPrefs(r.preferences))
      .catch((e) => setPrefsErr(e instanceof Error ? e.message : "Tercihler alınamadı"));
  }, []);

  return (
    <div className="space-y-5">
      <SectionHeader eyebrow="Ayarlar" title="Panel ayarları" description="Profil, bildirim tercihleri ve Binance API erişimi." />

      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileCard profile={profile} username={username} />
        <BinanceCard binance={binance} />
      </div>

      {prefsErr ? (
        <Card className="p-4 text-sm text-loss">Bildirim tercihleri alınamadı: {prefsErr}</Card>
      ) : !prefs ? (
        <Skeleton className="h-48" />
      ) : (
        <NotificationsCard initial={prefs} onSaved={setPrefs} />
      )}
    </div>
  );
}

function ProfileCard({ profile, username }: { profile: ReturnType<typeof usePoll<Profile>>; username: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "gain" | "loss"; text: string } | null>(null);

  const u = profile.data?.user;

  async function changePassword() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiRequest(`${API_BASE}/api/profile/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Güncellenemedi (${res.status})`);
      setMsg({ tone: "gain", text: "Şifre güncellendi." });
      setCurrent("");
      setNext("");
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Güncellenemedi" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <p className="odak-kicker">Profil</p>
      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between border-b border-line/70 pb-1.5">
          <span className="text-ink-500">Kullanıcı adı</span>
          <span className="font-mono text-ink-900">{u?.username || username || "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-500">Rol</span>
          <span className="font-mono text-ink-900">{u?.role || "—"}</span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-sm font-medium text-ink-900">Şifre değiştir</p>
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Mevcut şifre"
          autoComplete="current-password"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="Yeni şifre (en az 6 karakter)"
          autoComplete="new-password"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <Button variant="primary" disabled={busy || !current || next.length < 6} onClick={changePassword}>
          {busy ? "Kaydediliyor…" : "Şifreyi güncelle"}
        </Button>
        {msg && <p className={`text-xs ${msg.tone === "gain" ? "text-gain" : "text-loss"}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}

function BinanceCard({ binance }: { binance: ReturnType<typeof usePoll<BinanceSettings>> }) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "gain" | "loss"; text: string } | null>(null);

  const configured = Boolean(binance.data?.configured);
  const isAdmin = Boolean(binance.data?.is_admin);

  async function save(realSellOnly?: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {};
      if (!realSellOnly) {
        if (!apiKey.trim() || !apiSecret.trim()) throw new Error("API key ve secret gerekli");
        payload.api_key = apiKey.trim();
        payload.api_secret = apiSecret.trim();
      }
      const res = await apiRequest(`${API_BASE}/api/binance/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Kaydedilemedi (${res.status})`);
      setMsg({ tone: "gain", text: "Binance anahtarları kaydedildi." });
      setApiKey("");
      setApiSecret("");
      binance.reload();
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Kaydedilemedi" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleRealSell(enabled: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiRequest(`${API_BASE}/api/binance/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ real_sell_enabled: enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Güncellenemedi (${res.status})`);
      setMsg({ tone: "gain", text: enabled ? "Gerçek işlem açıldı." : "Gerçek işlem kapatıldı." });
      binance.reload();
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Güncellenemedi" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="odak-kicker">Binance TR API</p>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${configured ? "border-gain/25 bg-gain-soft text-gain" : "border-warn/30 bg-warn-soft text-warn"}`}>
          {configured ? "Anahtar kayıtlı" : "Anahtar yok"}
        </span>
      </div>

      <p className="mt-2 text-xs text-ink-500">
        Kendi Binance TR hesabınızın API anahtarını girin. Anahtar şifrelenerek saklanır ve bir daha
        girmeniz gerekmez; portföy/işlem bölümleri yalnız anahtar girildikten sonra görünür.
      </p>

      {configured ? (
        <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-xs text-ink-500">
          Anahtarlarınız kayıtlı. Değiştirmek için yeni anahtar/secret girip kaydedin.
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API Key"
          autoComplete="off"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        <input
          type="password"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          placeholder="API Secret"
          autoComplete="off"
          className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        <Button variant="primary" disabled={busy || !apiKey.trim() || !apiSecret.trim()} onClick={() => save(false)}>
          {busy ? "Kaydediliyor…" : configured ? "Anahtarları güncelle" : "Anahtarları kaydet"}
        </Button>
      </div>

      {configured && (
        <div className="mt-3 border-t border-line pt-2">
          <Toggle
            checked={Boolean(binance.data?.sell_enabled)}
            onChange={toggleRealSell}
            disabled={busy || (!isAdmin && binance.data?.sell_source === "env")}
            label="Gerçek işlemleri aç"
            hint={
              binance.data?.sell_source === "env"
                ? "Sunucu tarafından yönetiliyor (ENABLE_REAL_BINANCE_SELL)."
                : "Kapalıyken emir gönderilmez (güvenli varsayılan)."
            }
          />
        </div>
      )}

      {msg && <p className={`mt-2 text-xs ${msg.tone === "gain" ? "text-gain" : "text-loss"}`}>{msg.text}</p>}
    </Card>
  );
}

function NotificationsCard({
  initial,
  onSaved,
}: {
  initial: UserPreferences;
  onSaved: (p: UserPreferences) => void;
}) {
  const [prefs, setPrefs] = useState<UserPreferences>(initial);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "gain" | "loss"; text: string } | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [showPhoneEntry, setShowPhoneEntry] = useState(false);

  async function persist(patch: Partial<UserPreferences> & { phone?: string }) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiRequest(`${API_BASE}/api/user/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Kaydedilemedi (${res.status})`);
      setPrefs(body.preferences);
      onSaved(body.preferences);
      setMsg({ tone: "gain", text: "Kaydedildi." });
      if (patch.phone !== undefined) setPhone("");
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Kaydedilemedi" });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiRequest(`${API_BASE}/api/user/whatsapp/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Gönderilemedi (${res.status})`);
      setMsg({ tone: "gain", text: `Test mesajı gönderildi: ${body.to_masked || ""}` });
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Gönderilemedi" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <SectionHeader eyebrow="Bildirimler" title="Bildirim tercihleri" description="Hangi kanallardan bilgilendirilmek istediğinizi seçin." />

      <div className="mt-3 divide-y divide-line">
        <Toggle
          checked={prefs.app_notifications}
          onChange={(v) => persist({ app_notifications: v })}
          disabled={busy}
          label="Anlık bildirimler"
          hint="Sistem fırsat tespit ettiğinde panelde bildirim göster."
        />
        <Toggle
          checked={prefs.sound}
          onChange={(v) => persist({ sound: v })}
          disabled={busy}
          label="Bildirim sesi"
          hint="Bildirim geldiğinde ses çal."
        />
        <Toggle
          checked={prefs.whatsapp_enabled}
          onChange={(v) => {
            if (v && !prefs.phone_set && !phone.trim()) {
              setShowPhoneEntry(true);
              setMsg({ tone: "loss", text: "Önce telefon numaranızı girip 'Numarayı kaydet'e basın." });
              setTimeout(() => phoneInputRef.current?.focus(), 50);
              return;
            }
            persist({ whatsapp_enabled: v, ...(v && phone.trim() ? { phone } : {}) });
          }}
          disabled={busy}
          label="WhatsApp mesajı gönder"
          hint={
            prefs.whatsapp_available
              ? "Açtığınızda sistem bildirimleri WhatsApp'tan telefonunuza gelir."
              : "WhatsApp köprüsü sunucuda yapılandırılmamış (gönderim pasif)."
          }
        />
      </div>

      {(prefs.whatsapp_enabled || showPhoneEntry) && (
        <div className="mt-3 space-y-2 rounded-lg border border-line bg-canvas/60 p-3">
          <p className="text-xs text-ink-500">
            {prefs.phone_set ? `Kayıtlı numara: ${prefs.phone_masked}` : "WhatsApp için telefon numaranızı girin."}
          </p>
          <input
            ref={phoneInputRef}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Telefon (ör. 0555 123 45 67)"
            inputMode="tel"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || phone.replace(/\D/g, "").length < 10} onClick={() => persist({ phone })}>
              Numarayı kaydet
            </Button>
            <Button disabled={busy || !prefs.phone_set} onClick={sendTest}>
              Test mesajı gönder
            </Button>
          </div>
        </div>
      )}

      {msg && <p className={`mt-2 text-xs ${msg.tone === "gain" ? "text-gain" : "text-loss"}`}>{msg.text}</p>}

      <div className="mt-4 border-t border-line pt-4">
        <PushNotifications />
      </div>
    </Card>
  );
}

/* ---------- Tarayıcı push bildirimleri ---------- */

/** VAPID public key'i base64url'den Uint8Array'e çevirir (applicationServerKey). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type PushState = "unsupported" | "default" | "denied" | "granted-subscribed" | "granted-unsubscribed";

function PushNotifications() {
  const [state, setState] = useState<PushState>("default");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "gain" | "loss"; text: string } | null>(null);

  useEffect(() => {
    // iOS Safari < 16.4 vb. push desteklemez.
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    const perm = Notification.permission;
    if (perm === "denied") {
      setState("denied");
      return;
    }
    if (perm !== "granted") {
      setState("default");
      return;
    }
    // İzin var: mevcut aboneliği kontrol et.
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "granted-subscribed" : "granted-unsubscribed"))
      .catch(() => setState("granted-unsubscribed"));
  }, []);

  /** VAPID anahtarı: env varsa onu kullan, yoksa backend'den çek. */
  async function resolveVapidKey(): Promise<string> {
    const envKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (envKey) return envKey;
    const res = await apiRequest(`${API_BASE}/api/monitoring/push-health`, { cache: "no-store" });
    if (!res.ok) throw new Error(`VAPID anahtarı alınamadı (${res.status})`);
    const data = await res.json();
    if (!data?.vapid_public_key) throw new Error("Sunucuda VAPID anahtarı yapılandırılmamış");
    return String(data.vapid_public_key);
  }

  async function requestPermission() {
    setBusy(true);
    setMsg(null);
    try {
      // iOS'ta kullanıcı hareketi içinde çağrılmalı — buton onClick olduğu için uygun.
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setState("granted-unsubscribed");
        setMsg({ tone: "gain", text: "Bildirim izni verildi. Şimdi bildirimleri etkinleştirin." });
      } else if (perm === "denied") {
        setState("denied");
        setMsg({ tone: "loss", text: "Bildirim izni reddedildi." });
      } else {
        setMsg({ tone: "loss", text: "Bildirim izni verilmedi." });
      }
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "İzin istenemedi" });
    } finally {
      setBusy(false);
    }
  }

  async function subscribe() {
    setBusy(true);
    setMsg(null);
    try {
      const vapidKey = await resolveVapidKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const res = await apiRequest(`${API_BASE}/api/alerts/push-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        throw new Error(body.detail || `Kaydedilemedi (${res.status})`);
      }
      setState("granted-subscribed");
      setMsg({ tone: "gain", text: "Tarayıcı bildirimleri etkinleştirildi." });
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Etkinleştirilemedi" });
    } finally {
      setBusy(false);
    }
  }

  async function sendPushTest() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiRequest(`${API_BASE}/api/alerts/push-test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Gönderilemedi (${res.status})`);
      setMsg({ tone: "gain", text: "Test bildirimi gönderildi." });
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Gönderilemedi" });
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const ok = await sub.unsubscribe();
        setMsg({
          tone: ok ? "gain" : "loss",
          text: ok
            ? "Bildirimler kapatıldı. Sunucudaki kayıt zaman aşımıyla temizlenir."
            : "Abonelik kaldırılamadı.",
        });
      }
      setState("granted-unsubscribed");
    } catch (e) {
      setMsg({ tone: "loss", text: e instanceof Error ? e.message : "Kapatılamadı" });
    } finally {
      setBusy(false);
    }
  }

  if (state === "unsupported") {
    return (
      <div>
        <p className="odak-kicker">Tarayıcı bildirimleri</p>
        <p className="mt-2 text-xs text-ink-500">Bu tarayıcı push bildirimlerini desteklemiyor.</p>
      </div>
    );
  }

  const permBadge =
    state === "denied" ? (
      <span className="rounded-full border border-loss/25 bg-loss-soft px-2 py-0.5 text-[11px] font-medium text-loss">
        Reddedildi — tarayıcı ayarlarından açın
      </span>
    ) : state === "granted-subscribed" || state === "granted-unsubscribed" ? (
      <span className="rounded-full border border-gain/25 bg-gain-soft px-2 py-0.5 text-[11px] font-medium text-gain">
        İzin verildi
      </span>
    ) : (
      <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-500">
        İzin bekliyor
      </span>
    );

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="odak-kicker">Tarayıcı bildirimleri</p>
        {permBadge}
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Sistem bildirimlerini tarayıcı kapalıyken de masaüstüne/mobil cihaza push olarak alın.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === "default" && (
          <Button variant="primary" disabled={busy} onClick={requestPermission}>
            {busy ? "İsteniyor…" : "Bildirim izni ver"}
          </Button>
        )}
        {state === "granted-unsubscribed" && (
          <Button variant="primary" disabled={busy} onClick={subscribe}>
            {busy ? "Etkinleştiriliyor…" : "Bildirimleri etkinleştir"}
          </Button>
        )}
        {state === "granted-subscribed" && (
          <>
            <span className="rounded-full border border-gain/25 bg-gain-soft px-2 py-0.5 text-[11px] font-medium text-gain">Etkin</span>
            <Button disabled={busy} onClick={sendPushTest}>
              Test bildirimi gönder
            </Button>
            <Button disabled={busy} onClick={unsubscribe}>
              Bildirimleri kapat
            </Button>
          </>
        )}
      </div>

      {msg && <p className={`mt-2 text-xs ${msg.tone === "gain" ? "text-gain" : "text-loss"}`}>{msg.text}</p>}
    </div>
  );
}
