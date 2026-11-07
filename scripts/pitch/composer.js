/* Pitch video composer: 1080×1920, drawn frame by frame by scripts/pitch/render.mjs.
 * window.renderFrame(t) shows the video at t seconds. Real screenshots of the live demo
 * (pitch/shots/*.jpg) sit inside phone and laptop frames; Arabic captions on top. */
(function () {
  const params = new URLSearchParams(location.search);
  const BASE = params.get("base") || "../../pitch/shots/";
  const src = (name) => BASE + name + (name.includes(".") ? "" : ".jpg");

  // ── easing & helpers ──
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3); // ease-out cubic
  const inOut = (x) => {
    x = clamp(x);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    (parent || stage).appendChild(e);
    return e;
  };
  const stage = document.getElementById("stage");
  const bg = document.getElementById("bg");

  // Slow drifting colour blobs behind everything.
  const blobs = [
    { c: "#cfe3dc", s: 620, x: 760, y: 420, dx: -60, dy: 40 },
    { c: "#efe2c6", s: 560, x: 120, y: 1500, dx: 70, dy: -50 },
    { c: "#dcebe5", s: 420, x: 200, y: 700, dx: 40, dy: 60 },
  ].map((b) => {
    const e = el("div", "blob", bg);
    Object.assign(e.style, { width: b.s + "px", height: b.s + "px", background: b.c });
    return { e, ...b };
  });

  // ── building blocks ──
  function caption(group, { kicker, title, sub, top = 205 }) {
    const k = el("div", "kicker", group, kicker || "");
    const ti = el("div", "title", group, title);
    ti.style.top = top + "px";
    k.style.top = top - 55 + "px";
    const su = el("div", "sub", group, sub || "");
    return {
      els: [k, ti, su],
      place() {
        su.style.top = top + ti.offsetHeight + 22 + "px";
      },
      show(t, at = 0.15, out = null) {
        [k, ti, su].forEach((e, i) => {
          const p = ease(prog(t, at + i * 0.12, at + i * 0.12 + 0.7));
          const o = out === null ? 1 : 1 - ease(prog(t, out, out + 0.4));
          e.style.opacity = p * o;
          e.style.transform = `translateY(${(1 - p) * 40 - (1 - o) * 30}px)`;
        });
      },
    };
  }

  /** A device (phone / laptop) holding a sequence of shots that crossfade, each optionally panning. */
  function device(group, kind, shots, { top, scale = 1 }) {
    const d = el("div", "device " + kind, group);
    let screen;
    if (kind === "phone") {
      screen = el("div", "screen", d);
      el("div", "notch", d);
    } else {
      const lid = el("div", "lid", d);
      screen = el("div", "screen", lid);
      el("div", "base", d);
    }
    d.style.top = top + "px";
    const W = kind === "phone" ? 564 : 936;
    const H = kind === "phone" ? 1262 : 585;
    const imgs = shots.map((s) => {
      const i = el("img", "shot", screen);
      i.src = src(s.img);
      return { i, ...s };
    });
    return {
      d,
      imgs,
      show(t, enterAt = 0, exitAt = null) {
        const p = ease(prog(t, enterAt, enterAt + 0.8));
        const x = exitAt === null ? 0 : inOut(prog(t, exitAt, exitAt + 0.6));
        d.style.opacity = p * (1 - x);
        d.style.transform = `translateX(-50%) translateY(${(1 - p) * 120 - x * 60}px) scale(${scale * (0.94 + 0.06 * p)})`;
        for (const s of imgs) {
          const iw = s.i.naturalWidth || 1170;
          const ih = s.i.naturalHeight || 2532;
          // Fade in over 0.45 s at s.from, stay until the next one is in.
          const fin = s.from <= 0 ? 1 : ease(prog(t, s.from, s.from + 0.45));
          s.i.style.opacity = t < s.from ? 0 : fin;
          s.i.style.zIndex = Math.round(s.from * 100);
          const k = W / iw;
          const h = ih * k;
          let y = 0;
          if (s.zoom) {
            // Zoom into a point of a wide screen (focus = fractions of the picture), slowly moving.
            const q = inOut(prog(t, s.from + 0.4, s.zoomTo ?? s.from + 4));
            const z = s.zoom[0] + (s.zoom[1] - s.zoom[0]) * q;
            const fx = s.focus[0] + ((s.focus2 ?? s.focus)[0] - s.focus[0]) * q;
            const fy = s.focus[1] + ((s.focus2 ?? s.focus)[1] - s.focus[1]) * q;
            const w = W * z;
            const hh = ih * (w / iw);
            const left = clamp(W / 2 - fx * w, W - w, 0);
            const top = clamp(H / 2 - fy * hh, Math.min(0, H - hh), 0);
            s.i.style.width = w + "px";
            s.i.style.left = left + "px";
            s.i.style.transform = `translateY(${top}px)`;
            continue;
          }
          if (s.pan && h > H) {
            const [a, b] = s.pan; // fractions of the scrollable height
            const q = inOut(prog(t, s.panAt ?? s.from + 0.6, s.panTo ?? s.from + (s.panDur ?? 2.5)));
            y = -(a + (b - a) * q) * (h - H);
          } else if (h < H) {
            // Cover the screen (crop the sides a little).
            const k2 = H / ih;
            s.i.style.width = iw * k2 + "px";
            s.i.style.left = (W - iw * k2) / 2 + "px";
            s.i.style.transform = "none";
            continue;
          }
          s.i.style.width = W + "px";
          s.i.style.left = "0px";
          s.i.style.transform = `translateY(${y}px)`;
        }
      },
    };
  }

  function chips(group, items, { top, spread = 60 }) {
    return items.map((text, i) => {
      const c = el("div", "chip", group, `<i></i>${text}`);
      c.dataset.i = i;
      c.style.top = top + i * 0 + "px";
      return { c, i };
    });
  }

  function tap(group) {
    return el("div", "tap", group);
  }

  // ── the scenes ──
  const SCENES = [];
  function scene(dur, build) {
    const group = el("div", "layer");
    const draw = build(group);
    SCENES.push({ dur, group, draw });
  }

  // 0. Opening
  scene(4.5, (g) => {
    const logo = el("img", "logo", g);
    logo.src = src("logo.png");
    logo.style.top = "640px";
    logo.style.height = "150px";
    const t1 = el("div", "center", g, "");
    t1.style.cssText += ";top:860px;font-family:'Noto Naskh Arabic',serif;font-weight:700;font-size:78px;line-height:1.3";
    t1.innerHTML = "نظامٌ واحد<br/><span style='color:var(--emerald)'>للمريض والطبيب والإدارة</span>";
    const t2 = el("div", "center", g, "تجربة حيّة على نظام عيادات ديرما");
    t2.style.cssText += ";top:1130px;font-size:36px;color:var(--slate);font-weight:500";
    return (t) => {
      const a = ease(prog(t, 0.2, 1.1));
      logo.style.opacity = a;
      logo.style.transform = `translateX(-50%) scale(${0.9 + 0.1 * a})`;
      const b = ease(prog(t, 0.9, 1.8));
      t1.style.opacity = b;
      t1.style.transform = `translateY(${(1 - b) * 40}px)`;
      const c = ease(prog(t, 1.6, 2.4));
      t2.style.opacity = c;
      const out = inOut(prog(t, 3.9, 4.5));
      g.style.opacity = 1 - out;
    };
  });

  // 1. The website
  scene(9, (g) => {
    const cap = caption(g, {
      kicker: "١ · الموقع",
      title: "موقع <em>ديرما</em> الجديد",
      sub: "أقسامكم وأطباؤكم وعروضكم… وزر الحجز دائمًا في المتناول",
    });
    const ph = device(g, "phone", [{ img: "site-full", from: 0, pan: [0, 0.42], panAt: 1.4, panTo: 8.2 }], { top: 520, scale: 0.98 });
    return (t) => {
      cap.place();
      cap.show(t, 0.1, 8.5);
      ph.show(t, 0.3, 8.4);
    };
  });

  // 2. Booking from the phone
  scene(13, (g) => {
    const cap = caption(g, {
      kicker: "٢ · الحجز",
      title: "حجز من الجوال<br/>في <em>أقل من دقيقة</em>",
      sub: "رقم الجوال، رمز التحقق، الخدمة، الوقت… وتمّ",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "book-2-mobile", from: 0 },
        { img: "book-3-code", from: 2.2 },
        { img: "book-5-service", from: 4.2 },
        { img: "book-7-times", from: 6.2 },
        { img: "book-8-details", from: 8.3 },
        { img: "book-9-done", from: 10.4 },
      ],
      { top: 600, scale: 0.92 },
    );
    const clock = el("div", "chip", g, "<i></i><span>00:00</span>");
    clock.style.cssText += ";top:548px;left:50%;transform:translateX(-50%)";
    return (t) => {
      cap.place();
      cap.show(t, 0.1, 12.5);
      ph.show(t, 0.3, 12.4);
      const secs = Math.min(48, Math.floor(prog(t, 1, 10.6) * 48));
      clock.querySelector("span").textContent = `مدة الحجز ‎00:${String(secs).padStart(2, "0")}`;
      const c = ease(prog(t, 1, 1.6)) * (1 - inOut(prog(t, 12.3, 12.8)));
      clock.style.opacity = c;
    };
  });

  // 3. WhatsApp + consent
  scene(12, (g) => {
    const cap1 = caption(g, {
      kicker: "٣ · واتساب",
      title: "تأكيد وتذكير<br/>على <em>واتساب</em>",
      sub: "مع الموقع، وتعليمات ما قبل الجلسة، وأزرار: تأكيد · تغيير · إلغاء",
    });
    const cap2 = caption(g, {
      kicker: "٣ · الموافقة",
      title: "نموذج الموافقة<br/><em>يُوقَّع من الجوال</em>",
      sub: "قبل الوصول للعيادة… ومحفوظ في ملف المريضة",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "wa-2-reminder", from: 0 },
        { img: "consent-1-open", from: 5.4 },
        { img: "consent-3-signed", from: 7.6 },
        { img: "consent-4-done", from: 9.6 },
      ],
      { top: 600, scale: 0.92 },
    );
    return (t) => {
      cap1.place();
      cap2.place();
      cap1.show(t, 0.1, 4.9);
      cap2.show(t, 5.3, 11.5);
      ph.show(t, 0.3, 11.4);
    };
  });

  // 4. AI receptionist
  scene(14, (g) => {
    const cap = caption(g, {
      kicker: "٤ · الاستقبال الذكي",
      title: "حتى قبل الفجر…<br/><em>الرد فوري</em>",
      sub: "يفهم اللهجة، يقترح المواعيد، ولا يحجز إلا بعد «نعم» من المريضة",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "ai-1", from: 0 },
        { img: "ai-2", from: 3.4 },
        { img: "ai-3", from: 6.6 },
        { img: "ai-4", from: 9.8 },
      ],
      { top: 600, scale: 0.92 },
    );
    return (t) => {
      cap.place();
      cap.show(t, 0.1, 13.5);
      ph.show(t, 0.3, 13.4);
    };
  });

  // 5. The doctor
  scene(11, (g) => {
    const cap = caption(g, {
      kicker: "٥ · الطبيب",
      title: "الطبيبة تتكلم…<br/><em>والملاحظة تُكتب</em>",
      sub: "مسودة بالذكاء الاصطناعي، تراجعها وتوقّعها بنفسها",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "dr-1-myday", from: 0 },
        { img: "dr-3-dictation", from: 3.4 },
        { img: "dr-5-note", from: 6.8 },
      ],
      { top: 600, scale: 0.92 },
    );
    return (t) => {
      cap.place();
      cap.show(t, 0.1, 10.5);
      ph.show(t, 0.3, 10.4);
    };
  });

  // 6. The owner
  scene(11, (g) => {
    const cap = caption(g, {
      kicker: "٦ · الإدارة",
      title: "الرياض وجدة<br/><em>في شاشة واحدة</em>",
      sub: "كل حجز، وكل طبيب، وكل غرفة… أمامك",
    });
    const lap = device(
      g,
      "laptop",
      [
        { img: "own-2-calendar", from: 0, zoom: [1, 1.7], focus: [0.5, 0.35], focus2: [0.42, 0.45], zoomTo: 5 },
        { img: "own-3-patient", from: 5.2, zoom: [1.2, 1.45], focus: [0.5, 0.25], focus2: [0.45, 0.4], zoomTo: 10 },
      ],
      { top: 760, scale: 1 },
    );
    const items = ["لا يمكن أن يتكرر حجز", "الجلسات تُخصم من الباقة تلقائيًا", "كل تغيير مسجّل باسم صاحبه"];
    const cs = items.map((txt) => el("div", "chip", g, `<i></i>${txt}`));
    return (t) => {
      cap.place();
      cap.show(t, 0.1, 10.5);
      lap.show(t, 0.3, 10.4);
      cs.forEach((c, i) => {
        const p = ease(prog(t, 1.4 + i * 0.5, 2.1 + i * 0.5)) * (1 - inOut(prog(t, 10.3, 10.8)));
        c.style.opacity = p;
        c.style.top = 1500 + i * 110 + "px";
        c.style.right = "90px";
        c.style.transform = `translateX(${(1 - p) * -60}px)`;
      });
    };
  });

  // 7. Close
  scene(5.5, (g) => {
    const logo = el("img", "logo", g);
    logo.src = src("logo.png");
    logo.style.top = "700px";
    logo.style.height = "140px";
    const t1 = el("div", "center", g, "جاهز للتجربة<br/><span style='color:var(--emerald)'>في عيادات ديرما</span>");
    t1.style.cssText += ";top:900px;font-family:'Noto Naskh Arabic',serif;font-weight:700;font-size:76px;line-height:1.3";
    const n = el("div", "notice", g, "عرض تجريبي حيّ · جميع بيانات المرضى وهمية");
    return (t) => {
      const a = ease(prog(t, 0.2, 1));
      logo.style.opacity = a;
      logo.style.transform = `translateX(-50%) scale(${0.92 + 0.08 * a})`;
      const b = ease(prog(t, 0.7, 1.5));
      t1.style.opacity = b;
      t1.style.transform = `translateY(${(1 - b) * 40}px)`;
      n.style.opacity = ease(prog(t, 1.4, 2.2));
    };
  });

  const bar = el("div", "progress", document.body);
  const fill = el("div", "", bar);
  const TOTAL = SCENES.reduce((n, s) => n + s.dur, 0);

  window.SCENES = SCENES.map((s) => s.dur);
  window.TOTAL = TOTAL;
  window.renderFrame = function (T) {
    let start = 0;
    for (const s of SCENES) {
      const on = T >= start && T < start + s.dur;
      s.group.style.display = on ? "block" : "none";
      if (on) s.draw(T - start);
      start += s.dur;
    }
    for (const b of blobs) {
      const k = Math.sin(T / 6);
      b.e.style.left = b.x + b.dx * k - b.s / 2 + "px";
      b.e.style.top = b.y + b.dy * Math.cos(T / 7) - b.s / 2 + "px";
    }
    fill.style.width = (T / TOTAL) * 100 + "%";
    bar.style.opacity = T < 4 || T > TOTAL - 5 ? 0 : 1;
  };
  window.ready = Promise.all([
    document.fonts.ready,
    ...[...document.images].map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {}))),
  ]).then(() => true);
})();
