/* Website section: the public site's galleries, pages, style and publishing.
   Uses the panel's globals: $, api, esc, toast, chrome, listView, tog. */
(function(){
var K = window.AdminKit, $ = K.$, api = K.api, esc = K.esc, toast = K.toast, chrome = K.chrome, listView = K.listView, tog = K.tog;
var W = { state:null, rev:0, screen:"galleries", gid:null, publishes:[], dirty:false, canPublish:false,
          missing:null, fonts:[], defaults:null, liveUrl:null, queue:[], uploading:false, showVersions:false, active:false, liveDeploymentId:null, dirtyForm:false };

var css = document.createElement("style");
css.textContent = [
".wbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0 16px;border-bottom:1px solid var(--line);margin-bottom:20px}",
".wbar .st{flex:1;font-size:14px;color:var(--muted)}.wbar .st b{color:var(--warn);font-weight:600}",
".wtabs{display:flex;gap:4px;margin-bottom:20px;flex-wrap:wrap;border-bottom:1px solid var(--line)}",
".wtabs button{border:0;border-bottom:2px solid transparent;background:none;color:var(--muted);padding:10px 14px;min-height:44px;cursor:pointer;font:inherit;font-size:14px}",
".wtabs button:hover{color:var(--fg)}",
".wtabs button.on{color:var(--fg);border-bottom-color:var(--primary)}",
".wg{display:flex;align-items:center;gap:12px;padding:10px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;background:var(--card);cursor:pointer}",
".wg.drag,.wp.drag{opacity:.4}",
".wg img,.wg .ph{width:56px;height:56px;object-fit:cover;border-radius:6px;background:var(--raised);flex:none}",
".wg .nm{flex:1}.wg .nm small{display:block;color:var(--muted);font-size:12px}",
".wg .hd{cursor:grab;color:var(--muted);padding:0 4px}",
".wgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:14px}",
".wp{position:relative;aspect-ratio:1;background:var(--raised);border-radius:6px;overflow:hidden;cursor:grab}",
".wp img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}",
".wp .bd{position:absolute;left:6px;bottom:6px;font-size:11px;background:rgba(0,0,0,.65);color:#fff;border-radius:4px;padding:2px 6px}",
".wp .bd.cv{background:var(--ok-bg);color:var(--ok)}",
".wp .mn{position:absolute;right:4px;top:4px;border:0;border-radius:50%;width:26px;height:26px;background:rgba(20,20,26,.85);color:var(--fg);cursor:pointer;font-size:15px;line-height:1}",
".wp .menu{position:absolute;right:4px;top:34px;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:2;min-width:150px}",
".wp .menu button{display:block;width:100%;text-align:left;border:0;background:none;color:var(--fg);padding:8px 12px;cursor:pointer;font:inherit;font-size:14px}",
".wp .menu button:hover{background:var(--raised)}",
".wdrop{border:2px dashed var(--input-line);border-radius:10px;padding:20px;text-align:center;color:var(--muted);cursor:pointer}",
".wdrop.on{border-color:var(--primary);color:var(--fg)}",
".wver div{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}.wver div span{flex:1}",
".wthumb{width:120px;height:120px;object-fit:cover;border-radius:8px;background:var(--raised);display:block;margin-bottom:8px}",
".wcol{display:flex;gap:8px;align-items:center}.wcol input[type=color]{width:42px;height:32px;border:1px solid var(--input-line);border-radius:6px;padding:0;background:none}",
".wsample{font-size:20px;margin-top:6px;color:var(--fg)}"
].join("\n");
document.head.appendChild(css);

/* ---------- data ---------- */
function load(){
  return api("/site").then(function(r){
    if (!r.ok) throw new Error((r.body && r.body.error) || "Could not load the website");
    var b = r.body;
    W.state = b.state; W.rev = b.rev; W.publishes = b.publishes; W.dirty = b.dirty;
    W.canPublish = b.canPublish; W.missing = b.missing; W.fonts = b.fonts; W.defaults = b.defaults; W.liveUrl = b.liveUrl; W.liveDeploymentId = b.liveDeploymentId || null;
  });
}
/* every change carries the revision it was made against; a stale one means another tab won */
function send(path, method, data){
  return api("/site" + path, { method: method, headers: { "Content-Type":"application/json", "x-site-rev": String(W.rev) },
                               body: data === undefined ? undefined : JSON.stringify(data) })
    .then(function(r){
      if (r.status === 409){ toast("Changed in another tab — showing the latest"); return load().then(function(){ render(); return null; }, function(e){ toast(e.message); return null; }); }
      if (!r.ok){ toast((r.body && r.body.error) || "That didn’t work"); return null; }
      if (r.body && r.body.rev) W.rev = Math.max(W.rev, r.body.rev);
      return r.body;
    });
}
function changed(msg){
  if (!W.active) return Promise.resolve();
  return load().then(function(){ render(); if (msg) toast(msg); }, function(e){ toast(e.message); });
}
/* after an upload run: rebuild the screen, unless the person is part-way through typing on a form */
function settled(){
  if (!W.active) return;
  if (!W.dirtyForm || (W.screen !== "pages" && W.screen !== "style")){ changed(); return; }
  load().then(function(){
    var st = document.querySelector(".wbar .st"); if (st) st.innerHTML = statusHtml();
  }, function(e){ toast(e.message); });
}
function statusHtml(){ return W.dirty ? "<b>Unpublished changes</b>" : "Everything is live"; }
function gal(id){ return (W.state.galleries || []).filter(function(g){ return g.id === id; })[0]; }
function allPhotos(){ return W.state.pagePhotos.concat.apply(W.state.pagePhotos, W.state.galleries.map(function(g){ return g.photos; })); }
function photoById(id){ return allPhotos().filter(function(p){ return p.id === id; })[0]; }
function thumb(p){ return p ? "/api/admin/site/img/" + p.fileKey + "-grid.jpg" : ""; }

/* ---------- resizing in the browser ---------- */
function shrinkTo(src, w, h){
  /* halve until close, then one last step - one big jump from 6000 px to 800 px looks jagged */
  var cur = src, cw = src.width, ch = src.height;
  while (cw / 2 >= w && ch / 2 >= h){
    cw = Math.round(cw / 2); ch = Math.round(ch / 2);
    var c = document.createElement("canvas"); c.width = cw; c.height = ch;
    var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, cw, ch); x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, cw, ch); cur = c;
  }
  var out = document.createElement("canvas"); out.width = w; out.height = h;
  var o = out.getContext("2d"); o.fillStyle = "#fff"; o.fillRect(0, 0, w, h); o.imageSmoothingQuality = "high"; o.drawImage(cur, 0, 0, w, h);
  return out;
}
function jpeg(canvas){ return new Promise(function(ok, bad){ canvas.toBlob(function(b){ if (b) ok(b); else bad(new Error("This browser could not make the web copy of the photo.")); }, "image/jpeg", 0.82); }); }
function makeCopies(file){
  return createImageBitmap(file, { imageOrientation: "from-image" }).then(function(bmp){
    var w = bmp.width, h = bmp.height;
    var gs = w > 800 ? 800 / w : 1, fs = Math.max(w, h) > 2048 ? 2048 / Math.max(w, h) : 1;
    var gw = Math.round(w * gs), gh = Math.round(h * gs), fw = Math.round(w * fs), fh = Math.round(h * fs);
    return Promise.all([jpeg(shrinkTo(bmp, gw, gh)), jpeg(shrinkTo(bmp, fw, fh))]).then(function(b){
      bmp.close(); return { grid: b[0], full: b[1], width: fw, height: fh };
    }, function(e){ bmp.close(); throw e; });
  }, function(){ throw new Error(file.name + ": this browser can’t read it. Use a JPEG, or upload from Safari."); });
}

/* ---------- uploads: one at a time, with a running count ---------- */
function queue(files, target, after, zone, multiple){
  var list = Array.prototype.slice.call(files); if (!multiple) list = list.slice(0, 1);
  list.forEach(function(f){ W.queue.push({ file:f, target:target, after:after, zone:zone }); });
  pump();
}
function pump(){
  if (W.uploading) return;
  var it = W.queue.shift();
  if (!it){ settled(); return; }
  W.uploading = true;
  var left = W.queue.length;
  var st = $(it.zone + "st"); if (st) st.textContent = "Uploading " + it.file.name + (left ? " (" + left + " more)" : "") + "…";
  makeCopies(it.file).then(function(c){
    var f = new FormData();
    f.append("original", it.file, it.file.name);
    f.append("grid", c.grid, "grid.jpg"); f.append("full", c.full, "full.jpg");
    f.append("width", String(c.width)); f.append("height", String(c.height));
    return fetch("/api/admin/site/photos?gallery=" + it.target, { method:"POST", credentials:"same-origin", body:f })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "Upload failed"); return j; }); });
  }).then(function(j){
    W.rev = Math.max(W.rev, j.rev);
    if (it.after) return it.after(j.photo);
  }).catch(function(e){ toast(e.message); })
    .then(function(){ W.uploading = false; pump(); });
}
function dropZone(id, target, label, after, multiple){
  return { html: '<div class="wdrop" id="'+id+'">'+esc(label)+'<input type="file" accept="image/*"'+(multiple?" multiple":"")+' hidden></div>'
                 + '<div class="hint" id="'+id+'st"></div>',
    wire: function(){
      var z = $(id), inp = z.querySelector("input");
      z.onclick = function(){ inp.click(); };
      inp.onchange = function(){ queue(inp.files, target, after, id, multiple); inp.value = ""; };
      z.ondragover = function(e){ e.preventDefault(); z.classList.add("on"); };
      z.ondragleave = function(){ z.classList.remove("on"); };
      z.ondrop = function(e){ e.preventDefault(); z.classList.remove("on"); queue(e.dataTransfer.files, target, after, id, multiple); };
    } };
}

/* ---------- drag to reorder ---------- */
function sortable(container, itemSel, onDone){
  var dragging = null, start = "";
  function order(){ return Array.prototype.map.call(container.querySelectorAll(itemSel), function(x){ return Number(x.dataset.id); }); }
  Array.prototype.forEach.call(container.querySelectorAll(itemSel), function(el){
    el.draggable = true;
    el.ondragstart = function(e){
      dragging = el; start = order().join(","); el.classList.add("drag");
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", el.dataset.id);
    };
    el.ondragend = function(){
      el.classList.remove("drag"); dragging = null;
      var now = order(); if (now.join(",") !== start) onDone(now);
    };
    el.ondragover = function(e){
      e.preventDefault();
      if (!dragging || dragging === el) return;
      var items = Array.prototype.slice.call(container.querySelectorAll(itemSel));
      var after = items.indexOf(dragging) < items.indexOf(el);
      container.insertBefore(dragging, after ? el.nextSibling : el);
    };
  });
}

/* ---------- shell ---------- */
window.websiteView = function(screen, gid){
  W.active = true;
  W.screen = screen || W.screen || "galleries"; W.gid = gid || null;
  chrome({ title:"Website", section:"website", sub: W.liveUrl ? W.liveUrl.replace(/^https?:\/\//, "") : "" });
  $("root").innerHTML = '<div class="wrap" style="padding-top:22px"><div class="spin"></div></div>';
  load().then(render, function(e){ $("root").innerHTML = '<div class="wrap"><p class="empty">'+esc(e.message)+'</p></div>'; });
};
function render(){
  if (!W.active) return;
  var tabs = [["galleries","Galleries"],["pages","Pages"],["style","Style"]].map(function(t){
    return '<button data-s="'+t[0]+'" class="'+(W.screen===t[0]?"on":"")+'">'+t[1]+'</button>'; }).join("");
  var status = statusHtml();
  $("root").innerHTML = '<div class="wrap" style="padding-top:22px">'
    + '<div class="wbar"><span class="st">'+status+'</span>'
    +   '<button class="btn sm ghost" id="wprev">Preview</button>'
    +   '<button class="btn sm ghost" id="wvers">Versions</button>'
    +   '<button class="btn sm" id="wpub"'+(W.canPublish?"":" disabled title=\""+esc(W.missing||"")+"\"")+'>Publish</button></div>'
    + (W.showVersions ? versionsHtml() : "")
    + '<div class="wtabs">'+tabs+'</div><div id="wbody"></div></div>';
  Array.prototype.forEach.call(document.querySelectorAll(".wtabs button"), function(b){
    b.onclick = function(){ W.screen = b.dataset.s; W.gid = null; render(); };
  });
  $("wprev").onclick = function(){ window.open("/admin/site-preview/", "_blank", "noopener"); };
  $("wvers").onclick = function(){ W.showVersions = !W.showVersions; render(); };
  $("wpub").onclick = publish;
  wireVersions();
  W.dirtyForm = false;
  $("wbody").addEventListener("input", function(){ W.dirtyForm = true; });
  if (W.screen === "pages") return pagesScreen();
  if (W.screen === "style") return styleScreen();
  return W.gid ? galleryScreen(gal(W.gid)) : galleriesScreen();
}
function publish(){
  var b = $("wpub"); b.disabled = true; b.textContent = "Publishing…";
  send("/publish", "POST").then(function(r){
    if (r) changed("Published — live in about a minute");
    else { b.disabled = false; b.textContent = "Publish"; }
  });
}
function versionsHtml(){
  var ok = W.publishes.filter(function(p){ return p.status === "ok"; });
  if (!ok.length) return '<div class="wver"><p class="hint">Nothing published from here yet.</p></div>';
  var live = ok.filter(function(p){ return W.liveDeploymentId && p.deploymentId === W.liveDeploymentId; })[0] || ok[0];
  return '<div class="wver">' + ok.map(function(p){
    var isLive = p === live;
    return '<div><span>'+esc(new Date(p.createdAt).toLocaleString())+(isLive?" — live now":"")+'</span>'
      + (isLive ? "" : '<button class="btn sm ghost" data-restore="'+p.id+'">Restore</button>') + '</div>';
  }).join("") + '</div>';
}
function wireVersions(){
  Array.prototype.forEach.call(document.querySelectorAll("[data-restore]"), function(b){
    b.onclick = function(){
      if (!confirm("Put this version back on the live site? Your current edits are replaced by that version.")) return;
      b.disabled = true;
      send("/restore", "POST", { id: Number(b.dataset.restore) }).then(function(r){ if (r) changed("Restored"); else b.disabled = false; });
    };
  });
}

/* ---------- galleries ---------- */
function galleriesScreen(){
  var gs = W.state.galleries;
  var h = '<div class="wlist" id="wlist">' + gs.map(function(g){
    var c = photoById(g.coverPhotoId) || g.photos[0];
    var info = g.photos.length + " photo" + (g.photos.length===1?"":"s") + (g.hidden ? " · hidden" : "") + " · /" + g.slug;
    return '<div class="wg" data-id="'+g.id+'"><span class="hd" title="Drag to reorder">☰</span>'
      + (c ? '<img src="'+thumb(c)+'" alt="">' : '<span class="ph"></span>')
      + '<span class="nm">'+esc(g.title)+'<small>'+esc(info)+'</small></span></div>';
  }).join("") + '</div>'
    + '<div class="row2" style="margin-top:14px"><div class="field"><input type="text" id="wnew" placeholder="New gallery name, e.g. Autumn Wedding"></div>'
    + '<div><button class="btn" id="wadd">+ Add gallery</button></div></div>';
  $("wbody").innerHTML = h;
  Array.prototype.forEach.call(document.querySelectorAll(".wg"), function(el){
    el.onclick = function(){ W.gid = Number(el.dataset.id); render(); };
  });
  sortable($("wlist"), ".wg", function(ids){ send("/galleries/order", "PUT", { ids: ids }).then(function(r){ if (r) changed(); }); });
  $("wadd").onclick = function(){
    var t = $("wnew").value.trim(); if (!t) return;
    send("/galleries", "POST", { title: t }).then(function(r){ if (r){ W.gid = r.gallery.id; changed("Gallery added"); } });
  };
}
function galleryScreen(g){
  if (!g){ W.gid = null; return galleriesScreen(); }
  var dz = dropZone("wdz", g.id, "Drop photos here, or click to choose", null, true);
  var h = '<p><a href="#" id="wbackg">← All galleries</a></p>'
    + '<div class="row2"><div class="field"><label>Name</label><input type="text" id="wtitle" value="'+esc(g.title)+'"></div>'
    + '<div class="field"><label>Web address</label><input type="text" value="/'+esc(g.slug)+'/" disabled>'
    + '<div class="hint">Stays the same when you rename, so links keep working.</div></div></div>'
    + tog("wshow", "Show the name on the gallery page", "Off hides the heading above the photos.", g.showTitle)
    + tog("whide", "Hide this gallery", "Hidden galleries are left off the website, photos kept.", g.hidden)
    + '<div style="margin:14px 0"><button class="btn" id="wsaveg">Save</button> <button class="btn ghost" id="wdelg">Delete gallery</button></div>'
    + dz.html
    + '<div class="wgrid" id="wgrid">' + g.photos.map(function(p){
        var badge = p.id === g.coverPhotoId ? '<span class="bd cv">Cover</span>'
                  : p.immichStatus === "pending" ? '<span class="bd">Not in Immich yet</span>'
                  : p.immichStatus === "failed" ? '<span class="bd">Immich failed</span>' : "";
        return '<div class="wp" data-id="'+p.id+'"><img src="'+thumb(p)+'" alt="" loading="lazy">'+badge
          + '<button class="mn" title="Options">⋮</button></div>';
      }).join("") + '</div>';
  $("wbody").innerHTML = h;
  dz.wire();
  $("wbackg").onclick = function(e){ e.preventDefault(); W.gid = null; render(); };
  $("wsaveg").onclick = function(){
    send("/galleries/" + g.id, "PATCH", { title: $("wtitle").value, showTitle: $("wshow").checked, hidden: $("whide").checked })
      .then(function(r){ if (r) changed("Saved"); });
  };
  $("wdelg").onclick = function(){
    if (!confirm("Delete “" + g.title + "” from the website? The originals stay in Immich.")) return;
    send("/galleries/" + g.id, "DELETE").then(function(r){ if (r){ W.gid = null; changed("Gallery deleted"); } });
  };
  sortable($("wgrid"), ".wp", function(ids){ send("/galleries/" + g.id + "/photos/order", "PUT", { ids: ids }).then(function(r){ if (r) changed(); }); });
  Array.prototype.forEach.call(document.querySelectorAll(".wp .mn"), function(b){
    b.onclick = function(e){
      e.stopPropagation();
      var tile = b.parentNode, id = Number(tile.dataset.id), p = photoById(id);
      var old = document.querySelector(".wp .menu"); if (old){ old.remove(); if (old.parentNode === tile) return; }
      var m = document.createElement("div"); m.className = "menu";
      m.innerHTML = '<button data-a="cover">Set as cover</button>'
        + (p.immichStatus !== "ok" ? '<button data-a="retry">Retry Immich</button>' : "")
        + '<button data-a="remove">Remove from website</button>';
      tile.appendChild(m);
      m.onclick = function(ev){
        var a = ev.target.dataset.a; m.remove();
        if (a === "cover") send("/galleries/" + g.id, "PATCH", { coverPhotoId: id }).then(function(r){ if (r) changed("Cover set"); });
        if (a === "retry") api("/site/photos/" + id + "/retry", { method:"POST" }).then(function(r){ toast(r.ok ? "Saved to Immich" : (r.body && r.body.error) || "Still failing"); changed(); });
        if (a === "remove") send("/photos/" + id, "DELETE").then(function(r){ if (r) changed("Removed from the website"); });
      };
    };
  });
}

/* ---------- pages ---------- */
function photoPicker(id, label, current, onSet){
  var p = photoById(current);
  var dz = dropZone(id, "pages", p ? "Replace photo" : "Choose a photo", function(ph){ return onSet(ph.id); }, false);
  return { html: '<div class="field"><label>'+esc(label)+'</label>'
                 + (p ? '<img class="wthumb" src="'+thumb(p)+'" alt="">' : "") + dz.html + '</div>', wire: dz.wire };
}
function pagesScreen(){
  var s = W.state.settings;
  /* the same save carries everything typed so far, so choosing a photo never wipes unsaved text */
  function typed(){
    return {
      siteName: $("wsn").value,
      about: { heading: $("wah").value, text: $("wat").value },
      contact: { heading: $("wch").value, email: $("wce").value, phone: $("wcp").value },
      footer: { copyright: $("wfc").value, instagram: $("wfi").value }
    };
  }
  function setPhoto(key, field){ return function(photoId){
    var patch = $("wsn") ? typed() : {};
    patch[key] = patch[key] || {}; patch[key][field] = photoId;
    return send("/settings", "PUT", patch).then(function(r){ if (r) W.dirtyForm = false; return r; }); }; }
  var ap = photoPicker("wapic", "About photo", s.about.photoId, setPhoto("about", "photoId"));
  var bp = photoPicker("wbpic", "Contact banner photo", s.contact.bannerPhotoId, setPhoto("contact", "bannerPhotoId"));
  $("wbody").innerHTML = '<h3 class="sec">Site</h3>'
    + '<div class="field"><label>Site name</label><input type="text" id="wsn" value="'+esc(s.siteName)+'"><div class="hint">Shown in browser tabs, and instead of a logo if you have none.</div></div>'
    + '<h3 class="sec">About</h3>'
    + '<div class="field"><label>Heading</label><input type="text" id="wah" value="'+esc(s.about.heading)+'"></div>'
    + '<div class="field"><label>Text</label><textarea id="wat" rows="7">'+esc(s.about.text)+'</textarea><div class="hint">Leave an empty line between paragraphs.</div></div>'
    + ap.html
    + '<h3 class="sec">Contact</h3>'
    + '<div class="field"><label>Heading</label><input type="text" id="wch" value="'+esc(s.contact.heading)+'"></div>'
    + '<div class="row2"><div class="field"><label>Email</label><input type="email" id="wce" value="'+esc(s.contact.email)+'"></div>'
    + '<div class="field"><label>Phone</label><input type="text" id="wcp" value="'+esc(s.contact.phone)+'"></div></div>'
    + bp.html
    + '<h3 class="sec">Footer</h3>'
    + '<div class="row2"><div class="field"><label>Copyright line</label><input type="text" id="wfc" value="'+esc(s.footer.copyright)+'"></div>'
    + '<div class="field"><label>Instagram link</label><input type="url" id="wfi" value="'+esc(s.footer.instagram)+'" placeholder="https://www.instagram.com/…"></div></div>'
    + '<button class="btn" id="wsavep">Save changes</button>';
  ap.wire(); bp.wire();
  $("wsavep").onclick = function(){
    send("/settings", "PUT", typed()).then(function(r){ if (r) changed("Saved"); });
  };
}

/* ---------- style ---------- */
function fontSample(name){
  var id = "wf-" + name.replace(/\s+/g, "-");
  if (!document.getElementById(id)){
    var l = document.createElement("link"); l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(name).replace(/%20/g, "+") + ":wght@400;500&display=swap";
    document.head.appendChild(l);
  }
}
function styleScreen(){
  var st = W.state.settings.style;
  W.fonts.forEach(fontSample);
  function color(id, label, v){ return '<div class="field"><label>'+label+'</label><div class="wcol"><input type="color" id="'+id+'" value="'+esc(v)+'"><input type="text" id="'+id+'t" value="'+esc(v)+'" style="max-width:110px"></div></div>'; }
  function select(id, label, v, opts, hint){
    return '<div class="field"><label>'+label+'</label><select id="'+id+'">' + opts.map(function(o){
      return '<option value="'+esc(o[0])+'"'+(String(o[0])===String(v)?" selected":"")+'>'+esc(o[1])+'</option>'; }).join("")
      + '</select>' + (hint ? '<div class="hint">'+hint+'</div>' : '') + '</div>';
  }
  var fonts = W.fonts.map(function(f){ return [f, f]; });
  $("wbody").innerHTML = '<h3 class="sec">Colours</h3><div class="row2">'
    + color("wsp", "Page background", st.page) + color("wsb", "Header and footer", st.band) + '</div><div class="row2">'
    + color("wst", "Body text", st.text) + color("wsi", "Headings and menu", st.ink) + '</div>'
    + '<h3 class="sec">Text</h3><div class="row2">'
    + select("wshf", "Heading font", st.headingFont, fonts) + select("wsbf", "Body font", st.bodyFont, fonts) + '</div>'
    + '<div class="wsample" id="wsample">Portraits · Hi! This is how your text will look.</div>'
    + select("wsts", "Text size", st.textSize, [["smaller","Smaller"],["normal","Normal"],["larger","Larger"]])
    + '<h3 class="sec">Logo</h3><div class="field">'
    + (st.logo ? '<img class="wthumb" style="object-fit:contain;background:'+esc(st.band)+'" src="/api/admin/site/img/'+esc(st.logo)+'?v='+W.rev+'" alt="">' : '<p class="hint">No logo — the site name is shown instead.</p>')
    + '<input type="file" id="wlogo" accept=".png,.svg,image/png,image/svg+xml"> '
    + (st.logo ? '<button class="btn sm ghost" id="wlogox">Remove logo</button>' : '') + '</div>'
    + '<h3 class="sec">Layout</h3><div class="row2">'
    + select("wscd", "Gallery columns on computers", st.colsDesktop, [[2,"2"],[3,"3"],[4,"4"],[5,"5"]])
    + select("wscp", "Gallery columns on phones", st.colsPhone, [[1,"1"],[2,"2"]]) + '</div><div class="row2">'
    + select("wsg", "Space between photos", st.gap, [["none","None"],["tight","Tight"],["normal","Normal"],["roomy","Roomy"]])
    + select("wsc", "Home page cards", st.cardShape, [["tall","Tall"],["square","Square"],["wide","Wide"]]) + '</div>'
    + '<button class="btn" id="wsaves">Save style</button> <button class="btn ghost" id="wsreset">Reset to current look</button>';
  ["wsp","wsb","wst","wsi"].forEach(function(id){
    $(id).oninput = function(){ $(id + "t").value = $(id).value; };
    $(id + "t").oninput = function(){ if (/^#[0-9a-f]{6}$/i.test($(id + "t").value)) $(id).value = $(id + "t").value; };
  });
  function sample(){ var s = $("wsample"); s.style.fontFamily = "'" + $("wsbf").value + "'"; s.firstChild.textContent = "Portraits · Hi! This is how your text will look."; }
  $("wshf").onchange = sample; $("wsbf").onchange = sample; sample();
  function values(){
    return { page:$("wspt").value, band:$("wsbt").value, text:$("wstt").value, ink:$("wsit").value,
      headingFont:$("wshf").value, bodyFont:$("wsbf").value, textSize:$("wsts").value,
      colsDesktop:Number($("wscd").value), colsPhone:Number($("wscp").value), gap:$("wsg").value, cardShape:$("wsc").value };
  }
  $("wsaves").onclick = function(){ send("/settings", "PUT", { style: values() }).then(function(r){ if (r) changed("Style saved"); }); };
  $("wsreset").onclick = function(){
    if (!confirm("Go back to the original colours, fonts and layout? Your logo stays.")) return;
    var d = {}; for (var k in W.defaults) if (k !== "logo") d[k] = W.defaults[k];
    send("/settings", "PUT", { style: d }).then(function(r){ if (r) changed("Style reset"); });
  };
  $("wlogo").onchange = function(){
    var f = $("wlogo").files[0]; if (!f) return;
    fetch("/api/admin/site/logo?name=" + encodeURIComponent(f.name), { method:"POST", credentials:"same-origin", body:f })
      .then(function(r){ return r.json().then(function(j){ toast(r.ok ? "Logo updated" : (j.error || "Logo upload failed")); changed(); }); });
  };
  if ($("wlogox")) $("wlogox").onclick = function(){ send("/logo", "DELETE").then(function(r){ if (r) changed("Logo removed"); }); };
}

/* one entry in the heading's section menu; leaving stops background repaints */
K.addSection("website", "Website", function(){ websiteView("galleries"); }, function(){ W.active = false; });
})();
