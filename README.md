# 🚗 Parkomat

> Camdaki QR'ı okutan kişi, **telefon numaranı görmeden** sana Telegram'dan ulaşır.

Hatalı park, açık kalmış far/cam, çalan alarm… Biri aracınla ilgili sana ulaşmak istediğinde numaranı paylaşmak zorunda kalma. QR'ı cama yapıştır, mesaj Telegram'ına gelsin. **%100 ücretsiz** (Cloudflare Free + Telegram Bot API).

## ✨ Özellikler

- 🔒 **Numara gizliliği** — QR'da sadece rastgele token var; ne senin numaran görünür ne arayanınki
- 📲 **Telegram bildirimi** — mesaj anında DM olarak düşer
- 🖨️ **Yazdırılabilir cam etiketi** — siyah-sarı 6×10 cm şablon (`/v/:token/etiket`)
- 🗑️ **Otomatik silme** — mesajlar 30 dk sonra DB'den silinir (cron + fırsatçı temizlik)
- 🛡️ **Spam koruması** — rate limit (10 dk'da 3 / günde 10) + Turnstile desteği
- 🔄 **QR yenileme** — tacizde tek tıkla eski QR'ı iptal et
- 🆓 **Sıfır maliyet** — Workers (100K req/gün) + D1 (5 GB) free limit içinde

## 🏗️ Nasıl çalışıyor?

```
[ Camdaki QR ]  →  https://senin-worker.workers.dev/v/A8f3K9xQ2m
                        │  maskeli plaka + sebep seç + mesaj yaz
                        ▼  POST /api/v/:token/message
[ Cloudflare Worker ] → rate limit → [ D1'e kaydet ] → [ Telegram Bot API ] → 📩 sana DM
```

Telefon numarası sistemin **hiçbir yerinde** saklanmaz. Eşleşme, Telegram `chat_id` üzerinden olur.

## 🚀 Kurulum (5 dk)

### 1. Ön koşullar

- Cloudflare hesabı (ücretsiz) + Node.js 18+
- Telegram'da `@BotFather` ile bot oluştur → `BOT_TOKEN` ve kullanıcı adını al (`/newbot`)

### 2. Projeyi deploy et

```bash
npm i -g wrangler
wrangler login

# Veritabanı
wrangler d1 create parkomat-db
# → çıkan database_id'yi wrangler.toml'a yapıştır
wrangler d1 execute parkomat-db --remote --file=migrations/0001_init.sql
wrangler d1 execute parkomat-db --remote --file=migrations/0002_channels.sql

# Gizli anahtarlar (değerler terminalde sorulur, chat'e yapıştırma!)
wrangler secret put BOT_TOKEN
wrangler secret put PEPPER
wrangler secret put TELEGRAM_WEBHOOK_SECRET

wrangler deploy
# → https://parkomat.<hesap>.workers.dev
```

### 3. Telegram webhook'unu bağla

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker-adresin>/api/telegram/webhook?secret=<WEBHOOK_SECRET>"
# {"ok":true} dönmeli
```

`wrangler.toml` içindeki `BOT_USERNAME` satırına bot kullanıcı adını yazmayı unutma.

### 4. İlk QR'ını oluştur

1. `https://<worker-adresin>/sahip` aç → plakayı **maskeli** yaz (`34 AB ****`)
2. Açılan sahip panelindeki (`/a/...` — bu linki kaybetme!) 6 haneli kodu al
3. `t.me/<botun>?start=<KOD>` aç → `/start <KOD>` gönder → `✅ Bağlandı!`
4. `🖨 Etiket şablonunu aç / yazdır` ile 6×10 cm etiketi bas, cama içten yapıştır

## 📁 Proje yapısı

```
parkomat/
├── src/worker.js              # Hepsi burada: API + sayfalar + Telegram webhook
├── migrations/
│   ├── 0001_init.sql          # vehicles + messages tabloları
│   └── 0002_channels.sql      # bildirim kanalı sütunları
└── wrangler.toml              # Worker + D1 + cron ayarı
```

Bağımlılık yok, build adımı yok — tek dosyalık Worker.

## 🔌 API

| Metod | Endpoint | Açıklama |
|---|---|---|
| `GET` | `/sahip` | Araç oluşturma sayfası |
| `POST` | `/api/admin/create` | Araç + token üretir |
| `GET` | `/a/:adminToken` | Sahip paneli (gizli tut!) |
| `GET` | `/v/:publicToken` | Tarayan kişinin formu |
| `POST` | `/api/v/:publicToken/message` | Anonim mesaj gönderir |
| `GET` | `/v/:publicToken/etiket` | Yazdırılabilir etiket |
| `POST` | `/api/admin/rotate` | QR'ı yeniler |
| `POST` | `/api/admin/purge` | Mesajları hemen siler |
| `POST` | `/api/telegram/webhook` | Bot güncellemeleri |

## 🔐 Gizlilik & güvenlik notları

- Plakanın tamamını yazma — son haneleri `****` yap.
- `/a/...` admin linkini kimseyle paylaşma; QR'daki `/v/...` linki herkese açık olabilir.
- Bot token'ını chate, commite, ekrana yapıştırma — sızarsa `@BotFather` → `/revoke`.
- Mesajlar 30 dk sonra silinir (`RETENTION_MINUTES`, cron: 10 dk'da 1). Telegram'a düşen bildirim Telegram'da kalır.

## 🗺️ Yol haritası

- [ ] Turnstile ile bot koruması (kod hazır, site key bekliyor)
- [ ] Fotoğraflı bildirim (R2)
- [ ] Çift yönlü anonim cevap ("Teşekkürler, geliyorum" butonu)
- [ ] Özel domain + Türkçe/İngilizce form

## 📄 Lisans

MIT — dilediğin gibi kullan, çatalla, geliştir. Katkı (PR) memnuniyetle karşılanır.
