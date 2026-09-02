// Spotter app logic. Wrapped in String.raw; never use backticks or "${" inside.
// Reads and simple writes go straight to PostgREST through supabase-js under RLS;
// only ingest, reprocess and the AI helpers go through the edge function.
export const APP = String.raw`
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script>
(function () {
  "use strict";

  var SB_URL = "https://mtzevoxxpsktmrbbuxva.supabase.co";
  var SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10emV2b3h4cHNrdG1yYmJ1eHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMjM5ODgsImV4cCI6MjEwMzc5OTk4OH0._vpNhLJtv2bVGgXXClva9O5cX8Y5eJdTgbgAO81NnmU";
  var API = SB_URL + "/functions/v1/spotter/api/";

  var sb = window.supabase.createClient(SB_URL, SB_ANON, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var CATEGORIES = ["Push", "Pull", "Legs", "Upper Body", "Full Body", "Core",
    "Cardio", "HIIT", "Mobility", "Yoga", "Other"];

  var state = {
    user: null, profile: null, workouts: [], logs: null, plan: null,
    collections: [], colItems: [],
    filter: "All", q: "", view: "library", weekStart: null, unit: "lb"
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.onclick = null;
    t.classList.remove("tappable");
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
      t.classList.remove("tappable");
      t.onclick = null;
    }, 2800);
  }

  function viewIn(node) {
    if (!node) return;
    node.classList.remove("viewin");
    void node.offsetWidth;
    node.classList.add("viewin");
  }

  function esc(s) { return String(s === null || s === undefined ? "" : s); }

  // ---------- edge function calls ----------

  function api(path, opts) {
    opts = opts || {};
    return sb.auth.getSession().then(function (r) {
      var token = r.data.session ? r.data.session.access_token : "";
      opts.headers = Object.assign({
        authorization: "Bearer " + token,
        "content-type": "application/json"
      }, opts.headers || {});
      return fetch(API + path, opts);
    }).then(function (r) {
      return r.json().then(function (body) {
        if (r.status === 401) { toast("Session expired — sign in again."); throw new Error("401"); }
        return body;
      });
    });
  }

  // ---------- auth ----------

  var authMode = "signup";

  function setAuthMode(mode) {
    authMode = mode;
    var isUp = mode === "signup";
    $("authtitle").textContent = isUp ? "Create your account" : "Welcome back";
    $("authgo").textContent = isUp ? "Create account" : "Sign in";
    $("pw").setAttribute("autocomplete", isUp ? "new-password" : "current-password");
    $("authswap").innerHTML = "";
    $("authswap").appendChild(document.createTextNode(
      isUp ? "Already have an account? " : "New here? "));
    var b = el("button", null, isUp ? "Sign in" : "Create an account");
    b.onclick = function () { setAuthMode(isUp ? "signin" : "signup"); };
    $("authswap").appendChild(b);
  }

  function authError(msg) {
    var e = $("autherr");
    if (!msg) { e.classList.remove("show"); return; }
    e.textContent = msg;
    e.classList.add("show");
  }

  function doAuth() {
    var email = $("email").value.trim();
    var pw = $("pw").value;
    authError("");
    if (!email || !pw) { authError("Enter your email and a password."); return; }
    if (authMode === "signup" && pw.length < 8) {
      authError("Use at least 8 characters."); return;
    }
    var btn = $("authgo");
    btn.disabled = true;
    btn.textContent = authMode === "signup" ? "Creating…" : "Signing in…";
    var p = authMode === "signup"
      ? sb.auth.signUp({ email: email, password: pw })
      : sb.auth.signInWithPassword({ email: email, password: pw });
    p.then(function (r) {
      btn.disabled = false;
      setAuthMode(authMode);
      if (r.error) {
        var m = r.error.message || "That did not work.";
        if (/already regist/i.test(m)) m = "That email already has an account — sign in instead.";
        if (/invalid login/i.test(m)) m = "Wrong email or password.";
        authError(m);
        return;
      }
      if (!r.data.session) { authError("Check your email to confirm your account, then sign in."); }
    }).catch(function (e) {
      btn.disabled = false;
      setAuthMode(authMode);
      authError(String(e.message || e));
    });
  }

  function showLanding() {
    document.body.classList.remove("app");
    $("landing").classList.add("open");
    $("app").classList.add("hide");
  }

  function showApp() {
    document.body.classList.add("app");
    $("landing").classList.remove("open");
    $("app").classList.remove("hide");
  }

  sb.auth.onAuthStateChange(function (event, session) {
    if (session && session.user) {
      var first = !state.user;
      state.user = session.user;
      showApp();
      // supabase-js holds the auth lock for the duration of this callback, so any
      // query started here deadlocks. Hand the work to the next tick instead.
      if (first) setTimeout(boot, 0);
    } else {
      state.user = null;
      state.workouts = []; state.logs = null; state.plan = null;
      showLanding();
    }
  });

  function boot() {
    loadProfile();
    maybeInstallHint();
    watchWorkouts();
    return load();
  }

  // ---------- realtime ----------
  //
  // Subscribed to this user's OWN workouts rows, filtered by user_id, on a table
  // whose RLS already restricts to the owner. The alternative — everyone watching
  // one shared card table — makes the server authorize every change against every
  // connected viewer, which is fine at two users and is the thing that falls over
  // at two thousand.
  //
  // This is how an asynchronous save finishes: ingest returns in ~200ms with a row
  // in a pending state, the worker fills that row in, and the UPDATE arrives here.
  var wkChannel = null;

  function watchWorkouts() {
    if (wkChannel || !state.user) return;
    var uid = state.user.id;
    // Not inside onAuthStateChange: supabase-js holds the auth lock through that
    // callback and getSession would deadlock. boot() is already deferred a tick.
    sb.auth.getSession().then(function (r) {
      var tok = r.data.session ? r.data.session.access_token : null;
      function subscribe() {
        wkChannel = sb.channel("wk-" + uid)
          .on("postgres_changes",
            { event: "*", schema: "public", table: "workouts", filter: "user_id=eq." + uid },
            onWorkoutChange)
          .subscribe();
      }
      // The socket has to be carrying this user's token before it joins, or the
      // server authorizes the subscription as anon, RLS matches nothing, and the
      // channel reports SUBSCRIBED while silently delivering no rows for ever.
      // Observed exactly that in testing. setAuth is a promise in current
      // supabase-js and was synchronous in older ones, so handle both.
      var applied = tok && sb.realtime && sb.realtime.setAuth ? sb.realtime.setAuth(tok) : null;
      if (applied && typeof applied.then === "function") applied.then(subscribe, subscribe);
      else subscribe();
    });
  }

  function onWorkoutChange(payload) {
    var row = payload.eventType === "DELETE" ? payload.old : payload.new;
    if (!row || !row.id) return;

    if (payload.eventType === "DELETE") {
      state.workouts = state.workouts.filter(function (w) { return w.id !== row.id; });
      state.colItems = state.colItems.filter(function (it) { return it.workout_id !== row.id; });
      render();
      return;
    }

    var at = -1;
    for (var i = 0; i < state.workouts.length; i++) {
      if (state.workouts[i].id === row.id) { at = i; break; }
    }
    var was = at >= 0 ? state.workouts[at] : null;
    if (at >= 0) state.workouts[at] = row; else state.workouts.unshift(row);

    if (current && current.id === row.id) {
      current = row;
      if ($("detail").classList.contains("open")) openDetail(row, true);
    }
    // Only announce a transition, so a favourite toggle or a note edit is silent.
    if (was && was.ingest_status === "processing" && row.ingest_status === "ready") {
      toast("Ready: " + (row.title || "your workout"));
    } else if (was && was.ingest_status === "processing" && row.ingest_status === "failed") {
      toast("Could not read that video — open it to try again.");
    }
    render();
    watchPending();
  }

  // Realtime is the fast path, not the only path: a dropped socket, a backgrounded
  // tab or a browser that never connected must still resolve a pending card.
  var pendTimer = null, pendPolls = 0;

  function watchPending() {
    clearTimeout(pendTimer);
    var pending = state.workouts.filter(function (w) { return w.ingest_status === "processing"; });
    if (!pending.length) { pendPolls = 0; return; }
    if (pendPolls > 75) return;          // ~5 minutes, by which point the sweeper has ruled
    pendPolls++;
    pendTimer = setTimeout(function () { load(); }, 4000);
  }

  function loadProfile() {
    sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle().then(function (r) {
      if (r.data) {
        state.profile = r.data;
        if (r.data.settings && r.data.settings.unit) state.unit = r.data.settings.unit;
      }
    });
  }

  // ---------- library ----------

  function load(retry) {
    return Promise.all([
      sb.from("workouts").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("collections").select("*").order("sort_order").order("created_at"),
      sb.from("collection_items").select("collection_id,workout_id,added_at")
    ]).then(function (rs) {
      if (rs[0].error) {
        // Right after a redirect sign-in (magic link, password reset) the first
        // read can race supabase-js finishing the session from the URL hash and
        // come back 401. One quiet retry before telling anyone anything.
        if (!retry) {
          return new Promise(function (res) { setTimeout(function () { res(load(true)); }, 900); });
        }
        toast("Could not load your library.");
        return;
      }
      state.workouts = rs[0].data || [];
      // Collections decorate the library; they are not the library. A failed read
      // here keeps whatever was already known rather than blanking the chips.
      if (!rs[1].error) state.collections = rs[1].data || [];
      if (!rs[2].error) state.colItems = rs[2].data || [];
      render();
      watchPending();
    });
  }

  function isPending(w) { return w.ingest_status === "processing"; }
  function isFailed(w) { return w.ingest_status === "failed"; }
  // A video the user uploaded themselves. It has no page to open, no embed and no
  // caption anybody wrote — everything on the card was heard rather than read, so
  // the copy around it says so.
  function isUpload(w) { return w.platform === "upload"; }

  // ---------- collections: lookups ----------

  function isColFilter(f) { return typeof f === "string" && f.indexOf("col:") === 0; }
  function colById(id) {
    for (var i = 0; i < state.collections.length; i++) {
      if (state.collections[i].id === id) return state.collections[i];
    }
    return null;
  }
  function inCol(colId, workoutId) {
    return state.colItems.some(function (it) {
      return it.collection_id === colId && it.workout_id === workoutId;
    });
  }
  function colCount(colId) {
    return state.colItems.filter(function (it) { return it.collection_id === colId; }).length;
  }
  function colsOf(workoutId) {
    return state.colItems
      .filter(function (it) { return it.workout_id === workoutId; })
      .map(function (it) { return colById(it.collection_id); })
      .filter(Boolean);
  }
  function colLabel(c) { return (c.emoji ? c.emoji + " " : "") + c.name; }

  function visible() {
    var q = state.q.toLowerCase().trim();
    return state.workouts.filter(function (w) {
      if (state.filter === "Favorites") { if (!w.favorite) return false; }
      else if (isColFilter(state.filter)) { if (!inCol(state.filter.slice(4), w.id)) return false; }
      else if (state.filter !== "All" && w.category !== state.filter) return false;
      if (!q) return true;
      var hay = [w.title, w.author, w.category, (w.muscle_groups || []).join(" "),
        (w.equipment || []).join(" "), (w.tags || []).join(" "), exerciseNames(w).join(" "),
        colsOf(w.id).map(function (c) { return c.name; }).join(" ")]
        .join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function exerciseNames(w) {
    var out = [];
    (w.blocks || []).forEach(function (b) {
      (b.exercises || []).forEach(function (e) { out.push(e.name); });
    });
    return out;
  }

  var chipSig = null;

  function renderChips() {
    var wrap = $("chips");
    var counts = {}, favs = 0;
    state.workouts.forEach(function (w) {
      counts[w.category] = (counts[w.category] || 0) + 1;
      if (w.favorite) favs++;
    });
    // The collection a chip was filtering on can have been deleted under it.
    if (isColFilter(state.filter) && !colById(state.filter.slice(4))) state.filter = "All";

    var list = [{ key: "All", label: "All", n: state.workouts.length }];
    if (favs) list.push({ key: "Favorites", label: "★ Favorites", n: favs });
    // Collections sit beside Favorites: the same idea, just more of them.
    state.collections.forEach(function (c) {
      list.push({ key: "col:" + c.id, label: colLabel(c), n: colCount(c.id) });
    });
    if (state.workouts.length) list.push({ key: "__newcol", label: "＋ Collection", n: null });
    CATEGORIES.forEach(function (c) { if (counts[c]) list.push({ key: c, label: c, n: counts[c] }); });

    // The chips have carried a 220ms transition on their lit state that never once
    // ran: render() threw every chip away, and a new node cannot transition from a
    // value it never held. Unchanged row, kept buttons.
    var sig = list.map(function (i) { return i.key + "" + i.label + "" + i.n; }).join("");
    var kids = wrap.children;
    if (sig === chipSig && kids.length === list.length) {
      for (var k = 0; k < list.length; k++) {
        kids[k].classList.toggle("active", state.filter === list[k].key);
      }
      return;
    }
    chipSig = sig;
    wrap.innerHTML = "";

    list.forEach(function (item) {
      var b = el("button", "chip" + (state.filter === item.key ? " active" : ""));
      b.appendChild(document.createTextNode(item.label));
      if (item.n !== null) b.appendChild(el("span", "n", String(item.n)));
      b.onclick = function () {
        if (item.key === "__newcol") { openCollections(null); return; }
        state.filter = item.key;
        render();
        viewIn($("grid"));
      };
      wrap.appendChild(b);
    });
  }

  // Rename / delete for the collection currently filtering the library. Shown
  // only then, so the chip row stays a chip row.
  function renderColBar() {
    var bar = $("colbar");
    bar.innerHTML = "";
    var c = isColFilter(state.filter) ? colById(state.filter.slice(4)) : null;
    if (!c || state.view !== "library") { bar.classList.add("hide"); return; }
    bar.classList.remove("hide");
    var n = colCount(c.id);
    bar.appendChild(el("b", null, colLabel(c) + " · " + n + (n === 1 ? " workout" : " workouts")));
    var ren = el("button", null, "Rename");
    ren.onclick = function () { openRename("collection", c.id, c.name); };
    bar.appendChild(ren);
    var del = el("button", "warn", "Delete");
    del.onclick = function () { deleteCollection(c, del); };
    bar.appendChild(del);
  }

  function fmtDur(m) {
    if (!m) return null;
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + "h " + r + "m" : h + "h";
  }

  function cardMeta(w) {
    if (isPending(w)) return isUpload(w) ? "Listening to the video…" : "Reading the video…";
    if (isFailed(w)) return isUpload(w) ? "Could not hear it — tap to see why" : "Could not read it — tap to retry";
    var bits = [];
    var n = exerciseNames(w).length;
    if (n) bits.push(n + (n === 1 ? " exercise" : " exercises"));
    if (w.equipment && w.equipment.length) bits.push(w.equipment[0]);
    else if (w.has_full_workout) bits.push("bodyweight");
    if (!bits.length && w.author) bits.push("@" + w.author);
    return bits.join(" · ");
  }

  // renderGrid runs on every keystroke and render(), and re-flew every card.
  var seenCards = {};
  var newThisPass = 0;

  function cardIn(card, id) {
    if (seenCards[id]) return;
    seenCards[id] = 1;
    card.classList.add("in");
    card.style.animationDelay = Math.min(newThisPass++, 10) * 26 + "ms";
    card.addEventListener("animationend", function () {
      card.classList.remove("in");
      card.style.animationDelay = "";
    });
  }

  function renderGrid() {
    var grid = $("grid"), empty = $("empty");
    var items = visible();
    grid.innerHTML = "";
    newThisPass = 0;

    if (!items.length) {
      grid.classList.add("hide");
      empty.classList.remove("hide");
      empty.innerHTML = "";
      var big = el("div", "big", state.workouts.length ? "🔍" : "🏋️");
      empty.appendChild(big);
      if (!state.workouts.length) {
        empty.appendChild(el("h2", null, "Your gym bag is empty"));
        var p = el("p");
        p.appendChild(document.createTextNode("Tap "));
        var b = el("b", null, "+");
        p.appendChild(b);
        p.appendChild(document.createTextNode(" and paste a link to a workout video. Spotter reads the exercises out of it."));
        empty.appendChild(p);
      } else {
        empty.appendChild(el("h2", null, "Nothing matches"));
        empty.appendChild(el("p", null, "Try a different search or filter."));
      }
      viewIn(empty);
      return;
    }

    empty.classList.add("hide");
    grid.classList.remove("hide");

    items.forEach(function (w, i) {
      var pending = isPending(w), failed = isFailed(w);
      var card = el("button", "carditem" + (pending ? " pending" : "") + (failed ? " failed" : ""));
      cardIn(card, w.id);

      var tw = el("div", "thumbwrap loading");
      if (pending || failed) {
        var up = isUpload(w);
        tw.className = "thumbwrap " + (pending ? "pending" : "failed");
        // A failed upload cannot be retried — the file was deleted the moment
        // Spotter finished listening — so it must not wear the ↻ that says it can.
        tw.appendChild(el("div", "noimg", pending ? (up ? "🎧" : "⏳") : (up ? "🎧" : "↻")));
        card.appendChild(tw);
        var pb = el("div", "cardbody");
        var pk = el("div", "cardkick");
        pk.appendChild(el("div", "catpill",
          pending ? (up ? "Listening" : "Reading") : (up ? "Failed" : "Retry")));
        pb.appendChild(pk);
        pb.appendChild(el("div", "cardtitle",
          w.title || (up ? "Listening to the video…" : "Reading the video…")));
        pb.appendChild(el("div", "cardmeta" + (failed ? " retryline" : ""), cardMeta(w)));
        card.appendChild(pb);
        card.onclick = function () { openDetail(w); };
        grid.appendChild(card);
        return;
      }
      if (w.thumb_url) {
        var img = el("img");
        img.loading = "lazy";
        img.alt = "";
        img.src = w.thumb_url;
        img.onload = function () { tw.classList.remove("loading"); tw.classList.add("loaded"); };
        img.onerror = function () {
          tw.classList.remove("loading");
          tw.appendChild(el("div", "noimg", "🏋️"));
        };
        // Cached: a skeleton for a wait already over is the flicker it prevents.
        if (img.complete && img.naturalWidth) {
          tw.classList.remove("loading");
          tw.classList.add("loaded");
        }
        tw.appendChild(img);
      } else {
        tw.classList.remove("loading");
        if (w.platform === "pumpy") {
          var pi = el("div", "noimg pumpyimg");
          pi.innerHTML = PUMPY_MARK;
          tw.appendChild(pi);
        } else {
          tw.appendChild(el("div", "noimg", "🏋️"));
        }
      }
      if (w.favorite) tw.appendChild(el("div", "fav", "★"));
      var d = fmtDur(w.duration_minutes);
      if (d) tw.appendChild(el("div", "durbadge", d));
      card.appendChild(tw);

      var body = el("div", "cardbody");
      var kick = el("div", "cardkick");
      kick.appendChild(el("div", "catpill", w.category || "Other"));
      if (w.difficulty) kick.appendChild(el("div", "diffpill", w.difficulty.slice(0, 3)));
      body.appendChild(kick);
      body.appendChild(el("div", "cardtitle", w.title || "Untitled workout"));
      var meta = cardMeta(w);
      if (meta) body.appendChild(el("div", "cardmeta", meta));
      card.appendChild(body);

      card.onclick = function () { openDetail(w); };
      grid.appendChild(card);
    });
  }

  function render() {
    renderChips();
    renderColBar();
    renderGrid();
    var n = state.workouts.length;
    $("count").textContent = n ? n + (n === 1 ? " workout" : " workouts") : "No workouts yet";
  }

  // ---------- detail ----------

  var current = null;

  function embedNode(w) {
    var wrap, frame;
    if (w.platform === "instagram") {
      wrap = el("div", "embedwrap vertical");
      frame = el("iframe");
      frame.src = "https://www.instagram.com/" + (w.kind === "p" ? "p" : "reel") + "/" + w.shortcode + "/embed/";
      frame.setAttribute("scrolling", "no");
      frame.setAttribute("allowtransparency", "true");
    } else if (w.platform === "tiktok") {
      wrap = el("div", "embedwrap vertical");
      frame = el("iframe");
      frame.src = "https://www.tiktok.com/embed/v2/" + String(w.shortcode).replace(/^tt-/, "");
      frame.setAttribute("allow", "encrypted-media");
    } else if (w.platform === "youtube") {
      wrap = el("div", "embedwrap wide");
      frame = el("iframe");
      frame.src = "https://www.youtube.com/embed/" + String(w.shortcode).replace(/^yt-/, "");
      frame.setAttribute("allow", "accelerometer; encrypted-media; picture-in-picture; fullscreen");
      frame.setAttribute("allowfullscreen", "");
    } else {
      if (w.thumb_url) {
        var img = el("img", "dphoto");
        img.src = w.thumb_url;
        img.alt = "";
        return img;
      }
      return null;
    }
    wrap.appendChild(frame);
    return wrap;
  }

  function doseText(ex) {
    var bits = [];
    if (ex.sets && ex.reps) bits.push(ex.sets + " × " + ex.reps);
    else if (ex.sets) bits.push(ex.sets + " sets");
    else if (ex.reps) bits.push(ex.reps + " reps");
    if (ex.duration_seconds) {
      bits.push(ex.duration_seconds >= 60
        ? Math.round(ex.duration_seconds / 60) + " min"
        : ex.duration_seconds + "s");
    }
    return bits.join(" · ");
  }

  function blockMetaText(b) {
    var bits = [];
    if (b.type && b.type !== "straight") bits.push(b.type);
    if (b.rounds) bits.push(b.rounds + " rounds");
    if (b.rest_seconds) bits.push(b.rest_seconds + "s rest");
    return bits.join(" · ");
  }

  // keepHistory is set when Realtime re-renders an open card in place: the overlay
  // is already on the history stack and pushing again would need two back gestures.
  function openDetail(w, keepHistory) {
    current = w;
    // Reopened mid-close: cancel it and the teardown behind it.
    clearTimeout(detailCloseTimer);
    $("detail").classList.remove("closing");
    var d = $("dinner");
    d.innerHTML = "";

    var em = embedNode(w);
    if (em) d.appendChild(em);

    d.appendChild(el("div", "dkick", isPending(w) ? "Reading" : (isFailed(w) ? "Needs another try" : (w.category || "Other"))));
    var titleEl = el("h2", "dtitle", w.title || "Untitled workout");
    if (!isPending(w)) {
      titleEl.classList.add("editable");
      titleEl.title = "Tap to rename";
      titleEl.onclick = function () { openRename("workout", w.id, w.title || ""); };
    }
    d.appendChild(titleEl);
    if (w.author) d.appendChild(el("div", "dauthor", "@" + w.author));
    d.appendChild(manageRow(w));
    d.appendChild(colPills(w));

    // A card whose extraction has not landed yet, or one whose job gave up. Both
    // are real rows with a real link — the user keeps what they saved either way.
    if (isPending(w) || isFailed(w)) {
      var isUp = isUpload(w);
      var note = el("div", "sect");
      note.appendChild(el("h3", null, isPending(w)
        ? (isUp ? "Still listening to this one" : "Still reading this one")
        : (isUp ? "Could not hear a workout in this one" : "Could not read this one")));
      note.appendChild(el("div", "capbox", isPending(w)
        ? (isUp
          ? "Spotter is transcribing what the creator says, then pulling the workout out of it. The card fills in here as soon as it lands — you can close this and carry on."
          : "Spotter is pulling the workout out of this video. The card fills in here as soon as it lands — you can close this and carry on.")
        : (w.ingest_error || (isUp
          ? "Spotter could not make out a workout in that file."
          : "Spotter could not get anything back from this link.")) +
          (isUp
            ? " The file itself is already deleted — Spotter keeps uploads only long enough to listen to them."
            : " The link is saved either way, so nothing is lost.")));
      d.appendChild(note);

      if (isFailed(w)) {
        // An upload has nothing to try again: the file is gone by the time this
        // card exists. Offering ↻ would offer a button that can only fail.
        if (!isUp) {
          var rb = el("button", "retrybtn", "Try reading it again");
          rb.onclick = function () { retryWorkout(w, rb); };
          d.appendChild(rb);
        }
        // The last rung, and the only one a platform cannot block: whatever it
        // serves a server, the user can read the caption on their own screen.
        var pb = el("button", "retrybtn" + (isUp ? "" : " ghost"), "Paste the caption instead");
        pb.onclick = function () { openCaption(w); };
        d.appendChild(pb);
      }
      // An upload has no original to open — its only address is inside Spotter,
      // and that address stopped resolving to anything the moment it was read.
      if (!isUp) {
        var open = el("a", "pill accent", "Open original ↗");
        open.href = w.source_url || w.url;
        open.target = "_blank";
        open.rel = "noopener";
        open.style.display = "inline-block";
        open.style.textDecoration = "none";
        open.style.marginBottom = "14px";
        d.appendChild(open);
      }

      $("dfav").textContent = w.favorite ? "★" : "☆";
      $("dfav").classList.toggle("on", !!w.favorite);
      $("detail").classList.add("open");
      if (!keepHistory) { $("detail").scrollTop = 0; history.pushState({ detail: 1 }, ""); }
      return;
    }

    var pills = el("div", "pillrow");
    (w.muscle_groups || []).forEach(function (m) { pills.appendChild(el("span", "pill accent", m)); });
    (w.equipment || []).forEach(function (e) { pills.appendChild(el("span", "pill", e)); });
    if (!(w.equipment || []).length && w.has_full_workout) pills.appendChild(el("span", "pill", "bodyweight"));
    if (pills.children.length) d.appendChild(pills);

    var specs = [];
    var dur = fmtDur(w.duration_minutes);
    if (dur) specs.push([dur, "Duration"]);
    var exN = exerciseNames(w).length;
    if (exN) specs.push([String(exN), "Exercises"]);
    if (w.difficulty) specs.push([w.difficulty, "Level"]);
    if (w.calories) specs.push([String(w.calories), "Est. kcal"]);
    if (specs.length) {
      var strip = el("div", "specstrip");
      specs.forEach(function (s) {
        var c = el("div", "spec");
        c.appendChild(el("div", "v", s[0]));
        c.appendChild(el("div", "k", s[1]));
        strip.appendChild(c);
      });
      d.appendChild(strip);
    }

    // The confidence score, translated into the only thing a user needs from it:
    // whether to check this card against the video before training it. Silent above
    // the threshold, because a caveat on every card is a caveat on none.
    var conf = typeof w.confidence === "number" ? w.confidence : null;
    if (w.has_full_workout && conf !== null && conf < 0.7) {
      var warn = el("div", "unverified");
      warn.appendChild(el("div", null, conf < 0.45 ? "⚠️" : "👀"));
      var wt = el("div");
      wt.appendChild(el("b", null, conf < 0.45
        ? "Spotter could not check most of this."
        : "Some of this is not in the caption."));
      wt.appendChild(document.createTextNode(conf < 0.45
        ? " The exercises below were not traceable to anything written on the post. Watch the original before you train it."
        : " A few sets or reps were not written down anywhere Spotter could find. Worth a glance at the original."));
      // Only on the low band. On the middle one the card is mostly traceable and
      // asking the user to retype a caption would be asking for work worth little.
      if (conf < 0.45) {
        wt.appendChild(document.createTextNode(" "));
        var fix = el("button", "fixlink", "Paste the caption to improve it");
        fix.onclick = function () { openCaption(w); };
        wt.appendChild(fix);
      }
      warn.appendChild(wt);
      d.appendChild(warn);
    }

    var start = el("button", "startbtn", w.has_full_workout ? "Start workout" : "Start & log freestyle");
    start.onclick = function () { startWorkout(w); };
    d.appendChild(start);

    var ask = el("button", "askpumpy");
    ask.appendChild(pumpyMark("pmark"));
    ask.appendChild(document.createTextNode("Ask Pumpy about this workout"));
    ask.onclick = function () { history.back(); openPumpy(w); };
    d.appendChild(ask);

    // What this hits: catalog muscles through canonical_id, nothing else. Filled
    // in once the catalog map is here, which after the first card is immediate.
    if (exN) {
      var hits = el("div", "sect");
      hits.appendChild(el("h3", null, "What this hits"));
      var slot = el("div");
      hits.appendChild(slot);
      hits.appendChild(el("div", null, " "));
      d.appendChild(hits);
      loadCatalog().then(function () {
        if (!current || current.id !== w.id) return;
        var r = cardHits(allExercises(w));
        slot.innerHTML = "";
        slot.appendChild(bodyMap(r.levels, 2, bodyLegend([
          { lv: [2], text: "Primary" },
          { lv: [1], text: "Secondary" },
          { lv: [0], text: "Not targeted" }
        ]), cardCaption(r.names)));
        if (!r.mapped) {
          slot.appendChild(el("div", "bodynote",
            "None of these exercises matched Spotter's catalog yet, so nothing is highlighted."));
        }
        bodyNotes(slot, r, "exercises");
      });
    }

    (w.blocks || []).forEach(function (b, bi) {
      var sect = el("div", "sect");
      sect.appendChild(el("h3", null, "Block " + (bi + 1)));
      if (b.title) sect.appendChild(el("div", "blocktitle", b.title));
      var bm = blockMetaText(b);
      if (bm) sect.appendChild(el("div", "blockmeta", bm));
      (b.exercises || []).forEach(function (ex, ei) {
        var row = el("div", "exrow");
        var name = el("div", "exname");
        name.appendChild(document.createTextNode(ex.name));
        if (ex.notes) name.appendChild(el("div", "exnote", ex.notes));
        // Say which lines are the user's own. Everything else on the card is the
        // creator's wording, and the difference matters when they come back to it.
        if (ex.added_by_user) name.appendChild(el("div", "exmine", "Added by you"));
        else if (ex.edited_by_user) name.appendChild(el("div", "exmine", "Edited by you"));
        // The line of the caption this exercise was read from, as a hover title.
        // Free, and it turns "where did this come from?" into a question the card
        // can answer without a new screen.
        if (ex.evidence && ex.evidence.quote) row.title = "From the source: " + ex.evidence.quote;
        row.appendChild(name);
        var dose = doseText(ex);
        if (dose) row.appendChild(el("div", "exdose", dose));
        var fix = el("button", "exhelp", "✎");
        fix.setAttribute("aria-label", "Fix this exercise");
        fix.onclick = function (e) { e.stopPropagation(); openExEdit(w, bi, ei, ex); };
        row.appendChild(fix);
        var sw = el("button", "exhelp", "⇄");
        sw.setAttribute("aria-label", "Swap or modify this exercise");
        sw.onclick = function (e) { e.stopPropagation(); openSwap(ex.name, w.title); };
        row.appendChild(sw);
        var help = el("button", "exhelp", "?");
        help.setAttribute("aria-label", "How to do this exercise");
        help.onclick = function (e) { e.stopPropagation(); explain(ex.name, w.title); };
        row.appendChild(help);
        sect.appendChild(row);
      });
      var addex = el("button", "addex", "+ Add an exercise Spotter missed");
      addex.onclick = function () { openExAdd(w, bi); };
      sect.appendChild(addex);
      d.appendChild(sect);
    });

    if (!(w.blocks || []).length) {
      var none = el("div", "sect");
      none.appendChild(el("h3", null, "No exercises found"));
      var np = el("div", "capbox",
        "This video did not include a written workout, so there is nothing to step through. " +
        "You can still watch it and log a freestyle session, tap ↻ above to try reading it again, " +
        "or type the exercises in yourself.");
      none.appendChild(np);
      none.appendChild(el("div", null, " "));
      var addfirst = el("button", "addex", "+ Add an exercise");
      addfirst.onclick = function () { openExAdd(w, 0); };
      none.appendChild(addfirst);
      d.appendChild(none);
    }

    var cat = el("div", "selectrow");
    var sel = el("select");
    CATEGORIES.forEach(function (c) {
      var o = el("option", null, c);
      o.value = c;
      if (c === w.category) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      patchWorkout(w, { category: sel.value });
      w.category = sel.value;
      render();
    };
    cat.appendChild(el("span", "pill", "Category"));
    cat.appendChild(sel);
    d.appendChild(cat);

    var notesSect = el("div", "sect");
    notesSect.appendChild(el("h3", null, "Notes"));
    var ta = el("textarea", "notesarea");
    ta.placeholder = "How it felt, weights to try next time…";
    ta.value = w.notes || "";
    var noteTimer = null;
    ta.oninput = function () {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () {
        patchWorkout(w, { notes: ta.value });
        w.notes = ta.value;
      }, 700);
    };
    notesSect.appendChild(ta);
    notesSect.appendChild(el("div", null, " "));
    d.appendChild(notesSect);

    if (w.caption) {
      var capSect = el("div", "sect");
      // Nobody wrote an upload's text — a speech model heard it — so calling it a
      // caption would be claiming a source that does not exist.
      capSect.appendChild(el("h3", null, isUpload(w) ? "What was said in the video" : "Original caption"));
      capSect.appendChild(el("div", "capbox", w.caption));
      capSect.appendChild(el("div", null, " "));
      d.appendChild(capSect);
    }

    if (w.source_url || w.platform === "web") {
      var link = el("a", "pill accent", "Open original ↗");
      link.href = w.source_url || w.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.style.display = "inline-block";
      link.style.textDecoration = "none";
      link.style.marginBottom = "14px";
      d.appendChild(link);
    }

    $("dfav").textContent = w.favorite ? "★" : "☆";
    $("dfav").classList.toggle("on", !!w.favorite);
    $("detail").classList.add("open");
    if (!keepHistory) { $("detail").scrollTop = 0; history.pushState({ detail: 1 }, ""); }
  }

  // The retry affordance for a job that gave up. It goes back through the queue
  // rather than re-running inline, so it gets the same backoff and the same
  // give-up point as the original save.
  function retryWorkout(w, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Queued…"; }
    api("workouts/" + w.id + "/reprocess", { method: "POST", body: "{}" })
      .then(function (r) {
        if (btn) { btn.disabled = false; btn.textContent = "Try reading it again"; }
        if (r.status !== "processing" && r.status !== "ok") {
          toast(r.message || "Could not queue that."); return;
        }
        w.ingest_status = "processing";
        w.ingest_error = null;
        if (current && current.id === w.id) openDetail(w, true);
        render();
        watchPending();
        toast("Reading it again…");
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = "Try reading it again"; }
        toast("Could not queue that.");
      });
  }

  // ---------- pasting the caption ----------
  //
  // The bottom of the ingest ladder. Every automated path can be blocked — an IP
  // ban, a login wall, a video with the workout only on screen — and none of that
  // stops the user reading the caption on their own phone. It goes to the same
  // reprocess endpoint as the retry button, which decides for itself whether that
  // means a queued job or an inline re-read with the never-downgrade merge.
  var capFor = null;

  function openCaption(w) {
    capFor = w;
    $("capinput").value = "";
    $("caplede").textContent = isUpload(w)
      ? "Type or paste the workout as the video says it. Spotter builds the card from your text — the file itself is already gone."
      : isFailed(w)
      ? "Copy the workout text off the post and paste it here. Spotter reads what you paste instead of trying the video again."
      : "Copy the workout text off the post and paste it here. Spotter rebuilds the card from your text.";
    openSheet("capsheet");
    setTimeout(function () { $("capinput").focus(); }, 60);
  }

  function sendCaption() {
    if (!capFor) return;
    var w = capFor;
    var text = $("capinput").value.trim();
    if (text.length < 12) { toast("Paste a bit more than that."); return; }
    var btn = $("capgo");
    btn.disabled = true;
    btn.textContent = "Reading…";
    api("workouts/" + w.id + "/reprocess", {
      method: "POST",
      body: JSON.stringify({ caption: text.slice(0, 6000) })
    }).then(function (r) {
      btn.disabled = false;
      btn.textContent = "Read it";
      // A card that had failed goes back on the queue; a card that was merely weak
      // is re-read inline and comes back whole.
      if (r.status === "processing") {
        closeSheet("capsheet");
        w.ingest_status = "processing";
        w.ingest_error = null;
        if (current && current.id === w.id) openDetail(w, true);
        render();
        watchPending();
        toast("Reading your caption…");
        return;
      }
      if (r.status !== "ok") { toast(r.message || "Could not read that."); return; }
      closeSheet("capsheet");
      load().then(function () {
        var fresh = state.workouts.filter(function (x) { return x.id === r.workout.id; })[0];
        if (fresh) openDetail(fresh, true);
        toast("Re-read it from your caption.");
      });
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = "Read it";
      toast("Could not read that.");
    });
  }

  var detailCloseTimer = null;

  function closeDetail() {
    var d = $("detail");
    if (!d.classList.contains("open")) return;
    d.classList.remove("open");
    d.classList.add("closing");
    current = null;
    clearTimeout(detailCloseTimer);
    // Torn out at the end: emptying first animates a blank page out.
    detailCloseTimer = setTimeout(function () {
      d.classList.remove("closing");
      if (!d.classList.contains("open")) $("dinner").innerHTML = "";
    }, 240);
  }

  function patchWorkout(w, fields) {
    return sb.from("workouts").update(fields).eq("id", w.id).then(function (r) {
      if (r.error) toast("Could not save that change.");
      return !r.error;
    });
  }

  // ---------- correcting an exercise ----------
  //
  // The exercise list is where extraction is actually wrong, and until now it was
  // the one part of a card the user could not touch — they could rename the
  // category and write notes, but not tell Spotter that "Warm up" is not a
  // movement. So this is both the missing affordance and the measurement: the edge
  // function records every change as model-output-to-user-correction, which is the
  // labelled set the confidence weights have never had.
  //
  // It goes through the API rather than PostgREST because the original value has
  // to be read from the stored row (a "before" the browser supplies is not
  // evidence) and a corrected name has to be resolved against the catalog, which
  // lives in the function.

  var exEdit = null;

  function fieldVal(v) { return v === null || v === undefined || v === "" ? "" : String(v); }

  function openExEdit(w, bi, ei, ex) {
    exEdit = { w: w, block: bi, index: ei, name: ex.name, mode: "edit" };
    $("exedittitle").textContent = "Fix this exercise";
    $("exeditlede").textContent =
      "Spotter read this off the video. If it got it wrong, put it right — the change stays on your copy.";
    $("exeditname").value = ex.name || "";
    $("exeditsets").value = fieldVal(ex.sets);
    $("exeditreps").value = fieldVal(ex.reps);
    $("exeditsecs").value = fieldVal(ex.duration_seconds);
    $("exeditdelete").classList.remove("hide");
    $("exeditsave").textContent = "Save change";
    openSheet("exeditsheet");
  }

  function openExAdd(w, bi) {
    exEdit = { w: w, block: bi, index: -1, name: null, mode: "add" };
    $("exedittitle").textContent = "Add an exercise";
    $("exeditlede").textContent =
      "Something in the video Spotter did not pick up. Sets, reps and seconds are optional.";
    $("exeditname").value = "";
    $("exeditsets").value = "";
    $("exeditreps").value = "";
    $("exeditsecs").value = "";
    $("exeditdelete").classList.add("hide");
    $("exeditsave").textContent = "Add exercise";
    openSheet("exeditsheet");
    $("exeditname").focus();
  }

  // Re-seat a workout row the server has just rewritten. Realtime will deliver the
  // same row a moment later; doing it here as well means the card does not sit
  // stale while the socket catches up.
  function absorbWorkout(row) {
    if (!row || !row.id) return;
    for (var i = 0; i < state.workouts.length; i++) {
      if (state.workouts[i].id === row.id) { state.workouts[i] = row; break; }
    }
    if (current && current.id === row.id) {
      current = row;
      if ($("detail").classList.contains("open")) openDetail(row, true);
    }
    render();
  }

  function sendCorrection(payload, btn, okMsg) {
    if (!exEdit) return;
    var id = exEdit.w.id;
    var label = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    api("workouts/" + id + "/exercises", { method: "POST", body: JSON.stringify(payload) })
      .then(function (r) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (r.status !== "ok") { toast(r.message || "Could not save that change."); return; }
        closeSheet("exeditsheet");
        exEdit = null;
        absorbWorkout(r.workout);
        toast(r.corrections ? okMsg : "Nothing to change.");
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        toast("Could not reach Spotter — check your connection.");
      });
  }

  function saveExEdit() {
    if (!exEdit) return;
    var fields = {
      name: $("exeditname").value,
      sets: $("exeditsets").value,
      reps: $("exeditreps").value,
      duration_seconds: $("exeditsecs").value
    };
    if (!String(fields.name).trim()) { toast("An exercise needs a name."); return; }
    var body = exEdit.mode === "add"
      ? { op: "add", block: exEdit.block, fields: fields }
      : { op: "edit", block: exEdit.block, index: exEdit.index, expect_name: exEdit.name, fields: fields };
    sendCorrection(body, $("exeditsave"), exEdit.mode === "add" ? "Added it 💪" : "Fixed — thanks");
  }

  function deleteExEdit() {
    if (!exEdit || exEdit.mode !== "edit") return;
    sendCorrection(
      { op: "delete", block: exEdit.block, index: exEdit.index, expect_name: exEdit.name },
      $("exeditdelete"), "Removed it");
  }

  function removeWorkout(w, btn) {
    var go = function () {
      sb.from("workouts").delete().eq("id", w.id).then(function (r) {
        if (r.error) { toast("Could not remove it."); return; }
        state.workouts = state.workouts.filter(function (x) { return x.id !== w.id; });
        state.colItems = state.colItems.filter(function (it) { return it.workout_id !== w.id; });
        history.back();
        render();
        toast("Removed.");
      });
    };
    if (btn) armed(btn, "Tap again to remove", go); else go();
  }

  // ---------- collections and renaming ----------
  //
  // Both are plain PostgREST writes under RLS. A rename lands on the workouts row
  // and a database trigger records it in the corrections table (kind 'rename')
  // with the title that was actually stored, so the browser never supplies a "before".
  // Membership is one row per (collection, workout): removing a workout from one
  // collection touches nothing else, and a workout can be in as many as it likes.

  // Two taps to destroy something, no dialog: the first tap changes the label,
  // a second within three seconds does it, and doing nothing puts it back.
  function armed(btn, confirmLabel, fn) {
    if (btn.getAttribute("data-armed") === "1") { btn.removeAttribute("data-armed"); fn(); return; }
    var was = btn.textContent;
    btn.setAttribute("data-armed", "1");
    btn.textContent = confirmLabel;
    setTimeout(function () {
      if (btn.getAttribute("data-armed") === "1") { btn.removeAttribute("data-armed"); btn.textContent = was; }
    }, 3000);
  }

  // Rename · Collections · Remove as one row under the title. The favourite star
  // stays in the top bar: it is a state, these are actions.
  function manageRow(w) {
    var row = el("div", "managerow");
    row.id = "dmanage";
    if (!isPending(w)) {
      var ren = el("button", "mbtn", "✎ Rename");
      ren.onclick = function () { openRename("workout", w.id, w.title || ""); };
      row.appendChild(ren);
    }
    var n = colsOf(w.id).length;
    var col = el("button", "mbtn" + (n ? " on" : ""));
    col.appendChild(document.createTextNode("🗂 Collections"));
    if (n) col.appendChild(el("span", "n", String(n)));
    col.onclick = function () { openCollections(w); };
    row.appendChild(col);
    var rm = el("button", "mbtn quiet", "🗑 Remove");
    rm.onclick = function () { removeWorkout(w, rm); };
    row.appendChild(rm);
    return row;
  }

  // The collections this card is in, as tappable pills that jump to that filter.
  function colPills(w) {
    var wrap = el("div", "colpills");
    wrap.id = "dcols";
    colsOf(w.id).forEach(function (c) {
      var p = el("button", "pill accent", colLabel(c));
      p.onclick = function () { state.filter = "col:" + c.id; history.back(); setView("library"); };
      wrap.appendChild(p);
    });
    if (!wrap.children.length) wrap.classList.add("hide");
    return wrap;
  }

  // Redraw only the management row and pills on an open card; a full openDetail
  // would reload the embedded video for a membership toggle.
  function refreshManage(w) {
    var m = $("dmanage"), p = $("dcols");
    if (m) m.parentNode.replaceChild(manageRow(w), m);
    if (p) p.parentNode.replaceChild(colPills(w), p);
  }

  var renameCtx = null;

  function openRename(kind, id, currentName) {
    renameCtx = { kind: kind, id: id };
    $("renametitle").textContent = kind === "workout" ? "Rename workout" : "Rename collection";
    $("renameinput").value = currentName || "";
    openSheet("renamesheet");
    setTimeout(function () { $("renameinput").focus(); $("renameinput").select(); }, 60);
  }

  function dupCollectionMsg(err) {
    return err && String(err.code) === "23505" ? "You already have a collection with that name." : null;
  }

  function saveRename() {
    if (!renameCtx) return;
    var name = $("renameinput").value.replace(/\s+/g, " ").trim();
    if (!name) { toast("Give it a name."); return; }
    var ctx = renameCtx;
    var btn = $("renamesave");
    btn.disabled = true;

    if (ctx.kind === "workout") {
      var w = state.workouts.filter(function (x) { return x.id === ctx.id; })[0];
      if (!w || name === (w.title || "")) { btn.disabled = false; closeSheet("renamesheet"); renameCtx = null; return; }
      patchWorkout(w, { title: name }).then(function (ok) {
        btn.disabled = false;
        if (!ok) return;
        w.title = name;
        closeSheet("renamesheet");
        renameCtx = null;
        var t = document.querySelector("#dinner .dtitle");
        if (t && current && current.id === w.id) t.textContent = name;
        render();
        toast("Renamed.");
      });
      return;
    }

    var c = colById(ctx.id);
    if (!c || name === c.name) { btn.disabled = false; closeSheet("renamesheet"); renameCtx = null; return; }
    sb.from("collections").update({ name: name }).eq("id", c.id).then(function (r) {
      btn.disabled = false;
      if (r.error) { toast(dupCollectionMsg(r.error) || "Could not rename it."); return; }
      c.name = name;
      closeSheet("renamesheet");
      renameCtx = null;
      render();
      if ($("colsheet").classList.contains("open")) renderColSheet();
      if (current && $("detail").classList.contains("open")) refreshManage(current);
      toast("Renamed.");
    });
  }

  var colCtx = null;   // the workout whose membership the sheet is editing, or null

  function openCollections(w) {
    colCtx = w ? w.id : null;
    $("coltitle").textContent = w ? "Collections" : "Your collections";
    $("collede").textContent = w
      ? "A workout can live in several — tap to add or remove."
      : "Make a collection here, then add workouts from any card.";
    $("colemoji").value = "";
    $("colname").value = "";
    renderColSheet();
    openSheet("colsheet");
  }

  function renderColSheet() {
    var list = $("collist");
    list.innerHTML = "";
    if (!state.collections.length) {
      list.appendChild(el("p", "lede", "No collections yet. Try “Leg day”, “Hotel gym” or “Quick 10 min”."));
    }
    state.collections.forEach(function (c) {
      var isIn = colCtx ? inCol(c.id, colCtx) : false;
      var row = el("div", "colrow" + (isIn ? " in" : ""));
      row.setAttribute("role", "button");
      if (colCtx) row.appendChild(el("div", "mark", "✓"));
      row.appendChild(el("div", "ce", c.emoji || "🗂"));
      var t = el("div", "ct");
      t.appendChild(el("b", null, c.name));
      var n = colCount(c.id);
      t.appendChild(el("span", null, n + (n === 1 ? " workout" : " workouts")));
      row.appendChild(t);
      var ren = el("button", "exhelp", "✎");
      ren.setAttribute("aria-label", "Rename collection");
      ren.onclick = function (e) { e.stopPropagation(); openRename("collection", c.id, c.name); };
      row.appendChild(ren);
      row.onclick = function () {
        if (colCtx) { toggleMembership(c, colCtx); return; }
        closeSheet("colsheet");
        state.filter = "col:" + c.id;
        setView("library");
      };
      list.appendChild(row);
    });
  }

  function toggleMembership(c, workoutId) {
    if (inCol(c.id, workoutId)) {
      sb.from("collection_items").delete().match({ collection_id: c.id, workout_id: workoutId })
        .then(function (r) {
          if (r.error) { toast("Could not update that."); return; }
          state.colItems = state.colItems.filter(function (it) {
            return !(it.collection_id === c.id && it.workout_id === workoutId);
          });
          afterMembership();
        });
      return;
    }
    sb.from("collection_items").insert({ collection_id: c.id, workout_id: workoutId, user_id: state.user.id })
      .then(function (r) {
        if (r.error) { toast("Could not update that."); return; }
        state.colItems.push({ collection_id: c.id, workout_id: workoutId, added_at: new Date().toISOString() });
        afterMembership();
      });
  }

  function afterMembership() {
    renderColSheet();
    render();
    if (current && $("detail").classList.contains("open")) refreshManage(current);
  }

  function createCollection() {
    var name = $("colname").value.replace(/\s+/g, " ").trim();
    var emoji = $("colemoji").value.trim() || null;
    if (!name) { toast("Name the collection first."); $("colname").focus(); return; }
    var btn = $("colcreate");
    btn.disabled = true;
    sb.from("collections")
      .insert({ user_id: state.user.id, name: name, emoji: emoji, sort_order: state.collections.length })
      .select().single()
      .then(function (r) {
        btn.disabled = false;
        if (r.error || !r.data) { toast(dupCollectionMsg(r.error) || "Could not create it."); return; }
        state.collections.push(r.data);
        $("colname").value = "";
        $("colemoji").value = "";
        if (colCtx) toggleMembership(r.data, colCtx);
        else { renderColSheet(); render(); }
        toast("Created " + colLabel(r.data));
      });
  }

  function deleteCollection(c, btn) {
    armed(btn, "Tap again to delete", function () {
      sb.from("collections").delete().eq("id", c.id).then(function (r) {
        if (r.error) { toast("Could not delete it."); return; }
        state.collections = state.collections.filter(function (x) { return x.id !== c.id; });
        state.colItems = state.colItems.filter(function (it) { return it.collection_id !== c.id; });
        if (state.filter === "col:" + c.id) state.filter = "All";
        render();
        if ($("colsheet").classList.contains("open")) renderColSheet();
        toast("Deleted " + c.name + " — its workouts are still in your library.");
      });
    });
  }

  // ---------- body diagram ----------
  //
  // Two anatomical figures, front and back, with a shape for every muscle the app
  // has a word for. What lights up is derived ONLY from the catalog through each
  // exercise's canonical_id — never from the card's free-text muscle list and never
  // from an exercise name. A movement the catalog does not know lights nothing, and
  // the section says so.
  //
  // Primary — what the movement is for — is the accent at full strength. Secondary
  // — what it also asks for — is the same accent, faint. Garmin uses red and yellow
  // for that split; on a palette with exactly one accent a second hue would be a new
  // claim on the eye for a distinction weight already tells, so this is one hue at
  // two strengths, and four on Progress where the ramp is the whole point.
  //
  // The artwork is the male front and back muscle maps from react-native-body-
  // highlighter (MIT, (c) 2022 ELABBASSI Hicham), re-projected from its 724x1448
  // space onto 181x362, merged to one path per group and rounded to a tenth of a
  // unit. Credit and licence are in README.md.

  var BODY_VIEWS = ["front", "back"];

  var BODY_VB = "0 0 181 362";

  var BODY_SKIN = {
    front:
      "M77.4 42.2Q76.5 41.1 75.8 42.4C74.6 45.1 77.1 50 78.6 52.2 79.1 52.8 79.5 52.2 79.6 51.8A.2.2 57" +
      ".6 0 1 80 51.9C79.8 53.8 79.7 56.9 81.1 58.1 81.8 58.8 81.7 59 81.7 59.9Q81.7 63.8 81 66.7 81 66" +
      ".8 80.9 66.9 77.2 70.7 72.6 73.3C69.6 75 66.9 74.8 63.2 74.5Q59.4 74.2 56.2 76.3C52.2 79 47.7 83" +
      ".9 47.3 88.9Q46.7 95.5 47.6 103.2C47.7 103.7 47.7 104.4 47.8 105Q47.8 105.1 47.7 105.2C47 106.9 " +
      "46 108.7 45.5 110.3 44.3 113.9 44.1 117.6 44 121.5Q44 121.6 44 121.7C40 126.9 36.9 132.3 35.4 13" +
      "8.7Q35 140.2 34.5 143.7 32.8 155.9 29.5 167.9C29 169.8 28.2 172.6 26 173.4Q22.7 174.7 19.8 176.8" +
      "C18.3 178 17.4 180 16.5 181.7 15.6 183.5 11.9 184.3 12.3 186.5 12.4 187.2 13 187.5 13.7 187.5Q16" +
      ".8 187.4 18.5 185C19 184.4 19.5 184.2 20.1 183.8Q20.3 183.7 20.3 183.9 21.1 185.8 20.1 187.7 17." +
      "9 191.9 15.6 196.2 15.1 197 14.9 197.8C14.4 199.4 16.4 200.2 17.4 198.8 19.2 196 20.7 193.3 23.1" +
      " 190.6Q23.2 190.5 23.2 190.7 22 195.8 19.8 200.6C19.3 201.5 18.9 203.1 19.8 203.8 22.4 205.9 26." +
      "8 193.4 27.3 192A.1.1-30.3 0 1 27.5 192C27.1 194.4 26.6 196.8 26.3 199 26.1 200.9 25.9 202.1 26." +
      "1 203.6 26.4 205.5 28.2 204.3 28.5 203.2 29.6 199.6 30.1 195.4 31.3 191.6A.1.1 0 0 1 31.5 191.5C" +
      "32.9 192.1 31.7 199.1 33.3 200.9A.3.3 0 0 0 33.5 201C34.6 201.1 34.9 199.3 35 198.4Q35.4 195.2 3" +
      "5.6 191.9 35.7 190.9 36 189.8 37.6 184.4 38.7 178.9 39 177.1 38.9 174.4 38.6 170.4 40.5 166.4 45" +
      ".1 156.4 50.3 146.6C53.4 140.8 54.7 135.3 55.2 128.5 55.3 126.5 55.8 125.6 57.1 124 59.4 120.9 6" +
      "0.7 116.2 61.5 112.5Q61.6 112.4 61.7 112.4L62.6 112A.1.1 0 0 1 62.7 112.1Q63.2 117.5 64.4 121.8C" +
      "64.8 123.2 66 124.6 66.3 126.3 66.5 127.2 66.7 128.1 66.8 129Q66.9 132.3 66.7 135.1C66.4 141.3 6" +
      "6 148.1 65 154.8 64.6 157.5 63.3 160.1 62.6 162.9Q61.3 168.4 60.6 174.1C59.9 179.4 59.1 185 59 1" +
      "89.4Q58.7 197.9 59.5 210.6 59.9 216.8 61.2 222.8 61.9 226.4 64 229.5 64 229.6 64 229.7C63.7 231." +
      "6 64.3 233.4 63.9 235.2Q63.1 239.6 62.9 244C62.9 245.9 63.2 247.8 63.4 249.7Q63.5 250.5 63.3 251" +
      ".2C59.8 266.8 61.7 282.7 65.4 297.5 66.5 301.8 66.6 305.6 66.2 310 66 312.2 65.5 315.1 66.1 317." +
      "2 66.5 318.9 66.9 321.9 65.4 323.3 64.2 324.6 60.6 327.6 60.2 329.2 59.8 330.7 58.8 333.1 60.6 3" +
      "33.4Q60.7 333.4 60.8 333.4L61.1 333.3Q61.3 333.3 61.2 333.5C60.7 335 62.3 335.1 63.4 335.2 64.1 " +
      "335.3 64.3 335.9 64.8 336.2Q65.8 336.7 66.8 336.1 66.9 336 67 336.1 67.8 337.2 69.1 337.3C69.7 3" +
      "37.3 70.3 336.8 70.9 336.5Q71 336.5 71.1 336.6 72.1 337.8 73.7 337.8C73.9 337.8 74.4 337.9 74.6 " +
      "337.7Q75.3 337.1 76.6 335.4C78 333.7 77.8 332.2 77.6 330 77.4 327.8 77.8 325.9 78.4 323.8 79 322" +
      ".1 78.3 320 78.5 318.3 78.6 317.1 79 315.9 78.8 314.8 78.5 313.4 78 311.9 77.8 310.7Q77.4 307.4 " +
      "77.4 304.9 77.4 298.1 78.4 290.5C78.8 287.1 79.8 284 81 280.9Q81.4 279.9 81.5 278.9C82.5 270.3 8" +
      "1.5 262.1 80.2 253.3 80 252 79.8 250.6 80.4 249.4 82 246.2 82.3 242.3 82.3 238.5 82.3 237.4 82 2" +
      "36.1 81.9 234.9 81.8 233.4 82.3 231.4 82.7 229.9 83.7 226.2 84.4 222.2 85.4 218.6Q87.2 211.1 88." +
      "9 203.5C89.6 199.9 89.4 196.2 89.4 192Q89.4 189.2 89.1 187.2 89.1 187.1 89.2 187.1L90.9 188A.3.3" +
      " 0 0 0 91.2 188L92.9 187.1Q93 187.1 93 187.2C92.4 191.5 92.6 195.8 92.8 200Q93 202.4 93.2 203.4C" +
      "94.6 209.8 96.2 216.1 97.6 222.5Q98.7 227.3 99.9 232.1C100.1 233.1 100.3 234.4 100.1 235.4 99.5 " +
      "239.7 99.6 245.6 101.8 249.6 102.1 250.3 102.2 251.3 102.1 252 100.7 260.9 99.5 269.8 100.5 278." +
      "8Q100.7 279.8 101.1 280.9C102.6 285 103.4 287.7 103.8 291.2 104.6 297.6 105.1 304.6 104.2 311.1 " +
      "103.9 313.2 102.9 314.6 103.4 316.9Q103.8 319.1 103.5 321.2C103.3 323.1 103.9 324.7 104.3 326.5 " +
      "104.8 328.3 104.5 330.2 104.4 332.1 104.2 334.4 105.9 336.2 107.5 337.7A.4.4-18.7 0 0 107.7 337." +
      "8Q109.8 338.1 111 336.5 111.1 336.4 111.2 336.5 113.3 338.2 115.1 336.1 115.2 336 115.3 336.1C11" +
      "7.3 337.3 117.5 335.2 118.7 335.2 119.9 335.2 121.3 335 120.9 333.4Q120.8 333.3 121 333.3C122.1 " +
      "333.7 122.7 333 122.5 331.9 122.3 330.3 121.9 328.6 120.9 327.6Q118.7 325.4 116.5 323.2C115.3 32" +
      "2 115.6 319.1 115.9 317.6 116.6 315.1 116.1 312 115.8 309.1 115.3 305 115.8 301.1 116.9 296.8 12" +
      "0.4 282.1 122.2 266.3 118.8 251.5 118.5 250.1 118.8 248.8 118.9 247.3 119.5 243.4 118.9 239.6 11" +
      "8.3 235.7 117.9 233.6 118.4 231.6 118 229.7Q118 229.6 118.1 229.5C120.8 225.7 121.6 220.2 122.1 " +
      "215.8 123 207.6 123.1 199.3 123.1 191.1 123 185.4 122.2 179.8 121.5 174.1 121.1 170.3 120.2 166." +
      "1 119.4 162.5 118.7 159.7 117.4 157.2 117 154.3 116.3 149.6 116 145.2 115.6 139.1Q115.2 133.8 11" +
      "5.3 130.7 115.3 128 115.8 126C116.1 124.7 117.1 123.5 117.5 122.4 118.6 119.2 119 115.4 119.4 11" +
      "2.1Q119.4 111.9 119.5 112L120.4 112.3A.2.2 0 0 1 120.5 112.5Q121.5 116.7 123.1 120.7C123.5 121.8" +
      " 124.2 122.9 125 123.9 126.4 125.6 126.8 127 127 129.3 127.4 134.1 128 138 129.7 142.3Q130.4 144" +
      " 131.9 146.8 135.9 154.4 139.6 162.1C141.5 166 143 168.9 143.2 172.6Q143.2 173.1 143.1 175.2 143" +
      " 177.3 143.5 179.6 144.5 184.2 145.6 188.1C146.3 190.5 146.6 192.3 146.7 194.6 146.7 195.9 146.9" +
      " 200.9 148.4 201 149.9 201.2 149.9 193.7 150.1 192A.3.3 0 0 1 150.2 191.8Q150.3 191.7 150.4 191." +
      "6A.3.2 59 0 1 150.9 191.8C151.8 195.6 152.4 199.4 153.6 203.1 153.9 204 154.6 205 155.7 204.3A.3" +
      ".3-8.4 0 0 155.8 204.2Q156.2 202.6 156 200.9 155.5 196.5 154.6 192.2A.1.1 0 0 1 154.8 192.1C155." +
      "7 194.3 159 203.6 161.3 204 162.7 204.3 163 202.8 162.7 201.8 162.1 199.9 161.1 197.9 160.5 196." +
      "2Q159.6 193.4 158.8 190.5A0 0-73.3 0 1 158.9 190.5Q160.1 191.9 161.2 193.4C162.4 194.9 163.4 196" +
      ".8 164.5 198.5Q165 199.3 165.4 199.5C166.4 199.9 167.7 198.9 167.2 197.8 166.7 196.2 165.4 194.2" +
      " 164.8 193Q163.6 190.6 162.2 188.1C161.4 186.6 161.2 185.5 161.7 183.9Q161.8 183.8 161.9 183.8C1" +
      "62.6 184.1 163.1 184.4 163.6 185.1Q165.3 187.4 168.4 187.5C170.3 187.5 170.1 185.2 169.1 184.6 1" +
      "67.8 183.8 166.2 182.8 165.5 181.5 164.5 179.5 163.7 177.8 162.3 176.8Q159.3 174.7 155.9 173.3C1" +
      "54.9 172.9 153.8 171.6 153.4 170.6Q152.1 166.9 150.7 160.5 148.7 151.7 147.7 144.7 147.1 140.6 1" +
      "46.9 139.8C145.5 132.9 142.4 127.5 138.2 121.9 138 121.5 138 121.3 138 120.8Q138.1 116.6 137.2 1" +
      "12.4C136.6 109.7 135.5 107.6 134.4 105.2Q134.3 105.1 134.3 105C134.8 99.7 135.2 94.4 134.8 89.2 " +
      "134.3 84 130.3 79.3 126.2 76.6 123.7 74.9 121.4 74.2 118.5 74.5Q116.1 74.8 113.4 74.6C109.5 74.3" +
      " 104.6 70.1 101.8 67.6 101.5 67.2 101.1 66.9 101 66.3Q100.3 62.9 100.3 59.4 100.3 58.4 101.2 58 " +
      "101.3 58 101.3 57.8C102.4 56 102.2 53.8 102.2 51.7A.1.1 0 0 1 102.4 51.7C102.6 52.2 103 52.9 103" +
      ".6 52.1 105.3 49.7 106.9 46 106.5 43 106.4 42 105.7 41.5 104.7 41.9",
    back:
      "M76 41.6Q74.3 41.7 74.4 44C74.6 46.8 75.9 50 77.7 52.4A.2.2 0 0 0 77.9 52.5Q78.5 52.3 78.6 51.7 " +
      "78.6 51.6 78.7 51.6C78.9 51.7 78.8 54.9 78.8 55.3 78.9 56.4 79.3 57.7 80.4 58.4A.4.4-79.2 0 1 80" +
      ".5 58.6C80.8 59.9 80.5 66.1 79.6 67.1Q75.8 70.9 71.1 73.5C68.3 75 65.4 74.7 62 74.5 59 74.3 56.9" +
      " 75 54.5 76.8 51 79.2 46.8 83.8 46.3 88.2 45.7 93.2 46.1 99.2 46.6 104.5Q46.7 105 46.5 105.5C45." +
      "8 107.1 44.9 108.8 44.4 110.3Q43 114.7 43 119.3 43 120.1 43 121.5 43 121.7 42.9 121.8C38.8 127 3" +
      "5.7 132.6 34.2 139.1Q33.9 140.4 33.4 144C32.3 151.9 30.7 159.9 28.5 167.6 27.8 169.8 27.2 172.5 " +
      "25.1 173.3Q21.8 174.6 19 176.7C17.3 177.9 16.6 179.5 15.4 181.7 14.6 183.3 10.1 184.8 11.4 186.9" +
      " 11.8 187.6 12.5 187.5 13.2 187.5Q15.8 187.1 17.3 185.2C17.9 184.5 18.3 184.1 19.1 183.8A.2.2 0 " +
      "0 1 19.3 183.9C19.9 185.5 19.7 186.4 18.9 188Q16.4 192.6 13.9 197.3C13 199.1 15.1 200.5 16.4 198" +
      ".6 18.2 195.9 19.6 193.3 22 190.6Q22.2 190.5 22.1 190.7 20.9 195.9 18.5 201 17.9 202.2 18.4 203." +
      "4C18.6 203.9 19.2 204.2 19.7 204 21 203.4 22.2 201.4 22.8 200.1Q24.1 197.2 25.3 194.2 25.8 192.9" +
      " 26.3 192.1A.1.1 0 0 1 26.4 192.1C26.2 193.7 24 203.5 25.4 204.4 26.4 205 27.2 203.9 27.4 203.1Q" +
      "28.7 199 29.5 194.2C29.7 193.3 29.9 192.5 30.1 191.7A.4.4 0 0 1 30.9 191.8C31.3 194.5 31 197.2 3" +
      "1.7 200 31.9 200.6 32.6 201.5 33.2 200.7 34.3 199.2 34.4 195 34.5 192.6 34.6 190.1 35.7 187.5 36" +
      ".2 185.3 36.9 182.3 38 178.7 37.9 175.1 37.7 171.9 38.1 169.1 39.5 166.1Q44 156.6 49.1 146.8C51." +
      "2 143 52.4 139.5 53.3 135.5Q53.6 133.8 54.1 127.8C54.3 126.5 54.8 125.5 55.8 124.3 58.3 121.2 59" +
      ".6 116.5 60.5 112.5Q60.5 112.4 60.6 112.3L61.5 112Q61.6 111.9 61.6 112.1C62 116.3 62.5 121 64.6 " +
      "124.6Q65.3 125.8 65.4 127.4C65.4 127.6 65.6 127.9 65.6 128.1 65.7 129.4 65.8 131.3 65.7 132.9Q65" +
      ".2 143.3 64.1 153.6C63.7 157 62.2 160.1 61.4 163.4 60.5 167.4 59.8 171.4 59.3 175.6 58.8 180.1 5" +
      "8 184.8 58 189.2 57.7 199.4 57.8 210.6 59.7 221.1 60.3 224 61.1 226.9 62.8 229.3A.4.4 27.9 0 1 6" +
      "2.9 229.6C62.9 231.6 63.1 233.6 62.8 235.5 62 240.2 61.5 244.7 62.4 249.5 62.4 249.9 62.4 250.5 " +
      "62.3 250.9 58.8 266.3 60.4 282.7 64.5 298 65.4 301.4 65.6 305.1 65.2 308.7 65 311.2 64.6 313.8 6" +
      "4.8 316.3 65 318.2 66.1 321 64.8 322.8 63.7 324.3 61.4 326 59.8 328.1 59 329.1 57.1 333.8 60 333" +
      ".4Q60.1 333.4 60.1 333.5C59.7 335.1 61.4 335.1 62.6 335.2Q62.7 335.2 62.8 335.3C63.7 336.2 64.5 " +
      "336.9 65.7 336.1Q65.8 336 65.9 336.1C67.1 337.5 68.3 337.6 69.8 336.5Q69.9 336.4 70 336.5C70.3 3" +
      "36.8 70.6 337.2 70.9 337.4Q72 338 73.3 337.8A.4.4 0 0 0 73.5 337.7Q75.1 336.2 75.9 334.9C77 333." +
      "2 76.5 331.4 76.4 329.5 76.3 327.5 76.8 325.6 77.4 323.7 77.6 322.9 77.5 321.6 77.4 320.6Q77.2 3" +
      "19.1 77.5 317.6C77.7 316.3 77.9 315.3 77.6 314.4Q76.5 310.6 76.4 306.8 76.2 298.5 77.4 289.9C77." +
      "8 286.8 78.7 284.2 79.9 281.1Q80.3 279.9 80.4 278.8C81.6 269.8 80.1 261.1 79 252.2 78.7 249.9 80" +
      " 248.4 80.4 246.9 81.1 244.1 81.4 239.8 81 236.4 80.7 234.5 80.9 233 81.3 231.2 82.3 227.3 83.2 " +
      "223.2 83.9 220Q85.6 213.2 87.1 206.3 88 202.6 88.1 201.4 88.4 199.1 88.4 194 88.5 191 88.1 188.1" +
      " 88.1 187.6 88 187.4 87.9 187 88.2 187.2L89.8 188A.3.3 44.4 0 0 90.1 188L91.9 187.1A.1.1 0 0 1 9" +
      "2 187.1Q91.6 188.4 91.6 189.7C91.5 195 91.4 200.6 92.6 205.6Q94.4 213.4 96.2 221.1C96.8 223.6 97" +
      ".6 227.5 98.5 230.7 98.8 231.8 98.9 233 99.1 234.1 99.3 235.1 98.9 236.5 98.8 237.4Q98.6 241.7 9" +
      "9.3 245.9C99.5 246.7 99.8 247.9 100.1 248.5 101 250.1 101.1 251.1 100.8 253 99.6 261.6 98.6 269." +
      "7 99.4 278.4 99.4 279.1 99.7 280.1 100 280.9 101.9 285.8 102.6 289.2 103.1 294.5 103.6 300 103.9" +
      " 305.6 103.1 311.1Q103 312 102.6 313.2C102 314.9 102.1 316 102.5 318 102.9 320.2 102 322.1 102.7" +
      " 324.4 103.2 326.1 103.5 327.7 103.5 329.5 103.4 331.1 102.9 333.1 103.8 334.6Q104.7 336 106.4 3" +
      "37.7 106.5 337.8 106.6 337.8 108.7 338.1 109.9 336.5A.2.2 0 0 1 110.1 336.5Q112.3 338.2 114 336." +
      "1 114.1 336.1 114.2 336.1 115.5 336.9 116.5 335.9 117.1 335.4 117.3 335.3C118.5 334.9 120.2 335." +
      "4 119.8 333.4A.1.1 0 0 1 120 333.3L120.2 333.4Q120.3 333.4 120.4 333.4C122.1 333.2 121.3 331.1 1" +
      "21 330 120.3 327.4 117.2 324.9 115.3 323.1 114.2 321.9 114.6 318.7 114.9 317.3 115.7 314.1 114.7" +
      " 310 114.6 307.6 114.4 304.4 114.7 301.1 115.5 297.8 119.2 282.8 121.1 266.8 117.7 251.6 117.4 2" +
      "50 117.7 248.6 117.9 246.8 118.4 243.2 117.8 238.9 117.1 235.2 116.8 233.5 117.1 231.8 117.1 230" +
      ".2Q117.1 230.1 117 229.9L116.9 229.7Q116.9 229.6 117 229.5C118.9 226.8 119.9 223.3 120.4 220.3 1" +
      "22 210.6 122.1 200.2 122 190.3 121.9 184.9 121 179.5 120.5 174.2Q120 170 118.5 163.2C117.7 159.9" +
      " 116.1 156.8 115.8 153.4Q114.8 144 114.3 135.5 114.1 132.7 114.2 129.5C114.2 128.2 114.6 126 115" +
      ".1 124.9 115.7 123.7 116.5 122.7 116.8 121.4Q117.9 116.8 118.3 112.1A.1.1 0 0 1 118.5 112L119.3 " +
      "112.4Q119.4 112.4 119.5 112.5C120.4 116.5 121.6 121.2 124.3 124.5 126.4 127 126 130.9 126.4 134 " +
      "127.1 138.4 128.4 142.3 130.6 146.4Q134.6 154.1 140.1 165.6 142.1 169.7 142.1 173.9 142.1 173.9 " +
      "142.1 175.5C141.9 178.3 142.7 181 143.3 183.7 144 186.7 145.3 189.8 145.4 193.1 145.5 194.3 145." +
      "7 201.1 147.4 201A.3.3 0 0 0 147.6 200.9C149.4 199.3 148.1 192.3 149.4 191.6A.3.3-21.2 0 1 149.8" +
      " 191.7C150.6 195.3 151.3 199 152.2 202.5 152.5 203.6 153.5 205.4 154.7 204.2Q154.8 204.1 154.8 2" +
      "04 155.1 202.4 154.9 201.2 154.4 196.7 153.5 192.1A.1.1 0 0 1 153.7 192C154.6 194.2 158 203.8 16" +
      "0.5 204 161.6 204.1 161.9 202.6 161.6 201.8 160.9 199.7 159.9 197.7 159.3 195.9Q158.5 193.3 157." +
      "8 190.7A.1.1 0 0 1 157.9 190.6Q158.9 191.8 159.9 193.1C161.2 194.8 162.3 196.8 163.5 198.7Q164 1" +
      "99.3 164.4 199.5C165.1 199.7 166.3 199.1 166.2 198.4Q166.2 197.7 165.7 196.6 163.5 192.6 161.3 1" +
      "88.6C160.3 186.9 160 185.8 160.7 183.9Q160.7 183.8 160.8 183.8 162 184.2 162.2 184.7 163.9 187.3" +
      " 167.3 187.5C169.3 187.6 169 185.4 167.8 184.5 166.6 183.7 165.1 182.8 164.5 181.6 163.5 179.8 1" +
      "62.7 177.9 161 176.7Q158.3 174.7 154.9 173.4C152.9 172.6 152.1 170.2 151.6 168.1 149.4 160.6 147" +
      ".8 152.9 146.7 145.1Q146.2 141.9 146.1 140.9C144.7 133.4 141.5 127.7 137 121.7Q136.9 121.6 136.9" +
      " 121.5C137 117.6 136.7 113.8 135.5 110.2 135 108.7 134.1 107.1 133.4 105.6Q133.2 105.1 133.3 104" +
      ".6C133.7 99.6 134.1 94.7 133.7 89.6 133.3 84.1 129.3 79.2 124.8 76.3 122.3 74.7 120.3 74.3 117.3" +
      " 74.5 113.9 74.7 111.3 75 108.4 73.3Q103.9 70.8 100.1 66.9 100 66.8 100 66.7 99.3 63.7 99.3 60.7" +
      "C99.2 59.4 99.1 58.6 100.1 57.9Q100.2 57.9 100.3 57.8C101.2 56.2 101.3 53.9 101 51.9Q101 51.8 10" +
      "1.1 51.7 101.2 51.6 101.3 51.7L101.6 52.3A.5.4-42.1 0 0 102.4 52.3C103.6 50.5 107.4 43.1 104.4 4" +
      "1.7Q104.3 41.6 104.2 41.7L103.6 42.1"
  };

  var BODY_FRONT = [
    ["back",
      "M71.3 76.8a.2.2 0 0 1 0-.4q4.9-2.4 8.9-6.2.4-.4.8-.1.1.1.1.2.3 3.2-.4 6.4c-.2.8-.6 1.1-1.5 1.1q-" +
      "4 .3-8-1zM103.5 77.8c-1.3 0-2-.2-2.2-1.6q-.6-3-.3-6 0-.2.2-.2.4-.2.9.2 4 3.7 8.5 5.9.9.4-.1.7-3." +
      "5 1-7 .9z"],
    ["shoulders",
      "M68.5 77.9q1 .7 1.1 2 0 .1-.1.2c-2.5 1.5-6.1 1.9-7.2 4.9-.6 1.6-.2 4.3-.4 5.9q-.1 1.9-1.4 3.5-2." +
      "6 3.3-3.5 4.2c-.9.9-1.7.4-2.7-.1-3.9-2.2-6.2-6.4-5.6-10.8.5-3.7 3.2-6.4 6-8.8 4.2-3.5 8.9-4.5 13" +
      ".7-1.1zM112.6 80.2q-.2-.1-.2-.4c.4-1.7 1.4-2.3 3-3 6.2-2.8 10.9.8 15 5.2 5.2 5.5 3 14.1-3.7 17-1" +
      ".1.5-1.7-.3-2.5-1.1-1.5-1.7-3.4-3.5-4-5.7-1-3.4 1.1-6.9-2.4-9.4q-2.1-1.5-4.5-2.3-.5-.1-.8-.4z"],
    ["chest",
      "M68.2 105.7c-4.7-4.3-5.5-14.2-3.2-19.7 1.4-3.2 6.6-6.1 10-6.5q5.1-.6 9.3.2c2.4.4 4 3.9 4.6 6.3 1" +
      " 4.1.8 7.8.4 12q-.3 3.6-.5 4.2c-1.6 5.9-9.5 7.3-14.6 6.1-2.3-.5-4.3-1.1-6-2.7zM104 108.8c-3.8 0-" +
      "8.6-1.7-10.3-5.4q-.5-1-.7-3c-.7-6.1-1.5-13.4 2.1-18.7 1.1-1.6 2.6-2 4.6-2.1q2.9-.2 5.8-.1c2.6.1 " +
      "4.5.7 6.7 2 3.2 1.9 4.9 3.6 5.7 7.4 1.2 6.4.1 16-7.1 18.7q-3.1 1.2-6.7 1.2z"],
    ["biceps",
      "M47.4 123.1c-.6.2-1.8.1-1.9-.8-.1-4-.1-8.9 1.3-12.6.8-2.1 3.5-7.6 5.8-8.2 2.5-.7 3.2 4.1 3.1 5.7" +
      "-.1 4-1.9 8.7-3.8 12.2-1.1 2-2.5 3.1-4.6 3.6zM131.7 121.6c-2.5-2.2-4.4-8.3-5.2-11.9-.4-1.8-.3-7." +
      "4 2.1-8 2.6-.7 6 6.3 6.7 8.2q.7 1.8.9 4 .4 3.7.4 8.1c0 2.8-4.1.4-4.9-.4z"],
    ["triceps",
      "M51.5 128.6c-1.4-.2-1.6-1.8-1.2-2.9 2.8-6.1 5.7-12.7 7.6-18.9.3-1.1.8-2.1 1-3.1q.7-3.3 1.4-6.6.1" +
      "-.5.5-.8a.1.1 0 0 1 .2 0q.3.4.5 1.1 1.2 3.7 1.3 6.2c.1 2.8-1.3 6.1-2.2 8.9q-1.9 5.9-5.1 11.3c-.6" +
      " 1.1-2.9 4.8-4.1 4.6zM129.4 128c-5-5.5-7.2-12.9-9.5-19.8-.8-2.5-.9-4.8-.3-7.3.3-1.5.6-3.3 1.4-4." +
      "6q.1-.1.2 0 .3.4.4.9c.7 3.1 1.3 6.1 2.3 9.1 2.1 6.3 4.6 12.4 7.8 19.3q.4.8.3 1.3c-.2 1.2-1.4 2.3" +
      "-2.5 1.1z"],
    ["forearms",
      "M31.8 170.8c-1-.5.3-6.8.6-7.9 1.2-5.8 2.3-11.5 3.5-17.3q.4-1.9.5-3.8c.2-3 .2-5.5 1.6-7.9 1.8-3.1" +
      " 3.4-7.3 6.5-9.2a.5.5 62.7 0 1 .7.2c.5 1.1.5 2.1.5 3.5.1 4.9-.3 10.3-2.2 14.9-2.8 6.9-5.6 13.8-8" +
      ".2 20.7-1 2.7-1.9 5.2-3.2 6.6q-.1.2-.3.1zM50.4 131.8a.2.2 0 0 1 .2.2c1 4.3-.7 9.8-2.7 13.6-1.1 2" +
      ".2-3.3 5.1-4.6 7.8q-3.3 7-6.1 14.2-.6 1.6-1.7 2.8a.4.4 0 0 1-.6-.2q-.1-.9.2-1.8 2.6-7.3 5.4-14.5" +
      "c1.6-4 3.6-7.9 5.2-12 .9-2.5 1.3-5.6 1.8-7.7.4-1.6 1-2.8 2.9-2.4zM51.8 135.1a.1.1-63.1 0 1 .3-.1" +
      "l1.3 1.5q.1.1.1.3-.1 1-.3 1.5-1.7 3.9-3.4 7.8c-1.4 3.1-4.1 7.1-5.9 11.2-2.1 4.8-4 9.8-6.7 14.3a." +
      "1.1 0 0 1-.2 0l0-.1q0-.1 0-.1 2.5-7.5 5.8-14.7.7-1.6 1.4-2.8c1.2-2.1 2.7-4 3.7-5.8q3.3-6 4.1-13z" +
      "M150 170.8c-1.2-1-2.2-3.9-2.8-5.4-1.5-3.8-2.8-7.6-4.4-11.4q-2.3-5.6-4.5-11.2c-1.4-3.5-1.8-7.9-2-" +
      "11.6-.1-1.6-.2-4.9.7-6.3a.4.4 0 0 1 .6-.2c1.7.9 2.8 2.5 3.7 4.1q1.6 2.8 3.2 5.7c.5.9.7 1.9.9 3 ." +
      "3 2.6.4 5.3.9 7.9 1 4.8 1.8 9.7 2.9 14.5.4 1.8 2.3 9.8 1.3 10.9a.2.2 0 0 1-.3 0zM146.6 170.4q-1." +
      "1-1.1-1.7-2.7-2.8-7.2-6.1-14.3c-1.4-3-3.6-5.7-5-8.8-1.8-3.8-3.2-8.3-2.3-12.6a.4.4-87.1 0 1 .3-.3" +
      "c1.9-.2 2.3.7 2.8 2.3.8 3.1 1.2 6.5 2.4 9.2 3.9 8.4 6.9 16.2 9.8 24.6.3.8.5 1.4.4 2.3a.3.3 26.3 " +
      "0 1-.6.2zM144.9 171.6q-1-1.4-1.7-3-2-4.3-4.9-11.1-.7-1.6-1.6-3.4c-1.3-2.5-3.3-5.6-4.3-8q-2.4-5.4" +
      "-3.4-7.8-.3-.6-.3-1.5 0-.2.1-.3l1.3-1.5a.2.2 0 0 1 .3.1q.7 6.8 3.9 12.7.4.8 2.1 3.2 1.8 2.6 3 5." +
      "5 2.2 4.9 5 12.5.6 1.5.8 2.5a.1.1 0 0 1-.2.1z"],
    ["core",
      "M77.8 132.9a.1.1 0 0 1 0-.1q-.1-2.6.5-5.2c.3-1.4 1.9-2.5 3.3-3.2 2.3-1.3 4.7-2.8 7.1-3.7a.3.3-42" +
      ".6 0 1 .2 0c.8.4 1.2 1 1.2 1.9q0 3.3 0 6.6c0 1 .2 2.1-.2 3.3q0 .1-.1.2-.7.4-1.1.5-5.3.6-10.8-.2z" +
      "M80.2 144.4c-1.3-.1-2.2-.1-2.5-1.6q-.8-3.6-.1-7 0-.1.2-.2c1.9-.4 3.4-.6 5.6-1.1q2.9-.7 6-.5c.9.1" +
      ".8.9.8 1.6q.1 3.1-.1 6.7-.1 1.1-.5 2-.1.1-.2.1-.3.1-.8.1-4.2 0-8.4-.2zM86.9 107.3c1.9-.9 2.6 1.6" +
      " 2.7 2.9.1 1.3.9 7.7-.7 8.2q-1 .4-1.7.8-4.4 2.9-9 5.4a.4.4-21.9 0 1-.6-.2c-.7-2.6-2.6-11 .4-12.7" +
      " 2.8-1.6 6-3 8.8-4.3zM87.6 178.2c-7.3-2.5-9.5-25.2-9.9-31.7a.2.2 0 0 1 .1-.2c.9-.8 6.9-.4 8.7-.2" +
      " 1.1.1 3.8.3 3.8 1.9 0 10.2.2 20.5-.5 30.7a.3.3 0 0 1-.5.3c-.6-.3-1-.5-1.7-.7zM93 118.3c-1.4-.6-" +
      ".7-6.1-.7-7.4.1-1.7.6-4.7 3.2-3.5q4.1 1.9 8.1 3.9 1.5.8 1.8 2.5c.1 1.1.3 2.1.3 3.2q-.2 3.1-1.1 6" +
      ".6-.1.5-.3.9-.1.1-.2.1c-3.9-1.8-7.7-4.8-11-6.4zM95.6 133.3c-1 0-2.4-.1-3.3-.7q0 0-.1-.1c-.5-1.4-" +
      ".2-2.8-.2-3.9 0-2.1-.2-4.3 0-6.4.1-.7.5-1.1 1-1.4q.1-.1.2 0 .4.1.8.3 3.1 1.6 6.2 3.3c1.2.7 3.1 1" +
      ".8 3.4 3.1q.7 2.6.6 5.4a.2.2-1.8 0 1-.2.2q-4.2.5-8.5.4zM93.4 144.7c-.6 0-1.1.1-1.2-.7-.5-1.9-.8-" +
      "8.6 0-9.7q.1-.1.2-.1 3.3-.3 6.4.5c2.1.5 3.6.8 5.5 1.1a.3.3.6 0 1 .3.3q.5 3.5-.2 7c-.3 1.3-1.3 1." +
      "3-2.6 1.4q-3.6.3-8.3.3zM104.1 146.2q.3.1.3.4c-.4 6.6-2.5 29.2-10.1 31.7-.6.2-1 .5-1.6.7q-.3.1-.3" +
      "-.2-.2-2.3-.3-4.4c-.2-8.9-.2-17.8-.3-26.7q0-.1.1-.2c1.2-1.6 10.4-1.8 12.2-1.2zM109.7 111.1c-.5-1" +
      " 0-1.7.9-2.2 2.6-1.3 4.2-2.8 6.1-4.5a.4.4 0 0 1 .7.3c.1 1.2-.2 3.6-1.4 4.3-1.2.7-4.7 2.5-6.1 2.3" +
      "q-.1 0-.2-.1zM114.3 116.7c-.9-.3-3.3-2.6-4.1-3.6a.1.1 0 0 1 .1-.2q2.7-.9 5.3-2.2c1-.5 1.6-1.5 2." +
      "1-2.4q.1-.1.1 0c.2.8.4 1.5.1 2.4-.6 1.9-1.9 4.7-3.4 6a.2.2 0 0 1-.2.1zM107.1 121.8c-.3-.4-.2-1.1" +
      "-.2-1.7q.2-3.8.1-7.6 0-.1.1-.1.4.1.8.4 2.9 2.3 4.7 4.2c1 1-4 4.4-4.9 4.9a.5.5 59.6 0 1-.7-.2zM11" +
      "7.7 114.1a.1.1 0 0 1 .1 0q.5 4.9-2.5 8.8-.1.1-.1 0c-.3-.8-1.5-4-.9-4.7q1.6-1.9 3.4-4.1zM113.1 11" +
      "9.6c.3.1 1.1 3.1 1.2 3.6q0 .1-.1.2-.3.3-.7.6-2.6 2-5.4 3.7-.4.2-.7.3a.2.2 0 0 1-.3-.2q-.2-2.2.2-" +
      "4.3 0-.1.1-.2c.4-.4 5.5-3.9 5.6-3.9a.1 0 31 0 0 .1.1zM107.1 129.8q0-.1.1-.1 3.8-2.4 7.2-5.4a.1.1" +
      "-22.6 0 1 .2.1c.1 2.1.6 4.7-1.1 6.3q-3 3-6.3 5.5-.1.1-.1-.1c-.2-1.7-.5-4.7 0-6.3zM114.1 131.1a0 " +
      "0 0 0 1 0 0q.4 3.4.1 6.8 0 .1-.1.2c-1.2 2.1-4.6 4.9-7 5.7q-.1 0-.1-.1 0-2.6-.1-5.1 0-1.2.7-1.8c2" +
      ".1-1.8 4.6-3.7 6.5-5.7zM104.7 164.3q-.3-.4-.1-.9.8-2.3 1-4.6.5-5.7.9-11.4c0-.6.2-1.6.7-1.9q3.7-2" +
      ".3 6.8-5.5.1-.1.2 0 .3.5.4 1.1.8 6.9.8 14.2a.3.3-24.5 0 1-.1.2q-3.2 3.5-6.4 6.9c-1.2 1.3-2.3 2-3" +
      ".9 2q-.2 0-.2-.1zM66.1 108.9c-1.2-.8-1.4-3-1.3-4.3q0-.1.1-.2.5-.2.9.2 2.5 2.6 5.6 4.2c.9.5 1.4.9" +
      " 1.2 1.9q-.1.6-.7.5-3.1-.6-5.8-2.3zM71.8 113.1c-1 1.1-2.6 2.8-4.1 3.6a.2.2 51.1 0 1-.2 0c-1.6-1." +
      "3-3.1-4.7-3.6-6.3q-.2-.8.2-2.2 0-.1.1 0c.6.9 1.1 1.9 2.2 2.4q2.5 1.3 5.3 2.3a.2.2 0 0 1 .1.2zM74" +
      ".3 122c-1.8-1.1-4.2-2.8-5.1-4.4q-.1-.1 0-.2 2.2-2.3 5-4.5.4-.3.7-.4a.1.1 0 0 1 .1.1c-.1 2.5-.1 5" +
      ".1.2 7.6q.1.8-.2 1.5a.5.5 0 0 1-.7.3zM64.3 114l3.4 4.2a.5.5 22.9 0 1 .1.2c.1 1.4-.5 3.2-.9 4.4q-" +
      ".1.2-.2 0-3-3.9-2.4-8.8 0-.1.1 0zM67.9 123.5a.4.4-61.8 0 1-.1-.4l1.1-3.4a.2.2 0 0 1 .4-.1c.8.6 5" +
      ".5 3.5 5.6 4.2q.3 2.1.2 4.2a.2.2 0 0 1-.3.2q-3.6-2-6.7-4.6zM74.8 136.2c-1.9-1.5-4-3.4-6.1-5.3-1." +
      "7-1.7-1.5-4.3-1.2-6.5a.1.1 0 0 1 .2-.1q3.3 3 7.1 5.3.1.1.1.2c.6 1.6.2 4.6 0 6.3q0 .1-.1.1zM74.8 " +
      "143.9c-2-.9-6.9-4-7-6.5q-.1-3 .1-6.1a.1.1 0 0 1 .2 0q.2.3.5.6 2.6 2.4 5.4 4.6c1.1.9 1.1 1.6 1 2." +
      "9q-.1 2.2-.1 4.4 0 .2-.2.1zM77 164.4c-1.8 0-3.1-1-4.3-2.3q-3-3.3-6-6.6-.1-.1-.1-.2 0-5.8.5-11.6." +
      "1-1.8.6-3.6a.2.2 0 0 1 .3-.1q2.9 3 6.5 5.3.8.5.9 1.3.5 5.9 1 11.8c.1 1.9.6 3.3 1.1 5.2q.1.4-.2.7" +
      "-.1.1-.2.1z"],
    ["adductors",
      "M70.1 161.8c2.9 2.7 5.5 5.3 7.8 8.6 4 5.9 6.9 12.4 8.5 19.4.3 1.4-1.5 5.1-3.2 5.1q-.1 0-.2-.1-.2" +
      "-.4-.3-.8c-3.7-10.4-7-19.9-11.7-29.3-.5-.9-.8-1.8-1-2.8a.1.1 0 0 1 .1-.1zM82.9 224.6q0 .1-.1 0c-" +
      ".6-6.3-2.1-12.5-3.6-18.6q-4.8-20.5-10.6-40.9-.1-.5.1 0c5 10.6 9.7 21.6 12.9 33 2.4 8.5 3.9 17.9 " +
      "1.2 26.6zM83.6 197.3c.4-.7 3.6-5.1 4-5.1a.4.4-89.2 0 1 .4.4q-.3 8.7-1.9 17.2c-.1.5-.4 1.1-.5 1.6" +
      "q-.1.2-.1 0-.9-6.4-2.1-12.7c-.1-.4-.2-1 .1-1.5zM98.9 194.8c-1.4.3-2.8-3-3.1-4q-.2-.5 0-1.2 2.5-1" +
      "0.7 8.8-19.7c2.4-3.4 4.7-5.6 7.5-8.1q.1-.1.1.1-.3 1.4-.9 2.7c-4.9 9.6-8.3 19.8-11.9 29.9a.5.5-86" +
      ".4 0 1-.3.3zM113.4 164.7q.2-.4.1 0-6.7 23.4-12.2 47.4c-.5 2.2-.9 4.5-1.4 6.7q-.5 2.8-.7 5.6a0 0 " +
      "0 0 1-.1 0c-2-6.1-1.7-13-.5-19.2 2.8-14.1 8.6-27.6 14.7-40.6zM94.5 192.2c.4.2.4.4.7.7q1.5 2 3.1 " +
      "4c.5.6.5 1 .3 1.9q-1.1 6.3-2.1 12.6 0 .2-.1 0-.5-1.1-.6-2-1.4-8.1-1.7-16.3 0-.5.2-.9a.2.2 30.8 0" +
      " 1 .3-.1z"],
    ["quads",
      "M73.1 233.9q-.2-.1-.4-.3-1-1.4-1.8-3.4-1.9-5.2-3.3-10.6c-2.3-8.9-4.8-17.8-6.3-26.9-1.3-8.5 1-18." +
      "5 5.2-25.8q.1-.2.1 0c3.6 13.9 9.8 27 10.4 41.3.3 6.6.2 13.2-.9 19.8-.2 1-1.2 7-3 5.9zM68.8 235.7" +
      "q-.6-.5-.9-1.3c-1-2.7-1.9-5.3-3.2-7.8-2-3.9-2.7-8.6-3.3-12.9-.5-3.7-.6-7.9-1-11.8-.1-.5-.3-3.2.1" +
      "-3.4q.3-.2.5.1c.4.8.8 1.5.9 2.4q2.1 13.1 6.6 25.5c.7 2 2.5 7.6.5 9.2a.2.2-42.5 0 1-.2 0zM80.7 23" +
      "6.4c-.9 1.5-2.7-.6-3.1-1.4-.8-1.4-.7-3.7-.4-5.2 1-7 1.4-13.2.9-20.2q0-.2.1 0 3.9 8.2 3.6 17.2c-." +
      "1 2.4-.7 5.6-.7 8.5q0 .8-.2 1.1zM109.5 233.4c-2.2 3.5-3.8-6.7-3.9-7.3q-1.3-10.8-.3-21.5c1.2-12.9" +
      " 6.7-24.8 10.1-37.7q0-.2.1 0c4.3 7.9 6.3 17.1 5.1 26.1q-.6 4.3-2.2 10.7-1.9 7.6-3.8 15.1-1.5 6.1" +
      "-3.8 11.9-.5 1.2-1.4 2.8zM112.9 235.7c-2.5-2.5 1.2-10.7 2.2-13.9q3.1-9.9 4.8-20.1c.1-.7.7-3.1 1." +
      "4-3.3a.2.2 0 0 1 .3.2q.2 1 .1 2c-.5 6.6-.8 14.7-2.8 21.9q-.6 2.4-1.9 4.7c-1.1 2.1-1.7 4.2-2.5 6." +
      "3q-.4 1.1-1.1 2.2a.3.3 0 0 1-.5 0zM101.7 236.7c-.8-.7-.4-2.7-.5-3.7q-.6-4.3-.6-5.5c-.4-6.3.9-12." +
      "3 3.5-18q.1-.1.1 0c-.3 4.8-.3 9.5.2 14.3q.4 3.9.8 7.7c.1 1-.1 2.4-.5 3.3-.4.8-1.9 2.7-2.9 1.8z"],
    ["calves",
      "M63 258.1c.1-.9.5-5.5 1.2-6a.3.3-17.9 0 1 .4.2c-.1 2-.3 4-.4 5.9q-.1 4.7-.2 9.5 0 .9.1 1.7c.5 4." +
      "7 1.4 9.3 2.3 13.9 1 4.7 2.3 9.4 3.3 14.2q.6 2.9.5 4.5c-.1 1.4-.8 5.1-2.1 6a.2.2 0 0 1-.2 0q-.3-" +
      ".4-.2-.9c.2-1.8.4-3.5-.1-5.4q-2.1-8.7-3.4-14.8c-.5-2.1-.8-4.3-1-6.6q-.9-11.1-.2-22.1zM78.8 256.3" +
      "a0 0 0 0 1 .1 0c1 6.4 2.2 13.2 2.2 19.5q0 3-1.4 6.6c-1.8 4.6-2.2 9.6-4 14.2q0 .1-.1 0c-.5-8.6-1." +
      "4-16.5-2.1-25.8q-.2-3.1 1.1-5.8 1.9-3.7 3.8-7.3c.2-.4.3-.9.5-1.3zM113.9 307.9c-1.8-1.5-2.3-6.1-2" +
      "-8 .4-2.6 1.2-5.8 2-9.1q2.4-9.4 3.8-18.9c.7-4.9.4-10 .2-14.9-.1-1.4-.2-3.1-.3-4.7a.2.2 0 0 1 .5-" +
      ".1c.1.2.2.4.3.7q.7 3.6.8 5.1.6 10.8-.1 21.2-.3 4.4-1.4 8.9-1.6 6.9-3.2 13.7-.5 2.1 0 4.6c.1.5 0 " +
      "1-.2 1.4a.2.2 0 0 1-.3.1zM103.2 256.4a0 0 0 0 1 .1 0c1.2 2.9 2.7 5.5 4.3 8.7 1 2 1.2 3.6 1 6.1-." +
      "5 8.6-1.6 17.2-2.1 25.4q0 .2-.1 0-.4-.9-.6-1.7c-1.1-4.2-2.2-9.6-4.1-14.4q-.3-.9-.6-2.5c-.4-3.7-." +
      "1-7.8.5-11.5q.8-5 1.5-10.1z"]
  ];

  var BODY_BACK = [
    ["back",
      "M86.8 77.2c1.4 1.2 1.7 4.5 1.9 6.2q.4 5.6.2 11.2-.3 11.7-1.4 23.5a.1.1 3.7 0 1-.1.1q-.2 0-.2-.3-" +
      "1.1-4-2.4-6.3c-2.6-4.3-4.7-8-6.4-12.3-2.5-6.6-3.9-13.6-6.6-20.1q-.8-1.9-1.9-3.5-.1-.1.1-.1 3.1-1" +
      ".1 6.4-1.2c1.4-.1 3 .2 4.6.4 2.4.2 4.2.9 6.1 2.6zM110 75.5a.1.1 0 0 1 .1.2q-1.8 2.7-2.9 5.8c-2.6" +
      " 7.7-4.5 15.7-7.8 22.8-1.3 2.7-3.8 6.3-5 9.1q-1 2.3-1.6 4.7a.2.2 0 0 1-.4 0q-1.1-11.3-1.4-22.7c-" +
      ".1-5.1-.2-10 .7-15.1.3-1.5.7-2.5 2-3.5 2.5-1.9 4.5-1.9 7.5-2.3 3-.3 6 .1 8.9 1.1zM65.8 95.4c-2.1" +
      "-1.3-3.5-3.3-4.7-5.7q-1.3-2.7-1.6-3.5c-.4-1 8.8-4.8 9.9-5.2q.7-.3 1.1-.2c1.1.2 1.7 2.5 1.9 3.4q1" +
      ".4 6 3.7 13.9.2.7-.2 1.1c-1.3 1.4-8.7-3-10-3.8zM73.4 145.8q-2.3-2.4-4.2-5.5-.6-.9-.7-1.8c-.8-4.7" +
      "-1.4-9.5-2.6-14.1-.9-3.4-1.2-6.3-1.7-10.4-.2-1.8-1.4-3.3-2.1-4.7q-1.2-2.6-1.6-5.7-.1-.7.5-.3c1.8" +
      " 1.3 4.1 1.5 6.7 1.9 2.2.3 5.9-.8 7.2-2.7.8-1.1 1.2-1.6 2.2-2.2a.2.2-26.4 0 1 .2.1q2.5 5.5 5 10." +
      "9c.6 1.4 3 4 2.7 5.5-.9 4-2.5 8-4.1 11.8-2.4 5.8-4.7 11.7-6.8 17.6q-.1.2-.2.1-.3-.1-.6-.4zM73.4 " +
      "101.2c-6 3.3-13.6 1.8-15.1-5.7-.3-1.5-.6-4 .2-5.1.9-1.4 1.8 1 2 1.5 1.9 3.8 7.9 7.3 12.1 7.8q.5." +
      "1 1.3.5.1.1.1.2-.2.7-.5.8zM104.4 99.4a.5.5-3.6 0 1-.5-.4q-.2-.7 0-1.5 2.2-7.3 2.9-10.8c.4-2 .8-4" +
      ".2 1.7-5.5.5-.7 1.1-.6 1.8-.3q5.1 2 9.8 4.7a.3.3 25.9 0 1 .1.4c-1.5 3.9-3.2 7.7-7.1 9.9-2.4 1.3-" +
      "6.5 3.8-8.9 3.6zM106.4 101.2q-.5-.3-.6-.9 0-.1.1-.2c1.2-.5 2.4-.6 3.7-1 2.8-.8 5.5-2.7 7.6-4.6q1" +
      ".6-1.5 1.9-2.2c.3-.6.9-2.4 1.8-2.4q.1 0 .2.1.7.8.7 1.8c.1 3.4-.6 6.7-3.3 9-3.5 2.8-8.3 2.5-12 .4" +
      "zM109.3 105c1.5.4 2.9.2 4.4 0 2.1-.3 3.7-.7 5.3-1.8a.1.1 74.1 0 1 .2.1q-.2 3-1.4 5.7c-.6 1.3-1.7" +
      " 2.7-2 4.2q-.3 1.1-.4 2.2-.4 4.7-1.6 9.4c-1.2 4.7-1.8 9.7-2.7 14.5q-.1.3-.6 1.1c-1.1 1.8-3.1 4.9" +
      "-4.8 6a.1.1-25.6 0 1-.2-.1c-2.1-5.6-4.2-11.3-6.5-16.8-1.7-4-3.3-8-4.3-12.1q-.4-1.6.7-3 1.3-1.6 2" +
      ".1-3.5 2.3-5.2 4.8-10.4a.1.1 0 0 1 .2-.1q1.5.8 2.4 2.4c.6 1.1 3.1 1.9 4.3 2.3zM65.7 156.8c-.8-3." +
      "3-1.8-12.4 1.8-14.5.6-.3 1.2-.2 1.7.3 1.5 1.7 4.1 4.6 4.7 7a.3.3 52.6 0 1 0 .2c-.6 1.1-2.5 2-4 2" +
      ".8q-1.4.8-2.8 2.6c-.3.4-.7 1.1-1.1 1.5a.1.1-28.2 0 1-.2-.1zM74.8 152a.5.5-74.3 0 1-.2-.4c0-2.7 1" +
      ".3-6.1 2.2-8.7q3.9-10.7 9-20.9a.3.3-62.5 0 1 .4-.1c.3.2.8 3.2.9 3.8q1.7 14.8.7 29.2-.2 2.2-.8 4." +
      "8 0 .1-.1.1l-12-7.7zM91.7 145.4q.2-1.3 0-2.6.1-7.4.8-14.9.3-2.9 1-5.7.1-.3.1-.4.3-.4.5 0 5.8 11." +
      "7 10 24c.5 1.3 1.5 4.2 1.1 5.7a.4.4 0 0 1-.2.3l-11.9 7.7q-.3.2-.3-.1-1.1-7-1-14.1zM106.8 150.8q-" +
      "1.3-.8-.5-2.3 2-3.6 4.5-6.2c.9-.9 2.3.2 2.7 1q.7 1.2.9 2.5.9 5.4-.3 10.8a.2.2 0 0 1-.4.1c-1.7-3-" +
      "4-4.1-6.9-5.9z"],
    ["shoulders",
      "M64.2 79.9c0 0 .1 0 .2.1a.2.2 0 0 1 0 .3c-1.7 1.2-3.8 2.4-5 3.9-1.6 1.9-2.2 4.2-2.4 6.8-.1 1.5-." +
      "4 2.4-1.4 3.4-2.5 2.5-4.8 4.1-7.8 5.1q-.2.1-.2-.1 0-4.6 0-9.1 0-2.4.3-3.6c1-4 5.7-8.5 9.9-8.9 2." +
      "5-.3 4.3.6 6.5 2.2zM125.8 79.1c3.7 2.4 6.4 5.3 6.4 9.9q0 5.1 0 10.3a.1.1 0 0 1-.1.1c-1.3-.5-2.6-" +
      "1-3.7-1.7-2-1.3-5.3-3.7-5.4-6.2-.2-2.7-.7-5.2-2.4-7.3-1.2-1.4-3.2-2.6-4.9-3.8q-.3-.2 0-.4c1.1-.8" +
      " 2.5-1.7 3.8-2q3.4-.8 6.5 1.2z"],
    ["triceps",
      "M51.8 110.6c-.5.6-1.6 2.4-2.5 2.3q-.1 0-.2-.1-.3-.5-.5-1.1c-.6-2.7-.8-5.7.3-8.3 1.4-3.1 4.6-5.9 " +
      "7.4-7.8a.1.1 68.7 0 1 .2.1l1.6 9.6q0 .1-.1.2c-.1.1-.3.4-.4.5q-2.3 1.6-4.5 3.3-.7.6-1.3 1.3zM58.5" +
      " 106.8a.1.1 0 0 1 .1.1q1.1 4-.6 7.9-.8 1.9-1.5 5c-.4 1.8-2.2 3.1-3 4.7-.6 1.4-.6 3.1-.9 4.2-.5 2" +
      "-2.1 3.5-3.5 5a.2.2 0 0 1-.4-.1q-.1-.3-.2-.7c-.5-4.2.6-8.4 1.4-12.5.5-2.8-.4-6 2.4-8.6q2.4-2.2 4" +
      ".9-4.3c.3-.3.7-.4 1-.6zM44.9 129.9a.5.5-5.4 0 1-.3-.2q-.9-1.7-.9-3.8c-.1-5.3.9-10.6 2.4-15.9q.1-" +
      ".3.2 0 1.2 2.2 2.1 4.7c.7 1.8 1 3.2.5 5.1q-1.5 5-3.5 9.8-.2.4-.5.3zM122.5 106.1q-.5-.4-.8-.8-.1-" +
      ".1-.1-.2.8-4.8 1.6-9.6 0-.1.1-.1 3.7 2.5 6.2 5.7c2.5 3.2 2.4 7.6 1.4 11.3a.7.7 0 0 1-.9.4c-.8-.4" +
      "-1.6-1.7-2.2-2.4-1.3-1.6-3.7-3-5.4-4.3zM130.6 133.6q-.2-.1-.4-.3c-1.2-1.4-2.3-2.5-2.9-3.9-.7-1.8" +
      "-.3-3.9-1.4-5.5-1-1.6-2.2-2.5-2.7-4.4-.4-1.4-.7-2.9-1.2-4.3-1.1-2.9-1.6-5.2-.8-8.4a.1.1-74 0 1 ." +
      "2-.1q.4.1.8.4 2.8 2.3 5.4 4.8c1.3 1.3 1.7 2.5 1.8 4.5.2 5.6 2.7 11.2 1.6 16.9a.3.2 13.9 0 1-.3.2" +
      "zM133.6 110q.5 1.3.8 2.7c.9 4.3 1.8 8.7 1.7 13.2q0 2.1-1 3.9a.4.4 33.4 0 1-.6.1c-.4-.3-.5-.9-.6-" +
      "1.2q-2.3-5.9-3.3-9.5c-.7-2.5 1.7-6.9 2.9-9.1q.1-.1.1 0z"],
    ["forearms",
      "M38.6 133.6a0 0 0 0 1 0 0c.1 0 1.7 3.9 1.8 4.3q1.7 6.2 1.4 12.6c-.1 2.2-.9 4.3-1.7 6.4-2 5.1-4.4" +
      " 10.5-7.4 15a.3.3-54.2 0 1-.4.1c-.1-.1.1-.4.1-.5q1.4-5.2 2.2-10.5 2.2-13.5 3.9-27.3zM42.2 129.7a" +
      ".1.1 24.6 0 1 .2-.1q1.5 2 3.3 3.8c2 2.1.4 7.2-1.5 9.3a.3.3 0 0 1-.4 0c-1.5-2-1.4-4.7-1.2-7.1.1-2" +
      "-.2-3.9-.3-5.9zM36.3 136.8c.5.1.4 1.6.4 1.9q-.6 9.7-2.3 19.3c-.8 4.4-2.1 10.3-5.5 13.5a.1.1 0 0 " +
      "1-.2-.1c3.6-10.1 4.8-21.1 6.7-31.6q.2-1.2.4-2.7 0-.5.5-.4zM35.1 170.6q3.8-7 6.3-14.6c2-6.2 3.4-1" +
      "0.6 5.2-15.1q.8-2.1 3-2.4c.3-.1.9-.2 1.2.1q.3.2.2.6-1.4 3.9-3 7.5c-1.4 3.3-3.7 7.2-5.1 10-1.5 3." +
      "2-7 14.8-7.9 14.2a.1.1 0 0 1 0-.1q0 0 .1 0 0 0 0 0zM137.2 129.9c.1-.1.1-.2.2-.3a.1.1 0 0 1 .1.1c" +
      "-.2 1.8-.4 3.6-.4 5.4 0 2.2.5 6-1.3 7.8q-.1.1-.2 0c-1.9-1.9-3.5-7.1-1.6-9.2q1.6-1.9 3.3-3.8zM147" +
      ".2 172c-1.2-1.5-1.8-2.7-2.9-4.9q-3.1-5.9-5.3-11.9c-1.2-3.3-1.3-6.5-1-10q.3-2.9.7-4.9.7-3.5 2.4-6" +
      ".7a0 0 0 0 1 .1 0q1.8 15.8 4.3 30.1.6 3.5 1.8 7.6c.1.2.2.3.1.6a.1.1 0 0 1-.1 0zM143.1 139.6c-.1-" +
      ".7-.4-2.6.5-3a.2.2-18.4 0 1 .2.1q1.6 8.9 3.1 17.8c1 5.8 2.2 11.6 4.2 17a.1.1 0 0 1-.1.1c-2.9-2.7" +
      "-4.5-7.8-5.2-11.5q-1.8-9.6-2.6-20.5zM144.9 170.9c-.7-.2-2.5-3.3-3-4.3-2.2-4.3-4.2-8.7-6.5-13-1.3" +
      "-2.6-2.7-5.1-3.8-7.7q-1.5-3.5-2.8-7a.4.4 79.5 0 1 .4-.6c3.3 0 3.9 1.8 4.9 4.7q2.3 6.3 4.4 12.7 2" +
      ".4 7.3 6 14.2.2.4.5.8.1.1 0 .1z"],
    ["glutes",
      "M80.3 156.5q.4.2 1 1.1.1.1 0 .1c-3.6 1-6.5 1.9-9.5 3.9q-3.8 2.7-7.6 5.4a.1.1 74.9 0 1-.2-.1c.3-3" +
      ".3 2.6-8.8 5.1-11.3 2.3-2.2 8.7-.3 11.3.8zM71 190.7c-4.2-4.2-7.3-9.4-7.9-15.2-.5-5.7 3.9-8.7 8-1" +
      "1.4 2-1.3 11.6-6.8 13.6-4.4 1.5 1.8 3.3 4 3.9 6.3q.8 3.4.6 6.9-.2 5.6-1.6 11.1c-.6 2.5-.7 4.3-.6" +
      " 6.7.1 3.7-4.6 4.3-7.3 3.5-1.6-.5-3.4-1.2-5.3-1.6q-1.8-.3-3.4-1.9zM98.5 157.8q0 0-.1 0 0 0 0 0 ." +
      "6-1.1 1.8-1.5 3.2-1.2 6.5-1.5c3.2-.2 4.3.8 5.8 3.3 1.4 2.3 3.3 6.2 3.4 9q0 .2-.2.1-4.2-2.9-8.3-5" +
      ".9c-2.5-1.8-5.9-2.6-8.9-3.5zM100 194.2c-2.3.7-6.7.3-7.2-2.7-.3-1.5.1-3.7-.3-5.8q-.1-.7-.5-2.3c-." +
      "8-3.2-1-5.8-1.3-8.8-.3-3-.1-5.5.4-8.3q.3-1.4 1-2.6 2.2-3.4 3-4.1c1.2-1.2 4 0 5.3.5q4.9 1.8 10 5." +
      "4c2.4 1.7 4.8 3.6 5.7 6.3 1.2 3.6-.2 8.5-1.9 11.7q-1.9 3.7-5.3 7.2-1.7 1.7-3.8 2.1c-1.8.3-3.4 1-" +
      "5.1 1.5z"],
    ["adductors",
      "M86.5 196.3c.7.3.5 2.6.4 3.3q-1 8.3-3.7 16.2a.1.1 0 0 1-.2 0c.2-1.8.6-3.6.5-5.2q-.2-7.5-4.7-13.6" +
      "-.1-.1 0-.1c1.9-.4 5.9-1.2 7.6-.4zM100.8 196.9c-4 5.4-5.6 12.1-4 18.7a.1.1-63.2 0 1-.2.1q-.5-1.2" +
      "-.9-2.6-2.1-6.9-2.9-14.1c-.2-1.4-.3-2.9 1.7-3q3.2 0 6.4.7a.1.1 41.2 0 1 0 .1q0 0-.1 0 0 0 0 0z"],
    ["hamstrings",
      "M59.8 185.4a.2.2 31.7 0 1 .3-.1q.4.4.6 1c1.1 2.9 2.2 5.7 2.8 8.7.8 4.8 1.2 9.6.8 14.4q-.4 4.8-.7" +
      " 9.5c-.1 1.9-.2 3.9 0 5.8q.3 2.1.3 4.4a.1.1 0 0 1-.2.1q-.3-.5-.5-1.2-1.3-4.2-1.8-8.6-1.3-10.4-1." +
      "7-20.8-.3-6.2 0-12.4 0-.4.2-.9zM76.6 197.9q0-.1.1 0c1.3 2 2.5 4 3.1 6.4.8 2.9 1.5 6.1 1.1 9.1q-." +
      "1.9-.9 3.5c-2.7 9-3.2 18.6-4.6 27.8q-.2 1.4-.6 2.6-.1.2-.1 0c-1.2-2-1.3-6.3-1.3-8.7-.2-10.9.5-22" +
      " 1.6-32.8.4-3.4.5-5.3 1.8-7.9zM68.7 190.5q3.5 3.5 5 8.4c.2.8-.2 2.4-.2 3.2q-.3 6.9-.6 13.8c-.1 3" +
      ".8-.4 7.6-1.3 11.3q-2.2 9-5.7 17.2-.9 2.1-2.5 4.3-.1.2-.1 0c0-.5.2-1 .2-1.4q.6-5.7 1.5-11.3c.7-4" +
      ".4 1-9 1.1-13.1.1-9.1-.2-18.3.4-27.4.1-1.3.3-4 1.2-5.1q.1-.1.2-.1.5-.1.8.2zM82.1 213.9a0 0 0 0 1" +
      " 0 0q.3 2.5.5 5 .1.8-.6 3.5c-1 4-2 7.8-2.2 11.9-.2 5.4-.8 11.4-2.5 16.6q-.4 1.1-.2-.1.8-6.3.9-13" +
      "c0-.9-.1-2.6.1-3.9.5-4.8 1.8-9.6 2.9-14.3.4-1.9.7-3.8 1-5.8zM114.8 236.9c.6 3.7 1.1 7.8 1.6 11.5" +
      "q.1.7-.3.1c-3.7-5.9-5.8-13-7.6-19.8q-1.3-4.8-1.5-9.8-.3-7.6-.6-15.2c-.1-1.5-.6-3.9-.1-5.4q1.5-4." +
      "3 4.7-7.8c2.7-2.8 2.5 11.6 2.5 12.2 0 10.3-.1 18.5.5 27.5.1 2.2.5 4.4.8 6.5zM103.1 197.9q.1-.1.1" +
      " 0c.8 1.6 1.2 3.1 1.4 5 1.3 11.4 2 23.7 1.9 35.2 0 3-.1 6.6-1.3 9.3a.1.1 0 0 1-.2 0q-.6-2.3-.9-4" +
      ".6-.9-6.9-1.8-13.8c-.6-4.5-1.4-8.9-2.8-13.1q-1.1-3.2-.5-6.7c.4-2.7.9-5.4 2.1-7.8q.9-1.7 2-3.5zM9" +
      "7.8 214.2c.5 4.7 1.8 9.4 2.9 13.9.6 2.4 1 4.9 1 7.5q0 7.9 1 15.8 0 .3-.1 0-.7-1.8-1-3.6c-1.1-5.6" +
      "-1.4-10.1-1.7-15.3-.1-1.1-.3-2.4-.6-3.5q-1-4.1-1.9-8.1c-.5-2.3 0-4.7.4-6.9q0-.1.1 0 0 0 0 .1 0 ." +
      "1 0 .1zM119.7 185.3a.1.1 0 0 1 .2 0c.1.2.2.5.2.7q.2 4 .1 8-.3 13.2-2 26.4-.5 3.7-1.5 7.3-.2.9-.5" +
      " 1.2-.4.6-.3-.1c.1-2.4.5-4.8.4-7-.1-6.1-1.2-12.3-1-18.2.2-4.1.6-8.4 1.9-12.3q.7-2.4 1.7-4.7.2-.5" +
      ".8-1.3z"],
    ["calves",
      "M64.7 287.3c-.8-.6-1-1.6-1.3-2.8-1.8-6.8-2-13.3-1.7-20.7q.3-6.3 2.3-11.9c1.2-3.2 3.8-6.2 5.9-9q." +
      "2-.3.2.1c-.3 5.7-.7 11.4-.8 17.1-.1 7.6-.4 15.3-.1 22.9.1 1.7-.7 4.1-2.5 4.6q-1.1.3-2.1-.4zM65 2" +
      "90.9c1.8-1.4 4-.2 4.2 2.1q1.1 11.3 1.3 22.6c0 2.1-.2 3.9-.5 5.9q-.1.6-.4.9-.2.3-.3-.1c-1.3-6.7-2" +
      ".1-13.4-3-20.1q-.4-3.1-.8-4.7-.5-2-1.4-4.6c-.3-.8.2-1.6.8-2zM72.4 287.6c-1.2-.7-1.2-4-1.1-5.2.6-" +
      "9.1.9-18.5.3-27.6-.3-3.9 0-7.9.2-11.8q0-.2.1 0c.6 1.6 1.1 3.2 1.8 4.8 1.3 2.8 2.9 5.7 3.7 8.5q.6" +
      " 1.9 1 4.1 1.3 7.1 1.4 14c.1 4.6-2 10-5.7 12.9q-.9.7-1.7.2zM72.5 291.1c1.8-.5 3.5.6 3.5 2.5q0 7." +
      "3-1.4 14.4c-1 4.8-1.6 9.6-2.1 14.4a.1.1 0 0 1-.2 0q-.8-10.9-.9-21.7 0-3.5.2-7.1c0-.7 0-2.2.9-2.5" +
      "zM112.2 287.3c-1.5-1.1-1.7-2.9-1.7-4.8.2-13.2-.1-26.3-.9-39.5q0-.2.1 0 2 2.5 3.9 5.1c2.3 3.2 3.4" +
      " 7.2 3.9 11.1 1.2 8.7.9 18.2-1.5 26.6-.5 1.7-2.3 2.7-3.8 1.6zM105.1 286.8q-4.3-4.3-5-10.2-.2-1.8" +
      " 0-5 .3-5 1.2-10.3c.6-3.5 1.4-6.3 3.1-9.7q2-4.1 3.6-8.5a0 0-37.7 0 1 .1 0q.3 3.9.3 7.9c0 2.9-.3 " +
      "6.2-.4 9.1-.2 8.7.3 15.5.5 23.3 0 1.6-.3 6.5-3.3 3.5zM112.4 290.4c1.7-.5 3.6.8 3 2.7-.6 1.8-1.2 " +
      "3.6-1.5 5.5-1.3 7.9-2 15.8-3.5 23.6a.2.2-61.9 0 1-.3.1c0 0-.1-.1-.1-.1q-.9-3.4-.8-7.1.3-11.2 1.3" +
      "-21.8c.1-1.5.5-2.6 2-3zM107.6 291.2a.4.4-84.6 0 1 .2.3c.2 1.1.4 2.2.4 3.4.2 7.3-.1 15.7-.5 22.6q" +
      "-.2 3.4-.3 4.9a.1.1 0 0 1-.1 0c-.7-5.3-1.4-10.5-2.4-15.8-.9-4.3-1.1-8.7-1.2-13.1 0-2.1 2.2-2.9 3" +
      ".9-2.2z"]
  ];
  var BODY_REGIONS = { front: BODY_FRONT, back: BODY_BACK };

  // The adductors are not one of the twelve words Spotter speaks, so they ride one
  // step below the group they sit against: the inner thigh visibly works on a squat
  // without claiming it worked as hard as the quad.
  var BODY_RIDES = { front: { adductors: "quads" }, back: { adductors: "hamstrings" } };

  function capWord(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // levels: muscle -> 0..steps, 0 being untargeted. steps is how many lit strengths
  // this figure uses — 2 on a card (secondary, primary), 4 on Progress. caption(m)
  // returns the line shown when a muscle is tapped and doubles as its aria-label.
  //
  // The figure paints grey first and the real levels on the next frame, so the
  // muscles light up rather than arriving already lit. Under prefers-reduced-motion
  // the transition is off and the two paints look like one.
  function bodyMap(levels, steps, legend, caption) {
    var box = el("div", "bodybox s" + steps);
    var wrap = el("div", "bodywrap");
    var pick = el("div", "bodypick");
    var figs = [];
    var sel = null;
    var ready = false;

    BODY_VIEWS.forEach(function (view, vi) {
      var fig = el("div", "bodyfig");
      fig.style.animationDelay = (vi * 70) + "ms";
      var html = '<svg class="bodysvg" viewBox="' + BODY_VB + '" role="group" aria-label="' +
        view + ' of the body"><path class="bodyskin" d="' + BODY_SKIN[view] + '"/>';
      var regions = BODY_REGIONS[view];
      for (var i = 0; i < regions.length; i++) {
        html += '<path class="bodymus" data-m="' + regions[i][0] + '" d="' + regions[i][1] + '"/>';
      }
      fig.innerHTML = html + "</svg>";   // constant markup: nothing user-supplied in it
      fig.appendChild(el("div", "bodylbl", view));
      wrap.appendChild(fig);
      figs.push(fig);
    });

    function groupOf(view, key) { return BODY_RIDES[view][key] || key; }

    function paint() {
      BODY_VIEWS.forEach(function (view, vi) {
        var paths = figs[vi].querySelectorAll(".bodymus");
        for (var i = 0; i < paths.length; i++) {
          var p = paths[i];
          var key = p.getAttribute("data-m");
          var g = groupOf(view, key);
          var lv = ready ? (levels[g] || 0) : 0;
          if (g !== key && lv > 0) lv -= 1;
          p.setAttribute("class", "bodymus lv" + lv + (lv ? " lit" : "") +
            (sel === g ? " sel" : ""));
          p.setAttribute("aria-pressed", sel === g ? "true" : "false");
        }
      });
      pick.textContent = sel ? caption(sel) : "Tap a muscle to see what works it.";
      pick.className = "bodypick" + (sel ? " on" : "");
    }

    function choose(g) { sel = (sel === g ? null : g); paint(); }

    BODY_VIEWS.forEach(function (view, vi) {
      var paths = figs[vi].querySelectorAll(".bodymus");
      for (var i = 0; i < paths.length; i++) {
        (function (p) {
          var g = groupOf(view, p.getAttribute("data-m"));
          p.setAttribute("role", "button");
          p.setAttribute("tabindex", "0");
          p.setAttribute("aria-label", caption(g));
          p.addEventListener("click", function (e) { e.stopPropagation(); choose(g); });
          p.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
              e.preventDefault(); choose(g);
            }
          });
        })(paths[i]);
      }
    });

    box.appendChild(wrap);
    if (legend) box.appendChild(legend);
    box.appendChild(pick);
    // Tapping anywhere off a muscle drops the selection, the same as tapping it again.
    box.addEventListener("click", function () { if (sel) { sel = null; paint(); } });
    paint();
    // Two frames is enough for the grey to be committed before the accent lands, but
    // rAF does not run in a background tab and the figure must never stay grey, so a
    // timer backs it up. Whichever arrives first wins; the other is a no-op.
    function lightUp() { if (ready) return; ready = true; paint(); }
    if (window.requestAnimationFrame) {
      requestAnimationFrame(function () { requestAnimationFrame(lightUp); });
    }
    setTimeout(lightUp, 90);
    return box;
  }

  // items: [{ lv: [level, ...], text: "..." }] — one swatch per level, so a single
  // entry can carry the whole four-step ramp under one label.
  function bodyLegend(items) {
    var row = el("div", "bodylegend");
    items.forEach(function (it) {
      var s = el("span", "lg");
      it.lv.forEach(function (n) { s.appendChild(el("i", "sw lv" + n + (n ? " lit" : ""))); });
      s.appendChild(document.createTextNode(it.text));
      row.appendChild(s);
    });
    return row;
  }

  // The catalog's id -> muscles map, read once per session. Every signed-in user
  // may read the catalog; it is reference data, not theirs or anyone's.
  var catalogMuscles = null;
  var catalogLoading = null;

  function loadCatalog() {
    if (catalogMuscles) return Promise.resolve(catalogMuscles);
    if (catalogLoading) return catalogLoading;
    catalogLoading = sb.from("exercise_catalog").select("id,muscle_groups,secondary_muscles")
      .limit(1000).then(function (r) {
        catalogMuscles = {};
        (r.data || []).forEach(function (e) {
          catalogMuscles[e.id] = {
            primary: e.muscle_groups || [], secondary: e.secondary_muscles || []
          };
        });
        catalogLoading = null;
        return catalogMuscles;
      });
    return catalogLoading;
  }

  // A card's exercises through the catalog. A muscle the card trains on purpose
  // outranks one it merely assists, so the strongest claim on the card wins. The word
  // "full body" itself lights nothing — spreading a burpee over every region paints the
  // whole figure and says nothing — so a full-body movement reaches the map only through
  // its secondary list, and a note under the figure says that is what happened.
  function cardHits(list) {
    var levels = {}, names = {}, mapped = 0, total = 0, fullBody = [];
    function slot(m) { if (!names[m]) names[m] = { p: [], s: [] }; return names[m]; }
    list.forEach(function (e) {
      total++;
      var c = e && e.canonical_id && catalogMuscles ? catalogMuscles[e.canonical_id] : null;
      if (!c) return;
      mapped++;
      var nm = e.name || e.canonical_id;
      if (c.primary.indexOf("full body") >= 0 && fullBody.indexOf(nm) < 0) fullBody.push(nm);
      c.primary.forEach(function (m) {
        if (m === "full body") return;
        levels[m] = 2;
        if (slot(m).p.indexOf(nm) < 0) slot(m).p.push(nm);
      });
      c.secondary.forEach(function (m) {
        if (m === "full body") return;
        if (!levels[m]) levels[m] = 1;
        if (slot(m).s.indexOf(nm) < 0) slot(m).s.push(nm);
      });
    });
    return { levels: levels, names: names, mapped: mapped, total: total, fullBody: fullBody };
  }

  function cardCaption(names) {
    return function (m) {
      var n = names[m];
      if (!n || (!n.p.length && !n.s.length)) return capWord(m) + " — nothing here works it.";
      var parts = n.p.slice();
      n.s.forEach(function (x) { if (parts.indexOf(x) < 0) parts.push(x + " (secondary)"); });
      return capWord(m) + " — " + parts.join(", ");
    };
  }

  // A week of logged sets through the catalog. A set counts once for every muscle the
  // movement is for and half for every muscle it assists. The four bands are fixed,
  // not relative to the week, so a light week looks like a light week instead of being
  // stretched to fill the ramp.
  function weekHits(entries) {
    var prim = {}, sec = {}, mapped = 0, total = 0, fullBody = [];
    entries.forEach(function (e) {
      var n = (e.sets || []).length;
      if (!n) return;
      total++;
      var c = e.canonical_id && catalogMuscles ? catalogMuscles[e.canonical_id] : null;
      if (!c) return;
      mapped++;
      var nm = e.name || e.canonical_id;
      if (c.primary.indexOf("full body") >= 0 && fullBody.indexOf(nm) < 0) fullBody.push(nm);
      c.primary.forEach(function (m) { if (m !== "full body") prim[m] = (prim[m] || 0) + n; });
      c.secondary.forEach(function (m) { if (m !== "full body") sec[m] = (sec[m] || 0) + n; });
    });
    var levels = {};
    Object.keys(prim).concat(Object.keys(sec)).forEach(function (m) {
      var score = (prim[m] || 0) + (sec[m] || 0) * 0.5;
      levels[m] = score >= 14 ? 4 : score >= 8 ? 3 : score >= 4 ? 2 : score > 0 ? 1 : 0;
    });
    return { levels: levels, prim: prim, sec: sec, mapped: mapped, total: total, fullBody: fullBody };
  }

  function weekCaption(r) {
    return function (m) {
      var p = r.prim[m] || 0, s = r.sec[m] || 0;
      if (!p && !s) return capWord(m) + " — nothing logged for it this week.";
      if (!p) return capWord(m) + " — " + s + (s === 1 ? " set" : " sets") +
        " this week, all as a secondary muscle.";
      var t = capWord(m) + " — " + p + (p === 1 ? " set" : " sets") + " this week";
      if (s) t += ", " + s + " more as a secondary muscle";
      return t + ".";
    };
  }

  // The same sentence in both places: how many movements the catalog could not place,
  // and how many are full-body and so deliberately light nothing.
  function bodyNotes(box, r, noun) {
    if (r.mapped && r.mapped < r.total) {
      box.appendChild(el("div", "bodynote", (r.total - r.mapped) + " of " + r.total + " " +
        noun + " are not in the catalog and are not shown."));
    }
    if (r.fullBody.length) {
      box.appendChild(el("div", "bodynote", r.fullBody.length === 1
        ? r.fullBody[0] + " is a full-body movement — only what it leans on hardest is shaded."
        : r.fullBody.length + " full-body movements work everything — only what they lean on hardest is shaded."));
    }
  }

  function allExercises(w) {
    var out = [];
    (w.blocks || []).forEach(function (b) { (b.exercises || []).forEach(function (e) { out.push(e); }); });
    return out;
  }

  // ---------- AI helpers ----------

  var expCache = {};

  function explain(name, title) {
    $("explaintitle").textContent = name;
    $("explaintext").textContent = expCache[name] || "Thinking…";
    $("swapgo").onclick = function () { closeSheet("explainsheet"); openSwap(name, title); };
    openSheet("explainsheet");
    if (expCache[name]) return;
    api("explain", { method: "POST", body: JSON.stringify({ exercise: name, title: title || "" }) })
      .then(function (r) {
        var text = r.status === "ok" ? r.text : (r.message || "Could not load that.");
        expCache[name] = r.status === "ok" ? text : null;
        if ($("explaintitle").textContent === name) $("explaintext").textContent = text;
      }).catch(function () { $("explaintext").textContent = "Could not load that."; });
  }

  // ---------- swap or modify ----------
  //
  // Three reasons, one sheet. No equipment and station busy come back as
  // alternatives with an honest trade-off each; "it hurts" asks where, then
  // returns ways to modify the movement and what to build up — and the server,
  // not the model, writes the not-medical-advice line at the bottom.

  var SWAP_REASONS = [["no_equipment", "No equipment"], ["station_busy", "Station busy"], ["pain", "It hurts"]];
  var BODY_AREAS = ["shoulder", "elbow", "wrist", "neck", "upper back", "lower back", "hip", "knee", "ankle"];
  var swapCtx = null;

  function openSwap(name, title) {
    swapCtx = { name: name, title: title || "", reason: null, area: null, seq: 0 };
    $("swaptitle").textContent = "Instead of " + name;
    $("swapresult").innerHTML = "";
    renderSwapChips();
    openSheet("swapsheet");
  }

  function renderSwapChips() {
    var rs = $("swapreasons");
    rs.innerHTML = "";
    SWAP_REASONS.forEach(function (pair) {
      var b = el("button", "chip" + (swapCtx.reason === pair[0] ? " active" : ""), pair[1]);
      b.onclick = function () {
        swapCtx.reason = pair[0];
        swapCtx.area = null;
        $("swapresult").innerHTML = "";
        renderSwapChips();
        if (pair[0] !== "pain") runSwap();
      };
      rs.appendChild(b);
    });
    var as = $("swapareas");
    as.innerHTML = "";
    // Bodyweight swaps by default; listing what is to hand widens the catalog
    // candidates the server offers the model.
    $("swaphave").classList.toggle("hide", swapCtx.reason !== "no_equipment");
    if (swapCtx.reason === "pain") {
      as.classList.remove("hide");
      $("swaplede").textContent = "Where does it hurt? You get ways to modify the move and what to build up — not a diagnosis.";
      BODY_AREAS.forEach(function (a) {
        var b = el("button", "chip" + (swapCtx.area === a ? " active" : ""), a);
        b.onclick = function () { swapCtx.area = a; renderSwapChips(); runSwap(); };
        as.appendChild(b);
      });
    } else {
      as.classList.add("hide");
      $("swaplede").textContent = swapCtx.reason === "no_equipment"
        ? "Bodyweight swaps unless you say what you have."
        : "Why do you need something different?";
    }
  }

  function runSwap() {
    var ctx = swapCtx;
    if (!ctx || !ctx.reason || (ctx.reason === "pain" && !ctx.area)) return;
    var seq = ++ctx.seq;
    var box = $("swapresult");
    box.innerHTML = "";
    box.appendChild(el("div", "aitext", "Thinking…"));
    var have = ctx.reason === "no_equipment" ? $("swaphaveinput").value.trim().slice(0, 200) : "";
    api("swap", { method: "POST", body: JSON.stringify({
      exercise: ctx.name, reason: ctx.reason, body_area: ctx.area || "", title: ctx.title, equipment_have: have
    }) }).then(function (r) {
      if (swapCtx !== ctx || ctx.seq !== seq) return;   // a newer question superseded this one
      box.innerHTML = "";
      if (r.status !== "ok") { box.appendChild(el("div", "aitext", r.message || "Could not load that.")); return; }
      renderSwapResult(box, r);
    }).catch(function () {
      if (swapCtx !== ctx || ctx.seq !== seq) return;
      box.innerHTML = "";
      box.appendChild(el("div", "aitext", "Could not load that."));
    });
  }

  function swapItem(it, withTrade) {
    var d = el("div", "swapitem");
    var h = el("div");
    h.appendChild(el("b", null, it.name));
    if (it.in_catalog) h.appendChild(el("span", "tag", "in catalog"));
    d.appendChild(h);
    if (it.why) d.appendChild(el("div", "why", it.why));
    if (withTrade && it.tradeoff) d.appendChild(el("div", "trade", "Trade-off: " + it.tradeoff));
    return d;
  }

  function renderSwapResult(box, r) {
    if (r.summary) box.appendChild(el("div", "swapsummary", r.summary));
    if (r.reason === "pain") {
      if ((r.modifications || []).length) {
        var ms = el("div", "swapsect");
        ms.appendChild(el("h3", null, "Modify the movement"));
        r.modifications.forEach(function (m) {
          var d = el("div", "swapitem");
          d.appendChild(el("b", null, m.change));
          if (m.why) d.appendChild(el("div", "why", m.why));
          ms.appendChild(d);
        });
        box.appendChild(ms);
      }
      if ((r.strengthen || []).length) {
        var ss = el("div", "swapsect");
        ss.appendChild(el("h3", null, "Build it up over time"));
        r.strengthen.forEach(function (s) { ss.appendChild(swapItem(s, false)); });
        box.appendChild(ss);
      }
      if (r.stop_if) box.appendChild(el("div", "swapsummary", r.stop_if));
      box.appendChild(el("div", "swapnote", r.disclaimer ||
        "Not medical advice — if the pain is sharp, keeps coming back or gets worse, see a professional."));
      return;
    }
    if ((r.alternatives || []).length) {
      var al = el("div", "swapsect");
      al.appendChild(el("h3", null, "Try instead"));
      r.alternatives.forEach(function (a) { al.appendChild(swapItem(a, true)); });
      box.appendChild(al);
    } else if (!r.summary) {
      box.appendChild(el("div", "aitext", r.text || "Nothing came back — try again in a minute."));
    }
  }

  // ---------- workout mode ----------

  var wo = null;          // { workout, screens, i, entries, startedAt, wake }
  var woTimer = null;
  var restTimer = null;

  function flatten(w) {
    var screens = [];
    (w.blocks || []).forEach(function (b, bi) {
      (b.exercises || []).forEach(function (ex, ei) {
        screens.push({ block: b, bi: bi, ex: ex, ei: ei });
      });
    });
    return screens;
  }

  function draftKey() { return "spotter_draft"; }

  function saveDraft() {
    if (!wo) return;
    try {
      localStorage.setItem(draftKey(), JSON.stringify({
        workoutId: wo.workout.id, title: wo.workout.title,
        entries: wo.entries, startedAt: wo.startedAt, i: wo.i
      }));
    } catch (e) { /* private mode */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ }
  }

  function startWorkout(w, resume) {
    var screens = flatten(w);
    wo = {
      workout: w, screens: screens, i: (resume && resume.i) || 0,
      entries: (resume && resume.entries) || screens.map(function (s) {
        return {
          name: s.ex.name, canonical_id: s.ex.canonical_id || null,
          block: s.bi, exercise: s.ei, sets: []
        };
      }),
      startedAt: (resume && resume.startedAt) || new Date().toISOString(),
      wake: null
    };
    if (!wo.entries.length) {
      wo.entries = [{ name: "Freestyle", canonical_id: null, block: 0, exercise: 0, sets: [] }];
    }
    clearTimeout(woCloseTimer);
    $("workout").classList.remove("closing");
    $("workout").classList.add("open");
    acquireWake();
    renderWorkout();
    startClock();
    history.pushState({ workout: 1 }, "");
    lastWeights(w);
  }

  // The grouping key for "the same movement". The catalog id when the name mapped,
  // the raw name otherwise — so "DB Bulgarians" and "Bulgarian Split Squats" are one
  // exercise, while anything the catalog does not know keeps the old behaviour
  // instead of silently collapsing into some other movement. Prefixed so a canonical
  // id can never collide with a raw name that happens to look like one.
  function exKey(e) {
    if (!e) return "n:";
    return e.canonical_id ? "c:" + e.canonical_id : "n:" + (e.name || "");
  }

  // Prefill weight from the last time this user did the same movement.
  var lastWeight = {};
  function lastWeights(w) {
    sb.from("workout_logs").select("entries").order("started_at", { ascending: false }).limit(25)
      .then(function (r) {
        if (r.error || !r.data) return;
        r.data.forEach(function (log) {
          (log.entries || []).forEach(function (e) {
            if (!e.name) return;
            var k = exKey(e);
            if (lastWeight[k] !== undefined) return;
            var last = (e.sets || []).filter(function (s) { return s.weight; }).pop();
            if (last) lastWeight[k] = last.weight;
          });
        });
      });
  }

  function startClock() {
    clearInterval(woTimer);
    woTimer = setInterval(function () {
      if (!wo) return;
      var s = Math.floor((Date.now() - new Date(wo.startedAt).getTime()) / 1000);
      var m = Math.floor(s / 60);
      $("wclock").textContent = m + ":" + String(s % 60).padStart(2, "0");
    }, 1000);
  }

  function acquireWake() {
    if (!navigator.wakeLock || !wo) return;
    navigator.wakeLock.request("screen").then(function (l) {
      if (wo) wo.wake = l; else l.release();
    }).catch(function () { /* not fatal */ });
  }

  function releaseWake() {
    if (wo && wo.wake) { try { wo.wake.release(); } catch (e) { /* ignore */ } wo.wake = null; }
  }

  function renderWorkout() {
    if (!wo) return;
    var main = $("wmain"), dots = $("wdots");
    // The running rest belongs to the screen being replaced, and used to carry on
    // and announce a rest already left.
    clearInterval(restTimer);
    main.innerHTML = "";
    dots.innerHTML = "";

    var n = Math.max(wo.screens.length, 1);
    for (var k = 0; k < n; k++) {
      var dot = el("div", "wdot" + (k === wo.i ? " on" : ""));
      if (wo.entries[k] && wo.entries[k].sets.length) dot.classList.add("done");
      dots.appendChild(dot);
    }

    var s = wo.screens[wo.i];
    var entry = wo.entries[wo.i];

    if (!s) {
      main.appendChild(el("div", "wblock", "Freestyle"));
      main.appendChild(el("h2", "wname", wo.workout.title || "Workout"));
      main.appendChild(el("div", "wnote",
        "This video had no written exercises. Log what you do — tap the button below to add a set."));
      var addSet = el("button", "btn", "Log a set");
      addSet.style.marginTop = "22px";
      addSet.onclick = function () { openSetSheet(0); };
      main.appendChild(addSet);
      renderSetPills(main, entry, null);
      return;
    }

    var blockLabel = s.block.title || (s.block.type && s.block.type !== "straight" ? s.block.type : "Block " + (s.bi + 1));
    if (s.block.rounds) blockLabel += " · " + s.block.rounds + " rounds";
    main.appendChild(el("div", "wblock", blockLabel));
    main.appendChild(el("h2", "wname", s.ex.name));

    var dose = doseText(s.ex);
    if (dose) main.appendChild(el("div", "wdose", dose));
    if (s.ex.weight) main.appendChild(el("div", "wnote", "Suggested load: " + s.ex.weight));
    if (s.ex.notes) main.appendChild(el("div", "wnote", s.ex.notes));

    renderSetPills(main, entry, s.ex);

    var acts = el("div", "wactions");
    var help = el("button", "chip", "? How to do this");
    help.onclick = function () { explain(s.ex.name, wo.workout.title); };
    acts.appendChild(help);
    var swapChip = el("button", "chip", "⇄ Swap or modify");
    swapChip.onclick = function () { openSwap(s.ex.name, wo.workout.title); };
    acts.appendChild(swapChip);
    main.appendChild(acts);

    viewIn(main);
  }

  // Read once by the next render: the pill is rebuilt, not transitioned, so this
  // is what says the tap landed.
  var justSet = -1;

  function renderSetPills(main, entry, ex) {
    var target = ex && ex.sets ? ex.sets : Math.max(entry.sets.length + 1, 1);
    var pills = el("div", "setpills");
    var count = Math.max(target, entry.sets.length + (entry.sets.length >= target ? 1 : 0));
    var just = justSet;
    justSet = -1;
    for (var i = 0; i < count; i++) {
      (function (idx) {
        var done = entry.sets[idx];
        var p = el("button", "setpill" + (done ? " done" : "") + (idx === just ? " just" : ""));
        var b = el("b", null, done
          ? (done.reps + (done.weight ? " × " + done.weight : ""))
          : "Set " + (idx + 1));
        p.appendChild(b);
        p.appendChild(document.createTextNode(done
          ? (done.weight ? state.unit : "reps")
          : (ex && ex.reps ? ex.reps + " reps" : "tap to log")));
        p.onclick = function () { openSetSheet(idx); };
        pills.appendChild(p);
      })(i);
    }
    main.appendChild(pills);
  }

  var setCtx = { idx: 0, reps: 10, weight: 0 };

  function openSetSheet(idx) {
    if (!wo) return;
    var s = wo.screens[wo.i];
    var entry = wo.entries[wo.i];
    var existing = entry.sets[idx];
    var targetReps = 10;
    if (s && s.ex && s.ex.reps) {
      var m = String(s.ex.reps).match(/\d+/);
      if (m) targetReps = parseInt(m[0], 10);
    }
    setCtx.idx = idx;
    setCtx.reps = existing ? existing.reps : targetReps;
    setCtx.weight = existing ? existing.weight : (lastWeight[exKey(entry)] || 0);
    $("settitle").textContent = (s && s.ex ? s.ex.name : "Set") + " · set " + (idx + 1);
    $("wtunit").textContent = state.unit;
    drawStepper();
    openSheet("setsheet");
  }

  function drawStepper() {
    $("repsval").textContent = String(setCtx.reps);
    $("wtval").textContent = String(setCtx.weight);
  }

  function saveSet() {
    if (!wo) return;
    var entry = wo.entries[wo.i];
    entry.sets[setCtx.idx] = {
      reps: setCtx.reps, weight: setCtx.weight || null, unit: state.unit, done: true
    };
    saveDraft();
    closeSheet("setsheet");
    justSet = setCtx.idx;
    renderWorkout();
    var s = wo.screens[wo.i];
    if (s && s.ex && s.ex.rest_seconds) startRest(s.ex.rest_seconds);
  }

  // What is left of the rest, not a spin; off the clock, not its own ticks.
  function startRest(seconds) {
    clearInterval(restTimer);
    var main = $("wmain");
    var box = el("div", "resttimer");
    var ring = el("div", "ring");
    var label = el("span", null, "Rest " + seconds + "s");
    ring.style.setProperty("--rest", "1");
    box.appendChild(ring);
    box.appendChild(label);
    main.appendChild(box);
    var total = seconds * 1000;
    var until = Date.now() + total;
    restTimer = setInterval(function () {
      // Its screen is gone. Stop, and say nothing.
      if (!box.parentNode) { clearInterval(restTimer); return; }
      var left = until - Date.now();
      if (left <= 0) {
        clearInterval(restTimer);
        box.classList.add("gone");
        setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 240);
        toast("Rest done — next set.");
        return;
      }
      ring.style.setProperty("--rest", String(left / total));
      label.textContent = "Rest " + Math.ceil(left / 1000) + "s";
    }, 100);
  }

  function woGo(delta) {
    if (!wo) return;
    var next = wo.i + delta;
    if (next < 0 || next >= Math.max(wo.screens.length, 1)) return;
    wo.i = next;
    saveDraft();
    renderWorkout();
  }

  function finishWorkout() {
    if (!wo) return;
    var logged = wo.entries.filter(function (e) { return e.sets.length; });
    var payload = {
      user_id: state.user.id,
      workout_id: wo.workout.id,
      workout_title: wo.workout.title,
      started_at: wo.startedAt,
      completed_at: new Date().toISOString(),
      duration_seconds: Math.round((Date.now() - new Date(wo.startedAt).getTime()) / 1000),
      entries: logged
    };
    var hadSets = logged.length > 0;
    exitWorkout();
    // Workout mode and the detail page each pushed a history entry; finishing should
    // land back in the library, not on the detail page under the closed overlay.
    var openedFromDetail = $("detail").classList.contains("open");
    history.go(openedFromDetail ? -2 : -1);
    if (!hadSets) { toast("Workout closed — nothing logged."); return; }
    sb.from("workout_logs").insert(payload).then(function (r) {
      if (r.error) { toast("Could not save that session."); return; }
      state.logs = null;
      toast("Session logged 💪");
    });
  }

  var woCloseTimer = null;

  function exitWorkout() {
    clearInterval(woTimer);
    clearInterval(restTimer);
    releaseWake();
    clearDraft();
    wo = null;
    var n = $("workout");
    if (!n.classList.contains("open")) return;
    n.classList.remove("open");
    n.classList.add("closing");
    clearTimeout(woCloseTimer);
    woCloseTimer = setTimeout(function () { n.classList.remove("closing"); }, 260);
  }

  function offerResume() {
    var raw = null;
    try { raw = localStorage.getItem(draftKey()); } catch (e) { return; }
    if (!raw) return;
    var d;
    try { d = JSON.parse(raw); } catch (e) { clearDraft(); return; }
    var w = state.workouts.filter(function (x) { return x.id === d.workoutId; })[0];
    if (!w) { clearDraft(); return; }
    var any = (d.entries || []).some(function (e) { return e.sets && e.sets.length; });
    if (!any) { clearDraft(); return; }
    toast("Tap to resume " + (d.title || "your workout"));
    // #toast is pointer-events: none, so this said "tap to resume" untappably.
    var t = $("toast");
    t.classList.add("tappable");
    t.onclick = function () {
      t.onclick = null;
      t.classList.remove("tappable");
      t.classList.remove("show");
      startWorkout(w, d);
    };
  }

  // ---------- plan ----------

  function mondayOf(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    var day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d;
  }

  function ymd(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function loadPlan() {
    if (!state.weekStart) state.weekStart = mondayOf(new Date());
    var start = ymd(state.weekStart);
    var endD = new Date(state.weekStart);
    endD.setDate(endD.getDate() + 6);
    return Promise.all([
      sb.from("plan").select("*").gte("day", start).lte("day", ymd(endD)),
      sb.from("workout_logs").select("id,started_at").gte("started_at", start + "T00:00:00Z")
    ]).then(function (rs) {
      state.plan = rs[0].data || [];
      state.planLogs = rs[1].data || [];
      renderPlan();
    });
  }

  function renderPlan() {
    var v = $("planview");
    v.innerHTML = "";
    var bar = el("div", "weekbar");
    var prev = el("button", "iconbtn", "←");
    prev.onclick = function () {
      state.weekStart = new Date(state.weekStart.getTime() - 7 * 86400000);
      loadPlan();
    };
    var endD = new Date(state.weekStart);
    endD.setDate(endD.getDate() + 6);
    var fmt = { month: "short", day: "numeric" };
    bar.appendChild(prev);
    bar.appendChild(el("b", null,
      state.weekStart.toLocaleDateString(undefined, fmt) + " – " + endD.toLocaleDateString(undefined, fmt)));
    var next = el("button", "iconbtn", "→");
    next.onclick = function () {
      state.weekStart = new Date(state.weekStart.getTime() + 7 * 86400000);
      loadPlan();
    };
    bar.appendChild(next);
    v.appendChild(bar);

    var names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    var todayStr = ymd(new Date());
    var planned = 0, done = 0;

    for (var i = 0; i < 7; i++) {
      (function (i) {
        var d = new Date(state.weekStart.getTime() + i * 86400000);
        var key = ymd(d);
        var card = el("div", "daycard" + (key === todayStr ? " today" : ""));
        var head = el("div", "dayhead");
        head.appendChild(el("div", "dayname", names[i] + " " + d.getDate()));
        var didLog = (state.planLogs || []).some(function (l) {
          return l.started_at && l.started_at.slice(0, 10) === key;
        });
        if (didLog) { head.appendChild(el("div", "daydone", "✓ done")); done++; }
        card.appendChild(head);

        var rows = (state.plan || []).filter(function (p) { return p.day === key; });
        planned += rows.length;
        rows.forEach(function (p) {
          var w = state.workouts.filter(function (x) { return x.id === p.workout_id; })[0];
          if (!w) return;
          var item = el("div", "planitem");
          if (w.thumb_url) {
            var img = el("img");
            img.src = w.thumb_url;
            img.alt = "";
            item.appendChild(img);
          }
          var t = el("div", "pt", w.title || "Workout");
          t.onclick = function () { openDetail(w); };
          item.appendChild(t);
          var x = el("button", "planx", "✕");
          x.onclick = function () {
            sb.from("plan").delete().eq("id", p.id).then(function () { loadPlan(); });
          };
          item.appendChild(x);
          card.appendChild(item);
        });

        var add = el("button", "planadd", "+ Add a workout");
        add.onclick = function () { openPicker(key); };
        card.appendChild(add);
        v.appendChild(card);
      })(i);
    }

    var summary = el("div", "count", planned + " planned · " + done + " done this week");
    summary.style.textAlign = "center";
    summary.style.marginTop = "14px";
    v.appendChild(summary);
    viewIn(v);
  }

  function openPicker(day) {
    var list = $("picklist");
    list.innerHTML = "";
    $("picktitle").textContent = "Add to " + day;
    if (!state.workouts.length) {
      list.appendChild(el("p", "lede", "Save a workout first, then you can plan it."));
    }
    state.workouts.forEach(function (w) {
      var row = el("button", "pickrow");
      if (w.thumb_url) {
        var img = el("img");
        img.src = w.thumb_url;
        img.alt = "";
        row.appendChild(img);
      }
      var t = el("div", "pt");
      t.appendChild(el("b", null, w.title || "Workout"));
      t.appendChild(el("span", null, [w.category, fmtDur(w.duration_minutes)].filter(Boolean).join(" · ")));
      row.appendChild(t);
      row.onclick = function () {
        sb.from("plan").insert({ user_id: state.user.id, day: day, workout_id: w.id })
          .then(function (r) {
            closeSheet("picksheet");
            if (r.error) { toast("Could not add that."); return; }
            loadPlan();
          });
      };
      list.appendChild(row);
    });
    openSheet("picksheet");
  }

  // ---------- logs, progress, history ----------

  function loadLogs() {
    if (state.logs) return Promise.resolve(state.logs);
    var since = new Date(Date.now() - 182 * 86400000).toISOString();
    return sb.from("workout_logs").select("*").gte("started_at", since)
      .order("started_at", { ascending: false }).limit(400)
      .then(function (r) {
        state.logs = r.data || [];
        return state.logs;
      });
  }

  function volumeOf(log) {
    var v = 0;
    (log.entries || []).forEach(function (e) {
      (e.sets || []).forEach(function (s) {
        if (s.reps && s.weight) v += s.reps * s.weight;
      });
    });
    return v;
  }

  function weekKey(iso) {
    return ymd(mondayOf(new Date(iso)));
  }

  function renderProgress() {
    var v = $("progressview");
    v.innerHTML = "";
    var logs = state.logs || [];

    if (!logs.length) {
      var e = el("div", "empty");
      e.appendChild(el("div", "big", "📈"));
      e.appendChild(el("h2", null, "No sessions yet"));
      e.appendChild(el("p", null, "Finish a workout and your volume, personal records and every logged session show up here."));
      v.appendChild(e);
      viewIn(v);
      return;
    }

    // stat row: streak of consecutive weeks with at least one session
    var weeks = {};
    logs.forEach(function (l) { weeks[weekKey(l.started_at)] = true; });
    var streak = 0;
    var cursor = mondayOf(new Date());
    while (weeks[ymd(cursor)]) {
      streak++;
      cursor = new Date(cursor.getTime() - 7 * 86400000);
    }
    var thisWeek = logs.filter(function (l) {
      return weekKey(l.started_at) === ymd(mondayOf(new Date()));
    }).length;

    var row = el("div", "statrow");
    [[String(streak), streak === 1 ? "Week streak" : "Week streak"],
     [String(thisWeek), "This week"],
     [String(logs.length), "Sessions"]].forEach(function (s) {
      var c = el("div", "stat");
      c.appendChild(el("div", "v", s[0]));
      c.appendChild(el("div", "k", s[1]));
      row.appendChild(c);
    });
    v.appendChild(row);

    // What you've hit this week, from the sessions actually logged: each logged
    // entry carries the canonical_id it was started with, and the catalog says
    // which muscles that is. Intensity is sets — full for a muscle the movement is
    // for, half for one it assists — against fixed bands, so a light week reads as
    // a light week instead of being stretched to fill the ramp.
    var monday = ymd(mondayOf(new Date()));
    var weekLogs = logs.filter(function (l) { return weekKey(l.started_at) === monday; });
    var hit = el("div", "chartcard");
    hit.appendChild(el("h3", null, "What you've hit this week"));
    var hitSlot = el("div");
    hit.appendChild(hitSlot);
    v.appendChild(hit);
    loadCatalog().then(function () {
      if (state.view !== "progress") return;
      var entries = [];
      weekLogs.forEach(function (l) { (l.entries || []).forEach(function (e) { entries.push(e); }); });
      var r = weekHits(entries);
      hitSlot.innerHTML = "";
      hitSlot.appendChild(bodyMap(r.levels, 4, bodyLegend([
        { lv: [0], text: "Not trained" },
        { lv: [1, 2, 3, 4], text: "Fewer to more sets" }
      ]), weekCaption(r)));
      if (!r.mapped) {
        hitSlot.appendChild(el("div", "bodynote", weekLogs.length
          ? "This week's logged exercises are not in the catalog, so nothing is highlighted."
          : "Nothing logged this week yet."));
      }
      bodyNotes(hitSlot, r, "logged exercises");
    });

    // weekly volume bars, last 8 weeks
    var buckets = [];
    var start = mondayOf(new Date());
    for (var i = 7; i >= 0; i--) {
      var wk = new Date(start.getTime() - i * 7 * 86400000);
      buckets.push({ key: ymd(wk), label: (wk.getMonth() + 1) + "/" + wk.getDate(), v: 0 });
    }
    logs.forEach(function (l) {
      var k = weekKey(l.started_at);
      for (var i = 0; i < buckets.length; i++) {
        if (buckets[i].key === k) { buckets[i].v += volumeOf(l); break; }
      }
    });
    var max = Math.max.apply(null, buckets.map(function (b) { return b.v; }).concat([1]));

    if (max > 1) {
      var card = el("div", "chartcard");
      card.appendChild(el("h3", null, "Weekly volume (" + state.unit + ")"));
      var W = 320, H = 120, pad = 16, bw = (W - pad * 2) / buckets.length;
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + (H + 22));
      svg.setAttribute("role", "img");
      buckets.forEach(function (b, i) {
        var h = Math.max(2, Math.round((b.v / max) * H));
        var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("class", "bar" + (b.v ? "" : " dim"));
        r.setAttribute("x", String(pad + i * bw + bw * 0.18));
        r.setAttribute("y", String(H - h));
        r.setAttribute("width", String(bw * 0.64));
        r.setAttribute("height", String(h));
        r.setAttribute("rx", "3");
        svg.appendChild(r);
        var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("class", "axis");
        t.setAttribute("x", String(pad + i * bw + bw * 0.5));
        t.setAttribute("y", String(H + 15));
        t.setAttribute("text-anchor", "middle");
        t.textContent = b.label;
        svg.appendChild(t);
      });
      card.appendChild(svg);
      v.appendChild(card);
    }

    // Personal records, by estimated 1RM (Epley). Grouped by catalog id where the
    // exercise name mapped, so a PR does not fragment across three spellings of the
    // same lift; the label keeps the most recent raw name the user actually saw.
    var prs = {};
    logs.forEach(function (l) {
      (l.entries || []).forEach(function (e) {
        var k = exKey(e);
        (e.sets || []).forEach(function (s) {
          if (!s.reps || !s.weight) return;
          var est = s.weight * (1 + s.reps / 30);
          if (!prs[k]) prs[k] = { est: 0, label: e.name || "Exercise" };
          if (est > prs[k].est) {
            prs[k].est = est;
            prs[k].weight = s.weight;
            prs[k].reps = s.reps;
            prs[k].date = l.started_at;
          }
        });
      });
    });
    var prKeys = Object.keys(prs).sort(function (a, b) { return prs[b].est - prs[a].est; }).slice(0, 12);
    if (prKeys.length) {
      var pc = el("div", "chartcard");
      pc.appendChild(el("h3", null, "Personal records"));
      prKeys.forEach(function (n) {
        var p = prs[n];
        var r = el("div", "prrow");
        var nm = el("div", "n");
        nm.appendChild(document.createTextNode(p.label));
        nm.appendChild(el("span", null,
          p.weight + " " + state.unit + " × " + p.reps + " · " +
          new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })));
        r.appendChild(nm);
        r.appendChild(el("div", "v", Math.round(p.est) + " " + state.unit));
        pc.appendChild(r);
      });
      v.appendChild(pc);
    }

    // muscle-group distribution, joined through the saved workout
    var byId = {};
    state.workouts.forEach(function (w) { byId[w.id] = w; });
    var mg = {};
    logs.forEach(function (l) {
      var w = byId[l.workout_id];
      if (!w) return;
      (w.muscle_groups || []).forEach(function (m) { mg[m] = (mg[m] || 0) + 1; });
    });
    var mgNames = Object.keys(mg).sort(function (a, b) { return mg[b] - mg[a]; });
    if (mgNames.length) {
      var mc = el("div", "chartcard");
      mc.appendChild(el("h3", null, "What you train"));
      var mgMax = mg[mgNames[0]];
      mgNames.forEach(function (m) {
        var r = el("div", "mgrow");
        r.appendChild(el("div", "lbl", m));
        var bar = el("div", "mgbar");
        var fill = el("i");
        fill.style.width = Math.round((mg[m] / mgMax) * 100) + "%";
        bar.appendChild(fill);
        r.appendChild(bar);
        r.appendChild(el("div", "num", String(mg[m])));
        mc.appendChild(r);
      });
      v.appendChild(mc);
    }

    // The session list, under the numbers it feeds. One tab, one scroll.
    renderHistoryInto(v, logs);
    viewIn(v);
  }

  function renderHistoryInto(v, logs) {
    var head = el("div", "monthhead", "History");
    head.style.marginTop = "26px";
    head.style.color = "var(--ember-ink)";
    v.appendChild(head);
    var month = "";
    logs.forEach(function (l) {
      var d = new Date(l.started_at);
      var mk = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      if (mk !== month) { month = mk; v.appendChild(el("div", "monthhead", mk)); }
      var card = el("div", "chartcard");
      card.style.padding = "14px 16px";
      var row = el("div", "histrow");
      var n = el("div", "n");
      n.appendChild(document.createTextNode(l.workout_title || "Workout"));
      var sets = 0;
      (l.entries || []).forEach(function (e) { sets += (e.sets || []).length; });
      n.appendChild(el("span", null,
        d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
        " · " + sets + (sets === 1 ? " set" : " sets") +
        (l.duration_seconds ? " · " + Math.round(l.duration_seconds / 60) + " min" : "")));
      row.appendChild(n);
      var vol = volumeOf(l);
      if (vol) row.appendChild(el("div", "v", Math.round(vol) + " " + state.unit));
      card.appendChild(row);

      (l.entries || []).forEach(function (e) {
        if (!(e.sets || []).length) return;
        var er = el("div", "histrow");
        var en = el("div", "n");
        en.appendChild(document.createTextNode(e.name));
        en.appendChild(el("span", null, e.sets.map(function (s) {
          return s.reps + (s.weight ? "×" + s.weight : "");
        }).join("  ")));
        er.appendChild(en);
        card.appendChild(er);
      });

      var del = el("button", "danger", "Delete session");
      del.onclick = function () {
        armed(del, "Tap again to delete", function () {
          sb.from("workout_logs").delete().eq("id", l.id).then(function () {
            state.logs = null;
            loadLogs().then(renderProgress);
          });
        });
      };
      card.appendChild(del);
      v.appendChild(card);
    });
  }

  // ---------- Pumpy ----------
  //
  // The coach. Everything Pumpy knows comes from server-side tools that only see
  // this user's rows, and every write comes back as a proposal card that is
  // confirmed here before anything is saved. The mark below is a PLACEHOLDER:
  // swap PUMPY_MARK for the real art and every avatar, tab icon and card follows.

  var PUMPY_MARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8.6 8.4a3.4 3.4 0 0 1 6.8 0"/>' +
    '<circle cx="12" cy="14.2" r="6.3"/>' +
    '<path d="M9.7 13.3h.01M14.3 13.3h.01"/>' +
    '<path d="M9.8 16.2c.7.9 1.5 1.3 2.2 1.3s1.5-.4 2.2-1.3"/>' +
    '</svg>';

  function pumpyMark(cls) {
    var s = el("span", cls || "pmark");
    s.innerHTML = PUMPY_MARK;   // constant markup, nothing user-supplied
    return s;
  }

  var pumpy = { thread: null, messages: [], busy: false, ctx: null, loaded: false,
    meter: null, meterAsked: false };

  // Short enough to wrap into a chip on a phone, long enough to still be a real ask.
  var QUICK_ASKS = [
    "Build a 25-min kettlebell shoulders + core",
    "Plan my week from what I've saved",
    "Add a finisher to my leg day",
    "Shoulder pain — what should I strengthen?"
  ];

  // A keyboard sends on Enter; a phone keyboard's return key must still make a
  // new line, so only ask for that where there is no touch screen.
  var NO_TOUCH = !("ontouchstart" in window) && !(navigator.maxTouchPoints > 0);

  function openPumpy(w) {
    if (w) pumpy.ctx = { id: w.id, title: w.title || "Workout" };
    setView("pumpy");
  }

  // The tab is a column between the sticky header and the fixed tab bar. Both
  // heights are read off the live layout rather than guessed: the header grows
  // with the safe area, the tab bar with the home indicator, and the install hint
  // can sit above the view. Written as custom properties so the CSS can do the
  // arithmetic, including on the body's bottom padding, which is what decides
  // where the page ends when the thread is long.
  function sizePumpy() {
    var v = $("pumpyview");
    if (!v || !v.classList.contains("open")) return;
    var scrolled = window.scrollY || window.pageYOffset || 0;
    var top = Math.max(0, Math.round(v.getBoundingClientRect().top + scrolled));
    var bar = document.querySelector(".tabbar");
    var tab = bar ? Math.round(bar.getBoundingClientRect().height) : 78;
    var root = document.documentElement;
    root.style.setProperty("--pumpytop", top + "px");
    root.style.setProperty("--ptab", tab + "px");
  }

  function loadPumpy() {
    ensurePumpyMeter();
    if (pumpy.loaded) { renderPumpy(); return; }
    sb.from("pumpy_threads").select("*").order("updated_at", { ascending: false }).limit(1).then(function (r) {
      var t = r.data && r.data[0];
      if (!t) { pumpy.loaded = true; renderPumpy(); return; }
      pumpy.thread = t;
      return sb.from("pumpy_messages").select("*").eq("thread_id", t.id).order("id", { ascending: true }).limit(80)
        .then(function (m) { pumpy.messages = m.data || []; pumpy.loaded = true; renderPumpy(); });
    });
  }

  function newPumpyThread() {
    pumpy.thread = null;
    pumpy.messages = [];
    pumpy.ctx = null;
    pumpy.loaded = true;
    pumpy.shownCount = 0;
    renderPumpy();
  }

  // ---------- Pumpy · the thread list ----------

  function agoText(iso) {
    var t = Date.parse(iso || "");
    if (!t) return "";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    if (s < 7 * 86400) return Math.round(s / 86400) + "d ago";
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function openPumpyThreads() {
    var list = $("pumpythreads");
    list.innerHTML = "";
    list.appendChild(el("div", "threadnone", "Loading…"));
    openSheet("pumpysheet");
    sb.from("pumpy_threads")
      .select("id,title,updated_at,workout_id,workouts(title)")
      .order("updated_at", { ascending: false }).limit(50)
      .then(function (r) { renderThreads((r && r.data) || []); })
      .catch(function () {
        list.innerHTML = "";
        list.appendChild(el("div", "threadnone", "Could not load your chats."));
      });
  }

  function renderThreads(rows) {
    var list = $("pumpythreads");
    list.innerHTML = "";
    if (!rows.length) {
      list.appendChild(el("div", "threadnone",
        "No chats yet. Ask Pumpy something and it will keep the conversation here."));
      return;
    }
    rows.forEach(function (t) {
      var open = pumpy.thread && pumpy.thread.id === t.id;
      var row = el("div", "threadrow" + (open ? " on" : ""));
      var main = el("button", "tmain");
      main.appendChild(el("b", null, t.title || "New chat"));
      var bits = [];
      if (agoText(t.updated_at)) bits.push(agoText(t.updated_at));
      if (t.workout_id) bits.push("About " + ((t.workouts && t.workouts.title) || "a workout"));
      if (open) bits.push("Open");
      main.appendChild(el("span", null, bits.join(" · ")));
      main.onclick = function () { openThread(t); };
      row.appendChild(main);

      var del = el("button", "tdel", "Delete");
      del.setAttribute("aria-label", "Delete this chat");
      del.onclick = function () {
        armed(del, "Delete?", function () {
          sb.from("pumpy_threads").delete().eq("id", t.id).then(function (r) {
            if (r && r.error) { toast("Could not delete that chat."); return; }
            row.parentNode && row.parentNode.removeChild(row);
            if (pumpy.thread && pumpy.thread.id === t.id) newPumpyThread();
            if (!list.querySelector(".threadrow")) renderThreads([]);
          });
        });
      };
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function openThread(t) {
    closeSheet("pumpysheet");
    pumpy.thread = { id: t.id, title: t.title, updated_at: t.updated_at, workout_id: t.workout_id };
    pumpy.messages = [];
    pumpy.loaded = true;
    pumpy.shownCount = 0;
    // The thread already knows which card it was opened from; say so, so the
    // context line matches the row the user just tapped.
    pumpy.ctx = t.workout_id
      ? { id: t.workout_id, title: (t.workouts && t.workouts.title) || "Workout" }
      : null;
    renderPumpy();
    sb.from("pumpy_messages").select("*").eq("thread_id", t.id).order("id", { ascending: true }).limit(80)
      .then(function (m) {
        if (!pumpy.thread || pumpy.thread.id !== t.id) return;   // switched again while loading
        pumpy.messages = (m && m.data) || [];
        renderPumpy();
      });
  }

  // ---------- Pumpy · credits ----------
  //
  // The meter is whatever the server last said, and every field of it is
  // optional: until the backend ships this block, r.pumpy is simply absent and
  // nothing new appears anywhere.

  function ensurePumpyMeter() {
    if (pumpy.meterAsked) return;
    pumpy.meterAsked = true;
    api("limits", { method: "GET" })
      .then(function (r) { absorbMeter(r && r.pumpy); })
      .catch(function () { /* the tab works fine without it */ });
  }

  function absorbMeter(p) {
    if (!p || typeof p !== "object") return;
    pumpy.meter = p;
    renderPumpyCredits();
    renderSettingsMeter();
  }

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  // {used, cap} where cap may be null for unlimited, or the whole thing may be junk.
  function bucket(b) {
    if (!b || typeof b !== "object") return null;
    var used = num(b.used);
    if (used === null) return null;
    var cap = num(b.cap);
    return { used: used, cap: cap, left: cap === null ? null : Math.max(0, cap - used) };
  }

  function countText(b, tail) {
    if (b.cap === null) return "unlimited " + tail;
    return b.used.toLocaleString() + " of " + b.cap.toLocaleString() + " " + tail;
  }

  function renderSettingsMeter() {
    var n = $("setpumpy");
    if (!n) return;
    var p = pumpy.meter;
    var day = p && bucket(p.day);
    var month = p && bucket(p.month);
    if (!p || (!day && !month)) { n.textContent = ""; n.classList.add("hide"); return; }
    var bits = ["Pumpy"];
    if (typeof p.plan === "string" && p.plan) {
      bits.push(p.plan.charAt(0).toUpperCase() + p.plan.slice(1) + " plan");
    }
    if (day) bits.push(countText(day, "credits today"));
    if (month) bits.push(countText(month, "this month"));
    n.textContent = bits.join(" · ");
    n.classList.remove("hide");
  }

  // Only speaks up when the tank is nearly empty — under a fifth of either cap.
  function renderPumpyCredits() {
    var n = $("pumpycredits");
    if (!n) return;
    var p = pumpy.meter;
    var day = p && bucket(p.day);
    var month = p && bucket(p.month);
    var low = null;
    if (day && day.cap > 0 && day.left < day.cap * 0.2) {
      low = day.left.toLocaleString() + " credit" + (day.left === 1 ? "" : "s") +
        " left today · resets at midnight UTC";
    } else if (month && month.cap > 0 && month.left < month.cap * 0.2) {
      low = month.left.toLocaleString() + " left this month · resets on the 1st";
    }
    if (!low) { n.textContent = ""; n.classList.add("hide"); return; }
    n.textContent = low;
    n.classList.remove("hide");
  }

  function renderPumpy() {
    var log = $("pumpylog");
    log.innerHTML = "";
    var shown = pumpy.messages.filter(function (m) { return m.role === "user" || m.role === "assistant"; });
    // With nothing said yet the log is empty space, so the greeting sits in the
    // middle of it rather than clinging to the top.
    log.classList.toggle("hello", !shown.length);
    if (!shown.length) {
      var hello = el("div", "pumpyhello");
      hello.appendChild(pumpyMark("pmark"));
      hello.appendChild(el("h2", null, "Hey, I'm Pumpy"));
      hello.appendChild(el("p", null,
        "I know what you've saved. Ask me to build a workout from it, add to one, or plan your week. " +
        "I'll show you before I change anything."));
      var q = el("div", "quick");
      QUICK_ASKS.forEach(function (t) {
        var c = el("button", "chip", t);
        c.onclick = function () { sendPumpy(t); };
        q.appendChild(c);
      });
      hello.appendChild(q);
      log.appendChild(hello);
    }
    // The thread is rebuilt every render; animating every bubble would replay it.
    var before = pumpy.shownCount || 0;
    shown.forEach(function (m, i) {
      var node = renderMsg(m);
      if (before && i >= before) node.classList.add("msgin");
      log.appendChild(node);
    });
    pumpy.shownCount = shown.length;
    if (pumpy.busy) {
      var row = el("div", "msgrow msgin");
      row.appendChild(pumpyMark("pmark"));
      row.appendChild(el("div", "msg pumpy typing", "•••"));
      log.appendChild(row);
    }
    renderPumpyCtx();
    renderPumpyCredits();
    $("pumpysend").disabled = !!pumpy.busy;
    sizePumpy();
    if (shown.length || pumpy.busy) window.scrollTo(0, document.body.scrollHeight);
  }

  function renderMsg(m) {
    if (m.role === "user") return el("div", "msg me", m.content || "");
    var row = el("div", "msgrow");
    row.appendChild(pumpyMark("pmark"));
    var col = el("div", "msgcol");
    if (m.content) col.appendChild(el("div", "msg pumpy", m.content));
    var p = m.meta && m.meta.proposal;
    if (p) col.appendChild(renderProposal(m, p));
    row.appendChild(col);
    return row;
  }

  function proposalLine(name, dose) {
    var l = el("div", "pline");
    l.appendChild(el("b", null, name));
    if (dose) l.appendChild(document.createTextNode(" — " + dose));
    return l;
  }

  function renderProposal(m, p) {
    var card = el("div", "proposal");
    card.appendChild(el("h4", null, p.kind === "create_workout" ? "New workout"
      : (p.kind === "append_exercises" ? "Add to a workout" : "Plan")));
    if (p.kind === "create_workout") {
      card.appendChild(el("div", "ptitle", p.title));
      var meta = [p.category, fmtDur(p.duration_minutes), (p.equipment || []).join(", ")].filter(Boolean).join(" · ");
      if (meta) card.appendChild(el("div", "pmeta", meta));
      (p.blocks || []).forEach(function (b) {
        var label = [b.title, b.type && b.type !== "straight" ? b.type : null, b.rounds ? b.rounds + " rounds" : null]
          .filter(Boolean).join(" · ");
        if (label) card.appendChild(el("div", "pblock", label));
        (b.exercises || []).forEach(function (e) { card.appendChild(proposalLine(e.name, doseText(e))); });
      });
    } else if (p.kind === "append_exercises") {
      card.appendChild(el("div", "ptitle", p.workout_title || "Workout"));
      if (p.block_title) card.appendChild(el("div", "pmeta", p.block_title));
      (p.exercises || []).forEach(function (e) { card.appendChild(proposalLine(e.name, doseText(e))); });
    } else if (p.kind === "plan_days") {
      (p.days || []).forEach(function (d) {
        var dt = new Date(d.day + "T12:00:00");
        card.appendChild(proposalLine(dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
          d.workout_title || d.workout_id));
      });
    }
    var status = m.meta.status;
    if (status === "pending") {
      var row = el("div", "btnrow");
      var no = el("button", "btn ghost", "Not now");
      var yes = el("button", "btn", p.kind === "create_workout" ? "Save it" : (p.kind === "plan_days" ? "Plan it" : "Add them"));
      no.onclick = function () { confirmPumpy(m, false, no, yes); };
      yes.onclick = function () { confirmPumpy(m, true, no, yes); };
      row.appendChild(no);
      row.appendChild(yes);
      card.appendChild(row);
    } else if (status === "done") {
      card.appendChild(el("div", "done", "✓ Done"));
    } else {
      card.appendChild(el("div", "declined", "Skipped"));
    }
    return card;
  }

  function renderPumpyCtx() {
    var c = $("pumpyctx");
    c.innerHTML = "";
    if (!pumpy.ctx) { c.classList.add("hide"); return; }
    c.classList.remove("hide");
    c.appendChild(document.createTextNode("About "));
    c.appendChild(el("b", null, pumpy.ctx.title));
    var x = el("button", null, "×");
    x.setAttribute("aria-label", "Stop talking about this workout");
    x.onclick = function () { pumpy.ctx = null; renderPumpyCtx(); };
    c.appendChild(x);
  }

  function sendPumpy(text) {
    text = String(text || $("pumpyinput").value || "").trim();
    if (!text || pumpy.busy) return;
    var box = $("pumpyinput");
    box.value = "";
    box.style.height = "auto";
    if (NO_TOUCH) box.focus();
    pumpy.busy = true;
    pumpy.messages.push({ id: "local-" + Date.now(), role: "user", content: text });
    renderPumpy();
    var payload = {
      thread_id: pumpy.thread ? pumpy.thread.id : null,
      message: text,
      workout_id: pumpy.ctx ? pumpy.ctx.id : null
    };
    api("pumpy/chat", { method: "POST", body: JSON.stringify(payload) }).then(function (r) {
      pumpy.busy = false;
      // Every answer carries the meter, the refusal at the cap most of all.
      absorbMeter(r && r.pumpy);
      pumpy.messages = pumpy.messages.filter(function (m) { return String(m.id).indexOf("local-") !== 0; });
      if (r.status !== "ok") {
        // The ceiling and the outage both come back as something Pumpy says.
        pumpy.messages.push({ id: "local-err-" + Date.now(), role: "user", content: text });
        pumpy.messages.push({ id: "local-err2-" + Date.now(), role: "assistant", content: r.message || "Something went wrong — try again." });
        renderPumpy();
        return;
      }
      if (!pumpy.thread || pumpy.thread.id !== r.thread_id) pumpy.thread = { id: r.thread_id };
      if (r.user_message) pumpy.messages.push(r.user_message);
      (r.messages || []).forEach(function (m) { pumpy.messages.push(m); });
      renderPumpy();
    }).catch(function () {
      pumpy.busy = false;
      pumpy.messages.push({ id: "local-err-" + Date.now(), role: "assistant", content: "I couldn't reach Spotter — check your connection." });
      renderPumpy();
    });
  }

  function confirmPumpy(m, accept, noBtn, yesBtn) {
    noBtn.disabled = true;
    yesBtn.disabled = true;
    if (accept) yesBtn.textContent = "Saving…";
    api("pumpy/confirm", { method: "POST", body: JSON.stringify({ thread_id: pumpy.thread.id, message_id: m.id, accept: accept }) })
      .then(function (r) {
        if (r.status !== "ok") {
          toast(r.message || "Could not do that.");
          noBtn.disabled = false; yesBtn.disabled = false;
          return;
        }
        m.meta.status = accept ? "done" : "declined";
        (r.messages || []).forEach(function (x) { pumpy.messages.push(x); });
        if (r.workout) {
          if (r.created) state.workouts.unshift(r.workout);
          else absorbWorkout(r.workout);
        }
        if (r.plan) state.plan = null;
        renderPumpy();
      }).catch(function () {
        toast("Could not reach Spotter — check your connection.");
        noBtn.disabled = false; yesBtn.disabled = false;
      });
  }

  // ---------- sheets ----------
  //
  // Closing was one frame of display:none. "open" drops when a close begins, not
  // when it ends: every overlayShowing() and popstate test asks about it.

  var closeTimers = {};

  function openSheet(id) {
    var n = $(id);
    clearTimeout(closeTimers[id]);
    n.classList.remove("closing");
    n.classList.add("open");
  }

  function closeSheet(id) {
    var n = $(id);
    if (!n.classList.contains("open")) return;
    n.classList.remove("open");
    n.classList.add("closing");
    clearTimeout(closeTimers[id]);
    // A timer, not animationend: a sheet reopened mid-close never fires one.
    closeTimers[id] = setTimeout(function () { n.classList.remove("closing"); }, 260);
  }

  ["addsheet", "setsheet", "exsheet", "exeditsheet", "explainsheet", "picksheet", "settingssheet",
   "colsheet", "renamesheet", "swapsheet", "pumpysheet", "capsheet"]
    .forEach(function (id) {
      $(id).addEventListener("click", function (e) { if (e.target === $(id)) closeSheet(id); });
    });

  function overlayShowing() {
    if ($("detail").classList.contains("open")) return true;
    if ($("workout").classList.contains("open")) return true;
    var sheets = document.querySelectorAll(".sheet.open");
    return sheets.length > 0;
  }

  // ---------- add ----------

  /**
   * The row the user sees the instant a save is accepted, before the worker has
   * put anything in it. Shared by the link path and the upload path so both land
   * in the library the same way and Realtime fills either one in.
   */
  function placePending(r, url, platform) {
    var known = false;
    for (var i = 0; i < state.workouts.length; i++) {
      if (state.workouts[i].id === r.id) { known = true; break; }
    }
    if (!known) {
      state.workouts.unshift({
        id: r.id, url: url, platform: platform || null,
        title: r.title || (platform === "upload" ? "Listening to the video…" : "Reading the video…"),
        ingest_status: "processing", category: "Other",
        blocks: [], muscle_groups: [], equipment: [], tags: [],
        has_full_workout: false, favorite: false,
        created_at: new Date().toISOString()
      });
    }
    setView("library");
    render();
    watchPending();
  }

  function doAdd() {
    var url = $("addurl").value.trim();
    if (!url) { toast("Paste a link first."); return; }
    var btn = $("addgo");
    btn.disabled = true;
    btn.textContent = "Saving…";
    api("ingest", { method: "POST", body: JSON.stringify({ url: url }) })
      .then(function (r) {
        btn.disabled = false;
        btn.textContent = "Save workout";

        // The normal case now. The row already exists; only its contents are
        // pending. Close the sheet, put the card in the library straight away and
        // let Realtime fill it in — nobody should watch a spinner for 15 seconds.
        if (r.status === "processing") {
          $("addurl").value = "";
          closeSheet("addsheet");
          toast("Saved — reading the video…");
          placePending(r, url, null);
          return;
        }

        if (r.status === "saved") {
          $("addurl").value = "";
          closeSheet("addsheet");
          toast(r.cached ? "Saved instantly ⚡" : "Saved 💪");
          load().then(function () {
            var w = state.workouts.filter(function (x) { return x.id === r.id; })[0];
            if (w) openDetail(w);
          });
        } else if (r.status === "exists") {
          closeSheet("addsheet");
          toast("Already in your library.");
          load();
        } else {
          toast(r.message || "Could not save that link.");
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "Save workout";
        toast("Could not reach Spotter — check your connection.");
      });
  }

  // ---------- upload a video you saved ----------
  //
  // The bottom of the ingest ladder, for the creator who says the workout out loud
  // and writes nothing down. There is no caption anywhere to fetch, so the user
  // hands over the video they already saved and Spotter listens to it.
  //
  // The bytes go from this device straight into the user's own folder of the
  // private uploads bucket, under the storage policies. They never pass through
  // the edge function — what is posted to /api/ingest is a path, so that request
  // is a few hundred bytes however heavy the video is.
  //
  // XHR rather than supabase-js's storage client, for one reason: XHR reports
  // upload progress and fetch does not. A 25 MB file on mobile data is well past
  // the ten seconds at which a spinner stops being an honest answer to "how long".

  var UPLOAD_MAX = 25 * 1024 * 1024;
  // Extension to content type. Also the whitelist: the server validates the same
  // set, and the bucket's own allowed_mime_types is the third and enforcing copy.
  var UPLOAD_TYPES = {
    mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm",
    m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", weba: "audio/webm"
  };
  var UPLOAD_KINDS = "MP4, MOV, M4A, MP3, WAV or WebM";
  var uploading = false;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = [];
    for (var i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
    return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" +
      h.slice(6, 8).join("") + "-" + h.slice(8, 10).join("") + "-" + h.slice(10, 16).join("");
  }

  function mb(bytes) { return Math.round(bytes / (1024 * 1024) * 10) / 10; }

  // Inline on the control that caused it, never a toast: the fix is to pick a
  // different file, so the message has to still be there when the user looks back.
  function upError(msg) {
    var e = $("uperr");
    if (!msg) { e.hidden = true; e.textContent = ""; return; }
    e.textContent = msg;
    e.hidden = false;
  }

  function upProgress(frac, note) {
    $("upprog").hidden = false;
    $("upfill").style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
    $("upnote").textContent = note;
  }

  function resetUpload() {
    uploading = false;
    upError("");
    $("upprog").hidden = true;
    $("upfill").style.width = "0";
    $("upnote").textContent = "Uploading…";
    $("uploadrow").disabled = false;
    $("addfile").value = "";
  }

  function putObject(file, path, ctype) {
    return sb.auth.getSession().then(function (s) {
      var token = s.data.session ? s.data.session.access_token : "";
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", SB_URL + "/storage/v1/object/uploads/" + path, true);
        xhr.setRequestHeader("authorization", "Bearer " + token);
        xhr.setRequestHeader("apikey", SB_ANON);
        xhr.setRequestHeader("content-type", ctype);
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = function (e) {
          if (!e.lengthComputable) return;
          var f = e.loaded / e.total;
          upProgress(f, "Uploading… " + Math.round(f * 100) + "%");
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
          reject(new Error(String(xhr.status)));
        };
        xhr.onerror = function () { reject(new Error("network")); };
        xhr.onabort = function () { reject(new Error("network")); };
        xhr.send(file);
      });
    });
  }

  function doUpload(file) {
    if (uploading) return;
    upError("");
    if (!state.user) { upError("Sign in first."); return; }

    var name = file.name || "video";
    var dot = name.lastIndexOf(".");
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    if (!UPLOAD_TYPES[ext]) {
      upError("Spotter cannot listen to a ." + (ext || "?") + " file. Send " + UPLOAD_KINDS + ".");
      $("addfile").value = "";
      return;
    }
    // Named cause, named limit, named way out — the opposite of "an error occurred
    // with your upload, please try again".
    if (file.size > UPLOAD_MAX) {
      upError("That file is " + mb(file.size) + " MB and the limit is " + mb(UPLOAD_MAX) +
        " MB. Trim the clip, or paste the workout text onto the card instead.");
      $("addfile").value = "";
      return;
    }
    if (!file.size) { upError("That file is empty."); $("addfile").value = ""; return; }

    uploading = true;
    $("uploadrow").disabled = true;
    var path = state.user.id + "/" + uuid() + "." + ext;
    upProgress(0, "Uploading… 0%");

    putObject(file, path, UPLOAD_TYPES[ext]).then(function () {
      // The bytes have landed. What happens next is a different kind of waiting —
      // somebody else's machine listening — so it gets a different word.
      upProgress(1, "Uploaded — Spotter is listening…");
      return api("ingest", {
        method: "POST",
        body: JSON.stringify({ upload_path: path, filename: name.slice(0, 160) })
      });
    }).then(function (r) {
      if (r.status === "processing") {
        closeSheet("addsheet");
        resetUpload();
        toast("Uploaded — listening to the video…");
        placePending(r, "", "upload");
        return;
      }
      if (r.status === "exists") {
        closeSheet("addsheet");
        resetUpload();
        toast("Already in your library.");
        load();
        return;
      }
      resetUpload();
      upError(r.message || "Spotter could not start reading that upload.");
    }).catch(function (e) {
      var msg = String(e && e.message ? e.message : e);
      resetUpload();
      if (msg === "413") {
        upError("That file is too big for Spotter's storage. The limit is " + mb(UPLOAD_MAX) + " MB.");
      } else if (msg === "400" || msg === "415") {
        upError("Spotter's storage would not take that file. Send " + UPLOAD_KINDS + ".");
      } else if (msg === "401" || msg === "403") {
        upError("Session expired — sign in again.");
      } else {
        upError("The upload did not finish. Check your connection and try again.");
      }
    });
  }

  // ---------- settings ----------

  function openSettings() {
    $("setemail").textContent = state.user ? state.user.email : "—";
    $("unittoggle").textContent = state.unit;
    var key = state.profile ? state.profile.ingest_key : null;
    $("setkey").textContent = key ? API + "ingest?key=" + key : "Loading…";
    $("setsaves").textContent = "…";
    renderSettingsMeter();
    api("limits", { method: "GET" }).then(function (r) {
      pumpy.meterAsked = true;
      absorbMeter(r && r.pumpy);
      if (r.status === "ok") {
        var line = r.saves_today + " of " + r.limit_saves +
          " (" + r.extracts_today + "/" + r.limit_extract + " extractions, " +
          r.helpers_today + "/" + r.limit_helper + " coaching" +
          // The credits line below is the real Pumpy meter; the turn count is only
          // shown while the server does not send one.
          (r.pumpy ? ")" : ", " + (r.chats_today || 0) + "/" + (r.limit_chat || "—") + " Pumpy)");
        // Say so plainly when the day's spend ceiling has switched the paid
        // extractors off — cards get thinner and the user should know why.
        if (r.paid_enabled === false) line += " · budget reached, using the free reader";
        $("setsaves").textContent = line;
      }
    }).catch(function () { $("setsaves").textContent = "—"; });
    openSheet("settingssheet");
  }

  function rotateKey() {
    api("rotate-key", { method: "POST", body: "{}" }).then(function (r) {
      if (r.status !== "ok") { toast("Could not make a new key."); return; }
      if (state.profile) state.profile.ingest_key = r.ingest_key;
      $("setkey").textContent = API + "ingest?key=" + r.ingest_key;
      toast("New key made — update your Shortcut.");
    });
  }

  function toggleUnit() {
    state.unit = state.unit === "lb" ? "kg" : "lb";
    $("unittoggle").textContent = state.unit;
    sb.from("profiles").update({ settings: { unit: state.unit } }).eq("id", state.user.id);
  }

  // ---------- views ----------

  function setView(v) {
    // History lives under Progress now; anything still routing to it lands there.
    if (v === "history") v = "progress";
    state.view = v;
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("active", tabs[i].getAttribute("data-view") === v);
    }
    var lib = v === "library";
    $("chips").classList.toggle("hide", !lib);
    if (!lib) $("colbar").classList.add("hide");
    $("grid").classList.toggle("hide", !lib);
    $("searchwrap").classList.toggle("hide", !lib);
    $("empty").classList.toggle("hide", !lib || !!visible().length);
    $("planview").classList.toggle("open", v === "plan");
    $("progressview").classList.toggle("open", v === "progress");
    $("pumpyview").classList.toggle("open", v === "pumpy");
    // The Pumpy tab ends exactly on the tab bar, so it wants the tab bar's own
    // height as the page's bottom padding rather than the roomier default.
    document.body.classList.toggle("pumpy", v === "pumpy");

    var titles = { library: "Spotter", plan: "Plan", progress: "Progress", pumpy: "Pumpy" };
    $("apptitle").textContent = titles[v] || "Spotter";
    if (lib) { render(); viewIn($("grid")); }
    if (v === "plan") { $("count").textContent = "This week"; loadPlan(); }
    if (v === "progress") { $("count").textContent = "Your numbers, every session"; loadLogs().then(renderProgress); }
    // Measure before the first render, so the column is the right height even on
    // the open that has to wait for the thread to come back from the database.
    if (v === "pumpy") {
      $("count").textContent = "Your coach";
      sizePumpy(); loadPumpy(); viewIn($("pumpyview"));
      return;
    }
    window.scrollTo(0, 0);
  }

  // ---------- pull to refresh ----------

  var ptrStart = 0, ptrPulling = false;

  document.addEventListener("touchstart", function (e) {
    if (window.scrollY > 2 || overlayShowing()) { ptrPulling = false; return; }
    ptrStart = e.touches[0].clientY;
    ptrPulling = true;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!ptrPulling) return;
    var dy = e.touches[0].clientY - ptrStart;
    if (dy <= 0) { ptrPulling = false; $("ptr").style.opacity = 0; return; }
    var d = Math.min(dy * 0.45, 80);
    var p = $("ptr");
    p.classList.remove("back");
    p.style.opacity = Math.min(d / 55, 1);
    p.style.transform = "translateY(" + d + "px) rotate(" + d * 4 + "deg)";
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    if (!ptrPulling) return;
    ptrPulling = false;
    var p = $("ptr");
    var d = parseFloat(p.style.opacity || "0");
    p.classList.add("back");
    p.style.opacity = 0;
    p.style.transform = "";
    if (d >= 1) { state.logs = null; load(); toast("Refreshed"); }
  }, { passive: true });

  // ---------- install hint ----------

  function maybeInstallHint() {
    var standalone = window.navigator.standalone ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var dismissed = false;
    try { dismissed = localStorage.getItem("spotter_hint_done") === "1"; } catch (e) { /* ignore */ }
    if (isIOS && !standalone && !dismissed) $("hint").classList.add("show");
  }

  // ---------- wiring ----------

  $("authgo").onclick = doAuth;
  $("pw").addEventListener("keydown", function (e) { if (e.key === "Enter") doAuth(); });
  // the sign-in/sign-up toggle is rebuilt by setAuthMode, which wires its own handler

  $("addbtn").onclick = function () { $("addurl").value = ""; resetUpload(); openSheet("addsheet"); };
  $("addgo").onclick = doAdd;
  $("addurl").addEventListener("keydown", function (e) { if (e.key === "Enter") doAdd(); });
  // The row is the tap target; the file input behind it is never seen.
  $("uploadrow").onclick = function () { upError(""); $("addfile").click(); };
  $("addfile").onchange = function () {
    var f = this.files && this.files[0];
    if (f) doUpload(f);
  };

  $("exeditsave").onclick = saveExEdit;
  $("exeditdelete").onclick = deleteExEdit;
  $("exeditcancel").onclick = function () { closeSheet("exeditsheet"); exEdit = null; };
  $("exeditname").addEventListener("keydown", function (e) { if (e.key === "Enter") saveExEdit(); });

  $("pumpytab").innerHTML = PUMPY_MARK;
  $("pumpysend").onclick = function () { sendPumpy(); };
  $("pumpychats").onclick = openPumpyThreads;
  $("pumpynew").onclick = newPumpyThread;
  $("pumpyinput").addEventListener("keydown", function (e) {
    if (NO_TOUCH && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPumpy(); }
  });
  $("pumpyinput").addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 138) + "px";
  });
  window.addEventListener("resize", sizePumpy);
  window.addEventListener("orientationchange", sizePumpy);

  $("swaphavego").onclick = function () { runSwap(); };
  $("swaphaveinput").addEventListener("keydown", function (e) { if (e.key === "Enter") runSwap(); });

  $("colcreate").onclick = createCollection;
  $("colname").addEventListener("keydown", function (e) { if (e.key === "Enter") createCollection(); });
  $("renamesave").onclick = saveRename;
  $("capcancel").onclick = function () { closeSheet("capsheet"); capFor = null; };
  $("capgo").onclick = sendCaption;

  $("renamecancel").onclick = function () { closeSheet("renamesheet"); renameCtx = null; };
  $("renameinput").addEventListener("keydown", function (e) { if (e.key === "Enter") saveRename(); });

  $("refreshbtn").onclick = function () {
    var b = $("refreshbtn");
    b.classList.add("spin");
    state.logs = null;
    load().then(function () { b.classList.remove("spin"); });
  };
  $("settingsbtn").onclick = openSettings;
  $("copykey").onclick = function () {
    var t = $("setkey").textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(t);
    toast("Copied.");
  };
  $("rotatekey").onclick = rotateKey;
  $("unittoggle").onclick = toggleUnit;
  $("signout").onclick = function () {
    closeSheet("settingssheet");
    sb.auth.signOut();
  };

  $("search").addEventListener("input", function () { state.q = this.value; renderGrid(); });

  $("dclose").onclick = function () { history.back(); };
  $("dfav").onclick = function () {
    if (!current) return;
    current.favorite = !current.favorite;
    $("dfav").textContent = current.favorite ? "★" : "☆";
    $("dfav").classList.toggle("on", current.favorite);
    patchWorkout(current, { favorite: current.favorite });
    render();
  };
  $("dshare").onclick = function () {
    if (!current) return;
    var lines = [current.title || "Workout"];
    (current.blocks || []).forEach(function (b) {
      (b.exercises || []).forEach(function (ex) {
        lines.push("• " + ex.name + (doseText(ex) ? " — " + doseText(ex) : ""));
      });
    });
    lines.push(current.url);
    var text = lines.join("\n");
    if (navigator.share) navigator.share({ title: current.title || "Workout", text: text }).catch(function () { });
    else if (navigator.clipboard) { navigator.clipboard.writeText(text); toast("Copied."); }
  };
  $("dreproc").onclick = function () {
    if (!current) return;
    // A card that never finished goes back on the queue instead of being re-run
    // inline; retryWorkout owns that path and the pending UI that goes with it.
    if (isPending(current) || isFailed(current)) { retryWorkout(current, null); return; }
    var b = $("dreproc");
    b.classList.add("spin");
    api("workouts/" + current.id + "/reprocess", { method: "POST", body: "{}" })
      .then(function (r) {
        b.classList.remove("spin");
        // The row went back on the queue rather than being re-read inline — the
        // requeue already happened, so this only has to reflect it.
        if (r.status === "processing") {
          if (current) { current.ingest_status = "processing"; current.ingest_error = null; openDetail(current, true); }
          render(); watchPending(); toast("Reading it again…");
          return;
        }
        if (r.status !== "ok") { toast(r.message || "Could not re-read it."); return; }
        load().then(function () {
          var w = state.workouts.filter(function (x) { return x.id === r.workout.id; })[0];
          if (w) openDetail(w);
          toast("Re-read the video.");
        });
      }).catch(function () { b.classList.remove("spin"); toast("Could not re-read it."); });
  };

  $("wclose").onclick = function () { history.back(); };
  $("wprev").onclick = function () { woGo(-1); };
  $("wnext").onclick = function () { woGo(1); };
  $("wfinish").onclick = finishWorkout;
  $("wlist").onclick = function () {
    if (!wo) return;
    var list = $("exlist");
    list.innerHTML = "";
    wo.screens.forEach(function (s, i) {
      var row = el("button", "pickrow");
      var t = el("div", "pt");
      t.appendChild(el("b", null, s.ex.name));
      t.appendChild(el("span", null, doseText(s.ex) || "—"));
      row.appendChild(t);
      if (wo.entries[i] && wo.entries[i].sets.length) row.appendChild(el("span", "daydone", "✓"));
      row.onclick = function () { wo.i = i; closeSheet("exsheet"); renderWorkout(); };
      list.appendChild(row);
    });
    openSheet("exsheet");
  };

  $("repsup").onclick = function () { setCtx.reps++; drawStepper(); };
  $("repsdown").onclick = function () { if (setCtx.reps > 0) setCtx.reps--; drawStepper(); };
  $("wtup").onclick = function () { setCtx.weight += (state.unit === "kg" ? 2.5 : 5); drawStepper(); };
  $("wtdown").onclick = function () {
    setCtx.weight = Math.max(0, setCtx.weight - (state.unit === "kg" ? 2.5 : 5));
    drawStepper();
  };
  $("setsave").onclick = saveSet;
  $("setclear").onclick = function () {
    if (!wo) return;
    wo.entries[wo.i].sets.splice(setCtx.idx, 1);
    saveDraft();
    closeSheet("setsheet");
    renderWorkout();
  };

  $("hintx").onclick = function () {
    $("hint").classList.remove("show");
    try { localStorage.setItem("spotter_hint_done", "1"); } catch (e) { /* ignore */ }
  };

  var tabs = document.querySelectorAll(".tab");
  for (var ti = 0; ti < tabs.length; ti++) {
    (function (t) {
      t.onclick = function () { setView(t.getAttribute("data-view")); };
    })(tabs[ti]);
  }

  // one history entry per overlay, so the phone back gesture closes it
  window.addEventListener("popstate", function () {
    if ($("workout").classList.contains("open")) { exitWorkout(); return; }
    var open = document.querySelectorAll(".sheet.open");
    if (open.length) {
      for (var i = 0; i < open.length; i++) closeSheet(open[i].id);
      return;
    }
    if ($("detail").classList.contains("open")) closeDetail();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !state.user) return;
    if (wo) { acquireWake(); return; }
    if (!overlayShowing()) load();
  });

  setAuthMode("signup");

  // A session restored from storage does not always fire onAuthStateChange in time.
  sb.auth.getSession().then(function (r) {
    if (r.data.session && r.data.session.user) {
      state.user = r.data.session.user;
      showApp();
      boot().then(offerResume);
    } else {
      showLanding();
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* not fatal */ });
    });
  }
})();
</script>
</body>
</html>
`;
