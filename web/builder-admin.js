/* The page editor: a full-screen editor for the public website's pages. On the left, the pages and the blocks of the
   open page; in the middle, a live preview of the real page at phone, tablet or desktop size, where clicking a block
   selects it; on the right, the page's settings or the chosen block's content, style and motion. Changes preview at
   once and save as a draft a moment later; Undo and Redo cover mistakes; the public site changes only on Publish.
   Forms are built from the block descriptions the server sends (site/blocks), so they offer only what it accepts.
   Uses the panel's globals through window.AdminKit, photo uploads through window.WebsiteKit (site-admin.js), and the
   preview, device and footer styles the Design editor (design-admin.js) adds, which admin.html loads first. */
(function(){
var K = window.AdminKit, $ = K.$, api = K.api, esc = K.esc, toast = K.toast;
var DEVICES = { phone: { w: 390, h: 844, label: "Phone" }, tablet: { w: 820, h: 1180, label: "Tablet" }, desktop: { w: 1440, h: 900, label: "Desktop" } };
var B = { open: false, info: null, site: null, pages: [], pagesRev: 0, rev: 0, pageId: "home", sel: null, tab: "content",
  undo: [], redo: [], lastKey: null, lastAt: 0, saveT: null, saving: false, again: false, renderT: null, seq: 0,
  status: "Saved", bad: false, stale: false, errors: [], device: "desktop", scrollY: 0, frame: null, ro: null, keyFn: null, msgFn: null,
  dirty: false, canPublish: false, missing: null };

var css = document.createElement("style");
css.textContent = [
".wb{display:grid;grid-template-columns:268px minmax(0,1fr) 360px;height:100%;min-height:0}",
".wbrail{background:var(--panel);border-right:1px solid var(--line);overflow-y:auto;min-height:0;padding:14px 0}",
".wbh{display:flex;align-items:center;justify-content:space-between;padding:10px 16px 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}",
".wbh button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;height:30px;padding:0 10px;cursor:pointer;font:inherit;font-size:13px;letter-spacing:0;text-transform:none}",
".wbpg,.wbbl{display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;font-size:14px;border-left:3px solid transparent}",
".wbpg:hover,.wbbl:hover{background:var(--raised)}.wbpg.on,.wbbl.on{border-left-color:var(--primary);background:var(--raised);font-weight:600}",
".wbpg .nm,.wbbl .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wbpg small,.wbbl small{color:var(--muted);font-weight:400}",
".wbpg .hd,.wbbl .hd{cursor:grab;color:var(--muted)}.wbpg.drag,.wbit.drag{opacity:.4}",
".wbbl.off .nm{opacity:.45;text-decoration:line-through}",
".wbbl .acts{display:flex;gap:2px}.wbbl .acts button{border:0;background:none;color:var(--muted);cursor:pointer;width:26px;height:26px;border-radius:6px;font:inherit}",
".wbbl .acts button:hover{background:var(--card);color:var(--fg)}",
".wbkids{margin-left:22px;border-left:1px dashed var(--line)}",
".wbcolh{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;font-size:12px;color:var(--muted)}",
".wbcolh button{border:0;background:none;color:var(--primary);cursor:pointer;font:inherit;font-size:12px}",
".wbpanel{background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:0;overflow-y:auto}",
".dzfoot #wbStatus{flex:1;font-size:13px;color:var(--muted)}.dzfoot #wbStatus.bad{color:var(--bad)}",
".wbstale{background:var(--warn-bg);color:var(--warn);padding:12px 16px;font-size:13px;display:flex;flex-direction:column;gap:8px}",
".wbstale .acts{display:flex;gap:8px}",
".wbpick{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:20px}",
".wbpickin{background:var(--panel);border-radius:14px;max-width:760px;width:100%;max-height:86vh;overflow-y:auto;padding:20px}",
".wbpickin h2{margin:0 0 14px;font-size:20px}",
".wbtypes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}",
".wbtype{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:10px;padding:10px;cursor:pointer;font:inherit;font-size:14px;text-align:left}",
".wbtype:hover,.wbtype:focus-visible{border-color:var(--primary)}.wbsk{display:block;aspect-ratio:5/3;background:var(--raised);border-radius:6px;color:var(--fg)}",
".wbsk svg{width:100%;height:100%;display:block}.wbsk svg *{fill:currentColor;opacity:.28}",
".wbphotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:12px}",
".wbphotos button{border:2px solid transparent;padding:0;border-radius:6px;overflow:hidden;cursor:pointer;aspect-ratio:1;background:var(--raised)}",
".wbphotos button.on{border-color:var(--primary)}.wbphotos img{width:100%;height:100%;object-fit:cover;display:block}",
".wbrich{border:1px solid var(--input-line);border-radius:8px;background:var(--card)}",
".wbrich .bar{display:flex;gap:4px;padding:6px;border-bottom:1px solid var(--line);flex-wrap:wrap}",
".wbrich .bar button{border:1px solid var(--line);background:var(--panel);color:var(--fg);border-radius:6px;min-width:32px;height:30px;cursor:pointer;font:inherit;font-size:13px}",
".wbrich .ed{min-height:160px;padding:10px 12px;outline:none;line-height:1.6}",
"textarea.wbcode{width:100%;min-height:200px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5}",
"@media(max-width:1199px){.wb{grid-template-columns:220px minmax(0,1fr) 320px}}",
"@media(max-width:899px){.wb{display:flex;flex-direction:column;overflow-y:auto}.wb .dzstage{height:42vh;height:42dvh;flex:0 0 auto}.wbrail,.wbpanel{border:0;overflow:visible}}"
].join("\n");
document.head.appendChild(css);

/* ---------- small helpers ---------- */
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function rid(prefix){ return prefix + (Math.random().toString(36).slice(2) + "0000000").slice(0, 7); }
function page(){ return B.pages.filter(function(p){ return p.id === B.pageId; })[0] || B.pages[0]; }
function typeOf(t){ return B.info.types.filter(function(x){ return x.type === t; })[0]; }
/* where a block is: its list (a page's blocks, or one column of a columns block) and its place in that list */
function find(id, list){
  list = list || page().blocks;
  for (var i = 0; i < list.length; i++){
    var b = list[i];
    if (b.id === id) return { list: list, i: i, block: b };
    if (b.type === "columns") for (var c = 0; c < b.props.columns.length; c++){ var f = find(id, b.props.columns[c]); if (f) return f; }
  }
  return null;
}
function allPhotos(){ var s = B.site; return s.pagePhotos.concat.apply(s.pagePhotos, s.galleries.map(function(g){ return g.photos; })); }
function photoById(id){ return allPhotos().filter(function(p){ return p.id === id; })[0]; }
function thumb(p){ return p ? "/api/admin/site/img/" + p.fileKey + "-grid.jpg" : ""; }
function dirtyLocal(){ return !!(B.saveT || B.saving); }
function field(label, inner, hint){ return '<div class="field"><label>' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + esc(hint) + '</div>' : "") + '</div>'; }
function slugify(t){
  var base = String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
  var taken = { img: 1 };
  B.pages.forEach(function(p){ taken[p.slug.toLowerCase()] = 1; });
  B.site.galleries.forEach(function(g){ taken[g.slug.toLowerCase()] = 1; });
  for (var n = 1; ; n++){ var s = n === 1 ? base : base + "-" + n; if (!taken[s]) return s; }
}
function newBlock(type){
  var t = typeOf(type);
  return { id: rid("b"), type: type, props: clone(t.defaults), style: clone(B.info.styleDefaults), motion: clone(B.info.motionDefaults) };
}
function reid(b){ b.id = rid("b"); if (b.type === "columns") b.props.columns.forEach(function(c){ c.forEach(reid); }); return b; }
/* drag to reorder the direct children of one list (pages, a page's blocks, or one column) */
function sortable(container, itemSel, onDone){
  var dragging = null, start = "";
  function items(){ return Array.prototype.slice.call(container.querySelectorAll(":scope > " + itemSel)); }
  function order(){ return items().map(function(x){ return x.dataset.id; }); }
  items().forEach(function(el){
    el.draggable = true;
    el.ondragstart = function(e){ e.stopPropagation(); dragging = el; start = order().join(","); el.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", el.dataset.id); };
    el.ondragend = function(e){ e.stopPropagation(); el.classList.remove("drag"); dragging = null; var now = order(); if (now.join(",") !== start) onDone(now); };
    el.ondragover = function(e){
      if (!dragging || dragging === el || dragging.parentNode !== container) return;
      e.preventDefault(); e.stopPropagation();
      var all = items();
      container.insertBefore(dragging, all.indexOf(dragging) < all.indexOf(el) ? el.nextSibling : el);
    };
  });
}

/* ---------- entry points ---------- */
function isOpen(){ return B.open; }
function open(pageId){
  if (B.open) return;
  B.open = true; B.undo = []; B.redo = []; B.sel = null; B.tab = "content"; B.stale = false; B.errors = []; B.scrollY = 0;
  B.status = "Saved"; B.bad = false; B.device = window.innerWidth < 900 ? "phone" : "desktop";
  chrome();
  $("root").innerHTML = '<div class="spin" style="margin:60px auto"></div>';
  var mine = ++B.seq;
  Promise.all([api("/site"), B.info ? Promise.resolve(null) : api("/site/blocks")]).then(function(rs){
    if (!B.open || mine !== B.seq) return;
    if (!rs[0].ok) throw new Error((rs[0].body && rs[0].body.error) || "Couldn’t load the website");
    if (rs[1]){ if (!rs[1].ok) throw new Error("Couldn’t load the block types"); B.info = rs[1].body; }
    take(rs[0].body);
    B.pageId = pageId && B.pages.some(function(p){ return p.id === pageId; }) ? pageId : B.pages[0].id;
    buildShell(); paintAll(); render(0);
    B.keyFn = onKey; document.addEventListener("keydown", B.keyFn);
    B.msgFn = onMessage; window.addEventListener("message", B.msgFn);
  }).catch(function(e){ if (B.open) $("root").innerHTML = '<p class="empty" style="padding:30px">' + esc(e.message) + '</p>'; });
}
function take(body){
  B.site = body.state; B.pages = clone(body.pages); B.pagesRev = body.pagesRev; B.rev = body.rev; B.dirty = body.dirty;
  B.canPublish = body.canPublish; B.missing = body.missing;
}
function close(){
  if (!B.open) return;
  if (B.saveT) saveNow();
  B.open = false; B.seq++; clearTimeout(B.renderT); clearTimeout(B.saveT); B.saveT = null;
  if (B.ro){ try { B.ro.disconnect(); } catch (e) {} B.ro = null; }
  if (B.keyFn){ document.removeEventListener("keydown", B.keyFn); B.keyFn = null; }
  if (B.msgFn){ window.removeEventListener("message", B.msgFn); B.msgFn = null; }
  B.frame = null;
  var app = document.getElementById("app"); if (app) app.classList.remove("dzfull");
}
function leave(){ close(); if (window.websiteView) window.websiteView("pages"); }
function chrome(){
  K.chrome({ title: "Pages", crumb: "Website", back: leave, section: "website", full: true, actions: [
    { label: "Open preview", onClick: function(){ var p = page(); window.open("/admin/site-preview/" + (p && p.slug ? encodeURIComponent(p.slug) + "/" : ""), "_blank", "noopener"); } },
    { label: "Publish", primary: true, id: "wbPublish", onClick: publish }
  ] });
}

/* ---------- shell ---------- */
function buildShell(){
  $("root").innerHTML = '<div class="wb" id="wb">'
    + '<nav class="wbrail" aria-label="Pages and blocks">'
    +   '<div class="wbh"><span>Pages</span><button type="button" id="wbAddPage">+ Page</button></div><div id="wbPages" role="list"></div>'
    +   '<div id="wbOutline"></div></nav>'
    + '<section class="dzstage" aria-label="Preview">'
    +   '<div class="dzcanvas" id="wbCanvas"><div class="dzdevice" id="wbDevice"><iframe id="wbFrame" title="Page preview"></iframe></div></div>'
    +   '<div class="dzdev" id="wbDev" role="group" aria-label="Preview size"></div></section>'
    + '<section class="wbpanel" aria-labelledby="wbTitle"><div id="wbStale"></div>'
    +   '<header class="dzoh"><div class="dzoht"><h2 id="wbTitle"></h2></div><div class="dzsubs" id="wbTabs"></div></header>'
    +   '<div class="dzob" id="wbBody"></div><div class="dzerr" id="wbErr" style="padding:0 24px 12px"></div>'
    +   '<div class="dzpub" id="wbPub"></div>'
    +   '<footer class="dzfoot"><span id="wbStatus" role="status" aria-live="polite"></span>'
    +   '<button id="wbUndo" type="button" aria-label="Undo" title="Undo">↶</button><button id="wbRedo" type="button" aria-label="Redo" title="Redo">↷</button></footer></section></div>';
  $("wbUndo").onclick = undo; $("wbRedo").onclick = redo;
  $("wbAddPage").onclick = addPage;
  B.frame = $("wbFrame");
  B.frame.addEventListener("load", function(){ fit(); send({ type: "wb-scroll", y: B.scrollY }); send({ type: "wb-select", id: B.sel }); });
  paintDevices();
  if (window.ResizeObserver){ B.ro = new ResizeObserver(fit); B.ro.observe($("wbCanvas")); }
}
function paintAll(){ paintPages(); paintOutline(); paintPanel(); paintHistory(); paintPub(); paintStale(); paintErrors(); setStatus(B.status, B.bad); }
function setStatus(t, bad, retry){
  B.status = t; B.bad = !!bad;
  var el = $("wbStatus"); if (!el) return;
  el.textContent = t; el.className = bad ? "bad" : "";
  if (retry){ var b = document.createElement("button"); b.type = "button"; b.textContent = "Retry"; b.style.marginLeft = "8px"; b.onclick = function(){ saveNow(); }; el.appendChild(b); }
}
function paintHistory(){ if ($("wbUndo")){ $("wbUndo").disabled = !B.undo.length; $("wbRedo").disabled = !B.redo.length; } }
function paintErrors(){ var e = $("wbErr"); if (e) e.textContent = B.errors.join("\n"); }

/* ---------- preview ---------- */
function paintDevices(){
  $("wbDev").innerHTML = Object.keys(DEVICES).map(function(k){ return '<button type="button" data-d="' + k + '" class="' + (B.device === k ? "on" : "") + '">' + DEVICES[k].label + '</button>'; }).join("");
  Array.prototype.forEach.call($("wbDev").querySelectorAll("button"), function(b){ b.onclick = function(){ B.device = b.dataset.d; paintDevices(); fit(); }; });
}
function fit(){
  var host = $("wbCanvas"), fr = B.frame; if (!host || !fr) return;
  var d = DEVICES[B.device], pad = B.device === "desktop" ? 0 : 20;
  var k = Math.min(1, (host.clientWidth - pad) / d.w, (host.clientHeight - pad) / d.h);
  if (!(k > 0)) return;
  fr.style.width = d.w + "px"; fr.style.height = d.h + "px"; fr.style.transform = "scale(" + k + ")";
  var box = $("wbDevice"); box.style.width = Math.round(d.w * k) + "px"; box.style.height = Math.round(d.h * k) + "px";
  box.className = "dzdevice " + (B.device === "desktop" ? "" : B.device);
}
function send(msg){ try { if (B.frame && B.frame.contentWindow) B.frame.contentWindow.postMessage(msg, location.origin); } catch (e) {} }
function onMessage(ev){
  if (ev.origin !== location.origin || !B.frame || ev.source !== B.frame.contentWindow) return;
  var m = ev.data || {};
  if (m.type === "wb-select") select(m.id || null, false);
  if (m.type === "wb-scrolled") B.scrollY = Number(m.y) || 0;
}
/* the real build of the pages on screen, saved or not, as one self-contained page (see site/routes.mjs renderDraft) */
function render(ms){
  clearTimeout(B.renderT);
  B.renderT = setTimeout(function(){
    var mine = ++B.seq, p = page();
    api("/site/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: B.pages, slug: p.slug }) }).then(function(r){
      if (!B.open || mine !== B.seq) return;
      B.errors = r.ok ? [] : ((r.body && r.body.errors) || [(r.body && r.body.error) || "The preview could not be made"]);
      paintErrors();
      if (r.ok && B.frame) B.frame.srcdoc = r.body.html;
    }, function(){});
  }, ms);
}
function select(id, scroll){
  B.sel = id && find(id) ? id : null; B.tab = "content";
  paintOutline(); paintPanel(); send({ type: "wb-select", id: B.sel, scroll: !!scroll });
}

/* ---------- changing things: undo, autosave ---------- */
function commit(fn, key){
  var now = Date.now();
  if (!(key && B.lastKey === key && now - B.lastAt < 800)){ B.undo.push(clone(B.pages)); if (B.undo.length > 100) B.undo.shift(); }
  B.lastKey = key || null; B.lastAt = now; B.redo = [];
  fn();
  changed();
}
function changed(){ B.dirty = true; setStatus("Saving…"); paintHistory(); paintPub(); paintPages(); paintOutline(); render(250); saveSoon(900); }
function undo(){ if (!B.undo.length) return; B.redo.push(clone(B.pages)); B.pages = B.undo.pop(); B.lastKey = null; afterHistory(); }
function redo(){ if (!B.redo.length) return; B.undo.push(clone(B.pages)); B.pages = B.redo.pop(); B.lastKey = null; afterHistory(); }
function afterHistory(){
  if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
  if (B.sel && !find(B.sel)) B.sel = null;
  changed(); paintPanel();
}
function saveSoon(ms){ clearTimeout(B.saveT); B.saveT = setTimeout(saveNow, ms); }
function saveNow(){
  clearTimeout(B.saveT); B.saveT = null;
  if (B.stale) return;
  if (B.saving){ B.again = true; return; }
  var body = JSON.stringify({ pages: B.pages });
  if (body.length > 2 * 1024 * 1024){ setStatus("Not saved: these pages are too large. Remove some text or blocks.", true); return; }
  B.saving = true;
  api("/site/pages", { method: "PUT", headers: { "Content-Type": "application/json", "x-pages-rev": String(B.pagesRev), "x-site-rev": String(B.rev) }, body: body }).then(function(r){
    B.saving = false;
    if (r.status === 409){ B.stale = true; paintStale(); setStatus("Not saved: changed somewhere else", true); return; }
    if (!r.ok){ B.errors = (r.body && r.body.errors) || []; paintErrors(); setStatus("Not saved: " + ((r.body && r.body.error) || "something went wrong"), true, true); paintPub(); return; }
    B.pagesRev = r.body.pagesRev; if (r.body.rev) B.rev = r.body.rev; B.dirty = true;
    if (B.again){ B.again = false; saveSoon(0); } else setStatus("Draft saved");
    paintPub();
  }, function(){ B.saving = false; setStatus("Couldn’t save — check your connection", true, true); });
}
function reloadSite(){
  return api("/site").then(function(r){ if (!r.ok) throw new Error((r.body && r.body.error) || "Couldn’t load the website"); return r.body; })
    .catch(function(e){ toast(e.message); throw e; });
}
/* another tab, or a restored version, changed the pages: the owner chooses, nothing is overwritten silently */
function paintStale(){
  var box = $("wbStale"); if (!box) return;
  if (!B.stale){ box.innerHTML = ""; return; }
  box.innerHTML = '<div class="wbstale" role="alert"><b>These pages were changed somewhere else</b>'
    + '<span>Another tab, or restoring an earlier version, changed them after you opened the editor. Your latest edits are not saved yet.</span>'
    + '<div class="acts"><button class="btn sm" type="button" id="wbKeep">Keep my version</button><button class="btn sm ghost" type="button" id="wbTheirs">Load the latest</button></div></div>';
  $("wbKeep").onclick = function(){ reloadSite().then(function(body){ B.site = body.state; B.pagesRev = body.pagesRev; B.rev = body.rev; B.stale = false; paintStale(); saveNow(); }); };
  $("wbTheirs").onclick = function(){ reloadSite().then(function(body){
    take(body); B.stale = false; B.undo = []; B.redo = [];
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !find(B.sel)) B.sel = null;
    paintAll(); render(0); setStatus("Saved");
  }); };
}
function settled(){
  return new Promise(function(done){ (function wait(){ if (B.saveT) saveNow(); if (B.saving) return setTimeout(wait, 100); done(); })(); });
}
function publish(){
  if (!B.canPublish) return toast(B.missing || "Publishing isn’t set up on this server");
  if (B.stale) return toast("First choose which version of the pages to keep");
  if (B.errors.length) return toast("Fix this first: " + B.errors[0]);
  var btn = $("wbPublish"); if (btn) btn.disabled = true;
  settled().then(function(){
    if (B.bad) throw new Error("Your last change is not saved yet");
    return api("/site/publish", { method: "POST" });
  }).then(function(r){
    if (!r.ok) throw new Error((r.body && r.body.error) || "Couldn’t publish");
    B.dirty = false; paintPub(); toast("Published — live in about a minute");
  }).catch(function(e){ toast(e.message); }).then(function(){ var x = $("wbPublish"); if (x) x.disabled = false; });
}
function discard(){
  if (!confirm("Throw away your unpublished page changes?\n\nThe pages go back to what the public site shows now. Galleries and photos are not affected.")) return;
  settled().then(function(){ return api("/site/pages/discard", { method: "POST" }); }).then(function(r){
    if (!r.ok) return toast((r.body && r.body.error) || "Couldn’t discard");
    B.pages = clone(r.body.pages); B.pagesRev = r.body.pagesRev; if (r.body.rev) B.rev = r.body.rev; B.undo = []; B.redo = []; B.stale = false; B.errors = [];
    if (!B.pages.some(function(p){ return p.id === B.pageId; })) B.pageId = B.pages[0].id;
    if (B.sel && !find(B.sel)) B.sel = null;
    paintAll(); render(0); setStatus("Saved"); toast("Back to the published pages.");
  });
}
function paintPub(){
  var box = $("wbPub"); if (!box) return;
  var wait = B.dirty || dirtyLocal();
  box.className = "dzpub" + (wait ? " wait" : "");
  box.innerHTML = '<p>' + (wait ? "Your changes are a draft. The public site shows the published pages until you publish." : "Published. The public site shows exactly these pages.") + '</p>'
    + '<div class="acts"><button class="btn sm ghost" id="wbDiscard" type="button"' + (wait ? "" : " disabled") + '>Discard changes</button></div>';
  $("wbDiscard").onclick = discard;
}
function onKey(ev){
  var t = ev.target && ev.target.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || (ev.target && ev.target.isContentEditable)) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z"){ ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
}
window.addEventListener("beforeunload", function(ev){ if (B.open && dirtyLocal()){ ev.preventDefault(); ev.returnValue = ""; } });

/* ---------- pages ---------- */
function paintPages(){
  var host = $("wbPages"); if (!host) return;
  host.innerHTML = B.pages.map(function(p){
    var where = p.slug ? "/" + p.slug + "/" : "/";
    return '<div class="wbpg' + (p.id === B.pageId ? " on" : "") + '" role="listitem" data-id="' + esc(p.id) + '"><span class="hd" title="Drag to reorder">☰</span>'
      + K.lucide(p.slug ? (p.galleryId != null ? "images" : "type") : "house", 16)
      + '<span class="nm">' + esc(p.title) + ' <small>' + esc(where) + (p.inMenu ? "" : " · not in menu") + '</small></span></div>';
  }).join("");
  Array.prototype.forEach.call(host.querySelectorAll(".wbpg"), function(el){
    el.onclick = function(){ B.pageId = el.dataset.id; B.sel = null; B.scrollY = 0; paintPages(); paintOutline(); paintPanel(); render(0); };
  });
  sortable(host, ".wbpg", function(ids){
    commit(function(){ B.pages = ids.map(function(id){ return B.pages.filter(function(p){ return p.id === id; })[0]; }); });
  });
}
function addPage(){
  var t = prompt("Name of the new page", "New page"); if (!t || !t.trim()) return;
  var p = { id: rid("p"), title: t.trim().slice(0, 120), slug: slugify(t), inMenu: true, seoTitle: "", seoDescription: "", galleryId: null, blocks: [newBlock("heading")] };
  p.blocks[0].props.text = p.title; p.blocks[0].props.level = 1;
  commit(function(){ B.pages.push(p); });
  B.pageId = p.id; B.sel = null; paintAll(); render(0);
}
function duplicatePage(p){
  var c = clone(p); c.id = rid("p"); c.galleryId = null; c.title = (p.title + " copy").slice(0, 120); c.slug = slugify(c.title); c.blocks.forEach(reid);
  commit(function(){ B.pages.splice(B.pages.indexOf(p) + 1, 0, c); });
  B.pageId = c.id; B.sel = null; paintAll(); render(0);
}
function deletePage(p){
  if (!confirm("Delete the page “" + p.title + "”?\n\nUndo brings it back. The public site keeps it until you publish.")) return;
  commit(function(){ B.pages = B.pages.filter(function(x){ return x !== p; }); });
  B.pageId = B.pages[0].id; B.sel = null; paintAll(); render(0);
}
function paintPanel(){
  if (!$("wbBody")) return;
  var f = B.sel ? find(B.sel) : null;
  if (!f){ B.sel = null; return paintPagePanel(); }
  paintBlockPanel(f);
}
function paintPagePanel(){
  var p = page(), gal = p.galleryId != null, home = p.slug === "" && !gal;
  $("wbTitle").textContent = p.title; $("wbTabs").innerHTML = "";
  $("wbBody").innerHTML = field("Name", '<input type="text" id="wbPTitle" maxlength="120" value="' + esc(p.title) + '"' + (gal ? " disabled" : "") + '>',
        gal ? "A gallery page takes its name and address from the gallery. Change them in the Galleries tab." : "")
    + (home ? "" : field("Web address", '<input type="text" id="wbPSlug" maxlength="60" value="' + esc(p.slug) + '"' + (gal ? " disabled" : "") + '>',
        gal ? "" : "Lower-case letters, numbers and dashes. Changing it breaks links people already have."))
    + '<div class="field"><label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;font-weight:400"><input type="checkbox" id="wbPMenu"' + (p.inMenu ? " checked" : "") + '> Show in the menu</label></div>'
    + '<div class="dzh3">Search engines</div>'
    + field("Title in search results", '<input type="text" id="wbPSeoT" maxlength="120" value="' + esc(p.seoTitle) + '" placeholder="' + esc(home ? "Your site name" : p.title) + '">')
    + field("Description", '<textarea id="wbPSeoD" rows="3" maxlength="300">' + esc(p.seoDescription) + '</textarea>', "Up to 300 characters. Empty uses your About text.")
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn sm ghost" type="button" id="wbPDup">Duplicate page</button>'
    + (home || gal ? "" : '<button class="btn sm ghost" type="button" id="wbPDel">Delete page</button>') + '</div>'
    + (home ? '<p class="hint">The home page can’t be deleted.</p>' : gal ? '<p class="hint">To remove a gallery page, delete or hide the gallery in the Galleries tab.</p>' : "");
  var set = function(key, v, k){ commit(function(){ page()[key] = v; }, k); };
  if (!gal) $("wbPTitle").oninput = function(){ set("title", this.value, "pt"); };
  if ($("wbPSlug") && !gal) $("wbPSlug").oninput = function(){ set("slug", this.value.toLowerCase(), "ps"); };
  $("wbPMenu").onchange = function(){ set("inMenu", this.checked); };
  $("wbPSeoT").oninput = function(){ set("seoTitle", this.value, "pst"); };
  $("wbPSeoD").oninput = function(){ set("seoDescription", this.value, "psd"); };
  $("wbPDup").onclick = function(){ duplicatePage(page()); };
  if ($("wbPDel")) $("wbPDel").onclick = function(){ deletePage(page()); };
}

/* ---------- blocks ---------- */
function paintOutline(){
  var host = $("wbOutline"); if (!host) return;
  var p = page();
  host.innerHTML = '<div class="wbh"><span>On this page</span></div>' + p.blocks.map(function(b){
    return '<div class="wbbl' + (B.sel === b.id ? " on" : "") + '" data-sel="' + esc(b.id) + '">' + K.lucide(typeOf(b.type).icon, 16)
      + '<span class="nm">' + esc(typeOf(b.type).label) + '</span></div>';
  }).join("");
  Array.prototype.forEach.call(host.querySelectorAll("[data-sel]"), function(row){ row.onclick = function(){ select(row.dataset.sel, true); }; });
}
function blockActions(f){
  var off = f.block.style.visible === "none";
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 16px"><button class="btn sm ghost" type="button" id="wbBBack">← Page settings</button>'
    + '<button class="btn sm ghost" type="button" id="wbBDup">Duplicate</button>'
    + '<button class="btn sm ghost" type="button" id="wbBHide">' + (off ? "Show" : "Hide") + '</button>'
    + '<button class="btn sm ghost" type="button" id="wbBDel">Delete</button></div>';
}
function wireBlockActions(f){
  $("wbBBack").onclick = function(){ select(null); };
  $("wbBDup").onclick = function(){ duplicateBlock(f.block.id); };
  $("wbBHide").onclick = function(){ toggleHidden(f.block.id); };
  $("wbBDel").onclick = function(){ deleteBlock(f.block.id); };
}
function paintBlockPanel(f){
  $("wbTitle").textContent = typeOf(f.block.type).label; $("wbTabs").innerHTML = "";
  $("wbBody").innerHTML = blockActions(f);
  wireBlockActions(f);
}
function duplicateBlock(id){
  var c;
  commit(function(){ var f = find(id); c = reid(clone(f.block)); f.list.splice(f.i + 1, 0, c); });
  select(c.id, true);
}
function toggleHidden(id){
  commit(function(){ var b = find(id).block; b.style.visible = b.style.visible === "none" ? "all" : "none"; });
  paintPanel();
}
function deleteBlock(id){
  commit(function(){ var f = find(id); f.list.splice(f.i, 1); });
  select(null);
}

window.SiteBuilder = { open: open, close: close, isOpen: isOpen };
})();
