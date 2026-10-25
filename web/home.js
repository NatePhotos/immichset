/* Home section: the first screen after signing in. What happened this week, what needs doing,
   whether everything is working, and the newest galleries. One request: GET /api/admin/overview. */
(function(){
var K = window.AdminKit, $ = K.$, api = K.api, esc = K.esc, toast = K.toast, chrome = K.chrome;
/* active: Home is the open section; seq: only the newest request may paint */
var H = { active:false, seq:0, data:null, allAttention:false, healthOpen:false };

function svg(d, size){
  var n = size || 20;
  return '<svg viewBox="0 0 24 24" width="'+n+'" height="'+n+'" fill="none" stroke="currentColor" stroke-width="1.8" '
       + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}
var IC = {
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  alert: svg('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/>'),
  cross: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  plus:  svg('<path d="M12 5v14M5 12h14"/>'),
  chev:  svg('<path d="M9 6l6 6-6 6"/>', 16)
};

/* ---------- small formatting ---------- */
function greeting(){
  var h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function today(){ return new Date().toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric" }); }
/* created_at values are SQLite UTC 'YYYY-MM-DD HH:MM:SS' */
function when(s){
  var d = new Date(String(s || "").replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
  if (isNaN(d)) return "";
  var m = Math.floor((Date.now() - d) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return m + "m ago";
  if (m < 1440) return Math.floor(m / 60) + "h ago";
  if (m < 2880) return "Yesterday";
  return d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
}
function daysLeft(iso){
  var t = Date.parse(iso || "");
  return isNaN(t) ? null : Math.max(0, Math.ceil((t - Date.now()) / 86400000));
}
var DOING = { register:"registered", favourite:"added a favourite", download:"downloaded a photo", download_all:"downloaded all photos" };

/* ---------- navigation out of Home ---------- */
function toGallery(id, tab, pane){ K.openGallery(Number(id), tab, pane); }

/* ---------- data ---------- */
function refresh(){
  var my = ++H.seq;
  return api("/overview").then(function(r){
    if (!H.active || my !== H.seq) return;   /* left Home, or a newer refresh is on its way */
    if (!r.ok || !r.body){
      $("root").innerHTML = '<div class="wrap"><p class="empty">'+esc((r.body && r.body.error) || "Could not load the overview")+'</p></div>';
      return;
    }
    H.data = r.body;
    render();
  }, function(){
    if (H.active && my === H.seq) toast("Could not load the overview");
  });
}

function open(){
  H.active = true; H.allAttention = false; H.healthOpen = false;
  hchrome();
  $("root").innerHTML = '<div class="wrap"><div class="spin"></div></div>';
  refresh();
}
function leave(){ H.active = false; H.seq++; }

function hchrome(){
  chrome({ title: greeting(), summary: today(), section:"home", actions: [
    { label:"Website", onClick:function(){ K.goSection("website"); } },
    { label:"New gallery", primary:true, id:"hNew", icon:IC.plus, onClick:function(){ K.openNewGallery(); } }
  ] });
}

/* ---------- pieces ---------- */
function statsHtml(s){
  var change = "";
  if (s.viewsPrevWeek > 0){
    var pct = Math.round((s.viewsWeek - s.viewsPrevWeek) / s.viewsPrevWeek * 100);
    change = pct >= 0 ? '<span class="hm-up">+' + pct + '%</span>' : '<span class="hm-down">−' + Math.abs(pct) + '%</span>';
  }
  function tile(label, n, extra){
    return '<div class="hm-stat"><div class="hm-lbl">'+esc(label)+'</div><div class="hm-num">'+esc(n)+(extra || "")+'</div></div>';
  }
  return '<div class="hm-stats">'
    + tile("Live galleries", s.liveGalleries)
    + tile("Views this week", s.viewsWeek, change)
    + tile("Downloads this week", s.downloadsWeek)
    + tile("Sign-ups this week", s.signupsWeek) + '</div>';
}

var KIND = {
  expiring:   { icon:IC.clock, tone:"warn", btn:"Extend" },
  favourites: { icon:IC.heart, tone:"info", btn:"View" },
  website:    { icon:IC.globe, tone:"warn", btn:"Publish" },
  immich:     { icon:IC.alert, tone:"bad",  btn:"Retry" }
};
function attentionHtml(list){
  var n = list.length;
  var h = '<section class="hm-card hm-att'+(H.allAttention ? " all" : "")+'"><div class="hm-head"><h2>Needs attention</h2>'
        + (n ? '<span class="hm-badge">'+n+'</span>' : '') + '</div>';
  if (!n) return h + '<div class="hm-none">'+IC.check+'<span>Nothing needs you right now</span></div></section>';
  h += list.map(function(a, i){
    var k = KIND[a.kind] || { icon:IC.alert, tone:"warn", btn: a.action === "website" ? "Open" : "View" };
    return '<div class="hm-row'+(i >= 3 ? " extra" : "")+'"><span class="hm-ic '+k.tone+'">'+k.icon+'</span>'
      + '<div class="hm-txt"><div class="hm-t">'+esc(a.title)+'</div><div class="hm-d">'+esc(a.detail)+'</div></div>'
      + '<button type="button" class="btn sm ghost" data-att="'+i+'">'+esc(k.btn)+'</button></div>';
  }).join("");
  if (n > 3 && !H.allAttention) h += '<button type="button" class="hm-more" id="hmAll">Show all '+n+'</button>';
  return h + '</section>';
}
function activityHtml(list){
  var h = '<section class="hm-card hm-act"><div class="hm-head"><h2>Recent activity</h2></div>';
  if (!list.length) return h + '<p class="hm-empty">Nothing yet. Registrations, favourites and downloads show up here.</p></section>';
  return h + list.map(function(a){
    return '<div class="hm-arow"><span class="hm-time">'+esc(when(a.at))+'</span>'
      + '<span class="hm-what">'+esc(a.email || "Someone")+' '+esc(DOING[a.type] || a.type)
      + ' <span class="hm-gal">· '+esc(a.galleryTitle)+'</span></span></div>';
  }).join("") + '</section>';
}

/* ok: true = fine, null = not known yet, false = wrong; email not set up is a warning, not a fault */
function tone(item, soft){ return item.ok === true ? "ok" : (item.ok === null || soft) ? "warn" : "bad"; }
function healthHtml(hl){
  var items = [
    { title:"Website", it: hl.site, tone: tone(hl.site) },
    { title:"NAS and Immich", it: hl.nas, tone: tone(hl.nas) },
    { title:"Email", it: hl.email, tone: tone(hl.email, true) }
  ];
  var rank = { ok:0, warn:1, bad:2 }, worst = items[0];
  items.forEach(function(x){ if (rank[x.tone] > rank[worst.tone]) worst = x; });
  var allOk = worst.tone === "ok";
  var sum = '<button type="button" class="hm-hsum" id="hmHealth" aria-expanded="'+H.healthOpen+'" aria-controls="hmHcards">'
    + '<span class="hm-ic '+worst.tone+'">'+(allOk ? IC.check : worst.tone === "bad" ? IC.cross : IC.alert)+'</span>'
    + '<span class="hm-txt"><span class="hm-t">'+(allOk ? "All systems normal" : esc(worst.title))+'</span>'
    + (allOk ? "" : '<span class="hm-d">'+esc(worst.it.detail)+'</span>')+'</span>'
    + '<span class="hm-chev">'+IC.chev+'</span></button>';
  return '<section class="hm-health'+(H.healthOpen ? " open" : "")+'">' + sum + '<div class="hm-hcards" id="hmHcards">'
    + items.map(function(x){
      return '<div class="hm-card hm-hcard"><span class="hm-ic '+x.tone+'">'+(x.tone === "ok" ? IC.check : x.tone === "bad" ? IC.cross : IC.alert)+'</span>'
        + '<div class="hm-txt"><div class="hm-t">'+esc(x.title)+'</div><div class="hm-d">'+esc(x.it.detail)+'</div></div></div>';
    }).join("") + '</div></section>';
}
function statusLine(g){
  if (g.status === "draft") return "Draft";
  if (g.status === "expired") return "Expired";
  var d = g.expiresAt ? daysLeft(g.expiresAt) : null;
  if (d != null && d <= 30) return '<span class="hm-warn">'+(d === 1 ? "1 day left" : d + " days left")+'</span>';
  return "Live · " + esc(g.views) + (g.views === 1 ? " view" : " views");
}
function recentHtml(list){
  var tiles = list.map(function(r){
    /* the panel's own gallery record knows the focal point and the album fallback; the overview row is enough otherwise */
    var full = K.galleryById(r.id);
    var cover = K.coverCss(full || { slug:r.slug, coverFile:r.coverFile, coverAssetId:r.coverAssetId });
    return '<button type="button" class="hm-tile" data-gal="'+esc(r.id)+'"><span class="hm-cov" style="'+esc(cover)+'"></span>'
      + '<span class="hm-tt">'+esc(r.title)+'</span><span class="hm-ts">'+statusLine(r)+'</span></button>';
  }).join("");
  return '<section class="hm-recent"><div class="hm-head"><h2>Recent galleries</h2>'
    + '<button type="button" class="hm-link" id="hmSeeAll">See all ›</button></div>'
    + '<div class="hm-tiles">' + tiles
    + '<button type="button" class="hm-tile hm-newtile" id="hmNewTile"><span class="hm-cov">'+IC.plus+'</span>'
    + '<span class="hm-tt">New gallery</span></button></div></section>';
}

/* ---------- the page ---------- */
function render(){
  if (!H.active || !H.data) return;
  var d = H.data;
  hchrome();   /* the greeting follows the clock */
  $("root").innerHTML = '<div class="wrap"><div class="hm">'
    + statsHtml(d.stats || {}) + attentionHtml(d.attention || []) + activityHtml(d.activity || [])
    + healthHtml(d.health || { site:{ok:null}, nas:{ok:null}, email:{ok:null} }) + recentHtml(d.recent || [])
    + '</div></div>';
  var root = $("root");
  Array.prototype.forEach.call(root.querySelectorAll("[data-att]"), function(b){
    b.onclick = function(){ act((d.attention || [])[Number(b.dataset.att)], b); };
  });
  Array.prototype.forEach.call(root.querySelectorAll("[data-gal]"), function(b){
    b.onclick = function(){ toGallery(b.dataset.gal); };
  });
  if ($("hmAll")) $("hmAll").onclick = function(){ H.allAttention = true; render(); };
  $("hmHealth").onclick = function(){ H.healthOpen = !H.healthOpen; render(); var b = $("hmHealth"); if (b) b.focus(); };
  $("hmSeeAll").onclick = function(){ K.goSection("galleries"); };
  $("hmNewTile").onclick = function(){ K.openNewGallery(); };
}

/* ---------- the buttons on attention rows ---------- */
function busy(b, label){ b.disabled = true; b.textContent = label; }
function act(a, b){
  if (!a) return;
  if (a.kind === "expiring") return toGallery(a.galleryId, "settings", "general");
  if (a.kind === "favourites") return toGallery(a.galleryId, "activity", "picks");
  if (a.kind === "website") return publishSite(b);
  if (a.kind === "immich") return retryImmich(b);
  if (a.action === "gallery" && a.galleryId != null) return toGallery(a.galleryId);
  K.goSection("website");
}
/* the same publish endpoint the Website section's Publish button uses */
function publishSite(b){
  busy(b, "Publishing…");
  api("/site").then(function(r){
    if (!r.ok || !r.body){ toast((r.body && r.body.error) || "Could not load the website"); return refresh(); }
    if (!r.body.canPublish){ toast(r.body.missing || "Publishing isn’t set up on this server"); return refresh(); }
    return api("/site/publish", { method:"POST" }).then(function(p){
      toast(p.ok ? "Published — live in about a minute" : (p.body && p.body.error) || "That didn’t work");
      return refresh();
    });
  });
}
/* the overview only counts the waiting photos, so find them in the website's state; one failure stops the run */
function retryImmich(b){
  busy(b, "Retrying…");
  api("/site").then(function(r){
    if (!r.ok || !r.body || !r.body.state){ if (H.active) K.goSection("website"); return; }
    var st = r.body.state, all = (st.pagePhotos || []).slice();
    (st.galleries || []).forEach(function(g){ all = all.concat(g.photos || []); });
    var ids = all.filter(function(p){ return p.immichStatus === "pending"; }).map(function(p){ return p.id; });
    if (!ids.length){ toast("Nothing is waiting any more"); return refresh(); }
    var done = 0;
    (function next(){
      if (done === ids.length){ toast(ids.length === 1 ? "Saved to Immich" : "All " + ids.length + " saved to Immich"); return refresh(); }
      api("/site/photos/" + ids[done] + "/retry", { method:"POST" }).then(function(p){
        if (!p.ok){ toast((p.body && p.body.error) || "Still failing"); return refresh(); }
        done++; next();
      });
    })();
  });
}

K.addSection("home", "Home", K.icons.home, open, leave, 10);
})();
