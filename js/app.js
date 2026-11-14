(() => {
    "use strict";

    const $ = id => document.getElementById(id);
    const cv = $("radarCanvas");
    const cx = cv && cv.getContext("2d");
    const lg = $("legend");
    const lx = lg && lg.getContext("2d");
    const sl = { dbz: $("sl-dbz"), w: $("sl-vento"), m: $("sl-desloc"), rot: $("se-couplet") };
    const ui = { elev: $("se-elev"), nyq: $("se-nyquist"), dea: $("ck-dealias") };
    if (!cx || !lx || Object.values(sl).some(x => !x)) {
        console.error("THE-RADAR: elementos obrigatórios ausentes.");
        return;
    }

    /* ---------- parâmetros do radar (GATE e NAZ definem o tamanho dos "pixels") ---------- */
    const RANGE = 150, GATE = 1.5, NAZ = 288;
    const NG = Math.floor(RANGE / GATE);
    const D = Math.PI / 180, TP = 2 * Math.PI, RE = 8495;   // RE = 4/3 do raio da Terra (km)
    const KMIN = 0.0268;                                     // km/min por mph (1 s real = 1 min simulado)
    const DIRTO = 60 * D;                                    // a tempestade se move para ENE
    const TILT_MAX = 19.5;                                   // maior elevação do VCP 212 (cone de silêncio)

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

    // col: produto de coluna (não depende da elevação). min: valores abaixo disso não são desenhados.
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
        et: { n: "Echo Tops (km)", u: "km", f: "E", a: 0, b: 20, d: 1, min: 1, col: 1,
            st: [[0, "#202830"], [3, "#0aa0c8"], [6, "#1060d0"], [9, "#2a1a90"], [11, "#18b868"],
                [13, "#10a010"], [15, "#e8d020"], [17, "#e08010"], [18, "#900000"], [20, "#ff3030"]] },
        vil: { n: "VIL (kg/m²)", u: "kg/m²", f: "L", a: 0, b: 70, d: 0, min: 1, col: 1,
            st: [[0, "#6f8a8c"], [5, "#18b8b8"], [15, "#2a6adf"], [25, "#1a1ac8"], [35, "#18b028"],
                [45, "#e0c820"], [55, "#e03018"], [65, "#d838b8"], [70, "#ffffff"]] },
        vild: { n: "VIL Density (g/m³)", u: "g/m³", f: "G", a: 0, b: 6, d: 1, min: 0.3, col: 1,
            st: [[0, "#303844"], [1.5, "#2a6adf"], [2.5, "#18b028"], [3.5, "#e0c820"], [4.5, "#e03018"], [6, "#d838b8"]] }
    };

    for (const k in P) P[k].l = mk(P[k].st, P[k].a, P[k].b);

    /* ---------- importação de paletas JASC-PAL ---------- */
    const PALETTE_KEY = "the-radar-palettes-v1";
    const productKeys = Object.keys(P);
    function paletteLut(colors) {
        const lut = new Uint8ClampedArray(1024);
        for (let n = 0; n < 256; n++) {
            const pos = n / 255 * (colors.length - 1);
            const i = Math.floor(pos), f = pos - i, a = colors[i], b = colors[Math.min(i + 1, colors.length - 1)];
            for (let ch = 0; ch < 3; ch++) lut[n * 4 + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * f);
            lut[n * 4 + 3] = 255;
        }
        return lut;
    }
    function parsePal(source) {
        const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith("#") && !x.startsWith(";"));
        let rows = lines;
        if (lines[0] && lines[0].toUpperCase() === "JASC-PAL") {
            if (lines[1] !== "0100" && lines[1] !== "0101") throw new Error("Versão JASC-PAL não suportada.");
            const count = Number(lines[2]);
            if (!Number.isInteger(count) || count < 1 || count > 256 || lines.length < count + 3) throw new Error("Quantidade de cores inválida ou arquivo incompleto.");
            rows = lines.slice(3, 3 + count);
        }
        const colors = rows.map(line => {
            const parts = line.split(/[\s,;]+/).filter(Boolean);
            if (parts.length < 3) throw new Error("Linha de cor inválida: " + line);
            const rgb = parts.slice(0, 3).map(Number);
            if (rgb.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error("Valores RGB devem estar entre 0 e 255.");
            return rgb;
        });
        if (!colors.length || colors.length > 256) throw new Error("A paleta precisa ter entre 1 e 256 cores.");
        return colors;
    }
    function loadSavedPalettes() {
        try {
            const saved = JSON.parse(localStorage.getItem(PALETTE_KEY) || "{}");
            for (const key of productKeys) if (Array.isArray(saved[key]) && saved[key].length) { P[key].l = paletteLut(saved[key]); P[key].customColors = saved[key]; }
        } catch (err) { console.warn("THE-RADAR: não foi possível carregar paletas salvas.", err); }
    }
    function savePalettes() {
        const saved = {};
        for (const key of productKeys) {
            if (P[key].customColors) saved[key] = P[key].customColors;
        }
        try { localStorage.setItem(PALETTE_KEY, JSON.stringify(saved)); }
        catch (err) { console.warn("THE-RADAR: não foi possível salvar paletas.", err); }
    }
    loadSavedPalettes();
    function showPalettePreview(colors) {
        const preview = $("pal-preview");
        if (!preview) return;
        preview.textContent = "";
        colors.forEach(rgb => {
            const swatch = document.createElement("span");
            swatch.className = "pal-swatch";
            swatch.style.backgroundColor = "rgb(" + rgb.join(",") + ")";
            preview.appendChild(swatch);
        });
    }

    /* ---------- estado ---------- */
    const F = {};
    for (const k of ["Z", "V", "S", "R", "K", "E", "L", "G"]) F[k] = new Float32Array(NAZ * NG);
    const buf = document.createElement("canvas");
    const bctx = buf.getContext("2d");
    let img = null, map = null;
    let prod = "dbz", sx = -90, sy = 10, sweep = 0, since = 0, prevT = performance.now(), dirty = true, alertKey = "";

    const elev = () => (ui.elev ? +ui.elev.value : 0.5);
    const nyq = () => (ui.nyq ? +ui.nyq.value : 58);
    const dealias = () => !!(ui.dea && ui.dea.checked);

    /* ---------- modelo 3D da tempestade ---------- */
    const g2 = (px, py, ox, oy, rx, ry) => {
        const a = (px - ox) / rx, b = (py - oy) / ry;
        return Math.exp(-0.5 * (a * a + b * b));
    };
    const HZ = { z: 0, t: 0 };

    function params() {
        const dbzT = +sl.dbz.value, W = +sl.w.value, mot = +sl.m.value, rot = sl.rot.value === "1";
        const hook = [], Mx = sx + 10, My = sy - 17;
        if (rot) for (let k = 0; k < 8; k++) {                        // eco de gancho a sudoeste
            const a = (190 + k * 14) * D, r = 8 + 1.3 * k;
            hook.push([Mx + r * Math.sin(a), My + r * Math.cos(a), 1 - 0.06 * k]);
        }
        return { dbzT, W, mot, rot, hook, Mx, My,
            mx: Math.sin(DIRTO) * mot, my: Math.cos(DIRTO) * mot,
            top: 6 + 0.13 * dbzT + (sl.rot.value === "1" ? 2 : 0),   // topo da tempestade (km)
            tds: rot && W >= 70 && dbzT >= 60 };
    }

    // campo horizontal no nível baixo: refletividade (HZ.z) e topo local (HZ.t). Falso se não há eco.
    function horiz(H, x, y) {
        const dx = x - sx, dy = y - sy;
        if (Math.abs(dx) >= 70 || Math.abs(dy) >= 70) return false;
        const br = nz(dx, dy, 21), md = nz(dx, dy, 9), fn = nz(dx, dy, 4);
        const px = dx + br * 8 + md * 4, py = dy + br * 6 + md * 3;
        let prec = Math.max(g2(px, py, 0, 0, 29, 21) * 0.68, g2(px, py, 10, -7, 11, 9) * 0.95,
            g2(px, py, -13, 5, 13, 10) * 0.78, g2(px, py, 3, 17, 10, 8) * 0.62);
        let hp = 0;
        for (const h of H.hook) hp = Math.max(hp, h[2] * 0.95 * g2(x, y, h[0], h[1], 3.2, 3.2));
        HZ.t = hp > prec ? H.top * 0.6 : H.top;                     // o gancho é mais raso que o núcleo
        prec = Math.max(prec, hp);
        if (prec <= 0.075) return false;
        HZ.z = H.dbzT * Math.pow(prec, 0.72) * (0.78 + br * 0.16 + md * 0.22 + fn * 0.16);
        HZ.z *= 1 - g2(px, py, 1, -5, 8, 6) * 0.34;
        return HZ.z > 0;
    }

    // refletividade na altura z (km): queda parabólica até o topo; BWER abaixo de 6 km no centro da rotação
    const zAt = (H, zh, top, z, bw) => {
        if (z >= top) return -99;
        const f = z / top, v = zh - 48 * f * f;
        return bw && z < 6 ? Math.min(v, H.dbzT * 0.15) : v;
    };

    /* ---------- varredura: produtos da elevação escolhida e produtos de coluna ---------- */
    function scan() {
        const H = params(), el = elev(), VN = nyq(), da = dealias();
        const se = Math.sin(el * D), ce = Math.cos(el * D);
        let mZ = -99, mE = 0, mL = 0, mG = 0;

        for (let i = 0; i < NAZ; i++) {
            const az = (i + 0.5) * TP / NAZ, sa = Math.sin(az), ca = Math.cos(az);
            let att = 0;
            for (let j = 0; j < NG; j++) {
                const k = i * NG + j, r = (j + 0.5) * GATE;
                F.Z[k] = F.E[k] = F.L[k] = F.G[k] = NaN;

                /* ----- produtos de coluna (usam o alcance como distância no solo) ----- */
                {
                    const x = r * sa, y = r * ca;
                    if (horiz(H, x, y) && HZ.z >= 5) {
                        const zh = HZ.z, top = HZ.t, vis = Math.min(top, r * Math.tan(TILT_MAX * D));
                        const bw = H.rot && Math.hypot(x - H.Mx, y - H.My) < 3.5;
                        let vil = 0;
                        for (let z = 0.25; z < vis; z += 0.5) {
                            const zz = zAt(H, zh, top, z, bw);
                            if (zz > 0) vil += 3.44e-6 * Math.pow(10, Math.min(zz, 56) / 10 * 4 / 7) * 500;
                        }
                        const et = zh > 18 ? Math.min(vis, top * Math.sqrt((zh - 18) / 48)) : 0;
                        if (et > 0.5) {
                            F.E[k] = et; F.L[k] = vil; F.G[k] = vil / et;     // VIL-D = VIL / ET (g/m³)
                            mE = Math.max(mE, et); mL = Math.max(mL, vil); mG = Math.max(mG, vil / et);
                        }
                    }
                }

                /* ----- produtos da elevação: geometria do feixe (4/3 da Terra) ----- */
                const g = r * ce, x = g * sa, y = g * ca;
                const h = r * se + r * r / (2 * RE), hw = r * 0.0083;
                if (h > 20) continue;
                let z = -99;
                const has = horiz(H, x, y);
                const zh = HZ.z, top = HZ.t;
                const mdx = x - H.Mx, mdy = y - H.My, rM = Math.hypot(mdx, mdy) + 0.01;
                if (has) {
                    let L = 0;
                    const bw = H.rot && rM < 3.5;
                    for (const q of [-0.5, 0, 0.5]) {
                        const zz = zAt(H, zh, top, Math.max(h + q * hw, 0.03), bw);
                        if (zz > -90) L += Math.pow(10, zz / 10);
                    }
                    if (L > 0) z = 10 * Math.log10(L / 3);
                    if (z > -90) { const zc = z; z -= att; att = Math.min(14, att + 0.02 * Math.max(0, zc - 30) * GATE); }
                }
                let cl = 0;                                                     // clutter de solo
                if (el < 1.3 && r < 14 && hs(i, j, 9) < 0.35 * (1 - r / 14)) { cl = 1; z = Math.max(z, 8 + 14 * hs(i, j, 10)); }
                const zmin = -2 + 20 * Math.log10(Math.max(r, 1) / 50);        // sensibilidade cai com o alcance
                if (z < Math.max(5, zmin) && !cl) continue;
                F.Z[k] = z + (hs(i, j, 3) - 0.5) * 2;
                mZ = Math.max(mZ, F.Z[k]);

                const base = (H.mx * sa + H.my * ca) * ce;
                if (cl) {
                    F.V[k] = F.S[k] = (hs(i, j, 4) - 0.5) * 3; F.R[k] = 0.45 + 0.3 * hs(i, j, 6); F.K[k] = 0;
                    continue;
                }

                // vento na altura do feixe: movimento médio + saída de ar (decai com a altura) + vórtice de Rankine
                let u = H.mx, v = H.my;
                const dx = x - sx, dy = y - sy, d0 = Math.hypot(dx, dy) + 0.01;
                const so = H.W * 0.6 * Math.exp(-(dx * dx + dy * dy) / 392 - h / 2.5);
                u += dx / d0 * so; v += dy / d0 * so;
                if (H.rot) {
                    const vt = H.W * (rM < 2.5 ? rM / 2.5 : Math.pow(2.5 / rM, 0.6)) * Math.exp(-rM / 40) * Math.exp(-(h * h) / 64);
                    u += -mdy / rM * vt; v += mdx / rM * vt;
                }
                const vr = (u * sa + v * ca) * ce + (hs(i, j, 4) - 0.5) * 4;
                F.S[k] = vr - base;                                             // SRV usa a velocidade desdobrada
                F.V[k] = da ? vr : ((vr + VN) % (2 * VN) + 2 * VN) % (2 * VN) - VN;   // aliasing de Nyquist

                const z0 = F.Z[k];
                let rho = 0.985 + (hs(i, j, 6) - 0.5) * 0.014 - (z0 > 57 ? 0.06 : 0) - 0.12 * Math.exp(-(z0 - 8) / 4);
                if (H.tds && rM < 4 && h < 3) rho = 0.5 + 0.15 * hs(i, j, 7);
                F.R[k] = Math.max(0.2, rho);
                F.K[k] = Math.max(0, Math.min(6, (z0 - 15) / 12));
            }
        }
        const st = $("stats");
        if (st) st.textContent = "Máx: " + (mZ > -90 ? mZ.toFixed(0) + " dBZ (elev. " + el.toFixed(1) + "°)" : "sem eco nesta elevação") +
            " · ET " + mE.toFixed(1) + " km · VIL " + mL.toFixed(0) + " kg/m² · VIL-D " + mG.toFixed(1) + " g/m³" +
            (mG >= 3.5 ? " (≥ 3,5: potencial de granizo grande)" : "");
    }

    /* ---------- pintura (mapa pixel -> bin calculado uma vez por redimensionamento) ---------- */
    function buildMap(s) {
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
        const s = cv.width, p = P[prod], data = F[p.f], mask = p.col ? data : F.Z, l = p.l, d = img.data;
        const min = p.min === undefined ? -Infinity : p.min, n = s * s;
        for (let q = 0; q < n; q++) {
            const idx = map[q], o = q * 4;
            if (idx < 0) { d[o + 3] = 0; continue; }
            const v = data[idx], m = mask[idx];
            if (m !== m || v !== v || v < min) { d[o] = 2; d[o + 1] = 8; d[o + 2] = 4; d[o + 3] = 255; continue; }
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
        const a = sweep - Math.PI / 2;
        cx.fillStyle = "rgba(0,255,0,0.06)";
        cx.beginPath(); cx.moveTo(c, c); cx.arc(c, c, c, a - 0.4, a); cx.closePath(); cx.fill();
        cx.strokeStyle = "rgba(0,255,0,0.45)"; cx.lineWidth = 2 * dpr;
        cx.beginPath(); cx.moveTo(c, c); cx.lineTo(c + c * Math.cos(a), c + c * Math.sin(a)); cx.stroke();
    }

    /* ---------- alertas (regras do README, rotulados como simulados) ---------- */
    function alertas() {
        const dbz = +sl.dbz.value, w = +sl.w.value, mot = +sl.m.value, rot = sl.rot.value === "1";
        const out = [];
        const storm = dbz >= 35;                                   // há tempestade (eco convectivo)
        if (storm && (w >= 58 || dbz > 55)) out.push(["severe", "⚠️ Severe Thunderstorm Warning — SIMULADO"]);
        if (!storm && w >= 58) out.push(["wind", "💨 High Wind Warning — SIMULADO"]);
        if (dbz >= 45 && mot < 20) out.push(["flood", "🌊 Flash Flood Warning — SIMULADO"]);
        if (storm && rot && w >= 70 && dbz >= 60) out.push(["pds", "🚨 PDS Tornado Warning (TDS simulado)"]);
        else if (storm && rot) out.push(["tornado", "🌪️ Tornado Warning (Radar Indicated) — SIMULADO"]);

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

    function titulo() {
        const p = P[prod], t = $("radar-title");
        let s = "Display Principal: " + p.n;
        if (p.col) s += " — coluna completa";
        else s += " — elev. " + elev().toFixed(1) + "°";
        if (prod === "vento") s += " — Nyquist ±" + nyq() + " mph" + (dealias() ? " (desdobrada)" : "");
        if (t) t.textContent = s;
        if (ui.elev) ui.elev.disabled = !!p.col;
    }

    function refresh() {
        const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
        set("lbl-dbz", sl.dbz.value); set("lbl-vento", sl.w.value); set("lbl-desloc", sl.m.value);
        alertas(); titulo();
        dirty = true;
    }

    function setProduct(name) {
        prod = name;
        document.querySelectorAll(".btn-product").forEach(b => b.classList.toggle("active", b.dataset.p === name));
        titulo(); legend();
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
    Object.values(ui).forEach(e => { if (e) e.addEventListener("change", refresh); });
    const palFile = $("pal-file"), palTarget = $("pal-target"), palStatus = $("pal-status");
    if (palFile) palFile.addEventListener("change", () => {
        const file = palFile.files && palFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const colors = parsePal(String(reader.result || ""));
                const targets = palTarget && palTarget.value === "all" ? productKeys : [prod];
                targets.forEach(key => { P[key].l = paletteLut(colors); P[key].customColors = colors; });
                savePalettes();
                showPalettePreview(colors);
                legend(); dirty = true;
                if (palStatus) palStatus.textContent = colors.length + " cores importadas em " + (targets.length === 1 ? P[targets[0]].n : "todos os produtos") + ".";
            } catch (err) {
                if (palStatus) palStatus.textContent = "Erro: " + err.message;
            }
            palFile.value = "";
        };
        reader.onerror = () => { if (palStatus) palStatus.textContent = "Não foi possível ler o arquivo."; };
        reader.readAsText(file);
    });
    const palReset = $("btn-pal-reset");
    if (palReset) palReset.addEventListener("click", () => {
        for (const key of productKeys) { P[key].l = mk(P[key].st, P[key].a, P[key].b); delete P[key].customColors; }
        try { localStorage.removeItem(PALETTE_KEY); } catch (err) {}
        showPalettePreview([]);
        if (palStatus) palStatus.textContent = "Paletas padrão restauradas.";
        legend(); dirty = true;
    });

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
        const idx = ((az / TP * NAZ) | 0) * NG + ((r / GATE) | 0), p = P[prod], v = F[p.f][idx], m = (p.col ? F[p.f] : F.Z)[idx];
        if (m !== m || v !== v || (p.min !== undefined && v < p.min)) { readout.hidden = true; return; }
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
    fit();
    requestAnimationFrame(frame);
})();
