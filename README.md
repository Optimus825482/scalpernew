# SCALPERNEW — bağımsız izole trade platformu

Scalper Agent ana projesinden (scalper.erkanerdem.online) **tamamen ayrı**, kendi
başına deploy edilebilen uygulama: kendi Postgres'i (DB adı: `scalpernew`), kendi
volume'ları, kendi ağı ve kendi domain'i (`scalpernew.erkanerdem.online`) var.
Ana projeyle hiçbir kaynak paylaşmaz; aynı sunucuda yan yana da çalışabilir.

## Bileşenler

| Dizin | İçerik |
|---|---|
| `backend/` | FastAPI backend (birleşik tarama motorları, radar güçlendirme katmanı, outcome journal, OCO/SL-TP emir yolu, WhatsApp/WebPush bildirim). Migration'lar (001–013) ilk açılışta otomatik kurulur. |
| `frontend/` | **Scalper Intelligent** arayüzü: birleşik aday taraması, favori fiyat bandı, 1/2/4 panel grafik, emir defteri (DOM), SL/TP-OCO koruma paneli, açık emirler, alarmlar, portföy analitiği, işlem günlüğü, CSV dışa aktarma, klavye kısayolları. **basePath YOK** — kökte servis edilir. |
| `nginx/` | Hardened gateway: rate limit'ler, WebSocket koruması (limit_conn + 24s timeout), immutable statik cache, güvenlik başlıkları, bot istek engeli. |
| `whatsapp-bridge/` | Baileys WhatsApp köprüsü (varsayılan kapalı). |
| `docker-compose.yaml` | Bağımsız stack tanımı — repo kökü DOĞRUDAN stack'tir. |
| `.env.example` | Secret şablonu → `.env` olarak doldurun (ASLA commit etmeyin). |

## Optimizasyonlar (2026-10-14)

- Backend: `uvloop` event loop + `httptools` HTTP ayrıştırıcı, erişim logu gateway'e bırakıldı.
- Postgres: 1G bütçeye göre ayarlı — `shared_buffers=256MB`, `work_mem=8MB`, `wal_compression=on`.
- Frontend: 512MB cap + Node heap tavanı (`--max-old-space-size=384`).
- Gateway: 256MB cap / 0.5 CPU.
- Toplam gerçek kullanım ~2 GB; tavanlar ~4.3 GB.

## Coolify ile deploy (önerilen)

1. Coolify → New Resource → **Docker Compose** → repo: `Optimus825482/scalpernew`,
   **Compose file path:** `./docker-compose.yaml`
2. Environment Variables'a `.env.example` içindeki ZORUNLU alanları gir:
   `POSTGRES_PASSWORD`, `SCALPER_ADMIN_PASSWORD`, `SCALPER_SESSION_SECRET`,
   `LLM_ENCRYPTION_KEY` (üretim komutları `.env.example` içinde).
3. Domain alanına `scalpernew.erkanerdem.online` yaz (TLS'i Coolify/Traefik sağlar;
   DNS'te bu alt alan adı sunucu IP'sine A kaydı olarak ekli olmalı).
4. Deploy. Backend sağlıklı olduktan sonra arayüz kökte açılır.

## Manuel deploy (VPS'te)

```bash
git clone https://github.com/Optimus825482/scalpernew.git && cd scalpernew
cp .env.example .env   # doldur
docker compose up -d --build
```

(DNS: `scalpernew.erkanerdem.online` → sunucu IP; TLS için ayrıca Traefik/Caddy
yapılandırması gerekir — Coolify bunu otomatik yapar.)

## Doğrulama

```bash
docker compose ps
docker logs scalpernew-backend --tail 100      # migration + startup logları
docker logs scalpernew-gateway --tail 50
curl -s https://scalpernew.erkanerdem.online/health
```

## Tanı komutları

```bash
docker inspect --format '{{.State.Health.Status}} OOM={{.State.OOMKilled}} restarts={{.RestartCount}}' scalpernew-backend
docker stats --no-stream
```
