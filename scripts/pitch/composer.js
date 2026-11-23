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
  // Order (founder, 24 Nov): hook → the clinic's website → booking → WhatsApp → video
  // consultation → front desk → doctor → owner → close. Every picture is the live demo.
  const SCENES = [];
  function scene(dur, build) {
    const group = el("div", "layer");
    const draw = build(group);
    SCENES.push({ dur, group, draw });
  }
  const T_OUT = (dur) => dur - 0.5;

  // 0. Hook: what the clinic gains, over a quick montage of the app
  scene(7, (g) => {
    const t1 = el("div", "center", g, "عيادتك كاملة<br/><span style='color:var(--emerald)'>في تطبيقٍ واحد</span>");
    t1.style.cssText += ";top:300px;font-family:'Noto Naskh Arabic',serif;font-weight:700;font-size:84px;line-height:1.3";
    const ph = device(
      g,
      "phone",
      [
        { img: "site-hero", from: 0 },
        { img: "book-4-times", from: 1.3 },
        { img: "wa-2-reminder", from: 2.6 },
        { img: "dr-5-note", from: 3.9 },
      ],
      { top: 620, scale: 0.78 },
    );
    const items = ["غيابٌ أقل عن المواعيد", "استقبالٌ أسرع", "وقتٌ أطول مع المرضى"];
    const cs = items.map((txt) => el("div", "chip", g, `<i></i>${txt}`));
    return (t) => {
      const a = ease(prog(t, 0.1, 0.9));
      t1.style.opacity = a * (1 - inOut(prog(t, 6.4, 7)));
      t1.style.transform = `translateY(${(1 - a) * 40}px)`;
      ph.show(t, 0.3, 6.4);
      cs.forEach((c, i) => {
        const p = ease(prog(t, 4.6 + i * 0.45, 5.2 + i * 0.45)) * (1 - inOut(prog(t, 6.4, 7)));
        c.style.opacity = p;
        c.style.top = 1560 + i * 104 + "px";
        c.style.left = "50%";
        c.style.transform = `translateX(-50%) translateY(${(1 - p) * 30}px)`;
      });
    };
  });

  // 1. The clinic's own website (online presence)
  scene(10, (g) => {
    const cap = caption(g, {
      kicker: "١ · حضوركم على الإنترنت",
      title: "موقع <em>عيادات ديرما</em>",
      sub: "الأقسام والعلاجات والأطباء والباقات بأسعارها… وزر «حجز موعد» في كل صفحة",
    });
    const ph = device(g, "phone", [{ img: "site-full", from: 0, pan: [0, 0.62], panAt: 1.2, panTo: 9.2 }], {
      top: 560,
      scale: 0.95,
    });
    return (t) => {
      cap.place();
      cap.show(t, 0.1, T_OUT(10));
      ph.show(t, 0.3, T_OUT(10) - 0.1);
    };
  });

  // 2. The booking journey, from that website
  scene(13, (g) => {
    const cap = caption(g, {
      kicker: "٢ · الحجز",
      title: "من الموقع…<br/><em>إلى موعدٍ مؤكد</em>",
      sub: "العلاج، الطبيب، الوقت… ثم رقم الجوال ورمز التحقق",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "book-1-start", from: 0 },
        { img: "book-2-service", from: 1.9 },
        { img: "book-3-doctor", from: 3.8 },
        { img: "book-4-times", from: 5.6 },
        { img: "book-5-details", from: 7.5 },
        { img: "book-5-code", from: 9.2 },
        { img: "book-5-done", from: 10.9 },
      ],
      { top: 620, scale: 0.92 },
    );
    return (t) => {
      cap.place();
      cap.show(t, 0.1, T_OUT(13));
      ph.show(t, 0.3, T_OUT(13) - 0.1);
    };
  });

  // 3. WhatsApp: confirmation and reminder
  scene(8, (g) => {
    const cap = caption(g, {
      kicker: "٣ · واتساب",
      title: "تأكيدٌ وتذكير<br/><em>تلقائيًا على واتساب</em>",
      sub: "مع الموقع وتعليمات الجلسة… فلا يُنسى الموعد",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "wa-1-confirmation", from: 0 },
        { img: "wa-2-reminder", from: 3.6 },
      ],
      { top: 620, scale: 0.92 },
    );
    return (t) => {
      cap.place();
      cap.show(t, 0.1, T_OUT(8));
      ph.show(t, 0.3, T_OUT(8) - 0.1);
    };
  });

  // 4. Video consultation
  scene(11, (g) => {
    const cap = caption(g, {
      kicker: "٤ · الاستشارة عن بُعد",
      title: "استشارة بالفيديو<br/><em>برابطٍ آمن</em>",
      sub: "تُحجز من الموقع، ويصل الرابط على واتساب، والطبيب ينضم من شاشة الزيارة",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "vc-0-mode", from: 0 },
        { img: "vc-2-whatsapp", from: 2.4 },
        { img: "vc-3-patient", from: 4.9 },
        { img: "vc-5-doctor-visit", from: 7.6 },
      ],
      { top: 620, scale: 0.92 },
    );
    return (t) => {
      cap.place();
      cap.show(t, 0.1, T_OUT(11));
      ph.show(t, 0.3, T_OUT(11) - 0.1);
    };
  });

  // 5. Front desk: search, patient flow, checkout
  scene(12, (g) => {
    const cap = caption(g, {
      kicker: "٥ · الاستقبال",
      title: "استقبالٌ <em>أسرع</em>",
      sub: "بحث برقم الجوال، تسجيل حضور بضغطة، وكل مريض في مكانه حتى المحاسبة",
    });
    const lap = device(
      g,
      "laptop",
      [
        { img: "day-1-desk", from: 0, zoom: [1, 1.55], focus: [0.55, 0.2], focus2: [0.55, 0.28], zoomTo: 3.8 },
        { img: "day-2-board", from: 4, zoom: [1, 1.35], focus: [0.5, 0.45], focus2: [0.6, 0.5], zoomTo: 7.8 },
        { img: "day-3-checkout", from: 8, zoom: [1.1, 1.4], focus: [0.45, 0.35], focus2: [0.55, 0.45], zoomTo: 11.5 },
      ],
      { top: 700, scale: 1 },
    );
    const items = ["الانتظار الطويل يظهر فورًا", "المحاسبة برقم فاتورة نظامكم"];
    const cs = items.map((txt) => el("div", "chip", g, `<i></i>${txt}`));
    return (t) => {
      cap.place();
      cap.show(t, 0.1, T_OUT(12));
      lap.show(t, 0.3, T_OUT(12) - 0.1);
      cs.forEach((c, i) => {
        const p = ease(prog(t, 4.4 + i * 4, 5.1 + i * 4)) * (1 - inOut(prog(t, 11.3, 11.8)));
        c.style.opacity = p;
        c.style.top = 1460 + i * 110 + "px";
        c.style.right = "90px";
        c.style.transform = `translateX(${(1 - p) * -60}px)`;
      });
    };
  });

  // 6. Doctor: the note written from speech, then before / after photos
  scene(13, (g) => {
    const cap1 = caption(g, {
      kicker: "٦ · الطبيب",
      title: "الطبيب يتكلم…<br/><em>والملاحظة تُكتب</em>",
      sub: "مسودة بالذكاء الاصطناعي، يراجعها الطبيب ويعتمدها بنفسه",
    });
    const cap2 = caption(g, {
      kicker: "٦ · الطبيب",
      title: "صور قبل وبعد<br/><em>جنبًا إلى جنب</em>",
      sub: "لكل منطقة وتاريخ… يراها الطبيب والممرضة فقط",
    });
    const ph = device(
      g,
      "phone",
      [
        { img: "dr-3-dictation", from: 0 },
        { img: "dr-5-note", from: 3 },
      ],
      { top: 620, scale: 0.92 },
    );
    const lap = device(
      g,
      "laptop",
      [
        { img: "ph-1-tab", from: 0, zoom: [1, 1.3], focus: [0.45, 0.35], zoomTo: 2.8 },
        { img: "ph-2-compare", from: 2.8, zoom: [1.05, 1.25], focus: [0.5, 0.5], zoomTo: 6 },
      ],
      { top: 760, scale: 1 },
    );
    return (t) => {
      cap1.place();
      cap2.place();
      cap1.show(t, 0.1, 6);
      cap2.show(t, 6.5, T_OUT(13));
      ph.show(t, 0.3, 6);
      lap.show(t - 6.4, 0, T_OUT(13) - 6.5);
    };
  });

  // 7. Owner: the monthly report
  scene(8, (g) => {
    const cap = caption(g, {
      kicker: "٧ · الإدارة",
      title: "أرقام العيادة<br/><em>في شاشة واحدة</em>",
      sub: "الحجوزات والإيرادات الفعلية لكل طبيب وخدمة وفرع",
    });
    const lap = device(
      g,
      "laptop",
      [{ img: "own-4-report", from: 0, zoom: [1, 1.45], focus: [0.5, 0.25], focus2: [0.45, 0.45], zoomTo: 7 }],
      { top: 760, scale: 1 },
    );
    return (t) => {
      cap.place();
      cap.show(t, 0.1, T_OUT(8));
      lap.show(t, 0.3, T_OUT(8) - 0.1);
    };
  });

  // 8. Close
  scene(6, (g) => {
    const logo = el("img", "logo", g);
    logo.src = src("logo.png");
    logo.style.top = "700px";
    logo.style.height = "140px";
    const t1 = el("div", "center", g, "عيادات ديرما<br/><span style='color:var(--emerald)'>جاهزةٌ للتجربة</span>");
    t1.style.cssText += ";top:900px;font-family:'Noto Naskh Arabic',serif;font-weight:700;font-size:80px;line-height:1.3";
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
