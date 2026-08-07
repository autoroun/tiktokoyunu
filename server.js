const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ── GLOBAL HATA YAKALAMA & LOGLAMA ─────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('\n[CRITICAL UNCAUGHT EXCEPTION]', new Date().toISOString());
  console.error(err?.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n[UNHANDLED REJECTION]', new Date().toISOString());
  console.error(reason);
});
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {}
  return {};
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[USERS] Kayıt hatası:', err.message);
  }
}

function generateToken() {
  return crypto.randomBytes(5).toString('hex'); // 10 karakter hex
}

let tiktokConnection = null;
let currentTargetUser = '';
let currentCatalog = [];
const giftSeen = new Map();

function pruneGiftSeen(now = Date.now()) {
  for (const [key, ts] of giftSeen.entries()) {
    if (now - ts > 15000) giftSeen.delete(key);
  }
}

function giftKey(data) {
  const u = data.uniqueId || data.userId || data.user_id || data.nickname || 'u';
  const gid = data.giftId || data.gift_id || data.giftID || data.giftName || 'g';
  const end = (data.repeatEnd === true || data.repeat_end === true) ? 'end' : 'mid';
  const rc = data.repeatCount || data.repeat_count || 1;
  return `${u}|${gid}|${end}|${rc}`;
}

function pickFirstImage(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find(Boolean) || null;
  if (typeof value === 'object') {
    return (
      pickFirstImage(value.url_list) ||
      pickFirstImage(value.urlList) ||
      pickFirstImage(value.urls) ||
      pickFirstImage(value.image_list) ||
      value.uri ||
      value.url ||
      null
    );
  }
  return null;
}

function looksLikeGift(item) {
  if (!item || typeof item !== 'object') return false;
  const id = item.id ?? item.giftId ?? item.gift_id;
  const name = item.name ?? item.giftName ?? item.describe ?? item.description;
  const diamonds = item.diamondCount ?? item.diamond_count ?? item.diamondCost ?? item.diamond_cost ?? item.price;
  return id !== undefined && (name !== undefined || diamonds !== undefined);
}

function flattenGiftNodes(value, out = []) {
  if (!value) return out;

  if (Array.isArray(value)) {
    for (const item of value) flattenGiftNodes(item, out);
    return out;
  }

  if (typeof value !== 'object') return out;

  if (looksLikeGift(value)) out.push(value);

  const candidateKeys = [
    'gifts',
    'giftList',
    'gift_list',
    'items',
    'data',
    'availableGifts',
    'gift_info',
    'giftInfo',
    'roomGiftList',
    'room_gift_list'
  ];

  for (const key of candidateKeys) {
    if (value[key]) flattenGiftNodes(value[key], out);
  }

  return out;
}

function normalizeGiftCatalog(raw) {
  const flat = flattenGiftNodes(raw, []);
  const unique = new Map();

  for (const item of flat) {
    const id = String(item.id ?? item.giftId ?? item.gift_id ?? '').trim();
    if (!id) continue;

    const normalized = {
      id,
      name: String(item.name ?? item.giftName ?? item.describe ?? item.description ?? `Gift ${id}`).trim(),
      diamondCount: Number(item.diamondCount ?? item.diamond_count ?? item.diamondCost ?? item.diamond_cost ?? item.price ?? 0) || 0,
      image: pickFirstImage(item.image || item.giftImage || item.icon || item.iconImage || item.previewImage),
      type: item.type ?? item.giftType ?? null
    };

    if (!unique.has(normalized.id)) {
      unique.set(normalized.id, normalized);
      continue;
    }

    const prev = unique.get(normalized.id);
    if ((!prev.image && normalized.image) || (!prev.diamondCount && normalized.diamondCount)) {
      unique.set(normalized.id, { ...prev, ...normalized });
    }
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (b.diamondCount !== a.diamondCount) return b.diamondCount - a.diamondCount;
    return a.name.localeCompare(b.name, 'tr');
  });
}

async function refreshGiftCatalog(force = false) {
  if (!tiktokConnection) return currentCatalog;
  if (!force && currentCatalog.length > 0) return currentCatalog;

  try {
    let raw = [];

    if (typeof tiktokConnection.fetchAvailableGifts === 'function') {
      raw = await tiktokConnection.fetchAvailableGifts();
    } else if (Array.isArray(tiktokConnection.availableGifts)) {
      raw = tiktokConnection.availableGifts;
    }

    const normalized = normalizeGiftCatalog(raw);
    if (normalized.length > 0) currentCatalog = normalized;

    io.emit('gift_catalog', currentCatalog);
    return currentCatalog;
  } catch (err) {
    console.error('[CATALOG] Hediye katalogu alinamadi:', err?.message || err);
    io.emit('gift_catalog_error', err?.message || 'Hediye katalogu alinamadi.');
    return currentCatalog;
  }
}

function emitConnectionState(extra = {}) {
  io.emit('connection_state', {
    targetUser: currentTargetUser,
    connected: Boolean(tiktokConnection),
    catalogCount: currentCatalog.length,
    ...extra
  });
}

function broadcastConnectionInfo(socket) {
  socket.emit('connection_state', {
    targetUser: currentTargetUser,
    connected: Boolean(tiktokConnection),
    catalogCount: currentCatalog.length
  });

  if (currentCatalog.length > 0) {
    socket.emit('gift_catalog', currentCatalog);
  }
}

function disconnectTikTokConnection(reason = 'TikTok yayini ile baglanti kesildi.') {
  if (tiktokConnection) {
    try {
      tiktokConnection.disconnect();
    } catch (err) {
      console.error('[DISCONNECT]', err?.message || err);
    }
  }

  tiktokConnection = null;
  giftSeen.clear();
  emitConnectionState();
  io.emit('system_msg', reason);
}

function bindTikTokEvents(connection) {
  connection.on('gift', (data) => {
    const hasRepeatEnd = (typeof data.repeatEnd === 'boolean') || (typeof data.repeat_end === 'boolean');
    const repeatEnd = (data.repeatEnd === true) || (data.repeat_end === true);
    if (hasRepeatEnd && !repeatEnd) return;

    const repeatCount = Number(data.repeatCount || data.repeat_count || 1) || 1;
    const diamondCount = Number(data.diamondCount ?? data.diamond_count ?? 0) || 0;

    const payload = {
      nickname: data.nickname,
      uniqueId: data.uniqueId || data.userId || data.user_id || data.nickname,
      profilePictureUrl: data.profilePictureUrl,
      giftName: data.giftName,
      giftId: String(data.giftId ?? data.gift_id ?? ''),
      diamondCount,
      repeatCount,
      repeatEnd,
      totalDiamondCount: diamondCount * repeatCount
    };

    const now = Date.now();
    pruneGiftSeen(now);
    const key = giftKey(payload);
    const prev = giftSeen.get(key);
    if (prev && (now - prev) < 2500) return;
    giftSeen.set(key, now);

    io.emit('gift', payload);
  });

  connection.on('like', (data) => {
    if (!data) return;
    const profilePictureUrl = pickFirstImage(data.profilePictureUrl || data.profilePicture || data.avatarThumb || data.userDetails?.profilePictureUrl);
    const payload = {
      nickname: data.nickname || data.userDetails?.nickname || 'İzleyici',
      uniqueId: String(data.uniqueId || data.userId || data.user_id || data.nickname || ('u_' + Math.random().toString(36).slice(2))),
      profilePictureUrl,
      likeCount: Number(data.likeCount || 1) || 1
    };
    io.emit('like', payload);
  });

  connection.on('streamEnd', () => {
    disconnectTikTokConnection('Canli yayin sona erdi.');
  });

  connection.on('error', (err) => {
    console.error('[TIKTOK CONNECTION ERROR]', new Date().toISOString(), err?.message || err);
    io.emit('system_msg', `TikTok Bağlantı Hatası: ${err?.message || err}`);
  });

  connection.on('disconnected', () => {
    tiktokConnection = null;
    emitConnectionState();
    io.emit('system_msg', 'TikTok yayini ile baglanti kesildi.');
    console.log('[TIKTOK] disconnected');
  });
}

io.on('connection', (socket) => {
  console.log('Sunucu: Bir istemci baglandi. ID:', socket.id);
  broadcastConnectionInfo(socket);

  socket.on('requestGiftCatalog', async (payload = {}) => {
    const force = Boolean(payload && payload.force);
    const catalog = await refreshGiftCatalog(force);
    socket.emit('gift_catalog', catalog);
  });

  socket.on('disconnectTikTok', () => {
    disconnectTikTokConnection('TikTok baglantisi kapatildi.');
  });

  socket.on('setTargetUser', async (username) => {
    const cleanUsername = String(username || '').trim().replace(/^@+/, '');
    if (!cleanUsername) return;

    if (tiktokConnection && currentTargetUser === cleanUsername) {
      console.log(`[TIKTOK] ${cleanUsername} yayınına zaten bağlı, yeni sekme/cihaz için bağlantı kesilmeden korundu.`);
      broadcastConnectionInfo(socket);
      return;
    }

    if (tiktokConnection) {
      disconnectTikTokConnection('Eski TikTok baglantisi kapatildi.');
    }

    currentCatalog = [];
    currentTargetUser = cleanUsername;
    giftSeen.clear();

    console.log(`TikTok yayinina baglaniliyor: ${cleanUsername}`);
    const connection = new WebcastPushConnection(cleanUsername, {
      enableExtendedGiftInfo: true,
      fetchRoomInfoOnConnect: true
    });
    tiktokConnection = connection;
    emitConnectionState();
    bindTikTokEvents(connection);

    connection.connect().then(async (state) => {
      if (tiktokConnection !== connection) return;
      console.log(`Baglanti basarili! Room ID: ${state.roomId}`);
      io.emit('system_msg', `${cleanUsername} yayinina basariyla baglanildi.`);
      emitConnectionState({ roomId: state.roomId, connected: true });
      await refreshGiftCatalog(true);
    }).catch((err) => {
      if (tiktokConnection === connection) {
        tiktokConnection = null;
      }
      console.error('Baglanti Hatasi:', err);
      socket.emit('system_msg', `Hata: ${err.message}. Lutfen kullanici adini kontrol edin.`);
      socket.emit('connection_state', {
        targetUser: currentTargetUser,
        connected: false,
        error: err.message,
        catalogCount: currentCatalog.length
      });
    });
  });

  socket.on('joinAccountRoom', (token) => {
    if (typeof token === 'string' && /^[a-f0-9]{10}$/.test(token)) {
      socket.join('account:' + token);
      console.log(`[SYNC] Socket ${socket.id} odaya katildi: account:${token}`);
    }
  });

  socket.on('send_gift_event', (payload) => {
    const { token, teamIndex, amount, giftName, nickname, sessionId } = payload || {};
    if (token && /^[a-f0-9]{10}$/.test(token)) {
      io.to('account:' + token).emit('gift_event_received', {
        teamIndex,
        amount,
        giftName: giftName || 'Hediye',
        nickname: nickname || 'İzleyici',
        sessionId
      });
    }
  });

  socket.on('send_like_event', (payload) => {
    const { token, nickname, profilePictureUrl, likeCount, sessionId } = payload || {};
    if (token && /^[a-f0-9]{10}$/.test(token)) {
      io.to('account:' + token).emit('like_event_received', {
        nickname: nickname || 'Test Beğeni',
        uniqueId: String(nickname || 'test_user').toLowerCase().replace(/[^a-z0-9_]/g, ''),
        profilePictureUrl: profilePictureUrl || '',
        likeCount: Number(likeCount || 1) || 1,
        sessionId
      });
    }
  });

  socket.on('client_log_error', (logEntry) => {
    console.error('[CLIENT LOG ERROR]', new Date().toISOString(), logEntry);
  });

  socket.on('disconnect', () => {
    console.log('Istemci ayrildi.');
  });
});

app.get('/api/gifts', (_req, res) => {
  res.json({
    targetUser: currentTargetUser,
    count: currentCatalog.length,
    gifts: currentCatalog
  });
});

// ── HESAP API'LERİ ───────────────────────────────────────────────
app.post('/api/account/login', (req, res) => {
  const raw = String(req.body?.username || '').trim();
  const username = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!username || username.length < 2 || username.length > 30) {
    return res.status(400).json({ error: 'Kullanıcı adı 2-30 karakter, sadece harf/rakam/alt çizgi içermeli.' });
  }
  const users = loadUsers();
  const existingToken = Object.keys(users).find(t => users[t].username === username);
  if (existingToken) {
    return res.json({
      token: existingToken,
      username,
      settings: users[existingToken].settings || null,
      assets: users[existingToken].assets || null,
      isNew: false
    });
  }
  const token = generateToken();
  users[token] = { username, settings: null, createdAt: new Date().toISOString() };
  saveUsers(users);
  return res.json({ token, username, settings: null, isNew: true });
});

app.get('/api/account/:token', (req, res) => {
  const token = String(req.params.token || '').toLowerCase();
  if (!/^[a-f0-9]{10}$/.test(token)) {
    return res.status(400).json({ error: 'Geçersiz token formatı.' });
  }
  const users = loadUsers();
  if (!users[token]) {
    users[token] = {
      username: 'kullanici_' + token.slice(0, 4),
      settings: null,
      assets: null,
      createdAt: new Date().toISOString()
    };
    saveUsers(users);
  }
  const user = users[token];
  return res.json({ username: user.username, settings: user.settings || null, assets: user.assets || null });
});

app.post('/api/account/:token/save', (req, res) => {
  const token = String(req.params.token || '').toLowerCase();
  if (!/^[a-f0-9]{10}$/.test(token)) {
    return res.status(400).json({ error: 'Geçersiz token formatı.' });
  }
  const users = loadUsers();
  if (!users[token]) {
    users[token] = {
      username: 'kullanici_' + token.slice(0, 4),
      settings: null,
      assets: null,
      createdAt: new Date().toISOString()
    };
  }
  const { settings, assets, sessionId } = req.body || {};
  if (settings) users[token].settings = settings;
  if (assets && typeof assets === 'object') users[token].assets = assets;
  users[token].updatedAt = new Date().toISOString();
  saveUsers(users);
  // Ayni odadaki diger cihazlara gercek zamanli bildir (kaydedeni haric)
  io.to('account:' + token).emit('settings_updated', { settings, assets, sessionId });
  return res.json({ ok: true });
});

app.post('/api/log-error', (req, res) => {
  console.error('[CLIENT HTTP LOG ERROR]', new Date().toISOString(), req.body);
  return res.json({ ok: true });
});

// Token URL'leri için index.html sun (en son olmalı)
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n====================================================================');
    console.error(`  ⚠️ HATA: Port ${PORT} zaten kullanımda!`);
    console.error('  Sunucu veya başka bir Node.js penceresi zaten açık ve çalışıyor.');
    console.error(`  http://localhost:${PORT} adresine tarayıcıdan bağlanabilirsiniz.`);
    console.error('  Sunucuyu yeniden başlatmak isterseniz mevcut Node.js sürecini kapatın.');
    console.error('====================================================================\n');
    process.exit(1);
  } else {
    console.error('Sunucu hatası:', err);
  }
});

server.listen(PORT, () => {
  console.log('\n=========================================');
  console.log(`  SUNUCU AKTIF: http://localhost:${PORT}`);
  console.log('  Kapatmak icin Terminalde CTRL+C basin.');
  console.log('=========================================\n');
});
