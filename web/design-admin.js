/* The Design editor: a full-screen editor for one gallery's look, in three parts: the sections on the left, the
   options of the chosen section in the middle, and a large live preview of the real gallery page on the right.
   Changes show in the preview at once and save by themselves a moment later; Undo and Redo cover mistakes.
   A gallery keeps only the settings it changes; everything else follows "my default look".
   Controls are built from the limits the server sends, so they cannot offer a value the server would refuse.
   The arrangement (sections, options, large preview, device toggle) follows the pattern gallery tools such as Pixieset use.
   Uses the panel's globals through window.AdminKit. */
(function(){
var K = window.AdminKit, $ = K.$, api = K.api, esc = K.esc, toast = K.toast;
var DEVICES = { phone: { w: 390, h: 844, label: "Phone" }, tablet: { w: 820, h: 1180, label: "Tablet" }, desktop: { desk: true, ratio: 16 / 9, label: "Desktop" }, fit: { desk: true, label: "Fit" } };
/* Both computer sizes follow the preview area at full scale, so the words never change size: Fit fills the area,
   Desktop is the largest standard 16:9 screen that fits in it. */
function isDesk(k){ return !!DEVICES[k].desk; }
var SECTIONS = [["cover", "Cover"], ["type", "Typography"], ["color", "Color"], ["grid", "Grid"]];
/* section icons: Lucide, the same set as the rest of the panel */
var ICONS = { cover: "image", type: "type", color: "palette", grid: "layout-grid", advanced: "sliders-horizontal" };
function svg(name){ return K.lucide(ICONS[name], 20); }

/* D is the editing session for one gallery */
var D = { open: false, gid: null, info: null, own: {}, undo: [], redo: [], section: "cover", sub: "layout", device: null, land: false,
  frame: null, last: null, seq: 0, renderT: null, saveT: null, saving: false, again: false, errors: {}, warnings: [], status: "Saved", bad: false,
  lastKey: null, lastAt: 0, ro: null, keyFn: null, fontsOn: false };

var css = document.createElement("style");
css.textContent = [
".dzed{grid-template-columns:232px 360px minmax(0,1fr)}",
".dzed .dzrail,.dzopts{overflow-y:auto;min-height:0}",
".dzed .navitem svg{flex:0 0 auto;margin:-2px 0}.dzed .dzsep{border-top:1px solid var(--line);margin:8px 18px}",
".dzopts{background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column}",
".dzoh{padding:22px 24px 6px}.dzoh h2{margin:0;font-size:22px;font-weight:600}",
".dzoht{display:flex;align-items:center;justify-content:space-between;gap:12px}.dzoht .btn[disabled]{opacity:.4;cursor:default}",
".dzsubs{display:flex;gap:16px;margin-top:10px;flex-wrap:wrap}",
".dzsubs button{border:0;background:none;color:var(--muted);padding:6px 0;cursor:pointer;font:inherit;font-size:14px;border-bottom:2px solid transparent}",
".dzsubs button.on{color:var(--primary);border-bottom-color:var(--primary)}",
".dzob{padding:14px 24px 28px;flex:1 1 auto}",
".dzpub{padding:12px 16px;border-top:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;gap:10px}",
".dzpub p{margin:0;font-size:13px;line-height:1.45;color:var(--muted)}.dzpub.wait p{color:var(--warn)}",
".dzpub .acts{display:flex;gap:8px}.dzpub .acts .btn{flex:1}.dzpub .btn[disabled]{opacity:.4;cursor:default}",
".dzfoot{position:sticky;bottom:0;display:flex;align-items:center;gap:6px;padding:10px 16px;border-top:1px solid var(--line);background:var(--panel)}",
".dzfoot #dzStatus{flex:1;font-size:13px;color:var(--muted)}.dzfoot #dzStatus.bad{color:var(--bad)}",
".dzfoot button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;min-width:40px;height:36px;cursor:pointer;font:inherit}",
".dzfoot button[disabled]{opacity:.35;cursor:default}",
".dzstage{display:flex;flex-direction:column;align-items:center;padding:24px 28px 14px;min-width:0;min-height:0;position:relative}",
".dzcanvas{flex:1 1 auto;width:100%;min-height:0;display:grid;place-items:center}",
".dzdevice{overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.45);border-radius:6px;background:#fff}",
".dzdevice.phone{border-radius:28px;box-shadow:0 0 0 7px #0c0c0e,0 10px 40px rgba(0,0,0,.5)}",
".dzdevice.tablet{border-radius:18px;box-shadow:0 0 0 8px #0c0c0e,0 10px 40px rgba(0,0,0,.5)}",
".dzdevice iframe{border:0;display:block;transform-origin:0 0;background:#fff}",
".dzdev{display:flex;gap:6px;padding-top:14px}",
".dzdev button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;height:36px;padding:0 12px;cursor:pointer;font:inherit;font-size:13px}",
".dzdev button.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}",
".dzexpand{display:none}",
".dzseg{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}",
".dzseg button{border:1px solid var(--input-line);background:var(--card);color:var(--fg);border-radius:8px;padding:8px 13px;min-height:40px;font:inherit;font-size:14px;cursor:pointer}",
".dzseg button.on{border-color:var(--primary);box-shadow:inset 0 0 0 1px var(--primary);font-weight:600}",
".dzrange{display:flex;align-items:center;gap:12px}.dzrange input{flex:1;min-width:0}",
".dzrange output{min-width:62px;text-align:right;font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}",
".dzcol{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
".dzcol input[type=color]{width:44px;height:36px;border:1px solid var(--input-line);border-radius:6px;padding:0;background:none}",
".dzcol input[type=text]{max-width:104px}",
".dzlink{background:none;border:0;color:var(--muted);text-decoration:underline;cursor:pointer;font:inherit;font-size:12px;padding:0}",
".dzerr{color:var(--bad);font-size:13px;margin-top:6px;white-space:pre-wrap}",
".dzwarn{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:9px 12px;font-size:13px;margin:0 0 14px}",
".dzgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px 12px;margin:16px 0 22px}",
".dzlay{display:flex;flex-direction:column;gap:7px;border:0;background:none;padding:0;cursor:pointer;color:var(--fg);font:inherit;font-size:14px;text-align:center}",
".dzthumb{position:relative;display:block;aspect-ratio:3/2;background:#fff;border:2px solid var(--line);border-radius:6px;overflow:hidden}",
".dzlay.on .dzthumb{border-color:var(--primary)}.dzlay.on{font-weight:600}",
".dzthumb i{position:absolute;inset:0;background:#7d838d center/cover no-repeat}",
".dzthumb b{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font:700 8px/1 sans-serif;letter-spacing:.22em;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.4)}",
".dzthumb[data-l=left] b{text-align:left;left:9%;top:auto;bottom:16%;transform:none}",
".dzthumb[data-l=split] i{left:50%;top:9%;right:9%;bottom:9%}.dzthumb[data-l=split] b{right:50%;color:#222;text-shadow:none}",
".dzthumb[data-l=classic] i{inset:9% 9% 34% 9%}.dzthumb[data-l=classic] b{top:auto;bottom:11%;transform:none;color:#222;text-shadow:none}",
".dzthumb[data-l=frame] i{inset:7%}.dzthumb[data-l=frame]::after{content:\"\";position:absolute;inset:13%;border:1px solid rgba(255,255,255,.85)}",
".dzthumb[data-l=lines] b{left:14%;right:14%;padding:5px 0;border-top:1px solid #fff;border-bottom:1px solid #fff}",
".dzthumb[data-l=divider]::after{content:\"\";position:absolute;top:0;bottom:0;left:40%;width:3px;background:#fff}.dzthumb[data-l=divider] b{right:60%;left:6%;text-align:left}",
".dzthumb[data-l=journal] i{inset:9% 42% 26% 9%}.dzthumb[data-l=journal] b{left:auto;right:8%;top:auto;bottom:11%;transform:none;color:#222;text-shadow:none}",
".dzthumb[data-l=inset] i{inset:12% 33% 38%}.dzthumb[data-l=inset] b{top:auto;bottom:11%;transform:none;color:#222;text-shadow:none}",
".dzthumb[data-l=box] b{left:20%;right:20%;padding:6px 0;border:1px solid #fff}",
".dzsw{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0 22px}",
".dzsw button{display:flex;flex-direction:column;align-items:center;gap:7px;border:0;background:none;color:var(--fg);cursor:pointer;font:inherit;font-size:13px;padding:0}",
".dzdot{width:52px;height:52px;border-radius:50%;border:2px solid var(--line);display:block;position:relative;overflow:hidden}",
".dzdot i{position:absolute;inset:0;background:var(--sw-bg)}.dzdot b{position:absolute;left:30%;right:30%;top:42%;height:6px;background:var(--sw-fg);border-radius:3px}",
".dzdot u{position:absolute;left:30%;right:30%;top:58%;height:5px;background:var(--sw-ac);border-radius:3px}",
".dzsw button.on .dzdot{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary)}.dzsw button.on{font-weight:600}",
".dztype{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:10px;padding:12px 14px;text-align:left;cursor:pointer;font:inherit}",
".dztype.on{border-color:var(--primary);box-shadow:inset 0 0 0 1px var(--primary)}",
".dztype .t{font-size:19px;line-height:1.2}.dztype .n{font-size:12px;color:var(--muted)}",
".dztypes{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 22px}",
"textarea.dzcss{width:100%;min-height:260px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;tab-size:2;resize:vertical}",
".dzhooks code{background:var(--raised);border-radius:4px;padding:1px 5px;font-size:12px}",
".dzh3{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:26px 0 10px;font-weight:600}",
"@media(max-width:1199px){.dzed{grid-template-columns:64px 340px minmax(0,1fr)}.dzed .navhead,.dzed .navitem span,.dzed .dzsep{display:none}.dzed .navitem{justify-content:center;padding:12px 0}.dzed .dzrcov{aspect-ratio:1}.dzed .dzicons{flex-direction:column}.dzed .dzicons button{height:42px}}",
"@media(max-width:899px){",
" .dzed{display:flex;flex-direction:column}",
" .dzstage{order:0;height:38vh;height:38dvh;flex:0 0 auto;padding:10px 12px 6px}",
" .dzed .dzrail{order:1;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--line);flex:0 0 auto}",
" .dzed .dzrcov,.dzed .dzicons,.dzed .navhead{display:none}",
" .dzed .navitem span{display:inline}",
" .dzopts{order:2;flex:1 1 auto;border-right:0}.dzgrid{grid-template-columns:repeat(3,1fr)}",
" .dzexpand{display:grid;place-items:center;position:absolute;right:14px;top:12px;width:36px;height:36px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;z-index:2}",
" .dzed[data-view=preview] .dzstage{position:fixed;inset:0;height:auto;z-index:60;background:var(--bg)}",
"}"
].join("\n");
document.head.appendChild(css);

/* ---------- small helpers ---------- */
function clone(o){ return JSON.parse(JSON.stringify(o || {})); }
function gal(){ return K.galleryById(D.gid); }
function eff(){ return Object.assign({}, D.info.site, D.own); }
/* a setting that equals the default look needs no override of its own, and then follows the default later */
function prune(){ Object.keys(D.own).forEach(function(k){ if (D.own[k] === D.info.site[k]) delete D.own[k]; }); }
function dirty(){ return !!(D.saveT || D.saving); }

/* ---------- entry points ---------- */
function mapPane(pane){
  if (pane === "cover-photo") return { s: "cover", sub: "photo" };
  if (pane === "focal") return { s: "cover", sub: "focal" };
  if (["type", "color", "grid", "advanced"].indexOf(pane) >= 0) return { s: pane, sub: "layout" };
  return { s: "cover", sub: "layout" };
}
function isOpen(){ return D.open; }
function open(g, pane){
  var m = mapPane(pane);
  if (D.open && D.gid === g.id){
    if (pane){ D.section = m.s; D.sub = m.sub; }
    if ($("dz")){ paintRail(); showSection(); chrome(); }
    return;
  }
  close();
  D.open = true; D.gid = g.id; D.section = m.s; D.sub = m.sub; D.undo = []; D.redo = []; D.errors = {}; D.warnings = []; D.last = null;
  D.status = "Saved"; D.bad = false; D.device = window.innerWidth < 900 ? "phone" : "fit"; D.land = false;
  chrome();
  $("root").innerHTML = '<div class="spin" style="margin:60px auto"></div>';
  var mine = ++D.seq;
  loadInfo().then(function(){
    if (!D.open || D.gid !== g.id || mine !== D.seq) return;
    var cur = gal(); D.own = clone(cur && (cur.designDraft || cur.design));     /* what is being worked on: the draft, else the published look */
    buildShell(); mountPreview(); showSection();
    D.keyFn = onKey; document.addEventListener("keydown", D.keyFn);
  }, function(e){ if (D.open) $("root").innerHTML = '<p class="empty" style="padding:30px">' + esc(e.message) + '</p>'; });
}
function close(){
  if (!D.open) return;
  if (D.saveT) saveNow();
  D.open = false; D.seq++; clearTimeout(D.renderT); clearTimeout(D.saveT); D.saveT = null;
  if (D.ro){ try { D.ro.disconnect(); } catch (e) {} D.ro = null; }
  if (D.keyFn){ document.removeEventListener("keydown", D.keyFn); D.keyFn = null; }
  D.frame = null;
  var app = document.getElementById("app"); if (app) app.classList.remove("dzfull");
}
function loadInfo(){
  if (D.info) return Promise.resolve();
  return api("/design").then(function(r){
    if (!r.ok) throw new Error((r.body && r.body.error) || "Couldn’t load the design settings");
    D.info = r.body;
  });
}
function chrome(){
  var g = gal(); if (!g) return;
  K.chrome(K.galleryChromeOpts(g, { full: true, more: moreItems() }));
}
function moreItems(){
  return [
    { label: "Save as my default look", run: saveAsDefault },
    { label: "Use my default look", run: useDefault },
    { label: "Custom CSS and files…", run: function(){ D.section = "advanced"; paintRail(); showSection(); } },
    { label: "Open draft in a new tab", run: function(){ window.open("/admin/design-preview/" + D.gid, "_blank", "noopener"); } }
  ];
}

/* ---------- shell ---------- */
function buildShell(){
  $("root").innerHTML = '<div class="dz dzed" id="dz" data-view="edit">'
    + '<nav class="dzrail" aria-label="Design">' + K.railTop(gal(), "design")
    +   '<div class="navhead">Design</div><div class="navrow" role="tablist" aria-orientation="vertical" id="dzItems"></div></nav>'
    + '<section class="dzopts" role="tabpanel" aria-labelledby="dzTitle"><header class="dzoh"><div class="dzoht"><h2 id="dzTitle"></h2><button class="btn sm ghost" id="dzReset" type="button">Reset to default</button></div><div class="dzsubs" id="dzSubs"></div></header>'
    +   '<div class="dzob" id="dzBody"></div>'
    +   '<div class="dzpub" id="dzPub"></div>'
    +   '<footer class="dzfoot"><span id="dzStatus" role="status" aria-live="polite"></span>'
    +   '<button id="dzUndo" type="button" aria-label="Undo" title="Undo">↶</button><button id="dzRedo" type="button" aria-label="Redo" title="Redo">↷</button></footer></section>'
    + '<section class="dzstage" aria-label="Preview"><button class="dzexpand" id="dzExpand" type="button" aria-label="Full-screen preview">⤢</button>'
    +   '<div class="dzcanvas" id="dzCanvas"><div class="dzdevice" id="dzDevice"><iframe id="dzFrame" title="Gallery preview"></iframe></div></div>'
    +   '<div class="dzdev" id="dzDev" role="group" aria-label="Preview size"></div></section></div>';
  K.wireRail(function(tab){ if (tab !== "design"){ close(); K.backToGallery(tab); } });
  $("dzRcov").onclick = function(){ D.section = "cover"; D.sub = "photo"; paintRail(); showSection(); };
  $("dzUndo").onclick = undo; $("dzRedo").onclick = redo;
  $("dzExpand").onclick = function(){
    var dz = $("dz"), on = dz.dataset.view !== "preview";
    dz.dataset.view = on ? "preview" : "edit"; $("dzExpand").textContent = on ? "✕" : "⤢"; fit();
  };
  paintRail(); paintHistory(); paintPub(); setStatus(D.status, D.bad);
}
function paintRail(){
  var g = gal(); if (!g || !$("dzRcov")) return;
  var cov = K.coverOf(g);
  $("dzRcov").style.backgroundImage = cov ? 'url("' + cov + '")' : "";
  $("dzRcov").textContent = cov ? "" : "Choose a cover";
  var item = function(s, name){
    return '<button type="button" role="tab" data-s="' + s + '" aria-selected="' + (D.section === s) + '" class="navitem' + (D.section === s ? " on" : "") + '">' + svg(s) + '<span>' + name + '</span></button>';
  };
  $("dzItems").innerHTML = SECTIONS.map(function(s){ return item(s[0], s[1]); }).join("") + '<div class="dzsep"></div>' + item("advanced", "Advanced");
  Array.prototype.forEach.call($("dzItems").querySelectorAll("button"), function(b){
    b.onclick = function(){ D.section = b.dataset.s; D.sub = "layout"; paintRail(); showSection(); };
  });
}
function setStatus(t, bad, retry){
  D.status = t; D.bad = !!bad;
  var el = $("dzStatus"); if (!el) return;
  el.textContent = t; el.className = bad ? "bad" : "";
  if (retry){ var b = document.createElement("button"); b.type = "button"; b.textContent = "Retry"; b.style.marginLeft = "8px"; b.onclick = function(){ saveNow(); }; el.appendChild(b); }
}
function paintHistory(){ if ($("dzUndo")){ $("dzUndo").disabled = !D.undo.length; $("dzRedo").disabled = !D.redo.length; } }

/* ---------- preview ---------- */
function mountPreview(){
  D.frame = $("dzFrame");
  D.frame.addEventListener("load", function(){ fit(); if (D.last) send(D.last); else render(0); scrollPreview(); });
  D.frame.src = "/admin/design-preview/" + D.gid;
  paintDevices();
  if (window.ResizeObserver){ D.ro = new ResizeObserver(fit); D.ro.observe($("dzCanvas")); }
}
function paintDevices(){
  $("dzDev").innerHTML = Object.keys(DEVICES).map(function(k){ return '<button type="button" data-d="' + k + '" class="' + (D.device === k ? "on" : "") + '">' + DEVICES[k].label + '</button>'; }).join("")
    + '<button type="button" id="dzRot" aria-label="Rotate" title="Rotate">⟳</button>';
  Array.prototype.forEach.call($("dzDev").querySelectorAll("button[data-d]"), function(b){
    b.onclick = function(){ D.device = b.dataset.d; if (isDesk(D.device)) D.land = false; paintDevices(); fit(); };
  });
  $("dzRot").onclick = function(){ if (!isDesk(D.device)){ D.land = !D.land; fit(); } };
}
function fit(){
  var host = $("dzCanvas"), fr = D.frame; if (!host || !fr) return;
  var d = DEVICES[D.device], desk = isDesk(D.device);
  var w, h, k;
  if (desk){
    w = host.clientWidth; h = host.clientHeight; k = 1;
    if (d.ratio){ if (w / h > d.ratio) w = Math.round(h * d.ratio); else h = Math.round(w / d.ratio); }
  } else {
    w = D.land ? d.h : d.w; h = D.land ? d.w : d.h;
    k = Math.min(1, (host.clientWidth - 20) / w, (host.clientHeight - 20) / h);
  }
  if (!(k > 0) || !(w > 0)) return;
  fr.style.width = w + "px"; fr.style.height = h + "px"; fr.style.transform = "scale(" + k + ")";
  var box = $("dzDevice"); box.style.width = Math.round(w * k) + "px"; box.style.height = Math.round(h * k) + "px";
  box.className = "dzdevice " + (desk ? "" : D.device);
}
function send(msg){ try { if (D.frame && D.frame.contentWindow) D.frame.contentWindow.postMessage(msg, location.origin); } catch (e) {} }
function scrollPreview(){ send({ type: "ims-scroll", to: D.section === "grid" ? "grid" : "cover" }); }
function render(ms){
  clearTimeout(D.renderT);
  D.renderT = setTimeout(function(){
    var mine = ++D.seq;
    api("/design/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "gallery", design: D.own }) }).then(function(r){
      if (!D.open || mine !== D.seq || !r.ok) return;
      D.errors = r.body.errors || {}; D.warnings = r.body.warnings || [];
      D.last = { type: "ims-design", css: r.body.css, fontHref: r.body.fontHref || "" };
      send(D.last);
      var e = $("dzCssErr"); if (e) e.textContent = D.errors.customCss || "";
      var w = $("dzWarn"); if (w) w.innerHTML = D.warnings.map(function(x){ return '<div class="dzwarn">' + esc(x) + '</div>'; }).join("");
      var other = Object.keys(D.errors).filter(function(k){ return k !== "customCss"; });
      var o = $("dzErr"); if (o) o.textContent = other.map(function(k){ return D.errors[k]; }).join("\n");
    });
  }, ms);
}

/* ---------- changing things: undo, autosave ---------- */
function commit(changes, key){
  var now = Date.now();
  if (!(key && D.lastKey === key && now - D.lastAt < 800)){ D.undo.push(clone(D.own)); if (D.undo.length > 100) D.undo.shift(); }
  D.lastKey = key || null; D.lastAt = now; D.redo = [];
  Object.keys(changes).forEach(function(k){ D.own[k] = changes[k]; });
  changed(changes.customCss !== undefined);
}
function replaceOwn(next, key){
  D.undo.push(clone(D.own)); D.redo = []; D.lastKey = key || null; D.lastAt = Date.now();
  D.own = next; changed(false);
}
function changed(slow){ prune(); setStatus("Saving…"); paintHistory(); paintReset(); paintPub(); render(slow ? 600 : 150); saveSoon(slow ? 1500 : 700); }
function saveSoon(ms){ clearTimeout(D.saveT); D.saveT = setTimeout(saveNow, ms); }
function saveNow(){
  clearTimeout(D.saveT); D.saveT = null;
  if (D.saving){ D.again = true; return; }
  var bad = Object.keys(D.errors);
  if (bad.length){ setStatus("Not saved: " + D.errors[bad[0]], true); return; }
  D.saving = true;
  var id = D.gid, keys = Object.keys(D.own);
  api("/galleries/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ designDraft: D.own }) }).then(function(r){
    D.saving = false;
    if (!r.ok){ setStatus((r.body && r.body.error) ? "Not saved: " + r.body.error : "Couldn’t save", true, true); return; }
    var g = K.galleryById(id); if (g) takeDesign(g, r.body);
    if (D.open && D.gid === id){ if (D.again){ D.again = false; saveSoon(0); } else setStatus(r.body.designPending ? "Draft saved" : "Saved"); paintPub(); }
  }, function(){ D.saving = false; setStatus("Couldn’t save — check your connection", true, true); });
}
/* the gallery as the server now has it: its published look, and any draft waiting */
function takeDesign(g, body){ g.design = body.design; g.designDraft = body.designDraft; g.designPending = body.designPending; }
/* something is waiting to be published when the server holds a draft, or a change is on its way there */
function pendingNow(){ var g = gal(); return !!((g && g.designPending) || dirty()); }
function paintPub(){
  var box = $("dzPub"); if (!box) return;
  var wait = pendingNow();
  box.className = "dzpub" + (wait ? " wait" : "");
  box.innerHTML = '<p>' + (wait ? 'Your changes are a draft. Clients still see the published design until you publish.'
      : 'Published. Clients see exactly this design. Changes you make wait here until you publish them.') + '</p>'
    + '<div class="acts"><button class="btn sm ghost" id="dzDiscard" type="button"' + (wait ? "" : " disabled") + '>Discard changes</button>'
    + '<button class="btn sm" id="dzPublish" type="button"' + (wait ? "" : " disabled") + '>Publish</button></div>';
  $("dzPublish").onclick = publish; $("dzDiscard").onclick = discard;
}
function publish(){
  if (!pendingNow()) return;
  var bad = Object.keys(D.errors);
  if (bad.length) return toast("Fix the highlighted problem first: " + D.errors[bad[0]]);
  $("dzPublish").disabled = true;
  settled().then(function(){
    return api("/galleries/" + D.gid + "/design/publish", { method: "POST" });
  }).then(function(r){
    if (!r.ok){ paintPub(); return toast((r.body && r.body.error) || "Couldn’t publish"); }
    var g = gal(); if (g) takeDesign(g, r.body);
    setStatus("Saved"); paintPub(); toast("Published. Clients now see this design.");
  });
}
function discard(){
  if (!pendingNow()) return;
  if (!confirm("Throw away your unpublished changes?\n\nThe gallery goes back to the design clients see now.")) return;
  settled().then(function(){
    return api("/galleries/" + D.gid + "/design/discard", { method: "POST" });
  }).then(function(r){
    if (!r.ok) return toast((r.body && r.body.error) || "Couldn’t discard");
    var g = gal(); if (g) takeDesign(g, r.body);
    D.own = clone(r.body.design); D.undo = []; D.redo = []; paintHistory();
    setStatus("Saved"); showSection(true); paintPub(); toast("Back to the published design.");
  });
}
function undo(){
  if (!D.undo.length) return;
  D.redo.push(clone(D.own)); D.own = D.undo.pop(); D.lastKey = null; afterHistory();
}
function redo(){
  if (!D.redo.length) return;
  D.undo.push(clone(D.own)); D.own = D.redo.pop(); D.lastKey = null; afterHistory();
}
function afterHistory(){ changed(false); showSection(true); }
function onKey(ev){
  var t = ev.target && ev.target.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z"){ ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
}
window.addEventListener("beforeunload", function(ev){ if (D.open && dirty()){ ev.preventDefault(); ev.returnValue = ""; } });

/* ---------- controls ---------- */
function field(label, inner, hint){ return '<div class="field"><label>' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>'; }
function seg(key, label, opts, hint){
  var cur = eff()[key];
  return field(label, '<div class="dzseg" data-seg="' + key + '">' + opts.map(function(o){
    return '<button type="button" data-v="' + esc(o[0]) + '" class="' + (String(cur) === String(o[0]) ? "on" : "") + '">' + esc(o[1]) + '</button>'; }).join("") + '</div>', hint);
}
function range(key, label, hint){
  var r = D.info.ranges[key], v = eff()[key];
  return field(label, '<div class="dzrange"><input type="range" data-k="' + key + '" min="' + r.min + '" max="' + r.max + '" step="' + r.step + '" value="' + v + '" aria-label="' + esc(label) + '">'
    + '<output>' + v + (r.unit ? " " + r.unit : "") + '</output></div>', hint);
}
function select(key, label, opts, hint){
  var cur = eff()[key];
  return field(label, '<select data-k="' + key + '">' + opts.map(function(o){
    return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("") + '</select>', hint);
}
var THEME_COLOR = { background: "bg", text: "fg", accent: "accent" };
function colorField(key, label){
  var e = eff(), v = e[key], dflt = D.info.themes[e.theme === "dark" ? "dark" : "light"][THEME_COLOR[key]];
  return field(label, '<div class="dzcol"><input type="color" data-c="' + key + '" value="' + esc(v || dflt) + '" aria-label="' + esc(label) + '">'
    + '<input type="text" data-h="' + key + '" value="' + esc(v || "") + '" placeholder="' + esc(dflt) + '" aria-label="' + esc(label) + ' as hex">'
    + (v ? '<button type="button" class="dzlink" data-clear="' + key + '">use the theme’s colour</button>' : '<span class="hint" style="margin:0">theme colour</span>') + '</div>');
}
/* every control changes the draft, previews, and saves; controls that change what else is shown redraw the section after */
function wire(host){
  Array.prototype.forEach.call(host.querySelectorAll("[data-seg]"), function(box){
    Array.prototype.forEach.call(box.querySelectorAll("button"), function(b){
      b.onclick = function(){ var c = {}; c[box.dataset.seg] = b.dataset.v; commit(c); showSection(true); };
    });
  });
  Array.prototype.forEach.call(host.querySelectorAll("input[type=range][data-k]"), function(inp){
    var key = inp.dataset.k, r = D.info.ranges[key], out = inp.parentNode.querySelector("output");
    inp.oninput = function(){ var c = {}, v = Number(inp.value); c[key] = v; commit(c, "r_" + key); out.textContent = v + (r.unit ? " " + r.unit : ""); };
  });
  Array.prototype.forEach.call(host.querySelectorAll("select[data-k]"), function(sel){
    sel.onchange = function(){ var c = {}; c[sel.dataset.k] = sel.value; commit(c); showSection(true); };
  });
  Array.prototype.forEach.call(host.querySelectorAll("input[data-c]"), function(c){
    var key = c.dataset.c, t = host.querySelector('input[data-h="' + key + '"]');
    c.oninput = function(){ t.value = c.value; var o = {}; o[key] = c.value.toLowerCase(); commit(o, "c_" + key); };
    c.onchange = function(){ showSection(true); };
    t.oninput = function(){ if (/^#[0-9a-f]{6}$/i.test(t.value)){ c.value = t.value; var o = {}; o[key] = t.value.toLowerCase(); commit(o, "c_" + key); } };
    t.onchange = function(){ showSection(true); };
  });
  Array.prototype.forEach.call(host.querySelectorAll("[data-clear]"), function(b){
    b.onclick = function(){ var o = {}; o[b.dataset.clear] = null; commit(o); showSection(true); };
  });
}

/* ---------- sections ---------- */
/* the settings each section owns; "Reset to default" drops this gallery's own value for each, so it follows the default look again */
var RESET_KEYS = {
  cover: ["coverLayout", "cover", "coverHeight", "coverScrim", "coverMotion"],
  type: ["font", "titleFont", "titleCase", "titleWeight", "titleTracking", "titleSize"],
  color: ["theme", "background", "text", "accent"],
  grid: ["gridStyle", "rowHeight", "tileMinWidth", "tileAspect", "gap", "radius", "maxWidth", "header", "navStyle", "photoCount", "slideshow", "favourites"],
  advanced: ["customCss"]
};
function changedKeys(section){ return RESET_KEYS[section].filter(function(k){ return Object.prototype.hasOwnProperty.call(D.own, k); }); }
function paintReset(){
  var rb = $("dzReset"); if (!rb) return;
  /* the cover's photo and focal point are not design settings, so only its Layout view has a reset */
  var n = changedKeys(D.section).length;
  rb.hidden = D.section === "cover" && D.sub !== "layout"; rb.disabled = !n; rb.onclick = resetSection;
  rb.title = n ? "Put " + plural(n, "setting", "settings") + " here back to your default look" : "Nothing here differs from your default look";
}
function resetSection(){
  var keys = changedKeys(D.section); if (!keys.length) return;
  var next = clone(D.own); keys.forEach(function(k){ delete next[k]; });
  replaceOwn(next); showSection(true);
  toast(TITLES[D.section] + " is back to the default. Undo brings it back.");
}
var TITLES = { cover: "Cover", type: "Typography", color: "Color", grid: "Grid", advanced: "Advanced" };
function showSection(keep){
  if (!D.open || !$("dzBody")) return;
  var scroller = $("dzBody").parentNode, top = keep === true ? scroller.scrollTop : 0;
  $("dzTitle").textContent = TITLES[D.section];
  paintReset();
  var subs = D.section === "cover" ? [["layout", "Layout"], ["photo", "Cover photo"], ["focal", "Focal point"]] : [];
  $("dzSubs").innerHTML = subs.map(function(s){ return '<button type="button" data-sub="' + s[0] + '" class="' + (D.sub === s[0] ? "on" : "") + '">' + s[1] + '</button>'; }).join("");
  Array.prototype.forEach.call($("dzSubs").querySelectorAll("button"), function(b){ b.onclick = function(){ D.sub = b.dataset.sub; showSection(); }; });
  var body = $("dzBody");
  body.innerHTML = '<div id="dzWarn"></div>';
  var box = document.createElement("div"); body.appendChild(box);
  ({ cover: paintCover, type: paintType, color: paintColor, grid: paintGrid, advanced: paintAdvanced })[D.section](box);
  var tail = document.createElement("div"); tail.innerHTML = '<div id="dzErr" class="dzerr"></div>'; body.appendChild(tail);
  if (keep === true) scroller.scrollTop = top; else scrollPreview();
  render(0);
}
function paintCover(host){
  var g = gal();
  if (D.sub === "photo") return K.coverPhotoPane(host, g, {
    onPhoto: function(id){ send({ type: "ims-cover", src: "/api/admin/design-preview/" + g.id + "/img/" + id + "?size=preview" }); },
    done: function(){ paintRail(); showSection(true); } });
  if (D.sub === "focal") return K.focalPane(host, g, { onFocus: function(f){ send({ type: "ims-cover", focus: f[0] + " " + f[1] }); }, done: function(){ paintRail(); } });
  var e = eff(), cov = K.coverOf(g);
  var thumbs = D.info.coverLayouts.map(function(l){
    return '<button type="button" class="dzlay' + (e.coverLayout === l.id ? " on" : "") + '" data-lay="' + l.id + '" aria-pressed="' + (e.coverLayout === l.id) + '">'
      + '<span class="dzthumb" data-l="' + l.id + '"><i' + (cov ? ' style="background-image:url(\'' + esc(cov) + '\')"' : "") + '></i><b>TITLE</b></span><span>' + esc(l.name) + '</span></button>';
  }).join("");
  host.innerHTML = '<div class="dzgrid" style="' + (e.cover === "none" ? "opacity:.4;pointer-events:none" : "") + '">' + thumbs + '</div>'
    + (e.cover === "none" ? '<p class="hint" style="margin-top:-12px">Layouts apply when the cover is shown. Turn the cover size back on below.</p>' : "")
    + seg("cover", "Cover size", [["full", "Full screen"], ["banner", "Banner"], ["none", "None"]])
    + (e.cover === "banner" ? range("coverHeight", "Banner height") : "")
    + (e.cover !== "none" ? range("coverScrim", "Darken the photo", "Keeps the title readable on bright photos.")
      + seg("coverMotion", "Cover animation", [["on", "On"], ["off", "Off"]], "The slow zoom and fade as the gallery opens. Off shows the cover at once.") : "");
  Array.prototype.forEach.call(host.querySelectorAll("[data-lay]"), function(b){
    b.onclick = function(){ commit({ coverLayout: b.dataset.lay }); showSection(true); };
  });
  wire(host);
}
function loadFonts(){
  if (D.fontsOn) return; D.fontsOn = true;
  var fams = D.info.fonts.map(function(f){ return f.gfam; }).filter(Boolean);
  if (!fams.length) return;
  var l = document.createElement("link"); l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?" + fams.map(function(f){ return "family=" + f; }).join("&") + "&display=swap";
  document.head.appendChild(l);
}
function stackOf(id){ var f = D.info.fonts.filter(function(x){ return x.id === id; })[0]; return f ? f.stack : "inherit"; }
function paintType(host){
  loadFonts();
  var e = eff();
  var presets = D.info.typePresets.map(function(p){
    var on = Object.keys(p.set).every(function(k){ return e[k] === p.set[k]; });
    var tf = p.set.titleFont === "body" ? p.set.font : p.set.titleFont;
    return '<button type="button" class="dztype' + (on ? " on" : "") + '" data-tp="' + p.id + '" aria-pressed="' + on + '">'
      + '<span class="t" style="font-family:' + esc(stackOf(tf)) + ';font-weight:' + p.set.titleWeight + ';' + (p.set.titleCase === "upper" ? "text-transform:uppercase;font-size:15px;" : "")
      + 'letter-spacing:' + Math.min(0.15, p.set.titleTracking) + 'em">Gallery</span>'
      + '<span class="n" style="font-family:' + esc(stackOf(p.set.font)) + '">' + esc(p.name) + ' · Aa body text</span></button>';
  }).join("");
  var fonts = D.info.fonts.map(function(f){ return [f.id, f.name]; });
  host.innerHTML = '<div class="dztypes">' + presets + '</div>'
    + select("font", "Body font", fonts, "The “no download” fonts use what is already on the viewer’s device; the others load from Google Fonts.")
    + select("titleFont", "Title font", [["body", "Same as body"]].concat(fonts))
    + seg("titleCase", "Title case", [["upper", "UPPERCASE"], ["none", "As typed"]])
    + range("titleWeight", "Title weight") + range("titleTracking", "Letter spacing") + range("titleSize", "Title size");
  Array.prototype.forEach.call(host.querySelectorAll("[data-tp]"), function(b){
    var p = D.info.typePresets.filter(function(x){ return x.id === b.dataset.tp; })[0];
    b.onclick = function(){ commit(Object.assign({}, p.set)); showSection(true); };
  });
  wire(host);
}
function paintColor(host){
  var e = eff();
  var sw = D.info.colorPresets.map(function(p){
    var base = D.info.themes[p.set.theme === "dark" ? "dark" : "light"];
    var bg = p.set.background || base.bg, fg = p.set.text || base.fg, ac = p.set.accent || base.accent;
    var on = Object.keys(p.set).every(function(k){ return e[k] === p.set[k]; });
    return '<button type="button" class="' + (on ? "on" : "") + '" data-cp="' + p.id + '" aria-pressed="' + on + '" style="--sw-bg:' + esc(bg) + ';--sw-fg:' + esc(fg) + ';--sw-ac:' + esc(ac) + '">'
      + '<span class="dzdot"><i></i><b></b><u></u></span><span>' + esc(p.name) + '</span></button>';
  }).join("");
  host.innerHTML = '<div class="dzsw">' + sw + '</div>'
    + seg("theme", "Appearance", [["light", "Light"], ["dark", "Dark"], ["system", "Follow the device"]],
        e.theme === "system" ? "Colours you pick apply to the light appearance only. Devices set to dark use the dark theme." : "")
    + '<div class="dzh3">Your own colours</div>'
    + colorField("background", "Background") + colorField("text", "Text") + colorField("accent", "Buttons and accents")
    + '<div class="field"><button type="button" class="btn sm ghost" id="dzCopy">Match my website</button><div class="hint">Borrows the colours and font of your public website.</div></div>';
  Array.prototype.forEach.call(host.querySelectorAll("[data-cp]"), function(b){
    var p = D.info.colorPresets.filter(function(x){ return x.id === b.dataset.cp; })[0];
    b.onclick = function(){ commit(Object.assign({}, p.set)); showSection(true); };
  });
  host.querySelector("#dzCopy").onclick = function(){
    api("/site").then(function(r){
      var st = r.ok && r.body && r.body.state && r.body.state.settings && r.body.state.settings.style;
      if (!st) return toast("Your website has no style yet");
      var hex = function(v){ return /^#[0-9a-f]{6}$/i.test(v || "") ? v.toLowerCase() : null; };
      var c = {};
      if (hex(st.page)) c.background = hex(st.page);
      if (hex(st.text)) c.text = hex(st.text);
      if (hex(st.ink)) c.accent = hex(st.ink);
      var f = D.info.fonts.filter(function(x){ return x.name === st.bodyFont; })[0]; if (f) c.font = f.id;
      commit(c); toast("Copied from your website"); showSection(true);
    });
  };
  wire(host);
}
function paintGrid(host){
  var e = eff();
  host.innerHTML = seg("gridStyle", "Arrangement", [["justified", "Rows"], ["tiles", "Tiles"], ["columns", "Columns"]],
      e.gridStyle === "justified" ? "Rows keep each photo’s shape, like a contact sheet." : e.gridStyle === "tiles" ? "Even tiles in a regular grid." : "Columns flow photos top to bottom, keeping their shapes.")
    + (e.gridStyle === "justified" ? range("rowHeight", "Row height", "Tablets get slightly shorter rows; phones follow the screen.") : range("tileMinWidth", "Thumbnail size"))
    + (e.gridStyle === "tiles" ? range("tileAspect", "Tile shape", "Below 1 is tall, above 1 is wide.") : "")
    + range("gap", "Spacing") + range("radius", "Rounded corners") + range("maxWidth", "Widest the gallery gets")
    + seg("header", "Header title", [["bar", "Left"], ["centered", "Centred"]])
    + seg("navStyle", "Header buttons", [["text", "Words"], ["icons", "Icons"]], "On computers; phones always show icons.")
    + seg("photoCount", "Photo count", [["on", "Shown"], ["off", "Hidden"]], "The “174 photos” in the header.")
    + '<div class="dzh3">What clients can do</div>'
    + seg("slideshow", "Slideshow", [["on", "On"], ["off", "Off"]], "Off removes the Slideshow button.")
    + seg("favourites", "Favourites (hearts)", [["on", "On"], ["off", "Off"]], "Off removes the heart on every photo, in the viewer, and the Favourites button, so clients can’t pick photos.");
  wire(host);
}

/* ---------- Advanced: default look, custom CSS, design files ---------- */
function others(){ return K.galleries().filter(function(x){ return x.id !== D.gid; }); }
function plural(n, one, many){ return n + " " + (n === 1 ? one : many); }
/* wait for this gallery's own pending save, so the server sees what is on screen before the default changes */
function settled(){
  return new Promise(function(done){
    (function wait(){ if (D.saveT) saveNow(); if (D.saving) return setTimeout(wait, 100); done(); })();
  });
}
function saveAsDefault(){
  if (!confirm("Make this look your default for new galleries?\n\nGalleries that already exist keep the look they have now. Only galleries you create from now on start with this one.")) return;
  settled().then(function(){
    return api("/design", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design: eff() }) });
  }).then(function(r){
    if (!r.ok) return toast((r.body && r.body.error) || "Couldn’t save the default");
    D.info.site = r.body.site;
    /* the server wrote every existing gallery's look down as its own; this one then simply follows the new default */
    K.refreshGalleries(function(){ replaceOwn({}); showSection(); toast("Saved as your default for new galleries. Existing galleries are unchanged."); });
  });
}
function useDefault(){
  if (!Object.keys(D.own).length) return toast("This gallery already uses your default look");
  replaceOwn({}); showSection(true); toast("Using your default look. Undo brings the changes back.");
}
function resetDefault(){
  if (!confirm("Reset your default look to the original?\n\nGalleries that already exist keep the look they have now. Only galleries you create from now on start with the original.")) return;
  settled().then(function(){
    return api("/design", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design: D.info.defaults }) });
  }).then(function(r){
    if (!r.ok) return toast((r.body && r.body.error) || "Couldn’t reset");
    D.info.site = r.body.site;
    K.refreshGalleries(function(){
      var g = gal(); D.own = clone(g && (g.designDraft || g.design)); D.undo = []; D.redo = []; paintHistory();   /* this gallery keeps its look too */
      showSection(); toast("Default look reset for new galleries. Existing galleries are unchanged.");
    });
  });
}
var NAMES = { theme: "Appearance", background: "Background", text: "Text", accent: "Accent", font: "Font", gridStyle: "Arrangement", rowHeight: "Row height", tileMinWidth: "Thumbnail size",
  tileAspect: "Tile shape", gap: "Spacing", radius: "Corners", maxWidth: "Width", cover: "Cover size", coverHeight: "Banner height", coverScrim: "Darken", header: "Header",
  customCss: "Custom CSS", coverLayout: "Cover layout", titleFont: "Title font", titleCase: "Title case", titleWeight: "Title weight", titleTracking: "Letter spacing",
  titleSize: "Title size", navStyle: "Header buttons", coverMotion: "Cover animation", slideshow: "Slideshow", favourites: "Favourites", photoCount: "Photo count" };
function paintAdvanced(host){
  var keys = Object.keys(D.own), e = eff();
  host.innerHTML = '<div class="dzh3" style="margin-top:6px">Default look</div>'
    + '<p class="hint" style="margin:0 0 12px">' + (keys.length ? 'This gallery changes ' + plural(keys.length, "setting", "settings") + ': ' + esc(keys.map(function(k){ return NAMES[k] || k; }).join(", ")) + '.'
      : 'This gallery uses your default look.') + '</p>'
    + '<p class="hint" style="margin:0 0 12px">Your default look is what galleries you create from now on start with. Saving a new one never changes galleries that already exist.</p>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="dzSaveDef" type="button">Save as my default look</button>'
    + '<button class="btn sm ghost" id="dzUseDef" type="button">Use my default look</button>'
    + '<button class="btn sm ghost" id="dzResetDef" type="button">Reset default to original</button></div>'
    + '<div class="dzh3">Custom CSS</div>'
    + '<textarea class="dzcss" id="dzCss" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Custom CSS"></textarea>'
    + '<div class="hint"><span id="dzCount"></span></div><div class="dzerr" id="dzCssErr"></div>'
    + '<div class="hint dzhooks">For anything the controls don’t cover. Selectors: <code>:scope</code> (the whole gallery), <code>#cover</code>, <code>.hwrap</code>, <code>.htitle</code>, <code>#grid</code>, <code>.cell</code>. '
    + 'Variables like <code>--gap</code>, <code>--radius</code>, <code>--page-bg</code>, <code>--accent</code> can be set on <code>:scope</code>.<br>'
    + 'Not allowed: <code>url()</code>, <code>@import</code>, <code>@font-face</code>, animations, <code>position: fixed</code>, or anything loaded from another site. Up to 20,000 characters. It is saved once it passes.</div>'
    + '<div class="dzh3">Design file</div>'
    + '<p class="hint" style="margin:0 0 12px">Every setting and your CSS, with no photos, names or addresses. Export saves your current draft; import fills the settings in as a draft so you can look first, and Undo reverses it.</p>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn sm" id="dzExport" type="button">Download design file</button>'
    + '<input type="file" id="dzImport" accept=".json,application/json"></div><div class="dzerr" id="dzImpErr"></div>';
  host.querySelector("#dzSaveDef").onclick = saveAsDefault;
  host.querySelector("#dzUseDef").onclick = useDefault;
  host.querySelector("#dzResetDef").onclick = resetDefault;
  var ta = host.querySelector("#dzCss"); ta.value = e.customCss || "";
  var count = function(){ host.querySelector("#dzCount").textContent = ta.value.length.toLocaleString() + " / 20,000 characters"; };
  count();
  ta.oninput = function(){ commit({ customCss: ta.value }, "css"); count(); };
  ta.onkeydown = function(ev){
    if (ev.key === "Tab" && !ev.shiftKey){ ev.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); }
  };
  host.querySelector("#dzExport").onclick = function(){
    if (D.saveT) saveNow();
    setTimeout(function(){ location.href = "/api/admin/design/export?gallery=" + D.gid; }, 400);
  };
  host.querySelector("#dzImport").onchange = function(){
    var f = this.files[0]; this.value = ""; if (!f) return;
    var err = host.querySelector("#dzImpErr"); err.textContent = "";
    var rd = new FileReader();
    rd.onload = function(){
      api("/design/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(rd.result) }) }).then(function(r){
        if (!r.ok){ err.textContent = (r.body && r.body.error) || "That file couldn’t be used"; return; }
        replaceOwn(Object.assign({}, r.body.design)); showSection(true); toast("Imported. Undo reverses it.");
      });
    };
    rd.onerror = function(){ err.textContent = "That file couldn’t be read"; };
    rd.readAsText(f);
  };
}

window.DesignEditor = { open: open, close: close, isOpen: isOpen, chrome: chrome };
})();
