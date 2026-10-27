/* Site-wide editing in the page editor: the header and footer (their style and their elements), the theme and the
   wording. Everything here changes B.sw, the site-wide half of the editor's draft, through the editor's own commit(),
   so it previews, autosaves, undoes and publishes with the pages. Forms are built from the descriptions the server
   sends (site/bands.mjs, site/theme.mjs, site/wording.mjs), so they offer only what it accepts. The logo is the one
   exception: it is a file, uploaded and removed at once through the existing logo routes.
   Loaded by admin.html after builder-admin.js, whose internals it uses through window.SiteBuilder.kit; the editor
   calls back through window.SiteWide. Text from the server is always escaped or set as text. */
(function(){
var S = window.SiteBuilder; if (!S || !S.kit) return;
var X = S.kit, B = X.B, K = window.AdminKit, $ = K.$, esc = K.esc, api = K.api, toast = K.toast;
var AREAS = [["header", "Header", "layout-grid"], ["footer", "Footer", "layout-grid"], ["theme", "Theme", "palette"], ["wording", "Wording", "type"]];
var TABS = [["content", "Content"], ["motion", "Motion"]];
var shownBefore = {};   /* element id -> its "visible" setting before it was hidden, for this editor session */
var logoV = 0;          /* bumped after a logo upload, so the thumbnail is fetched again */

/* ---------- helpers ---------- */
function isBand(){ return B.area === "header" || B.area === "footer"; }
function band(){ return isBand() ? B.sw[B.area] : null; }
function elType(t){ return B.info.elements.filter(function(x){ return x.type === t; })[0] || { type: t, label: String(t), icon: "type", hint: "", fields: [], defaults: {} }; }
function findEl(id){
  var b = band(); if (!b || !id) return null;
  for (var i = 0; i < b.elements.length; i++) if (b.elements[i].id === id) return { list: b.elements, i: i, el: b.elements[i] };
  return null;
}
function has(id){ return !!findEl(id); }
function pageById(id){ return B.pages.filter(function(p){ return p.id === id; })[0]; }
/* every control changes the draft through commit(); typing merges into one undo step */
function setter(target, tag){
  return function(key, v, merge){ X.commit(function(){ var o = target(); if (o) o[key] = v; }, merge ? tag + key : null); };
}
function elSetter(id, part){ return setter(function(){ var f = findEl(id); return f ? (part ? f.el[part] : f.el) : null; }, "site:" + id + ":" + (part || "") + ":"); }
/* a form whose fields may start headed groups (f.group) */
function grouped(fields, values, onSet){
  var box = document.createElement("div"), run = [];
  function flush(){ if (run.length) box.appendChild(X.buildForm(run, values, onSet)); run = []; }
  (fields || []).forEach(function(f){
    if (f.group){ flush(); var h = document.createElement("div"); h.className = "dzh3"; h.textContent = f.group; box.appendChild(h); }
    run.push(f);
  });
  flush();
  return box;
}
function snippet(e){
  var p = e.props || {};
  if (e.type === "menu") return Array.isArray(p.items) ? p.items.length + " items" : "automatic";
  return String(p.text || p.label || p.url || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/* ---------- the rail: Header, Footer, Theme, Wording beside the pages ---------- */
function rail(host){
  host.innerHTML = '<div class="wbh"><span>Whole site</span></div><div role="list">' + AREAS.map(function(a){
    return '<div class="wbpg' + (B.area === a[0] ? " on" : "") + '" role="listitem" tabindex="0" data-area="' + a[0] + '">'
      + K.lucide(a[2], 16) + '<span class="nm">' + esc(a[1]) + '</span></div>';
  }).join("") + '</div>';
  Array.prototype.forEach.call(host.querySelectorAll("[data-area]"), function(r){
    r.onclick = function(){ X.selectArea(r.dataset.area, null); };
    r.onkeydown = function(ev){ if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); X.selectArea(r.dataset.area, null); } };
  });
}

/* ---------- the outline: the open band's elements ---------- */
function outline(host){
  var b = band();
  if (!b){ host.innerHTML = ""; return; }
  host.innerHTML = '<div class="wbh"><span>In the ' + esc(B.area) + '</span><button type="button" id="wbAddEl">+ Element</button></div>'
    + '<div class="wblist" data-list="band">' + b.elements.map(function(e){
      var t = elType(e.type), off = e.visible === "none";
      return '<div class="wbit" data-id="' + esc(e.id) + '"><div class="wbbl' + (B.sel === e.id ? " on" : "") + (off ? " off" : "") + '" data-sel="' + esc(e.id) + '">'
        + '<span class="hd" title="Drag to reorder">☰</span>' + K.lucide(t.icon, 16)
        + '<span class="nm">' + esc(t.label) + (off ? ' (hidden)' : '') + ' <small>' + esc(snippet(e)) + '</small></span>'
        + '<span class="acts"><button type="button" data-act="dup" title="Duplicate" aria-label="Duplicate">⧉</button>'
        + '<button type="button" data-act="hide" title="' + (off ? "Show" : "Hide") + '" aria-label="' + (off ? "Show" : "Hide") + '" aria-pressed="' + (off ? "true" : "false") + '">' + (off ? "◌" : "◉") + '</button>'
        + '<button type="button" data-act="del" title="Delete" aria-label="Delete">✕</button></span></div></div>';
    }).join("") + '</div>'
    + (b.elements.length ? "" : '<p class="hint" style="padding:0 16px">Nothing here yet. Press + Element.</p>');
  $("wbAddEl").onclick = picker;
  Array.prototype.forEach.call(host.querySelectorAll("[data-sel]"), function(row){
    row.onclick = function(ev){
      var a = ev.target.closest("[data-act]"), id = row.dataset.sel;
      if (!a) return X.selectArea(B.area, id);
      ev.stopPropagation();
      if (a.dataset.act === "dup") duplicate(id);
      if (a.dataset.act === "hide") toggleHidden(id);
      if (a.dataset.act === "del") remove(id);
    };
  });
  X.sortable(host.querySelector(".wblist"), ".wbit", function(ids){
    X.commit(function(){
      var b = band(); if (!b) return;
      var by = {}; b.elements.forEach(function(e){ by[e.id] = e; });
      b.elements = ids.map(function(id){ return by[id]; }).filter(Boolean);
    });
  });
}

/* the add-element picker; a new element goes after the selected one, else at the end */
function picker(){
  var box = document.createElement("div"); box.className = "wbpick";
  box.innerHTML = '<div class="wbpickin" role="dialog" aria-modal="true" aria-labelledby="wbElT"><div style="display:flex;justify-content:space-between;align-items:center"><h2 id="wbElT">Add to the ' + esc(B.area) + '</h2><button class="btn sm ghost" type="button" data-x>Close</button></div>'
    + '<div class="wbtypes">' + B.info.elements.map(function(t){
        return '<button type="button" class="wbtype" data-t="' + esc(t.type) + '">' + K.lucide(t.icon, 20) + '<span>' + esc(t.label) + '</span></button>'; }).join("") + '</div></div>';
  document.body.appendChild(box);
  function onEsc(ev){ if (ev.key === "Escape") done(); }
  function done(){ box.remove(); document.removeEventListener("keydown", onEsc); }
  document.addEventListener("keydown", onEsc);
  box.onclick = function(ev){
    if (ev.target === box || ev.target.closest("[data-x]")) return done();
    var b = ev.target.closest("[data-t]"); if (!b) return;
    done(); add(b.dataset.t);
  };
  var first = box.querySelector(".wbtype"); if (first) first.focus();
}
function add(type){
  var t = elType(type);
  var e = { id: X.rid("e"), type: type, props: X.clone(t.defaults), motion: X.clone(B.info.elementMotionDefaults), visible: "all" };
  X.commit(function(){ var b = band(), f = findEl(B.sel), at = f ? f.i + 1 : b.elements.length; b.elements.splice(at, 0, e); });
  X.selectArea(B.area, e.id);
}
function duplicate(id){
  var c;
  X.commit(function(){ var f = findEl(id); if (!f) return; c = X.clone(f.el); c.id = X.rid("e"); f.list.splice(f.i + 1, 0, c); });
  if (c) X.selectArea(B.area, c.id);
}
function toggleHidden(id){
  X.commit(function(){
    var f = findEl(id); if (!f) return;
    if (f.el.visible === "none") f.el.visible = shownBefore[id] || "all";
    else { shownBefore[id] = f.el.visible; f.el.visible = "none"; }
  });
  X.paintPanel();
}
function remove(id){
  X.commit(function(){ var f = findEl(id); if (f) f.list.splice(f.i, 1); });
  X.selectArea(B.area, null);
}

/* ---------- the right panel ---------- */
function panel(){
  if (B.area === "theme") return themePanel();
  if (B.area === "wording") return wordingPanel();
  var f = findEl(B.sel);
  if (!f){ B.sel = null; return bandPanel(); }
  elementPanel(f);
}
function bandPanel(){
  var hdr = B.area === "header";
  $("wbTitle").textContent = hdr ? "Header" : "Footer"; $("wbTabs").innerHTML = "";
  var host = $("wbBody"); host.innerHTML = "";
  if (hdr){
    var nm = X.el('<div class="field"><label>Site name</label><input type="text" id="wbSwName" maxlength="80"><div class="hint">Shown in browser tabs and search results, and instead of a logo if you have none.</div></div>');
    var i = nm.querySelector("input"); i.value = B.sw.name || "";
    i.oninput = function(){ var v = i.value; X.commit(function(){ B.sw.name = v; }, "swname"); };
    host.appendChild(nm);
  }
  host.appendChild(X.buildForm(hdr ? B.info.headerStyle : B.info.footerStyle, band().style, setter(function(){ var b = band(); return b && b.style; }, "site:" + B.area + "style:")));
  host.appendChild(X.el('<p class="hint">Click an element in the preview or in the list to change it. + Element adds one.</p>'));
}
function elementPanel(f){
  var e = f.el, t = elType(e.type);
  if (B.tab !== "motion") B.tab = "content";
  $("wbTitle").textContent = t.label;
  $("wbTabs").innerHTML = TABS.map(function(x){ return '<button type="button" data-tab="' + x[0] + '" class="' + (B.tab === x[0] ? "on" : "") + '">' + x[1] + '</button>'; }).join("");
  Array.prototype.forEach.call($("wbTabs").querySelectorAll("button"), function(x){ x.onclick = function(){ B.tab = x.dataset.tab; X.paintPanel(); }; });
  var off = e.visible === "none", host = $("wbBody");
  host.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 16px"><button class="btn sm ghost" type="button" id="wbEBack">← ' + (B.area === "header" ? "Header" : "Footer") + '</button>'
    + '<button class="btn sm ghost" type="button" id="wbEDup">Duplicate</button>'
    + '<button class="btn sm ghost" type="button" id="wbEHide">' + (off ? "Show" : "Hide") + '</button>'
    + '<button class="btn sm ghost" type="button" id="wbEDel">Delete</button></div>'
    + (t.hint ? '<p class="hint">' + esc(t.hint) + '</p>' : "");
  if (B.tab === "motion") host.appendChild(X.buildForm(B.info.elementMotion, e.motion, elSetter(e.id, "motion")));
  else {
    host.appendChild(X.buildForm(t.fields, e.props, elSetter(e.id, "props"), menuControl));
    host.appendChild(X.buildForm([B.info.elementVisible], e, elSetter(e.id, null)));
  }
  $("wbEBack").onclick = function(){ X.selectArea(B.area, null); };
  $("wbEDup").onclick = function(){ duplicate(e.id); };
  $("wbEHide").onclick = function(){ toggleHidden(e.id); };
  $("wbEDel").onclick = function(){ remove(e.id); };
}

/* the menu's items: automatic (the pages marked for the menu, in page order), or the owner's own list of pages and links */
function menuControl(f, v, set){
  if (f.kind !== "menu") return null;
  var id = B.sel;
  function items(){ var x = findEl(id); return x && Array.isArray(x.el.props.items) ? x.el.props.items : []; }
  function change(fn, merge){ set(fn(items().map(function(it){ return X.clone(it); })), merge, !merge); }
  var box = X.el('<div class="wbmenu"><label ' + X.LBL + '><input type="checkbox" data-auto' + (Array.isArray(v) ? "" : " checked") + '> Automatic</label></div>');
  box.querySelector("[data-auto]").onchange = function(){
    set(this.checked ? null : B.pages.filter(function(p){ return p.inMenu; }).map(function(p){ return { id: X.rid("m"), kind: "page", pageId: p.id }; }), false, true);
  };
  if (!Array.isArray(v)) return box;
  var list = X.el('<div class="wblist" style="margin-top:8px"></div>');
  v.forEach(function(it){
    var row = X.el('<div class="wbit" data-id="' + esc(it.id) + '" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"></div>');
    if (it.kind === "page"){
      var p = pageById(it.pageId);
      row.innerHTML = '<span class="hd" title="Drag to reorder">☰</span><span class="nm" style="flex:1">' + esc(p ? p.title : "A deleted page")
        + (p && !p.inMenu ? ' <small>(not shown: “Show in the menu” is off)</small>' : '') + '</span>';
    } else {
      row.innerHTML = '<span class="hd" title="Drag to reorder">☰</span><input type="text" data-l maxlength="60" placeholder="Words" style="flex:1"><input type="text" data-u maxlength="300" placeholder="/page/ or https://…" style="flex:1.4">';
      row.querySelector("[data-l]").value = it.label || "";
      row.querySelector("[data-u]").value = it.url || "";
      row.querySelector("[data-l]").oninput = function(){ var t = this.value; change(function(a){ a.forEach(function(x){ if (x.id === it.id) x.label = t; }); return a; }, true); };
      row.querySelector("[data-u]").oninput = function(){ var t = this.value; change(function(a){ a.forEach(function(x){ if (x.id === it.id) x.url = t; }); return a; }, true); };
    }
    var rm = X.el('<button type="button" class="btn sm ghost" aria-label="Remove from the menu">✕</button>');
    rm.onclick = function(){ change(function(a){ return a.filter(function(x){ return x.id !== it.id; }); }); };
    row.appendChild(rm);
    list.appendChild(row);
  });
  box.appendChild(list);
  X.sortable(list, ".wbit", function(ids){ change(function(a){ var by = {}; a.forEach(function(x){ by[x.id] = x; }); return ids.map(function(i){ return by[i]; }).filter(Boolean); }); });
  var more = X.el('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><select data-p aria-label="Add a page"><option value="">+ Page…</option></select><button type="button" class="btn sm ghost" data-link>+ Link</button></div>');
  var sel = more.querySelector("[data-p]");
  B.pages.forEach(function(p){
    if (v.some(function(x){ return x.kind === "page" && x.pageId === p.id; })) return;
    var o = document.createElement("option"); o.value = p.id; o.textContent = p.title; sel.appendChild(o);
  });
  sel.onchange = function(){ var pid = sel.value; if (pid) change(function(a){ return a.concat([{ id: X.rid("m"), kind: "page", pageId: pid }]); }); };
  more.querySelector("[data-link]").onclick = function(){ change(function(a){ return a.concat([{ id: X.rid("m"), kind: "link", label: "Link", url: "" }]); }); };
  box.appendChild(more);
  return box;
}

function themePanel(){
  $("wbTitle").textContent = "Theme"; $("wbTabs").innerHTML = "";
  var host = $("wbBody"); host.innerHTML = "";
  host.appendChild(grouped(B.info.theme, B.sw.theme, setter(function(){ return B.sw.theme; }, "site:theme:")));
  host.appendChild(logoBox());
}
/* the logo is a file, not part of the draft: it changes at once (and reaches the public site with the next publish) */
function logoBox(){
  var logo = B.site.settings.style.logo;
  var box = X.el('<div><div class="dzh3">Logo</div>'
    + (logo ? '<img class="wthumb" style="object-fit:contain;background:' + esc(B.sw.theme.band) + '" alt="" src="/api/admin/site/img/' + esc(logo) + '?v=' + logoV + '">'
            : '<p class="hint">No logo: the site name is shown instead.</p>')
    + '<input type="file" id="wbLogo" accept=".png,.svg,image/png,image/svg+xml"> '
    + (logo ? '<button class="btn sm ghost" type="button" id="wbLogoX">Remove logo</button>' : '')
    + '<div class="hint">A PNG, or a plain SVG, under 2 MB. Undo does not bring back an earlier logo.</div></div>');
  box.querySelector("#wbLogo").onchange = function(){
    var f = this.files[0]; if (!f) return;
    fetch("/api/admin/site/logo?name=" + encodeURIComponent(f.name), { method: "POST", credentials: "same-origin", body: f })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "Logo upload failed"); return j; }); })
      .then(logoDone, function(e){ toast(e.message); });
  };
  var x = box.querySelector("#wbLogoX");
  if (x) x.onclick = function(){
    api("/site/logo", { method: "DELETE" }).then(function(r){ if (!r.ok) return toast((r.body && r.body.error) || "Couldn’t remove the logo"); logoDone(r.body); },
      function(){ toast("Couldn’t remove the logo — check your connection"); });
  };
  return box;
}
function logoDone(j){
  B.site.settings.style.logo = j.logo || null; if (j.rev) B.rev = j.rev; B.dirty = true; logoV++;
  toast(j.logo ? "Logo updated" : "Logo removed");
  X.paintPub(); X.paintPanel(); X.render(0);
}
function wordingPanel(){
  $("wbTitle").textContent = "Wording"; $("wbTabs").innerHTML = "";
  var host = $("wbBody");
  host.innerHTML = '<p class="hint">The words the site writes by itself. The preview shows the “not found” page while this is open. '
    + 'An emptied one goes back to the original. The line under each gallery card is set on the Gallery cards block.</p>';
  host.appendChild(grouped(B.info.wording, B.sw.wording, setter(function(){ return B.sw.wording; }, "site:wording:")));
}

window.SiteWide = { rail: rail, outline: outline, panel: panel, has: has };
})();
