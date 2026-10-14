"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, Card, EmptyState, SectionHeader, Skeleton, Toggle } from "../components/ui";

type AdminUser = {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  session_version?: number | null;
  created_at?: string | number | null;
};

function fmtKayit(value?: string | number | null) {
  if (value == null) return "—";
  try {
    const date = typeof value === "number" ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("tr-TR");
  } catch {
    return String(value);
  }
}

/** Kullanıcı Yönetimi — yalnızca yönetici. Backend admin CRUD ucunu kullanır. */
export default function KullanicilarPage() {
  const { username, role } = useAuth();
  const isAdmin = String(role).toLowerCase() === "admin";

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "gain" | "loss"; text: string } | null>(null);

  // Yeni kullanıcı formu
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");

  // Satır içi düzenleme
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editActive, setEditActive] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest("/api/admin/users");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || `Kullanıcılar alınamadı (${response.status})`);
      setUsers(Array.isArray(body?.users) ? body.users : []);
    } catch (reason) {
      setMessage({ tone: "loss", text: reason instanceof Error ? reason.message : "Kullanıcılar alınamadı" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else setLoading(false);
  }, [isAdmin, load]);

  async function createUser() {
    const uname = newUsername.trim();
    if (uname.length < 3 || uname.length > 32) {
      setMessage({ tone: "loss", text: "Kullanıcı adı 3-32 karakter olmalı." });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ tone: "loss", text: "Şifre en az 6 karakter olmalı." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiRequest("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: uname, password: newPassword, role: newRole, is_active: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || `Kullanıcı oluşturulamadı (${response.status})`);
      setMessage({ tone: "gain", text: `${uname} oluşturuldu.` });
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      await load();
    } catch (reason) {
      setMessage({ tone: "loss", text: reason instanceof Error ? reason.message : "Kullanıcı oluşturulamadı" });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(user: AdminUser) {
    setEditingId(user.id);
    setEditUsername(user.username);
    setEditPassword("");
    setEditRole(user.role === "admin" ? "admin" : "user");
    setEditActive(user.is_active !== false);
  }

  async function saveEdit(id: number) {
    const uname = editUsername.trim();
    if (uname.length < 3 || uname.length > 32) {
      setMessage({ tone: "loss", text: "Kullanıcı adı 3-32 karakter olmalı." });
      return;
    }
    if (editPassword && editPassword.length < 6) {
      setMessage({ tone: "loss", text: "Şifre en az 6 karakter olmalı." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = { username: uname, role: editRole, is_active: editActive };
      if (editPassword) payload.password = editPassword;
      const response = await apiRequest(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || `Kullanıcı güncellenemedi (${response.status})`);
      setMessage({ tone: "gain", text: `${uname} güncellendi.` });
      setEditingId(null);
      setEditPassword("");
      await load();
    } catch (reason) {
      setMessage({ tone: "loss", text: reason instanceof Error ? reason.message : "Kullanıcı güncellenemedi" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!window.confirm(`${user.username} kullanıcısı silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiRequest(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.detail || `Kullanıcı silinemedi (${response.status})`);
      setMessage({ tone: "gain", text: `${user.username} silindi.` });
      await load();
    } catch (reason) {
      setMessage({ tone: "loss", text: reason instanceof Error ? reason.message : "Kullanıcı silinemedi" });
    } finally {
      setBusy(false);
    }
  }

  if (role === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <SectionHeader eyebrow="Yönetim" title="Kullanıcı Yönetimi" />
        <EmptyState title="Bu sayfa yalnızca yöneticiye açıktır" hint="Yönetici oturumuyla giriş yapmanız gerekir." tone="loss" />
      </div>
    );
  }

  const inputCls =
    "rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent";

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Yönetim"
        title="Kullanıcı Yönetimi"
        description="Sistem kullanıcılarını oluştur, düzenle, aktif/pasif yap veya sil. Kendi hesabını silemez veya yöneticilikten düşüremezsin."
      />

      {message && (
        <div
          role="status"
          className={`rounded-xl border p-3 text-sm ${
            message.tone === "gain"
              ? "border-gain/30 bg-gain-soft/40 text-gain"
              : "border-loss/30 bg-loss-soft/40 text-loss"
          }`}
        >
          {message.text}
        </div>
      )}

      <Card className="p-4">
        <p className="odak-kicker">Yeni kullanıcı</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="kullanıcı adı (3-32 karakter)"
            aria-label="Kullanıcı adı"
            className={inputCls}
          />
          <input
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            type="password"
            placeholder="şifre (en az 6 karakter)"
            aria-label="Şifre"
            className={inputCls}
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value === "admin" ? "admin" : "user")}
            aria-label="Rol"
            className={inputCls}
          >
            <option value="user">Kullanıcı</option>
            <option value="admin">Yönetici</option>
          </select>
          <Button variant="primary" disabled={busy} onClick={createUser}>
            Oluştur
          </Button>
        </div>
      </Card>

      {loading && users === null ? (
        <Skeleton className="h-48" />
      ) : users && users.length === 0 ? (
        <EmptyState title="Kullanıcı bulunamadı" hint="Liste boş görünüyor; sayfayı yenilemeyi deneyin." />
      ) : (
        <Card className="p-4">
          <div className="odak-scroll">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                  <th className="pb-2 pr-3 font-medium">Kullanıcı</th>
                  <th className="pb-2 pr-3 font-medium">Rol</th>
                  <th className="pb-2 pr-3 font-medium">Durum</th>
                  <th className="pb-2 pr-3 font-medium">Kayıt</th>
                  <th className="pb-2 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {(users || []).map((user) => {
                  const isSelf = user.username === username;
                  const editing = editingId === user.id;
                  return (
                    <Fragment key={user.id}>
                      <tr className="border-t border-line">
                        <td className="py-2 pr-3 font-mono font-semibold text-ink-900">
                          {user.username}
                          {isSelf && <span className="ml-2 text-[11px] font-normal text-ink-400">(sen)</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={user.role === "admin" ? "accent" : "neutral"}>
                            {user.role === "admin" ? "Yönetici" : "Kullanıcı"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={user.is_active === false ? "loss" : "gain"}>
                            {user.is_active === false ? "PASİF" : "AKTİF"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-xs text-ink-500">{fmtKayit(user.created_at)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="secondary"
                              className="min-h-0 px-2.5 py-1 text-[11px]"
                              disabled={busy}
                              onClick={() => (editing ? setEditingId(null) : startEdit(user))}
                            >
                              {editing ? "Kapat" : "Düzenle"}
                            </Button>
                            <Button
                              variant="danger"
                              className="min-h-0 px-2.5 py-1 text-[11px]"
                              disabled={busy || isSelf}
                              title={isSelf ? "Kendi hesabını silemezsin" : undefined}
                              onClick={() => deleteUser(user)}
                            >
                              Sil
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {editing && (
                        <tr className="border-t border-line bg-canvas/50">
                          <td colSpan={5} className="py-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <label className="flex flex-col gap-1 text-xs text-ink-500">
                                Kullanıcı adı
                                <input
                                  value={editUsername}
                                  onChange={(e) => setEditUsername(e.target.value)}
                                  className={`${inputCls} w-48`}
                                  aria-label="Düzenle: kullanıcı adı"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-ink-500">
                                Yeni şifre (opsiyonel)
                                <input
                                  value={editPassword}
                                  onChange={(e) => setEditPassword(e.target.value)}
                                  type="password"
                                  placeholder="değiştirmek istemiyorsan boş bırak"
                                  className={`${inputCls} w-56`}
                                  aria-label="Düzenle: yeni şifre"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-ink-500">
                                Rol
                                <select
                                  value={editRole}
                                  onChange={(e) => setEditRole(e.target.value === "admin" ? "admin" : "user")}
                                  className={inputCls}
                                  aria-label="Düzenle: rol"
                                >
                                  <option value="user">Kullanıcı</option>
                                  <option value="admin">Yönetici</option>
                                </select>
                              </label>
                              <div className="min-w-[200px]">
                                <Toggle
                                  checked={editActive}
                                  onChange={setEditActive}
                                  label="Aktif"
                                  hint="Pasif kullanıcı giriş yapamaz"
                                />
                              </div>
                              <div className="flex items-center gap-2 pb-2.5">
                                <Button variant="primary" disabled={busy} onClick={() => saveEdit(user.id)}>
                                  Kaydet
                                </Button>
                                <Button variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>
                                  Vazgeç
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
