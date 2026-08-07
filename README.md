# ŞAMPİYON KİM? — TikTok Canlı Yayın Futbol Oyunu

## Proje Nedir?

TikTok canlı yayınına bağlanan, izleyicilerin **hediye göndererek** takım seçtiği interaktif bir futbol oyunudur. Yayıncı, TikTok kullanıcı adını girerek yayınına bağlanır; izleyicilerin gönderdiği hediyeler gerçek zamanlı olarak takım skorlarına yansır.

- **Frontend:** `index.html` — Tek dosya, Tailwind CSS + Socket.io
- **Backend:** `server.js` — Node.js + Express + Socket.io + TikTok Live Connector
- **Gerçek zamanlı iletişim:** WebSocket (Socket.io)

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

## Yerel Geliştirme

```bash
npm install
npm start
# http://localhost:3000 adresinde açılır
```

---

## Önemli Teknik Notlar

- `server.js` içinde `PORT = process.env.PORT || 3000` — Railway env variable'ını otomatik alır
- `node_modules/` ve `*.msi` dosyaları `.gitignore` ile GitHub'a gönderilmez
- TikTok bağlantısı için yayın **canlı** olmalıdır; kayıt/arşiv çalışmaz
- `package.json` start scripti: `node server.js`
