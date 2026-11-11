(() => {
    "use strict";

    const $ = id => document.getElementById(id);
    const cv = $("radarCanvas");
    const cx = cv && cv.getContext("2d");
    const lg = $("legend");
    const lx = lg && lg.getContext("2d");
    const sl = { dbz: $("sl-dbz"), w: $("sl-vento"), m: $("sl-desloc"), rot: $("se-couplet") };
    const elSelect = $("se-tilt"), scenarioSelect = $("se-scenario"), dealiasSelect = $("se-dealias");
    let tilt = 0.5, scenario = "super", dealias = false;
    if (!cx || !lx || Object.values(sl).some(x => !x)) {
        console.error("THE-RADAR: elementos obrigatórios ausentes.");
        return;
    }

    /* ---------- parâmetros do radar (mude GATE e NAZ para ajustar o tamanho dos "pixels") ---------- */
    const RANGE = 150;               // alcance em km
    const GATE = 1.5;                // tamanho de cada bin em km (maior = mais pixelado)
    const NAZ = 288;                 // radiais (360 / 288 = 1,25° por bin)
    const NG = Math.floor(RANGE / GATE);
    const D = Math.PI / 180, TP = 2 * Math.PI;
    const KMIN = 0.0268;             // km por minuto, por mph
    const DIRTO = 60 * D;            // a tempestade se move para ENE (1 s real = 1 min simulado)

    /* ---------- ruído determinístico ---------- */
    const hs = (i, j, k) => {
        let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1103515245);
        n = Math.imul(n ^ (n >>> 13), 1274126177);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    };
    const vn = (x, y, k) => {
        const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        return (hs(i, j, k) * (1 - u) + hs(i + 1, j, k) * u) * (1 - v) +
               (hs(i, j + 1, k) * (1 - u) + hs(i + 1, j + 1, k) * u) * v;
    };
    const nz = (x, y, s) => (vn(x / s, y / s, 1) * 0.6 + vn(x * 2.1 / s, y * 2.1 / s, 2) * 0.4) * 2 - 1;

    /* ---------- tabelas de cores ---------- */
    function mk(st, a, b) {
        const o = new Uint8ClampedArray(1024);
        const h = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
        for (let n = 0; n < 256; n++) {
            const v = a + (b - a) * n / 255;
            let p = 0;
            while (p < st.length - 2 && v > st[p + 1][0]) p++;
            const [v0, c0] = st[p], [v1, c1] = st[p + 1];
            const f = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
            const A = h(c0), B = h(c1);
            for (let q = 0; q < 3; q++) o[n * 4 + q] = A[q] + (B[q] - A[q]) * f;
            o[n * 4 + 3] = 255;
        }
        return o;
    }

    const VEL = [[-90, "#7a0aa8"], [-67, "#2b3fd0"], [-49, "#27c4e0"], [-31, "#7de8a0"], [-13, "#10b020"],
        [-2, "#0f7a1c"], [0, "#707a70"], [2, "#7a1010"], [13, "#d01010"], [31, "#ff5a5a"],
        [49, "#ff9ab0"], [67, "#ff9a40"], [90, "#a04a10"]];

    const P = {
        dbz: { n: "Refletividade (dBZ)", u: "dBZ", f: "Z", a: -10, b: 75, d: 0, min: 5,
            st: [[-10, "#0b1020"], [0, "#3a5a88"], [10, "#4a90b8"], [18, "#3cb44b"], [25, "#1e8c2a"],
                [30, "#e6e02a"], [35, "#f0c010"], [40, "#f08a10"], [45, "#e03010"], [50, "#b00a0a"],
                [55, "#d83a8c"], [60, "#b04ad0"], [65, "#78e8f0"], [75, "#ffffff"]] },
        vento: { n: "Velocidade Base (mph)", u: "mph", f: "V", a: -100, b: 100, d: 0, st: VEL },
        srv: { n: "Storm Relative Velocity (mph)", u: "mph", f: "S", a: -100, b: 100, d: 0, st: VEL },
        cc: { n: "Coeficiente de Correlação (CC)", u: "", f: "R", a: 0.2, b: 1, d: 2,
            st: [[0.2, "#2a0a3a"], [0.5, "#18d8f0"], [0.75, "#2850d0"], [0.85, "#20b070"], [0.9, "#d8d838"],
                [0.95, "#f08020"], [0.98, "#e01818"], [1, "#e01818"]] },
        kdp: { n: "Fase Diferencial Específica (°/km)", u: "°/km", f: "K", a: 0, b: 6, d: 1, min: 0.3,
            st: [[0, "#00c800"], [1, "#ffff00"], [2, "#ff2a00"], [4, "#ff00ff"], [6, "#ffffff"]] },
        sw: { n: "Largura do Espectro (SW)", u: "mph", f: "W", a: 0, b: 30, d: 1,
            st: [[0, "#101018"], [3, "#5a5a60"], [5, "#9a9a9a"], [8, "#f09010"], [12, "#e02010"], [16, "#e010a0"], [20, "#a040f0"], [26, "#ffffff"], [30, "#e8f020"]] },
        vil: { n: "VIL estimado", u: "kg/m²", f: "VL", a: 0, b: 70, d: 1,
            st: [[0, "#6f8a8c"], [5, "#18b8b8"], [15, "#2a6adf"], [25, "#1a1ac8"], [35, "#18b028"], [45, "#e0c820"], [55, "#e03018"], [65, "#d838b8"], [70, "#ffffff"]] },
        et: { n: "Topo de Eco estimado", u: "km", f: "ET", a: 0, b: 20, d: 1,
            st: [[0, "#202830"], [3, "#0aa0c8"], [6, "#1060d0"], [9, "#2a1a90"], [11, "#18b868"], [13, "#10a010"], [15, "#e8d020"], [17, "#e08010"], [18, "#900000"], [20, "#ff3030"]] }
    };
    for (const k in P) P[k].l = mk(P[k].st, P[k].a, P[k].b);

    /* ---------- estado ---------- */
    const F = {};
    for (const k of ["Z", "V", "S", "R", "K", "W", "VL", "ET"]) F[k] = new Float32Array(NAZ * NG);
    const buf = document.createElement("canvas");
    const bctx = buf.getContext("2d");
    let img = null;
    let prod = "dbz", sx = -90, sy = 10, sweep = 0, since = 0, prevT = performance.now(), dirty = true, alertKey = "";

    /* ---------- varredura polar: campo da tempestade em cada bin ---------- */
    function scan() {
        const dbzT = +sl.dbz.value, W = +sl.w.value, mot = +sl.m.value, rot = sl.rot.value === "1";
        const elevFactor = Math.exp(-Math.max(0, tilt - 0.5) * 0.025);
        const mx = Math.sin(DIRTO) * mot, my = Math.cos(DIRTO) * mot;     // movimento da tempestade (mph)
        const Mx = sx + 10, My = sy - 17;                                  // centro da mesociclone
        const tds = rot && W >= 70 && dbzT >= 60;                          // regra do PDS (README)
        const g = (px, py, ox, oy, rx, ry) => {
            const a = (px - ox) / rx, b = (py - oy) / ry;
            return Math.exp(-0.5 * (a * a + b * b));
        };
        const hook = [];
        if (rot) for (let k = 0; k < 8; k++) {                              // eco de gancho a sudoeste
            const a = (190 + k * 14) * D, r = 8 + 1.3 * k;
            hook.push([Mx + r * Math.sin(a), My + r * Math.cos(a), 1 - 0.06 * k]);
        }

        for (let i = 0; i < NAZ; i++) {
            const az = (i + 0.5) * TP / NAZ, sa = Math.sin(az), ca = Math.cos(az);
            for (let j = 0; j < NG; j++) {
                const k = i * NG + j, r = (j + 0.5) * GATE, x = r * sa, y = r * ca, dx = x - sx, dy = y - sy;
                F.Z[k] = NaN;

                let z = 0, prec = 0, br = 0, md = 0, fn = 0, px = 0, py = 0;
                if (Math.abs(dx) < 70 && Math.abs(dy) < 70) {
                    br = nz(dx, dy, 21); md = nz(dx, dy, 9); fn = nz(dx, dy, 4);
                    px = dx + br * 8 + md * 4; py = dy + br * 6 + md * 3;
                    prec = Math.max(g(px, py, 0, 0, 29, 21) * 0.68, g(px, py, 10, -7, 11, 9) * 0.95,
                        g(px, py, -13, 5, 13, 10) * 0.78, g(px, py, 3, 17, 10, 8) * 0.62);
                    if (scenario === "line") {
                        prec = Math.max(prec, 0.72 * Math.exp(-Math.pow((px + 0.45 * py - 8) / 6, 2)) *
                            Math.exp(-Math.pow(py / 58, 2)));
                    } else if (scenario === "strat") {
                        prec = Math.max(prec, 0.58 * g(px, py, 0, 0, 58, 48));
                    }
                    for (const h of hook) prec = Math.max(prec, h[2] * 0.95 * g(x, y, h[0], h[1], 3.2, 3.2));
                    if (prec > 0.075) {
                        z = dbzT * Math.pow(prec, 0.72) * (0.78 + br * 0.16 + md * 0.22 + fn * 0.16) * elevFactor;
                        z *= 1 - g(px, py, 1, -5, 8, 6) * 0.34;
                    }
                }
                const mdx = x - Mx, mdy = y - My, rM = Math.hypot(mdx, mdy) + 0.01;
                if (rot && rM < 3.5) z = Math.min(z, dbzT * 0.15);         // BWER

                let cl = 0;                                                  // clutter de solo perto do radar
                if (r < 14 && hs(i, j, 9) < 0.35 * (1 - r / 14)) { cl = 1; z = Math.max(z, 8 + 14 * hs(i, j, 10)); }
                if (z < 5 && !cl) continue;
                F.Z[k] = z + (hs(i, j, 3) - 0.5) * 2;

                const base = mx * sa + my * ca;
                if (cl) {
                    F.V[k] = (hs(i, j, 4) - 0.5) * 3; F.S[k] = F.V[k] - base;
                    F.R[k] = 0.45 + 0.3 * hs(i, j, 6); F.K[k] = 0;
                    F.W[k] = 8 + 7 * hs(i, j, 5); F.VL[k] = 0; F.ET[k] = 0;
                    continue;
                }

                // vento: movimento médio + saída de ar da célula + vórtice (Rankine) se houver rotação
                let u = mx, v = my;
                const d0 = Math.hypot(dx, dy) + 0.01, so = W * 0.6 * Math.exp(-(dx * dx + dy * dy) / 392);
                u += dx / d0 * so; v += dy / d0 * so;
                if (rot) {
                    const vt = W * (rM < 2.5 ? rM / 2.5 : Math.pow(2.5 / rM, 0.6)) * Math.exp(-rM / 40);
                    u += -mdy / rM * vt; v += mdx / rM * vt;
                }
                let vr = u * sa + v * ca + (hs(i, j, 4) - 0.5) * 4;
                if (!dealias) vr = ((vr + 60) % 120 + 120) % 120 - 60;
                F.V[k] = vr; F.S[k] = vr - base;

                // CC: chuva ~0,985; granizo e bordas fracas caem; TDS abaixo de 0,7
                const z0 = F.Z[k];
                let rho = 0.985 + (hs(i, j, 6) - 0.5) * 0.014 - (z0 > 57 ? 0.06 : 0) - 0.12 * Math.exp(-(z0 - 8) / 4);
                if (tds && rM < 4) rho = 0.5 + 0.15 * hs(i, j, 7);
                F.R[k] = Math.max(0.2, rho);
                F.K[k] = Math.max(0, Math.min(6, (z0 - 15) / 12));
                const mesoBoost = rot ? 10 * Math.exp(-(rM * rM) / 18) : 0;
                F.W[k] = Math.max(0, Math.min(30, 2.2 + 0.07 * Math.max(0, z0 - 15) +
                    (hs(i, j, 5) - 0.5) * 2 + mesoBoost));
                // Integração vertical simplificada: produto didático sintético, não VIL operacional.
                let vil = 0, echoTop = 0;
                for (let layer = 0; layer < 10; layer++) {
                    const layerZ = z0 - layer * (scenario === "strat" ? 3.2 : 5.0);
                    if (layerZ > 18) {
                        echoTop = (layer + 1) * 0.5;
                        vil += 3.44e-6 * Math.pow(Math.pow(10, Math.min(layerZ, 56) / 10), 4 / 7) * 500;
                    }
                }
                F.VL[k] = Math.min(70, vil);
                F.ET[k] = echoTop;
            }
        }
    }

    /* ---------- pintura: cada pixel da tela consulta o seu bin polar ---------- */
    let map = null;
    function buildMap(s) {                       // pixel -> índice do bin (calculado só ao redimensionar)
        const c = s / 2, k = RANGE / c;
        map = new Int32Array(s * s);
        for (let py = 0; py < s; py++) {
            const y = (c - py - 0.5) * k;
            for (let px = 0; px < s; px++) {
                const x = (px + 0.5 - c) * k, r = Math.hypot(x, y);
                if (r >= RANGE) { map[py * s + px] = -1; continue; }
                let az = Math.atan2(x, y);
                if (az < 0) az += TP;
                map[py * s + px] = ((az / TP * NAZ) | 0) * NG + ((r / GATE) | 0);
            }
        }
    }

    function paint() {
        const s = cv.width, p = P[prod], data = F[p.f], l = p.l, d = img.data;
        const min = p.min === undefined ? -Infinity : p.min, n = s * s;
        for (let q = 0; q < n; q++) {
            const idx = map[q], o = q * 4;
            if (idx < 0) { d[o + 3] = 0; continue; }
            const v = data[idx];
            if (F.Z[idx] !== F.Z[idx] || v !== v || v < min) { d[o] = 2; d[o + 1] = 8; d[o + 2] = 4; d[o + 3] = 255; continue; }
            const t = (Math.max(0, Math.min(255, (v - p.a) / (p.b - p.a) * 255)) | 0) * 4;
            d[o] = l[t]; d[o + 1] = l[t + 1]; d[o + 2] = l[t + 2]; d[o + 3] = 255;
        }
        bctx.putImageData(img, 0, 0);
    }

    function legend() {
        const p = P[prod], w = lg.width, h = lg.height, dpr = h / 26;
        for (let x = 0; x < w; x++) {
            const n = (x / w * 255 | 0) * 4;
            lx.fillStyle = "rgb(" + p.l[n] + "," + p.l[n + 1] + "," + p.l[n + 2] + ")";
            lx.fillRect(x, 0, 1, h);
        }
        lx.font = 11 * dpr + "px 'Courier New', monospace";
        lx.lineWidth = 3 * dpr; lx.strokeStyle = "#000"; lx.fillStyle = "#fff";
        for (let i = 0; i <= 6; i++) {
            const t = (p.a + (p.b - p.a) * i / 6).toFixed(p.d), tw = lx.measureText(t).width;
            const x = Math.min(w - tw - 3, Math.max(3, i / 6 * w - tw / 2));
            lx.strokeText(t, x, 17 * dpr); lx.fillText(t, x, 17 * dpr);
        }
    }

    function overlay() {
        const s = cv.width, c = s / 2, pk = c / RANGE, dpr = s / Math.max(1, cv.clientWidth);
        cx.clearRect(0, 0, s, s);
        cx.drawImage(buf, 0, 0);
        cx.strokeStyle = "rgba(143,162,184,0.35)"; cx.lineWidth = dpr; cx.fillStyle = "#8fa2b8";
        cx.font = 11 * dpr + "px 'Courier New', monospace";
        for (let R = 50; R <= 150; R += 50) {
            cx.beginPath(); cx.arc(c, c, R * pk - dpr, 0, TP); cx.stroke();
            if (R < 150) cx.fillText(R + " km", c + 4 * dpr, c - R * pk - 3 * dpr);
        }
        cx.beginPath(); cx.moveTo(c, 0); cx.lineTo(c, s); cx.moveTo(0, c); cx.lineTo(s, c); cx.stroke();
        cx.fillText("N", c + 4 * dpr, 12 * dpr);
        // varredura giratória com rastro
        const a = sweep - Math.PI / 2;
        cx.fillStyle = "rgba(0,255,0,0.06)";
        cx.beginPath(); cx.moveTo(c, c); cx.arc(c, c, c, a - 0.4, a); cx.closePath(); cx.fill();
        cx.strokeStyle = "rgba(0,255,0,0.45)"; cx.lineWidth = 2 * dpr;
        cx.beginPath(); cx.moveTo(c, c); cx.lineTo(c + c * Math.cos(a), c + c * Math.sin(a)); cx.stroke();
    }

    /* ---------- alertas (regras do README) ---------- */
    function alertas() {
        const dbz = +sl.dbz.value, w = +sl.w.value, mot = +sl.m.value, rot = sl.rot.value === "1";
        const out = [];
        if (w >= 58 || dbz > 55) out.push(["severe", "⚠️ Severe Thunderstorm Warning — SIMULADO"]);
        if (mot < 20) out.push(["flood", "🌊 Flash Flood Warning — SIMULADO"]);
        if (rot && w >= 70 && dbz >= 60) out.push(["pds", "🚨 PDS Tornado Warning (TDS simulado)"]);
        else if (rot) out.push(["tornado", "🌪️ Tornado Warning (Radar Indicated) — SIMULADO"]);

        const key = out.map(a => a[1]).join("|");
        if (key === alertKey) return;
        alertKey = key;
        const list = $("alerts-list");
        if (!list) return;
        list.textContent = "";
        if (!out.length) { list.textContent = "Monitorando atmosfera... Sem alertas."; return; }
        out.forEach(([cls, msg]) => {
            const div = document.createElement("div");
            div.className = "alerta " + cls;
            div.textContent = msg;
            list.appendChild(div);
        });
    }

    function refresh() {
        const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
        set("lbl-dbz", sl.dbz.value); set("lbl-vento", sl.w.value); set("lbl-desloc", sl.m.value);
        alertas();
        dirty = true;
    }

    function setProduct(name) {
        prod = name;
        document.querySelectorAll(".btn-product").forEach(b => b.classList.toggle("active", b.dataset.p === name));
        const t = $("radar-title");
        if (t) t.textContent = "Display Principal: " + P[name].n + " · " + tilt.toFixed(1) + "°";
        legend();
        dirty = true;
    }

    function fit() {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const s = Math.max(240, Math.round(cv.clientWidth * dpr));
        cv.width = cv.height = buf.width = buf.height = s;
        img = bctx.createImageData(s, s);
        buildMap(s);
        lg.width = Math.max(200, Math.round(lg.clientWidth * dpr));
        lg.height = Math.round(26 * dpr);
        legend();
        dirty = true;
    }

    /* ---------- interação ---------- */
    document.querySelectorAll(".btn-product").forEach(b => b.addEventListener("click", () => setProduct(b.dataset.p)));
    Object.values(sl).forEach(e => e.addEventListener("input", refresh));
    sl.rot.addEventListener("change", refresh);
    elSelect.addEventListener("change", () => {
        tilt = +elSelect.value;
        const title = $("radar-title");
        if (title) title.textContent = "Display Principal: " + P[prod].n + " · " + tilt.toFixed(1) + "°";
        dirty = true;
    });
    scenarioSelect.addEventListener("change", () => { scenario = scenarioSelect.value; dirty = true; });
    dealiasSelect.addEventListener("change", () => { dealias = dealiasSelect.checked; dirty = true; });
    const reset = $("btn-reset");
    if (reset) reset.addEventListener("click", () => { sx = -90; sy = 10; dirty = true; });

    const readout = $("readout");
    cv.addEventListener("pointermove", e => {
        const rc = cv.getBoundingClientRect();
        const x = ((e.clientX - rc.left) / rc.width * 2 - 1) * RANGE, y = (1 - (e.clientY - rc.top) / rc.height * 2) * RANGE;
        const r = Math.hypot(x, y);
        if (!readout || r >= RANGE) { if (readout) readout.hidden = true; return; }
        let az = Math.atan2(x, y);
        if (az < 0) az += TP;
        const idx = ((az / TP * NAZ) | 0) * NG + ((r / GATE) | 0), p = P[prod], v = F[p.f][idx];
        if (F.Z[idx] !== F.Z[idx] || v !== v || (p.min !== undefined && v < p.min)) { readout.hidden = true; return; }
        readout.hidden = false;
        readout.textContent = v.toFixed(p.d) + " " + p.u + " · " + Math.round(az / D) + "° · " + r.toFixed(0) + " km";
    });
    cv.addEventListener("pointerleave", () => { if (readout) readout.hidden = true; });

    if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(cv);
    else window.addEventListener("resize", fit);

    /* ---------- laço principal ---------- */
    function frame(now) {
        const dt = Math.min((now - prevT) / 1000, 0.1);
        prevT = now;
        const mot = +sl.m.value;
        sx += Math.sin(DIRTO) * mot * KMIN * dt;
        sy += Math.cos(DIRTO) * mot * KMIN * dt;
        if (sx > 110) { sx = -90; sy = 10; }

        since += dt;
        if (dirty || since > 0.5) { since = 0; dirty = false; scan(); paint(); }
        sweep = (sweep + dt * 1.6) % TP;
        overlay();
        requestAnimationFrame(frame);
    }

    refresh();
    $("radar-title").textContent = "Display Principal: " + P[prod].n + " · 0,5°";
    fit();
    requestAnimationFrame(frame);
})();
