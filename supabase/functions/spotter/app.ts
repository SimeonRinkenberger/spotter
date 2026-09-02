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
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2800);
  }

  // Re-trigger an entrance animation on a node we are reusing.
  function viewIn(node) {
    if (!node) return;
    node.style.animation = "none";
    void node.offsetWidth;
    node.style.animation = "";
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

  function renderChips() {
    var wrap = $("chips");
    wrap.innerHTML = "";
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

    list.forEach(function (item) {
      var b = el("button", "chip" + (state.filter === item.key ? " active" : ""));
      b.appendChild(document.createTextNode(item.label));
      if (item.n !== null) b.appendChild(el("span", "n", String(item.n)));
      b.onclick = function () {
        if (item.key === "__newcol") { openCollections(null); return; }
        state.filter = item.key;
        render();
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
    if (isPending(w)) return "Reading the video…";
    if (isFailed(w)) return "Could not read it — tap to retry";
    var bits = [];
    var n = exerciseNames(w).length;
    if (n) bits.push(n + (n === 1 ? " exercise" : " exercises"));
    if (w.equipment && w.equipment.length) bits.push(w.equipment[0]);
    else if (w.has_full_workout) bits.push("bodyweight");
    if (!bits.length && w.author) bits.push("@" + w.author);
    return bits.join(" · ");
  }

  function renderGrid() {
    var grid = $("grid"), empty = $("empty");
    var items = visible();
    grid.innerHTML = "";

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
      card.style.animation = "cardin .42s cubic-bezier(.22,.9,.3,1) both";
      card.style.animationDelay = Math.min(i, 10) * 26 + "ms";
      // fill:both keeps every animation registered forever; clear it once it has run
      card.addEventListener("animationend", function () { card.style.animation = ""; });

      var tw = el("div", "thumbwrap loading");
      if (pending || failed) {
        tw.className = "thumbwrap " + (pending ? "pending" : "failed");
        tw.appendChild(el("div", "noimg", pending ? "⏳" : "↻"));
        card.appendChild(tw);
        var pb = el("div", "cardbody");
        var pk = el("div", "cardkick");
        pk.appendChild(el("div", "catpill", pending ? "Reading" : "Retry"));
        pb.appendChild(pk);
        pb.appendChild(el("div", "cardtitle", w.title || "Reading the video…"));
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
      var note = el("div", "sect");
      note.appendChild(el("h3", null, isPending(w) ? "Still reading this one" : "Could not read this one"));
      note.appendChild(el("div", "capbox", isPending(w)
        ? "Spotter is pulling the workout out of this video. The card fills in here as soon as it lands — you can close this and carry on."
        : (w.ingest_error || "Spotter could not get anything back from this link.") +
          " The link is saved either way, so nothing is lost."));
      d.appendChild(note);

      if (isFailed(w)) {
        var rb = el("button", "retrybtn", "Try reading it again");
        rb.onclick = function () { retryWorkout(w, rb); };
        d.appendChild(rb);
        // The last rung, and the only one a platform cannot block: whatever it
        // serves a server, the user can read the caption on their own screen.
        var pb = el("button", "retrybtn ghost", "Paste the caption instead");
        pb.onclick = function () { openCaption(w); };
        d.appendChild(pb);
      }
      var open = el("a", "pill accent", "Open original ↗");
      open.href = w.source_url || w.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.style.display = "inline-block";
      open.style.textDecoration = "none";
      open.style.marginBottom = "14px";
      d.appendChild(open);

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
        var r = countsFromExercises(allExercises(w));
        slot.innerHTML = "";
        slot.appendChild(bodyDiagram(r.counts,
          "None of these exercises matched Spotter's catalog yet, so nothing is highlighted."));
        if (r.mapped && r.mapped < r.total) {
          slot.appendChild(el("div", "bodynote",
            (r.total - r.mapped) + " of " + r.total + " exercises are not in the catalog and are not shown."));
        }
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
      capSect.appendChild(el("h3", null, "Original caption"));
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
    $("caplede").textContent = isFailed(w)
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

  function closeDetail() {
    $("detail").classList.remove("open");
    $("dinner").innerHTML = "";   // stop the embedded video
    current = null;
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
  // Two silhouettes as inline SVG, regions keyed to the catalog's muscle vocabulary.
  // What lights up is derived ONLY from exercise_catalog.muscle_groups through each
  // exercise's canonical_id — never from the card's free-text muscle list and never
  // from an exercise name. A movement the catalog does not know highlights nothing,
  // and says so. The figure is currentColor; highlights are the accent.

  var MUSCLE_LIST = ["chest", "back", "shoulders", "biceps", "triceps", "forearms",
    "core", "glutes", "quads", "hamstrings", "calves"];

  var BODY_BASE =
    '<g fill="currentColor" opacity=".13">' +
    '<circle cx="50" cy="15" r="11"/>' +
    '<rect x="45" y="24" width="10" height="9"/>' +
    '<path d="M30 32 H70 Q74 32 74 37 L71 82 Q69 108 60 112 H40 Q31 108 29 82 L26 37 Q26 32 30 32 Z"/>' +
    '<path d="M27 35 L17 40 L13 72 L22 74 L29 52 Z"/>' +
    '<path d="M13 72 L22 74 L19 106 L10 105 Z"/>' +
    '<circle cx="14" cy="111" r="4.5"/>' +
    '<path d="M73 35 L83 40 L87 72 L78 74 L71 52 Z"/>' +
    '<path d="M87 72 L78 74 L81 106 L90 105 Z"/>' +
    '<circle cx="86" cy="111" r="4.5"/>' +
    '<path d="M34 110 H50 L49 162 L36 162 Z"/>' +
    '<path d="M36 162 H49 L47 208 L38 208 Z"/>' +
    '<path d="M37 208 H48 L50 215 H34 Z"/>' +
    '<path d="M50 110 H66 L64 162 L51 162 Z"/>' +
    '<path d="M51 162 H64 L62 208 L53 208 Z"/>' +
    '<path d="M52 208 H63 L66 215 H50 Z"/>' +
    '</g>';

  var BODY_REGIONS = {
    front: {
      chest: '<path d="M32 37 L50 36 V56 Q41 59 33 54 Z"/><path d="M68 37 L50 36 V56 Q59 59 67 54 Z"/>',
      shoulders: '<ellipse cx="25" cy="40" rx="8" ry="6.5"/><ellipse cx="75" cy="40" rx="8" ry="6.5"/>',
      biceps: '<path d="M20 45 L28 47 L25 70 L16 68 Z"/><path d="M80 45 L72 47 L75 70 L84 68 Z"/>',
      forearms: '<path d="M14 74 L21 76 L19 104 L12 103 Z"/><path d="M86 74 L79 76 L81 104 L88 103 Z"/>',
      core: '<path d="M40 58 H60 L59 108 H41 Z"/>',
      quads: '<path d="M36 113 H49 L48 158 H38 Z"/><path d="M51 113 H64 L62 158 H52 Z"/>',
      calves: '<path d="M39 166 H47 L46 204 H40 Z"/><path d="M53 166 H61 L60 204 H54 Z"/>'
    },
    back: {
      back: '<path d="M30 34 H70 L66 86 Q50 94 34 86 Z"/>',
      shoulders: '<ellipse cx="25" cy="40" rx="8" ry="6.5"/><ellipse cx="75" cy="40" rx="8" ry="6.5"/>',
      triceps: '<path d="M20 45 L28 47 L25 70 L16 68 Z"/><path d="M80 45 L72 47 L75 70 L84 68 Z"/>',
      forearms: '<path d="M14 74 L21 76 L19 104 L12 103 Z"/><path d="M86 74 L79 76 L81 104 L88 103 Z"/>',
      glutes: '<path d="M35 96 H65 Q66 116 50 118 Q34 116 35 96 Z"/>',
      hamstrings: '<path d="M36 120 H49 L48 160 H38 Z"/><path d="M51 120 H64 L62 160 H52 Z"/>',
      calves: '<path d="M38 164 H48 L47 202 H39 Z"/><path d="M52 164 H62 L61 202 H53 Z"/>'
    }
  };

  // weights: muscle -> 0..1. Region opacity scales with it, from a clear floor so
  // a muscle hit once still reads, up to full accent for the most-hit one.
  function bodyFigure(view, weights) {
    var regions = BODY_REGIONS[view];
    var html = '<svg class="body" viewBox="0 0 100 220" role="img" aria-label="' + view + ' of body">' + BODY_BASE;
    Object.keys(regions).forEach(function (m) {
      var wgt = weights[m] || 0;
      html += '<g class="mg" data-m="' + m + '" fill="var(--ember)" opacity="' +
        (wgt ? (0.3 + 0.7 * wgt).toFixed(2) : "0") + '">' + regions[m] + '</g>';
    });
    html += '</svg>';
    var fig = el("div", "bodyfig");
    fig.innerHTML = html;   // constant markup: nothing user-supplied is in it
    fig.appendChild(el("div", "bodylbl", view));
    return fig;
  }

  // counts: muscle -> how many exercises hit it. "full body" is spread over every
  // region rather than drawn as its own.
  function bodyWeights(counts) {
    var fb = counts["full body"] || 0;
    var max = fb;
    MUSCLE_LIST.forEach(function (m) { max = Math.max(max, (counts[m] || 0) + fb); });
    var w = {};
    if (!max) return w;
    MUSCLE_LIST.forEach(function (m) {
      var n = (counts[m] || 0) + fb;
      if (n) w[m] = Math.min(1, n / max);
    });
    return w;
  }

  function bodyDiagram(counts, emptyText) {
    var box = el("div");
    var wrap = el("div", "bodywrap");
    var w = bodyWeights(counts);
    wrap.appendChild(bodyFigure("front", w));
    wrap.appendChild(bodyFigure("back", w));
    box.appendChild(wrap);
    var names = Object.keys(counts).filter(function (m) { return counts[m] > 0; })
      .sort(function (a, b) { return counts[b] - counts[a]; });
    if (!names.length) { box.appendChild(el("div", "bodynote", emptyText)); return box; }
    var legend = el("div", "pillrow bodylegend");
    names.forEach(function (m) {
      var p = el("span", "pill accent", m);
      p.appendChild(el("span", "n", String(counts[m])));
      legend.appendChild(p);
    });
    box.appendChild(legend);
    return box;
  }

  // The catalog's id -> muscle_groups map, read once per session. Every signed-in
  // user may read the catalog; it is reference data, not theirs or anyone's.
  var catalogMuscles = null;
  var catalogLoading = null;

  function loadCatalog() {
    if (catalogMuscles) return Promise.resolve(catalogMuscles);
    if (catalogLoading) return catalogLoading;
    catalogLoading = sb.from("exercise_catalog").select("id,muscle_groups").limit(1000).then(function (r) {
      catalogMuscles = {};
      (r.data || []).forEach(function (e) { catalogMuscles[e.id] = e.muscle_groups || []; });
      catalogLoading = null;
      return catalogMuscles;
    });
    return catalogLoading;
  }

  // list: anything carrying canonical_id — a card's exercises or a log's entries.
  function countsFromExercises(list) {
    var counts = {}, mapped = 0, total = 0;
    list.forEach(function (e) {
      total++;
      var ms = e && e.canonical_id && catalogMuscles ? catalogMuscles[e.canonical_id] : null;
      if (!ms) return;
      mapped++;
      ms.forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
    });
    return { counts: counts, mapped: mapped, total: total };
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

    var help = el("button", "chip", "? How to do this");
    help.style.marginTop = "18px";
    help.onclick = function () { explain(s.ex.name, wo.workout.title); };
    main.appendChild(help);
    var swapChip = el("button", "chip", "⇄ Swap or modify");
    swapChip.style.marginTop = "18px";
    swapChip.style.marginLeft = "8px";
    swapChip.onclick = function () { openSwap(s.ex.name, wo.workout.title); };
    main.appendChild(swapChip);

    viewIn(main);
  }

  function renderSetPills(main, entry, ex) {
    var target = ex && ex.sets ? ex.sets : Math.max(entry.sets.length + 1, 1);
    var pills = el("div", "setpills");
    var count = Math.max(target, entry.sets.length + (entry.sets.length >= target ? 1 : 0));
    for (var i = 0; i < count; i++) {
      (function (idx) {
        var done = entry.sets[idx];
        var p = el("button", "setpill" + (done ? " done" : ""));
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
    renderWorkout();
    var s = wo.screens[wo.i];
    if (s && s.ex && s.ex.rest_seconds) startRest(s.ex.rest_seconds);
  }

  function startRest(seconds) {
    clearInterval(restTimer);
    var left = seconds;
    var main = $("wmain");
    var box = el("div", "resttimer");
    var ring = el("div", "ring");
    var label = el("span", null, "Rest " + left + "s");
    box.appendChild(ring);
    box.appendChild(label);
    main.appendChild(box);
    restTimer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(restTimer);
        if (box.parentNode) box.parentNode.removeChild(box);
        toast("Rest done — next set.");
        return;
      }
      label.textContent = "Rest " + left + "s";
    }, 1000);
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

  function exitWorkout() {
    clearInterval(woTimer);
    clearInterval(restTimer);
    releaseWake();
    clearDraft();
    wo = null;
    $("workout").classList.remove("open");
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
    var t = $("toast");
    t.onclick = function () { t.onclick = null; startWorkout(w, d); };
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
    // which muscles that is. Intensity is how many logged exercises hit a region.
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
      var r = countsFromExercises(entries);
      hitSlot.innerHTML = "";
      hitSlot.appendChild(bodyDiagram(r.counts, weekLogs.length
        ? "This week's logged exercises are not in the catalog, so nothing is highlighted."
        : "Nothing logged this week yet."));
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
    shown.forEach(function (m) { log.appendChild(renderMsg(m)); });
    if (pumpy.busy) {
      var row = el("div", "msgrow");
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

  function openSheet(id) { $(id).classList.add("open"); }
  function closeSheet(id) { $(id).classList.remove("open"); }

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
          var known = false;
          for (var i = 0; i < state.workouts.length; i++) {
            if (state.workouts[i].id === r.id) { known = true; break; }
          }
          if (!known) {
            state.workouts.unshift({
              id: r.id, url: url, title: r.title || "Reading the video…",
              ingest_status: "processing", category: "Other",
              blocks: [], muscle_groups: [], equipment: [], tags: [],
              has_full_workout: false, favorite: false,
              created_at: new Date().toISOString()
            });
          }
          setView("library");
          render();
          watchPending();
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
    if (lib) { render(); }
    if (v === "plan") { $("count").textContent = "This week"; loadPlan(); }
    if (v === "progress") { $("count").textContent = "Your numbers, every session"; loadLogs().then(renderProgress); }
    // Measure before the first render, so the column is the right height even on
    // the open that has to wait for the thread to come back from the database.
    if (v === "pumpy") { $("count").textContent = "Your coach"; sizePumpy(); loadPumpy(); return; }
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
    p.style.opacity = Math.min(d / 55, 1);
    p.style.transform = "translateY(" + d + "px) rotate(" + d * 4 + "deg)";
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    if (!ptrPulling) return;
    ptrPulling = false;
    var p = $("ptr");
    var d = parseFloat(p.style.opacity || "0");
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

  $("addbtn").onclick = function () { $("addurl").value = ""; openSheet("addsheet"); };
  $("addgo").onclick = doAdd;
  $("addurl").addEventListener("keydown", function (e) { if (e.key === "Enter") doAdd(); });

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
    if (document.querySelectorAll(".sheet.open").length) {
      var open = document.querySelectorAll(".sheet.open");
      for (var i = 0; i < open.length; i++) open[i].classList.remove("open");
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
