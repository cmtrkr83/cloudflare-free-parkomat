// Parkomat - Cloudflare Worker (Free plan uyumlu)
// DB binding: D1 `DB`
// Secrets: BOT_TOKEN, PEPPER, TELEGRAM_WEBHOOK_SECRET
// Vars: BOT_USERNAME, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY (opsiyonel)

const TYPES = {
  double_park: "⛔ Çift sıra / Çıkışımı kapatıyor",
  lights_on: "💡 Far / lamba açık kalmış",
  window_open: "🪟 Cam açık kalmış",
  alarm: "🔔 Alarm çalıyor",
  other: "💬 Diğer",
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randStr(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[a[i] % ALPHABET.length];
  return s;
}
function randCode() {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return String(100000 + ((a[0] << 24 | a[1] << 16 | a[2] << 8 | a[3]) >>> 0) % 900000);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
function html(body, status = 200) {
  return new Response(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parkomat</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext x='50' y='72' font-size='72' text-anchor='middle'%3E%F0%9F%9A%97%3C/text%3E%3C/svg%3E">
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:20px;background:#f6f7f9;color:#111}h1{font-size:22px}.card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 2px 10px #0001;margin:12px 0}button{background:#111;color:#fff;border:0;border-radius:10px;padding:12px 16px;font-size:16px;width:100%;cursor:pointer}button:disabled{opacity:.5}input,select,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid #ddd;font-size:16px;box-sizing:border-box;margin:6px 0 12px}label{font-size:14px;font-weight:600}.tip{font-size:13px;color:#666}.type-grid{display:grid;gap:8px}.type-grid label{border:1px solid #ddd;border-radius:10px;padding:10px;font-weight:400;cursor:pointer}.qr{font-size:12px;word-break:break-all;background:#f0f0f0;padding:8px;border-radius:8px}</style></head><body>${body}</body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
function getIP(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function sendTelegram(env, chatId, text) {
  if (!env.BOT_TOKEN || !chatId) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return r.ok;
}
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true; // kurulmadıysa geç
  if (!token) return false;
  const fd = new FormData();
  fd.append("secret", env.TURNSTILE_SECRET_KEY);
  fd.append("response", token);
  fd.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
}

async function cleanupOld(env) {
  const mins = parseInt(env.RETENTION_MINUTES || "30", 10) || 30;
  const cutoff = Date.now() - mins * 60 * 1000;
  try { await env.DB.prepare("DELETE FROM messages WHERE created_at < ?").bind(cutoff).run(); }
  catch (e) { console.log("cleanup fail", e); }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupOld(env));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- Telegram webhook ---
    if (path === "/api/telegram/webhook" && method === "POST") {
      if (env.TELEGRAM_WEBHOOK_SECRET && url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET)
        return json({ ok: false }, 401);
      const update = await req.json().catch(() => ({}));
      const msg = update.message;
      const text = (msg?.text || "").trim();
      const chatId = String(msg?.chat?.id || "");
      if (!chatId || !text) return json({ ok: true });
      const m = text.match(/^\/start(?:@\w+)?\s*(\d{6})?/);
      if (m) {
        const code = m[1];
        if (!code) {
          await sendTelegram(env, chatId, "Merhaba! 🚗 Sahip panelinde gördüğün 6 haneli kodu şöyle gönder:\n\n<code>/start 482913</code>");
        } else {
          const v = await env.DB.prepare("SELECT id, plate_masked FROM vehicles WHERE link_code=?").bind(code).first();
          if (!v) {
            await sendTelegram(env, chatId, "❌ Bu kod bulunamadı. Paneldeki 6 haneli kodu kontrol et.");
          } else {
            await env.DB.prepare("UPDATE vehicles SET telegram_chat_id=? WHERE id=?").bind(chatId, v.id).run();
            await sendTelegram(env, chatId, `✅ Bağlandı! <b>${esc(v.plate_masked)}</b> için bildirimler bu sohbete gelecek.\n\nQR'ı cama yapıştırabilirsin. Biri okutunca mesaj burada görünecek.`);
          }
        }
      } else if (chatId) {
        await sendTelegram(env, chatId, "6 haneli kodu <code>/start KOD</code> şeklinde gönder.");
      }
      return json({ ok: true });
    }

    // --- Admin: araç oluştur ---
    if (path === "/api/admin/create" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      const plate = String(b.plate_masked || "").trim().slice(0, 20);
      if (plate.length < 3) return json({ error: "Plaka gerekli (örn: 34 AB ****)" }, 400);
      const v = {
        id: crypto.randomUUID(),
        public_token: randStr(12),
        admin_token: randStr(32),
        link_code: randCode(),
        plate_masked: plate,
        now: Date.now(),
      };
      await env.DB.prepare("INSERT INTO vehicles (id, public_token, admin_token, link_code, plate_masked, created_at) VALUES (?,?,?,?,?,?)")
        .bind(v.id, v.public_token, v.admin_token, v.link_code, v.plate_masked, v.now).run();
      const base = url.origin;
      return json({
        publicUrl: `${base}/v/${v.public_token}`,
        adminUrl: `${base}/a/${v.admin_token}`,
        link_code: v.link_code,
        botLink: `https://t.me/${env.BOT_USERNAME || "BOT_ADIN"}?start=${v.link_code}`,
      });
    }

    // --- Admin: rotate / info ---
    if (path === "/api/admin/rotate" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      const nt = randStr(12);
      const r = await env.DB.prepare("UPDATE vehicles SET public_token=? WHERE admin_token=?").bind(nt, String(b.admin_token || "")).run();
      if (!r.meta.changes) return json({ error: "bulunamadı" }, 404);
      return json({ publicUrl: `${url.origin}/v/${nt}` });
    }
    if (path === "/api/admin/purge" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      const v = await env.DB.prepare("SELECT id FROM vehicles WHERE admin_token=?").bind(String(b.admin_token || "")).first();
      if (!v) return json({ error: "bulunamadı" }, 404);
      await env.DB.prepare("DELETE FROM messages WHERE vehicle_id=?").bind(v.id).run();
      return json({ ok: true });
    }
    if (path === "/api/admin/info" && method === "GET") {
      const at = url.searchParams.get("admin_token") || "";
      const v = await env.DB.prepare("SELECT id, public_token, plate_masked, link_code, telegram_chat_id, created_at FROM vehicles WHERE admin_token=?").bind(at).first();
      if (!v) return json({ error: "bulunamadı" }, 404);
      const msgs = await env.DB.prepare("SELECT type, text, created_at FROM messages WHERE vehicle_id=? ORDER BY id DESC LIMIT 20").bind(v.id).all();
      return json({ vehicle: { ...v, connected: !!v.telegram_chat_id }, messages: msgs.results || [] });
    }

    // --- Scanner: mesaj gönder ---
    const vm = path.match(/^\/api\/v\/([A-Za-z0-9]{8,32})\/message$/);
    if (vm && method === "POST") {
      const publicToken = vm[1];
      const v = await env.DB.prepare("SELECT id, plate_masked, telegram_chat_id FROM vehicles WHERE public_token=?").bind(publicToken).first();
      if (!v) return json({ error: "QR geçersiz" }, 404);
      const b = await req.json().catch(() => ({}));
      const type = String(b.type || "other");
      const text = String(b.text || "").trim().slice(0, 500);
      if (!TYPES[type]) return json({ error: "tür hatalı" }, 400);
      if (text.length < 5) return json({ error: "Mesaj çok kısa (min 5 karakter)" }, 400);
      if (/https?:\/\//i.test(text) && text.length < 20) { /* link spam yumuşak geç */ }
      const ip = getIP(req);
      const okT = await verifyTurnstile(env, b.turnstileToken, ip);
      if (!okT) return json({ error: "Doğrulama başarısız, tekrar dene" }, 403);
      const pepper = env.PEPPER || "parkomat";
      const ipHash = await sha256hex(ip + "|" + pepper + "|" + v.id);
      const now = Date.now();
      // rate limit: IP+araç 10dk'da 3, günde 10; araç geneli saatte 30
      const c1 = await env.DB.prepare("SELECT COUNT(*) c FROM messages WHERE vehicle_id=? AND ip_hash=? AND created_at>?").bind(v.id, ipHash, now - 10 * 60 * 1000).first();
      if (c1.c >= 3) return json({ error: "Çok sık gönderdin, 10 dk sonra dene" }, 429);
      const c2 = await env.DB.prepare("SELECT COUNT(*) c FROM messages WHERE vehicle_id=? AND ip_hash=? AND created_at>?").bind(v.id, ipHash, now - 24 * 3600 * 1000).first();
      if (c2.c >= 10) return json({ error: "Günlük limit doldu" }, 429);
      const c3 = await env.DB.prepare("SELECT COUNT(*) c FROM messages WHERE vehicle_id=? AND created_at>?").bind(v.id, now - 3600 * 1000).first();
      if (c3.c >= 30) return json({ error: "Bu araç şu an yoğun, sonra dene" }, 429);
      await env.DB.prepare("INSERT INTO messages (vehicle_id, type, text, ip_hash, created_at) VALUES (?,?,?,?,?)").bind(v.id, type, text, ipHash, now).run();
      if (ctx && Math.random() < 0.05) ctx.waitUntil(cleanupOld(env));
      let telegramSent = false;
      if (v.telegram_chat_id && env.BOT_TOKEN) {
        const t = `🚗 <b>Park Bildirimi</b> — ${esc(v.plate_masked)}\n📍 ${esc(TYPES[type])}\n💬 ${esc(text)}\n\n<i>QR ile anonim gönderildi. Numara paylaşılmadı.</i>`;
        try { telegramSent = await sendTelegram(env, v.telegram_chat_id, t); } catch (e) { console.log("tg fail", e); }
      }
      return json({ ok: true, telegram: telegramSent });
    }

    // --- Sayfalar ---
    if (path === "/" && method === "GET")
      return html(`<h1>🚗 Parkomat</h1><div class="card"><p>Camdaki QR'ı okutan kişi, <b>numaranı görmeden</b> sana Telegram'dan ulaşır.</p><a href="/sahip"><button>1 dakikada QR oluştur →</button></a><p class="tip">Ücretsiz: Cloudflare Worker + D1 + Telegram. Telefon numarası sistemde saklanmaz.</p></div>`);

    if (path === "/sahip" && method === "GET")
      return html(`<h1>QR oluştur</h1><div class="card"><label>Plaka (maskeli yaz, örn: 34 AB ****)</label><input id="p" maxlength="20" placeholder="34 AB ****"><button id="b" onclick="go()">QR ve panel linki oluştur</button><p id="o"></p><p class="tip">Gerçek plakanın tamamını yazma. Son haneleri **** yap.</p></div>
<script>async function go(){const plate=document.getElementById('p').value;const b=document.getElementById('b');b.disabled=true;const r=await fetch('/api/admin/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plate_masked:plate})});const j=await r.json();b.disabled=false;if(j.error){document.getElementById('o').textContent=j.error;return;}location.href=j.adminUrl;}</script>`);

    const am = path.match(/^\/a\/([A-Za-z0-9]{20,64})$/);
    if (am && method === "GET") {
      const at = am[1];
      const v = await env.DB.prepare("SELECT public_token, plate_masked, link_code, telegram_chat_id FROM vehicles WHERE admin_token=?").bind(at).first();
      if (!v) return html("<h1>Bulunamadı</h1>", 404);
      const publicUrl = `${url.origin}/v/${v.public_token}`;
      const siteKey = env.TURNSTILE_SITE_KEY || "";
      return html(`<h1>🚗 ${esc(v.plate_masked)} — Sahip Paneli</h1>
<div class="card"><p><b>1. Telegram'ı bağla ${v.telegram_chat_id ? "✅" : "⬜"}</b></p><p>Kodun: <b style="font-size:24px">${esc(v.link_code)}</b></p><a href="https://t.me/${esc(env.BOT_USERNAME || "BOT_ADIN")}?start=${esc(v.link_code)}"><button>Telegram Bot'u aç</button></a><p class="tip">Bot'a <b>/start ${esc(v.link_code)}</b> gönder. Bağlanınca bildirimler Telegram'a düşer.</p></div>
<div class="card"><p><b>2. QR'ı bas</b></p><div class="qr">${esc(publicUrl)}</div><div id="q" style="margin:12px 0"></div><p><a href="/v/${v.public_token}/etiket" target="_blank"><button>🖨 Etiket şablonunu aç / yazdır</button></a></p><p><a href="https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=${encodeURIComponent(publicUrl)}" target="_blank">Sadece QR indir</a></p><p class="tip">Bu linki QR yapıp cama içten yapıştır. Altına: "Hatalı park? QR okut, numaramı görmeden yaz."</p><button onclick="newQR()">🔄 QR değiştir (eskisi iptal olur)</button></div>
<div class="card"><p><b>3. Son mesajlar</b></p><p class="tip">Mesajlar ${esc(env.RETENTION_MINUTES || "30")} dk sonra otomatik silinir.</p><div id="m">yükleniyor...</div><button onclick="purge()">🗑 Tüm mesajları hemen sil</button></div>
<p class="tip">⚠️ Bu sayfanın linkini kimseyle paylaşma. Kaybetmemek için yer imlerine ekle.</p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>try{new QRCode(document.getElementById('q'),{text:${JSON.stringify(publicUrl)},width:220,height:220});}catch(e){}
async function load(){const r=await fetch('/api/admin/info?admin_token=${at}');const j=await r.json();document.getElementById('m').innerHTML=(j.messages|| []).map(x=>'<p>• '+new Date(x.created_at).toLocaleString('tr-TR')+' — '+x.text.replace(/</g,'&lt;')+'</p>').join('')||'henüz mesaj yok';}load();
async function newQR(){if(!confirm('Emin misin? Eski QR çalışmaz olur.'))return;const r=await fetch('/api/admin/rotate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({admin_token:${JSON.stringify(at)}})});const j=await r.json();if(j.publicUrl)location.reload();}
async function purge(){if(!confirm('Tüm mesajlar silinsin mi?'))return;await fetch('/api/admin/purge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({admin_token:${JSON.stringify(at)}})});load();}</script>`);
    }

    const pm = path.match(/^\/v\/([A-Za-z0-9]{8,32})$/);
    if (pm && method === "GET") {
      const v = await env.DB.prepare("SELECT id, plate_masked FROM vehicles WHERE public_token=?").bind(pm[1]).first();
      if (!v) return html("<h1>QR geçersiz ❌</h1><p class='card'>Bu QR iptal edilmiş olabilir.</p>", 404);
      const opts = Object.entries(TYPES).map(([k, l]) => `<label><input type="radio" name="t" value="${k}" ${k === "double_park" ? "checked" : ""} style="width:auto"> ${esc(l)}</label>`).join("");
      const siteKey = env.TURNSTILE_SITE_KEY || "";
      const turnstile = siteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div>` : "";
      return html(`<h1>🚗 ${esc(v.plate_masked)}</h1><div class="card"><p>Araç sahibine <b>anonim</b> mesaj gönder. Numarası sana da, numaran ona da görünmez.</p><div class="type-grid">${opts}</div><label>Mesajın</label><textarea id="x" rows="4" maxlength="500" placeholder="Örn: Merhaba, çıkışımı kapatmışsınız, müsait misiniz?"></textarea>${turnstile}<button id="b" onclick="send()">Gönder →</button><p id="o" class="tip"></p></div>
<script>async function send(){const t=document.querySelector('input[name=t]:checked').value;const text=document.getElementById('x').value;const b=document.getElementById('b');const o=document.getElementById('o');b.disabled=true;o.textContent='Gönderiliyor...';const ts=document.querySelector('[name=cf-turnstile-response]')?.value;const r=await fetch('/api/v/${pm[1]}/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:t,text,turnstileToken:ts})});const j=await r.json();b.disabled=false;if(j.ok){document.body.innerHTML=j.telegram?'<h1>✅ İletildi</h1><div class=card><p>Araç sahibi Telegram\\'dan bildirim aldı. Teşekkürler!</p></div>':'<h1>✅ Kaydedildi</h1><div class=card><p>Mesaj kaydedildi ama araç sahibi Telegram\\'ı henüz bağlamamış, bildirim gidemedi.</p></div>';}else{o.textContent='⚠️ '+(j.error||'hata');}}</script>`);
    }

    const em = path.match(/^\/v\/([A-Za-z0-9]{8,32})\/etiket$/);
    if (em && method === "GET") {
      const v = await env.DB.prepare("SELECT plate_masked FROM vehicles WHERE public_token=?").bind(em[1]).first();
      if (!v) return html("<h1>QR geçersiz ❌</h1>", 404);
      const publicUrl = `${url.origin}/v/${em[1]}`;
      return new Response(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cam Etiketi - Parkomat</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext x='50' y='72' font-size='72' text-anchor='middle'%3E%F0%9F%9A%97%3C/text%3E%3C/svg%3E">
<style>*{box-sizing:border-box;margin:0;padding:0}@media print{.noprint{display:none!important}body{background:#fff!important}.sticker{box-shadow:none!important}}body{font-family:Arial,Helvetica,sans-serif;background:#333;min-height:100vh;display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px}.sticker{width:60mm;background:#000;border-radius:6mm;overflow:hidden;box-shadow:0 8px 30px #000a}.qrwrap{background:#000;padding:4mm 4mm 2mm}#qr{background:#fff;border-radius:3mm;padding:3mm;display:flex;justify-content:center}#qr img,#qr canvas{width:46mm!important;height:46mm!important}.plate{background:#000;color:#fff;text-align:center;font-weight:900;font-size:6mm;letter-spacing:.5mm;padding:2mm 1mm 3mm}.yband{background:#ffeb00;color:#111;text-align:center;font-weight:900;font-size:5.5mm;line-height:1.25;padding:3mm 2mm 4mm}.noprint button{background:#fff;color:#111;border:0;border-radius:10px;padding:12px 20px;font-size:16px;cursor:pointer;font-weight:700}</style></head><body>
<div class="noprint"><button onclick="window.print()">🖨 Yazdır</button> <a href="/v/${em[1]}" style="color:#fff">forma bak →</a></div>
<div class="sticker"><div class="qrwrap"><div id="qr"></div></div><div class="plate">${esc(v.plate_masked)}</div><div class="yband">ARAÇ SAHİBİNE<br>ULAŞMAK İÇİN<br>KODU OKUT</div></div>
<div class="noprint" style="color:#aaa;font-size:12px">Öneri: 6×10 cm'ye renkli bas, cama içten yapıştır.</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>new QRCode(document.getElementById('qr'),{text:${JSON.stringify(publicUrl)},width:248,height:248,correctLevel:QRCode.CorrectLevel.M});</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return html("<h1>404</h1>", 404);
  },
};
