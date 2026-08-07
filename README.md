# ŞAMPİYON KİM? — TikTok Canlı Yayın Futbol Oyunu

## Proje Nedir?

TikTok canlı yayınına bağlanan, izleyicilerin **hediye göndererek** takım seçtiği interaktif bir futbol oyunudur. Yayıncı, TikTok kullanıcı adını girerek yayınına bağlanır; izleyicilerin gönderdiği hediyeler gerçek zamanlı olarak takım skorlarına yansır.

- **Frontend:** `index.html` — Tek dosya, Tailwind CSS + Socket.io
- **Backend:** `server.js` — Node.js + Express 5 + Socket.io + TikTok Live Connector
- **Gerçek zamanlı iletişim:** WebSocket (Socket.io)
- **Yerel depolama:** `localStorage` (ayarlar) + `IndexedDB` (görseller/ses dosyaları)
- **Sunucu depolama:** `users.json` (kullanıcı hesapları ve ayarları)

---

## GitHub Bilgileri

| Alan | Değer |
|---|---|
| Hesap | `autoroun` |
| Repo | `tiktokoyunu` (private) |
| URL | https://github.com/autoroun/tiktokoyunu |
| Ana branch | `master` |

---

## Deploy (Railway)

**Platform:** [railway.app](https://railway.app)  
**Proje adı:** `pretty-dream` (Railway'deki proje adı)  
**Otomatik deploy:** `master` branch'e her push sonrası Railway otomatik deploy eder.

### Güncelleme Göndermek

```bash
git add .
git commit -m "değişiklik açıklaması"
git push
```

Push sonrası Railway ~1-2 dakikada otomatik yayınlar.

### İlk Kez Deploy (sıfırdan kurulum)

1. [railway.app](https://railway.app) → GitHub ile giriş yap
2. **New Project → Deploy from GitHub repo** → `autoroun/tiktokoyunu` seç
3. Deploy bittikten sonra: **Settings → Networking → Generate Domain**

---

## Kullanıcı Hesap Sistemi

- **URL bazlı oturum:** Her kullanıcıya benzersiz 10 karakterli hex URL verilir (örn: `site.com/a4b3c2d1e0`)
- **İlk giriş:** URL'siz veya geçersiz URL ile girilirse kullanıcı adı popup'ı gösterilir
- **Mevcut kullanıcı adı** → giriş yapar ve ayarlar sunucudan yüklenir
- **Yeni kullanıcı adı** → otomatik hesap oluşturulur
- **Ayar kaydetme:** Her değişiklik 1.5 saniye sonra otomatik sunucuya kaydedilir
- **Manuel kaydet:** Ayarlar panelinde "💾 TÜM AYARLARI KAYDET" butonu

### Hesap verisi nerede saklanır?

- `users.json` dosyasında (`.gitignore`'da — GitHub'a gitmez)
- Railway her redeploy'da bu dosyayı sıfırlar (ephemeral filesystem)
- Kalıcı çözüm için: Railway Volume (ücretli) veya Supabase/MongoDB Atlas entegrasyonu

---

## Veritabanı Yedekleme (İçe/Dışa Aktar)

Ayarlar panelinin altında **🗄️ VERİTABANI YEDEKLEMESİ** bölümü:

- **📦 DIŞA AKTAR:** Tüm ayarları + görselleri (logo, marş, SFX) tek `.json` dosyasına indirir
- **İÇE AKTAR:** Yedek `.json` dosyasını yükler, onay aldıktan sonra mevcut verilerin üzerine yazar

Yedek dosyası içeriği:
```json
{
  "version": 2,
  "exportDate": "...",
  "exportedBy": "kullanici_adi",
  "settings": { ... },
  "assets": {
    "team:0:logo": "data:image/png;base64,...",
    "team:0:anthem": "data:audio/mp3;base64,...",
    "global:reminder-sfx": "data:audio/...;base64,..."
  }
}
```

---

## Yerel Geliştirme

```bash
npm install
npm start
# http://localhost:3000 adresinde açılır
```

---

## Önemli Teknik Notlar

### Express 5 — Wildcard Route Sözdizimi

> ⚠️ Bu proje Express 5 kullanıyor. Express 5'te `/*` geçersizdir!

```js
// ❌ Express 4 (çalışmaz):
app.get('/*', handler);

// ✅ Express 5 (doğru):
app.get('/{*path}', handler);
```

Hata: `PathError: Missing parameter name at index 2: /*`

---

### Railway — Ephemeral Filesystem

Railway'in ücretsiz planında dosya sistemi **her redeploy'da sıfırlanır**.  
`users.json` bu yüzden silinir. Çözümler:

1. **Railway Volume** (ücretli) — kalıcı disk
2. **Supabase** (ücretsiz) — PostgreSQL veritabanı entegrasyonu
3. **MongoDB Atlas** (ücretsiz tier) — NoSQL alternatif

Şu an için: Kullanıcılar redeploy sonrası tekrar kayıt olabilir veya içe aktar ile ayarlarını yükleyebilir.

---

### Socket.io + TikTok Live Connector

- TikTok bağlantısı için yayın **canlı** olmalıdır; kayıt/arşiv çalışmaz
- `tiktok-live-connector` v2.1.1-beta1 kullanılıyor
- Hediye deduplication: `giftKey` + 2500ms TTL ile duplicate gift'ler filtrelenir

### Depolama Mimarisi

```
localStorage        → Ayarlar (teamCount, styleState, reminderState, vb.)
IndexedDB           → Binary assets (logo PNG, marş MP3, SFX MP3 — base64)
users.json          → Sunucu tarafı hesap + ayar kopyası
```

### PORT Ayarı

```js
const PORT = process.env.PORT || 3000;
// Railway otomatik PORT env variable atar
```

---

## Dosya Yapısı

```
futbol/
├── index.html        # Tüm frontend (2000+ satır)
├── server.js         # Express + Socket.io + TikTok backend
├── package.json      # npm start → node server.js
├── .gitignore        # node_modules, *.msi, .env, users.json
├── users.json        # Kullanıcı veritabanı (gitignored, runtime'da oluşur)
└── README.md         # Bu dosya
```
