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

  function load() {
    return sb.from("workouts").select("*").order("created_at", { ascending: false }).limit(200)
      .then(function (r) {
        if (r.error) { toast("Could not load your library."); return; }
        state.workouts = r.data || [];
        render();
        watchPending();
      });
  }

  function isPending(w) { return w.ingest_status === "processing"; }
  function isFailed(w) { return w.ingest_status === "failed"; }

  function visible() {
    var q = state.q.toLowerCase().trim();
    return state.workouts.filter(function (w) {
      if (state.filter === "Favorites" ? !w.favorite : (state.filter !== "All" && w.category !== state.filter)) return false;
      if (!q) return true;
      var hay = [w.title, w.author, w.category, (w.muscle_groups || []).join(" "),
        (w.equipment || []).join(" "), (w.tags || []).join(" "), exerciseNames(w).join(" ")]
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
    var list = [["All", state.workouts.length]];
    if (favs) list.push(["Favorites", favs]);
    CATEGORIES.forEach(function (c) { if (counts[c]) list.push([c, counts[c]]); });

    list.forEach(function (pair) {
      var b = el("button", "chip" + (state.filter === pair[0] ? " active" : ""));
      b.appendChild(document.createTextNode(pair[0] === "Favorites" ? "★ Favorites" : pair[0]));
      var n = el("span", "n", String(pair[1]));
      b.appendChild(n);
      b.onclick = function () { state.filter = pair[0]; render(); };
      wrap.appendChild(b);
    });
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
        tw.appendChild(el("div", "noimg", "🏋️"));
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
    d.appendChild(el("h2", "dtitle", w.title || "Untitled workout"));
    if (w.author) d.appendChild(el("div", "dauthor", "@" + w.author));

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
      }
      var open = el("a", "pill accent", "Open original ↗");
      open.href = w.source_url || w.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.style.display = "inline-block";
      open.style.textDecoration = "none";
      open.style.marginBottom = "14px";
      d.appendChild(open);

      var rm = el("button", "danger", "Remove from library");
      rm.onclick = function () { removeWorkout(w); };
      d.appendChild(rm);

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
      warn.appendChild(wt);
      d.appendChild(warn);
    }

    var start = el("button", "startbtn", w.has_full_workout ? "Start workout" : "Start & log freestyle");
    start.onclick = function () { startWorkout(w); };
    d.appendChild(start);

    (w.blocks || []).forEach(function (b, bi) {
      var sect = el("div", "sect");
      sect.appendChild(el("h3", null, "Block " + (bi + 1)));
      if (b.title) sect.appendChild(el("div", "blocktitle", b.title));
      var bm = blockMetaText(b);
      if (bm) sect.appendChild(el("div", "blockmeta", bm));
      (b.exercises || []).forEach(function (ex) {
        var row = el("div", "exrow");
        var name = el("div", "exname");
        name.appendChild(document.createTextNode(ex.name));
        if (ex.notes) name.appendChild(el("div", "exnote", ex.notes));
        // The line of the caption this exercise was read from, as a hover title.
        // Free, and it turns "where did this come from?" into a question the card
        // can answer without a new screen.
        if (ex.evidence && ex.evidence.quote) row.title = "From the source: " + ex.evidence.quote;
        row.appendChild(name);
        var dose = doseText(ex);
        if (dose) row.appendChild(el("div", "exdose", dose));
        var help = el("button", "exhelp", "?");
        help.onclick = function (e) { e.stopPropagation(); explain(ex.name, w.title); };
        row.appendChild(help);
        sect.appendChild(row);
      });
      d.appendChild(sect);
    });

    if (!(w.blocks || []).length) {
      var none = el("div", "sect");
      none.appendChild(el("h3", null, "No exercises found"));
      var np = el("div", "capbox",
        "This video did not include a written workout, so there is nothing to step through. " +
        "You can still watch it and log a freestyle session, or tap ↻ above to try reading it again.");
      none.appendChild(np);
      none.appendChild(el("div", null, " "));
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

    var del = el("button", "danger", "Remove from library");
    del.onclick = function () { removeWorkout(w); };
    d.appendChild(del);

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

  function closeDetail() {
    $("detail").classList.remove("open");
    $("dinner").innerHTML = "";   // stop the embedded video
    current = null;
  }

  function patchWorkout(w, fields) {
    return sb.from("workouts").update(fields).eq("id", w.id).then(function (r) {
      if (r.error) toast("Could not save that change.");
    });
  }

  function removeWorkout(w) {
    sb.from("workouts").delete().eq("id", w.id).then(function (r) {
      if (r.error) { toast("Could not remove it."); return; }
      state.workouts = state.workouts.filter(function (x) { return x.id !== w.id; });
      history.back();
      render();
      toast("Removed.");
    });
  }

  // ---------- AI helpers ----------

  var expCache = {};

  function explain(name, title) {
    $("explaintitle").textContent = name;
    $("explaintext").textContent = expCache[name] || "Thinking…";
    $("swapgo").onclick = function () { swap(name); };
    openSheet("explainsheet");
    if (expCache[name]) return;
    api("explain", { method: "POST", body: JSON.stringify({ exercise: name, title: title || "" }) })
      .then(function (r) {
        var text = r.status === "ok" ? r.text : (r.message || "Could not load that.");
        expCache[name] = r.status === "ok" ? text : null;
        if ($("explaintitle").textContent === name) $("explaintext").textContent = text;
      }).catch(function () { $("explaintext").textContent = "Could not load that."; });
  }

  function swap(name) {
    $("explaintitle").textContent = "Instead of " + name;
    $("explaintext").textContent = "Thinking…";
    api("swap", { method: "POST", body: JSON.stringify({ exercise: name, equipment_have: "" }) })
      .then(function (r) {
        $("explaintext").textContent = r.status === "ok" ? r.text : (r.message || "Could not load that.");
      }).catch(function () { $("explaintext").textContent = "Could not load that."; });
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
      e.appendChild(el("p", null, "Finish a workout and your volume, streak and personal records show up here."));
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

    viewIn(v);
  }

  function renderHistory() {
    var v = $("historyview");
    v.innerHTML = "";
    var logs = state.logs || [];
    if (!logs.length) {
      var e = el("div", "empty");
      e.appendChild(el("div", "big", "🗒️"));
      e.appendChild(el("h2", null, "No sessions yet"));
      e.appendChild(el("p", null, "Every workout you finish gets logged here with the sets you did."));
      v.appendChild(e);
      viewIn(v);
      return;
    }
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
        sb.from("workout_logs").delete().eq("id", l.id).then(function () {
          state.logs = null;
          loadLogs().then(function () { renderHistory(); });
        });
      };
      card.appendChild(del);
      v.appendChild(card);
    });
    viewIn(v);
  }

  // ---------- sheets ----------

  function openSheet(id) { $(id).classList.add("open"); }
  function closeSheet(id) { $(id).classList.remove("open"); }

  ["addsheet", "setsheet", "exsheet", "explainsheet", "picksheet", "settingssheet"].forEach(function (id) {
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
    api("limits", { method: "GET" }).then(function (r) {
      if (r.status === "ok") {
        var line = r.saves_today + " of " + r.limit_saves +
          " (" + r.extracts_today + "/" + r.limit_extract + " extractions, " +
          r.helpers_today + "/" + r.limit_helper + " coaching)";
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
    state.view = v;
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("active", tabs[i].getAttribute("data-view") === v);
    }
    var lib = v === "library";
    $("chips").classList.toggle("hide", !lib);
    $("grid").classList.toggle("hide", !lib);
    $("searchwrap").classList.toggle("hide", !lib);
    $("empty").classList.toggle("hide", !lib || !!visible().length);
    $("planview").classList.toggle("open", v === "plan");
    $("progressview").classList.toggle("open", v === "progress");
    $("historyview").classList.toggle("open", v === "history");

    var titles = { library: "Spotter", plan: "Plan", progress: "Progress", history: "History" };
    $("apptitle").textContent = titles[v];
    if (lib) { render(); }
    if (v === "plan") { $("count").textContent = "This week"; loadPlan(); }
    if (v === "progress") { $("count").textContent = "Your numbers"; loadLogs().then(renderProgress); }
    if (v === "history") { $("count").textContent = "Every session"; loadLogs().then(renderHistory); }
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
