(() => {
    "use strict";

    const $ = id => document.getElementById(id);
    const canvas = $("radarCanvas");
    const ctx = canvas && canvas.getContext("2d");

    if (!canvas || !ctx) {
        console.error("THE-RADAR: canvas radarCanvas não encontrado.");
        return;
    }

    const slDbz = $("sl-dbz");
    const slVento = $("sl-vento");
    const slDesloc = $("sl-desloc");
    const seCouplet = $("se-couplet");
    const lblDbz = $("lbl-dbz");
    const lblVento = $("lbl-vento");
    const lblDesloc = $("lbl-desloc");
    const alertsList = $("alerts-list");
    const radarTitle = $("radar-title");

    if (![slDbz, slVento, slDesloc, seCouplet].every(Boolean)) {
        console.error("THE-RADAR: controles obrigatórios ausentes.");
        return;
    }

    // Produtos: mantém os botões já existentes e cria SRV/KDP se necessário.
    const buttons = {
        dbz: $("btn-dbz"),
        vento: $("btn-vento"),
        cc: $("btn-cc")
    };

    const productContainer = buttons.dbz && buttons.dbz.parentElement;

    function criarBotao(id, label) {
        let button = $(id);
        if (!button && productContainer) {
            button = document.createElement("button");
            button.id = id;
            button.className = "btn-product";
            button.textContent = label;
            button.style.cssText =
                "flex:1;min-width:42px;padding:6px;background:#222;color:#fff;" +
                "border:1px solid #444;border-radius:4px;cursor:pointer;";
            productContainer.appendChild(button);
        }
        return button;
    }

    buttons.srv = criarBotao("btn-srv", "SRV");
    buttons.kdp = criarBotao("btn-kdp", "KDP");

    const nomes = {
        dbz: "Refletividade (dBZ)",
        vento: "Velocidade Base (mph)",
        srv: "Storm Relative Velocity (mph)",
        cc: "Coeficiente de Correlação (CC)",
        kdp: "Fase Diferencial Específica (°/km)"
    };

    let produtoAtivo = "dbz";
    let sweepAngle = 0;

    let stormX = 145;
    let stormY = 155;
    let ageSeconds = 0;
    let vitality = 100;
    let currentDbz = Number(slDbz.value);
    let dissipated = false;
    let previousFrame = performance.now();
    let possibleTds = false;
    let previousCouplet = String(seCouplet.value);

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    // Ruído determinístico interpolado: cria textura espacial sem flicker aleatório.
    function noise2D(x, y, scale) {
        const gx = x / scale;
        const gy = y / scale;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx0 = gx - ix;
        const fy0 = gy - iy;
        const fx = fx0 * fx0 * (3 - 2 * fx0);
        const fy = fy0 * fy0 * (3 - 2 * fy0);

        const hash = (px, py) => {
            const value = Math.sin(px * 127.1 + py * 311.7) * 43758.5453;
            return (value - Math.floor(value)) * 2 - 1;
        };

        const a = lerp(hash(ix, iy), hash(ix + 1, iy), fx);
        const b = lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx);
        return lerp(a, b, fy);
    }

    // Transparente fora dos ecos: evita que CC/Velocity/SRV virem retângulos.
    const overlay = document.createElement("canvas");
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const overlayCtx = overlay.getContext("2d");
    const image = overlayCtx.createImageData(overlay.width, overlay.height);
    const pixels = image.data;

    function atualizarLabels() {
        if (lblDbz) lblDbz.textContent = slDbz.value;
        if (lblVento) lblVento.textContent = slVento.value;
        if (lblDesloc) lblDesloc.textContent = slDesloc.value;
    }

    function selecionarProduto(produto) {
        produtoAtivo = produto;

        Object.entries(buttons).forEach(([key, button]) => {
            if (!button) return;
            const active = key === produto;
            button.style.background = active ? "#00ff00" : "#222";
            button.style.color = active ? "#000" : "#fff";
            button.style.fontWeight = active ? "bold" : "normal";
            button.style.border = active ? "none" : "1px solid #444";
        });

        if (radarTitle) {
            radarTitle.textContent = "Display Principal: " + nomes[produto];
        }
    }

    Object.entries(buttons).forEach(([produto, button]) => {
        if (button) button.addEventListener("click", () => selecionarProduto(produto));
    });

    function desenharGrade() {
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        ctx.fillStyle = "#000600";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "#123019";
        ctx.lineWidth = 1;

        for (let r = 45; r < Math.min(w, h) / 2; r += 45) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();
    }

    function atualizarTempestade(dt) {
        if (dissipated) return;

        const dbzTarget = Number(slDbz.value);
        const wind = Number(slVento.value);
        const motion = Number(slDesloc.value);
        const rotating = seCouplet.value === "1";

        ageSeconds += dt;

        // Índice ilustrativo de condições sustentadoras, não um modelo NWP.
        const organization =
            (dbzTarget / 75) * 0.40 +
            clamp(wind / 90, 0, 1) * 0.25 +
            (rotating ? 0.25 : 0) +
            clamp(1 - Math.abs(motion - 25) / 45, 0, 1) * 0.10;

        vitality = clamp(vitality + (organization - 0.48) * 10 * dt, 0, 100);

        currentDbz = lerp(
            currentDbz,
            dbzTarget * vitality / 100,
            1 - Math.exp(-dt * 0.8)
        );

        stormX += motion * 0.45 * dt;
        stormY += motion * 0.10 * dt;

        if (stormX > canvas.width + 100 || stormY > canvas.height + 100) {
            stormX = 40;
            stormY = 60;
        }

        if (vitality <= 0.5 || currentDbz < 1) dissipated = true;
    }

    // Campo de eco único compartilhado por todos os produtos.
    function calcularCampo(x, y) {
        const dx = x - stormX;
        const dy = y - stormY;
        const angle = Math.atan2(dy, dx);
        const radius = Math.hypot(dx, dy);

        // Campo de precipitação irregular, com textura em várias escalas.
        // O deslocamento lento do ruído simula pequenas mudanças entre varreduras.
        let deformation = 1;
        if (angle > -1.5 && angle < 0.5) deformation = 0.82;
        if (angle > 0.7 && angle < 2.4) deformation = 1.28;

        const drift = ageSeconds * 0.7;
        const broadTexture = noise2D(x + drift, y - drift * 0.35, 27);
        const cellTexture = noise2D(x - drift * 0.5, y + drift, 12);
        const fineTexture = noise2D(x + drift * 0.2, y - drift * 0.2, 5);
        const edgePerturbation = broadTexture * 8 + cellTexture * 5;
        const bodyRadius = radius * deformation + edgePerturbation;
        const edge = 51 + broadTexture * 5;
        const insideBody = bodyRadius < edge;

        let dbz = insideBody
            ? currentDbz * Math.pow(clamp(1 - bodyRadius / edge, 0, 1), 0.62)
            : 0;

        if (insideBody) {
            // Granulação de reflectividade: pequenas variações sem círculos concêntricos.
            const textureFactor = clamp(
                0.91 + broadTexture * 0.10 + cellTexture * 0.13 + fineTexture * 0.12,
                0.58,
                1.14
            );
            dbz *= textureFactor;
        }

        // Pequenos bolsões de precipitação assimétricos dentro do eco principal.
        const lobe1 = Math.hypot(x - (stormX + 17), y - (stormY - 9));
        const lobe2 = Math.hypot(x - (stormX - 20), y - (stormY + 15));
        const lobe3 = Math.hypot(x - (stormX + 4), y - (stormY + 28));
        const lobeNoise = noise2D(x + 13, y - 7, 9);
        const embeddedCore = Math.max(
            0,
            1 - lobe1 / 22,
            1 - lobe2 / 17,
            1 - lobe3 / 19
        );
        if (embeddedCore > 0) {
            dbz = Math.max(dbz, currentDbz * embeddedCore *
                clamp(0.78 + lobeNoise * 0.16, 0.55, 0.96));
        }

        const mesoX = stormX + 15;
        const mesoY = stormY + 25;
        const mx = x - mesoX;
        const my = y - mesoY;
        const rMeso = Math.hypot(mx, my);
        const aMeso = Math.atan2(my, mx);
        const rotating = seCouplet.value === "1";

        // Hook echo no sudoeste (x negativo e y positivo no canvas).
        // Um arco estreito, com raio variável para formar uma curva.
        let hookEcho = false;
        if (rotating && mx < 0 && my > 0) {
            const minAngle = 2.02;
            const maxAngle = 3.08;

            if (aMeso >= minAngle && aMeso <= maxAngle) {
                const t = (aMeso - minAngle) / (maxAngle - minAngle);
                const targetRadius = 12 + 17 * t;
                const arcDistance = Math.abs(rMeso - targetRadius);

                if (arcDistance < 4.5) {
                    hookEcho = true;
                    const hookDbz = currentDbz * 0.88 *
                        clamp(1 - arcDistance / 4.5, 0, 1);
                    dbz = Math.max(dbz, hookDbz);
                }
            }
        }

        // Região central de eco fraco (BWER) em vez de núcleo superbrilhante.
        const insideBwer = rotating && rMeso < 5.5;
        if (insideBwer) dbz = Math.min(dbz, currentDbz * 0.12);

        const inEcho = dbz >= 8 || (hookEcho && currentDbz >= 8);
        const inVelocityDomain = rotating && rMeso < 53 && currentDbz > 8;
        const activeArea = inEcho || inVelocityDomain;

        if (!activeArea) {
            return {
                active: false, dbz: 0, baseVelocity: 0, srv: 0,
                cc: 1, kdp: 0, hookEcho: false, possibleDebris: false
            };
        }

        // Vetor tangencial de uma circulação idealizada.
        // Projeção sobre o feixe do radar = velocidade radial sintética.
        const rSafe = Math.max(rMeso, 1);
        const tangentialSpeed = rotating
            ? Number(slVento.value) * Math.exp(-rMeso / 42)
            : 0;

        const vxRotation = -my / rSafe * tangentialSpeed;
        const vyRotation = mx / rSafe * tangentialSpeed;

        const radarX = x - canvas.width / 2;
        const radarY = y - canvas.height / 2;
        const radarRange = Math.max(1, Math.hypot(radarX, radarY));
        const beamX = radarX / radarRange;
        const beamY = radarY / radarRange;

        const motionX = Number(slDesloc.value) * 0.45;
        const motionY = Number(slDesloc.value) * 0.10;

        const stormMotionRadial = motionX * beamX + motionY * beamY;
        const rotationRadial = vxRotation * beamX + vyRotation * beamY;

        const baseVelocity = clamp(
            stormMotionRadial + rotationRadial,
            -120,
            120
        );
        const srv = clamp(baseVelocity - stormMotionRadial, -120, 120);

        // CC é desenhado somente onde há eco, nunca em toda a caixa de cálculo.
        const noise =
            Math.sin(x * 0.19 + y * 0.11) *
            Math.cos(y * 0.16 - x * 0.07) * 0.025;

        let cc = inEcho ? clamp(0.975 + noise, 0.90, 1) : 1;
        const possibleDebris =
            rotating && possibleTds && rMeso < 7 && dbz > 35;

        if (possibleDebris) {
            cc = 0.48 + Math.abs(noise);
        }

        // KDP ilustrativo associado à precipitação simulada.
        const kdp = inEcho ? clamp((dbz - 15) / 12, 0, 5) : 0;

        return {
            active: true,
            inEcho,
            dbz: clamp(dbz, 0, 75),
            baseVelocity,
            srv,
            cc: clamp(cc, 0, 1),
            kdp,
            hookEcho,
            insideBwer,
            possibleDebris
        };
    }

    function corDbz(v) {
        if (v >= 65) return [255, 0, 255];
        if (v >= 55) return [190, 0, 190];
        if (v >= 50) return [255, 0, 0];
        if (v >= 45) return [255, 75, 0];
        if (v >= 40) return [255, 145, 0];
        if (v >= 35) return [255, 205, 0];
        if (v >= 30) return [255, 255, 0];
        if (v >= 25) return [130, 255, 0];
        if (v >= 20) return [0, 220, 0];
        if (v >= 15) return [0, 190, 100];
        if (v >= 10) return [0, 190, 210];
        if (v >= 5) return [0, 100, 255];
        return null;
    }

    function corVelocidade(v) {
        // Verde = movimento negativo (em direção ao radar);
        // vermelho = positivo (afastando-se), convenção deste simulador.
        if (v >= 65) return [255, 0, 0];
        if (v >= 30) return [255, 90, 90];
        if (v >= 8) return [255, 190, 190];
        if (v <= -65) return [0, 255, 0];
        if (v <= -30) return [0, 190, 90];
        if (v <= -8) return [0, 100, 255];
        return [90, 90, 90];
    }

    function corCC(v) {
        if (v < 0.65) return [0, 255, 255];
        if (v < 0.80) return [0, 90, 255];
        if (v < 0.90) return [170, 0, 255];
        if (v < 0.96) return [255, 0, 170];
        return [0, 170, 65];
    }

    function corKdp(v) {
        if (v >= 4) return [255, 0, 255];
        if (v >= 2) return [255, 0, 0];
        if (v >= 1) return [255, 255, 0];
        if (v >= 0.3) return [0, 255, 0];
        return null;
    }

    function corProduto(campo) {
        if (produtoAtivo === "dbz") return campo.inEcho ? corDbz(campo.dbz) : null;
        if (produtoAtivo === "vento") return campo.active ? corVelocidade(campo.baseVelocity) : null;
        if (produtoAtivo === "srv") return campo.active ? corVelocidade(campo.srv) : null;
        if (produtoAtivo === "cc") return campo.inEcho ? corCC(campo.cc) : null;
        if (produtoAtivo === "kdp") return campo.inEcho ? corKdp(campo.kdp) : null;
        return null;
    }

    function desenharEcos() {
        // Zera o overlay inteiro a cada quadro: nenhum resíduo retangular.
        pixels.fill(0);

        const left = Math.max(0, Math.floor(stormX - 105));
        const right = Math.min(canvas.width, Math.ceil(stormX + 105));
        const top = Math.max(0, Math.floor(stormY - 105));
        const bottom = Math.min(canvas.height, Math.ceil(stormY + 105));

        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) {
                const field = calcularCampo(x + 0.5, y + 0.5);
                const color = corProduto(field);
                if (!color) continue;

                const i = (y * overlay.width + x) * 4;
                pixels[i] = color[0];
                pixels[i + 1] = color[1];
                pixels[i + 2] = color[2];
                pixels[i + 3] = 255;
            }
        }

        overlayCtx.putImageData(image, 0, 0);
        desenharGrade();
        ctx.drawImage(overlay, 0, 0);

        // Marcador do centro de circulação.
        if (seCouplet.value === "1" && !dissipated) {
            ctx.strokeStyle = "rgba(255,255,255,0.7)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(stormX + 15, stormY + 25, 5, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.strokeStyle = "rgba(0,255,0,0.18)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, canvas.height / 2);
        ctx.lineTo(
            canvas.width / 2 + canvas.width / 2 * Math.cos(sweepAngle),
            canvas.height / 2 + canvas.height / 2 * Math.sin(sweepAngle)
        );
        ctx.stroke();

        sweepAngle = (sweepAngle + 0.025) % (Math.PI * 2);
    }

    function processarAlertas() {
        if (!alertsList) return;

        const dbz = Number(slDbz.value);
        const wind = Number(slVento.value);
        const rotating = seCouplet.value === "1";
        const alerts = [];

        if (dissipated) {
            alerts.push("☁️ TEMPESTADE DISSIPADA — SIMULAÇÃO");
        } else {
            if (dbz >= 55 && wind >= 58) {
                alerts.push("⚠️ TEMPESTADE SEVERA — SIMULAÇÃO");
            }
            if (rotating && vitality > 20) {
                alerts.push("🌪️ ROTAÇÃO DETECTADA — SIMULAÇÃO");
            }
            if (rotating && possibleTds && dbz >= 35) {
                alerts.push("🟦 POSSÍVEL ASSINATURA DE DETRITOS — SIMULADA");
            }
            if (Number(slDesloc.value) < 15 && dbz >= 45) {
                alerts.push("🌊 RISCO DE CHUVA PERSISTENTE — SIMULAÇÃO");
            }
        }

        if (!alerts.length) alerts.push("Atmosfera monitorada. Sem alertas simulados.");
        alertsList.textContent = "";
        alerts.forEach(message => {
            const line = document.createElement("div");
            line.textContent = message;
            alertsList.appendChild(line);
        });
    }

    function criarPainelStatus() {
        let panel = $("storm-status");
        if (panel) return panel;

        const parent = alertsList && alertsList.parentElement;
        if (!parent) return null;

        panel = document.createElement("div");
        panel.id = "storm-status";
        panel.style.cssText =
            "margin-top:12px;padding:10px;background:#101810;" +
            "border:1px solid #244024;border-radius:6px;color:#baffba;" +
            "font:12px monospace;line-height:1.7;";
        parent.appendChild(panel);
        return panel;
    }

    function atualizarPainelStatus() {
        const panel = criarPainelStatus();
        if (!panel) return;

        const totalSeconds = Math.floor(ageSeconds);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        let stage = "Desenvolvimento";

        if (dissipated) stage = "Dissipada";
        else if (vitality < 30) stage = "Dissipação";
        else if (vitality >= 75 && ageSeconds > 30) stage = "Maturidade";
        else if (vitality >= 45) stage = "Organizada";

        panel.textContent =
            "ESTADO DA TEMPESTADE\n" +
            "Tempo de vida: " + String(minutes).padStart(2, "0") + ":" +
            String(seconds).padStart(2, "0") + "\n" +
            "Estágio: " + stage + "\n" +
            "Refletividade simulada: " + currentDbz.toFixed(1) + " dBZ\n" +
            "Vitalidade: " + vitality.toFixed(0) + "%";
        panel.style.whiteSpace = "pre-line";
    }

    function criarBotaoReiniciar() {
        if ($("btn-reset")) return;

        const controls = $("controls");
        if (!controls) return;

        const button = document.createElement("button");
        button.id = "btn-reset";
        button.textContent = "↻ Reiniciar tempestade";
        button.style.cssText =
            "margin-top:10px;padding:8px 10px;width:100%;" +
            "background:#17351b;color:#fff;border:1px solid #397342;" +
            "border-radius:5px;cursor:pointer;";

        button.addEventListener("click", () => {
            ageSeconds = 0;
            vitality = 100;
            currentDbz = Number(slDbz.value);
            dissipated = false;
            stormX = 145;
            stormY = 155;
            previousFrame = performance.now();
        });

        controls.appendChild(button);
    }

    seCouplet.addEventListener("change", () => {
        const state = String(seCouplet.value);

        if (state === "1" && previousCouplet === "0") {
            // Evento único ao ligar a rotação; 38% é uma chance didática,
            // não uma probabilidade meteorológica real.
            possibleTds = Math.random() < 0.38;
        }

        if (state === "0") possibleTds = false;
        previousCouplet = state;
    });

    function loop(now) {
        const dt = Math.min((now - previousFrame) / 1000, 0.1);
        previousFrame = now;

        atualizarLabels();
        atualizarTempestade(dt);
        desenharEcos();
        processarAlertas();
        atualizarPainelStatus();

        requestAnimationFrame(loop);
    }

    criarBotaoReiniciar();
    selecionarProduto("dbz");
    requestAnimationFrame(loop);
})();