// The announcement pack, the same drawing code as the website (src/lib/announce-draw.ts).
// Draws an announcement image on a canvas: the built-in pack, or a school's
// own uploaded design with the text laid over it.
const SIZES = { post: [1080, 1350], square: [1080, 1080], story: [1080, 1920] };
// The professional pack: drawn here, coloured with the school's colour.
const PACK = ["clean", "bold", "split", "notice", "event", "holiday"];
function wrap(ctx, text, maxWidth) {
    const lines = [];
    for (const para of text.split("\n")) {
        let line = "";
        for (const word of para.split(/\s+/)) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            }
            else
                line = test;
        }
        lines.push(line);
    }
    return lines;
}
function fontFamily() {
    const css = getComputedStyle(document.body);
    return `${css.getPropertyValue("--font-plex") || "'IBM Plex Sans Arabic'"}, ${css.getPropertyValue("--font-inter") || "Inter"}, sans-serif`;
}
function textBlock(ctx, t, x, y, width, color, align = "center") {
    const family = fontFamily();
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    let cy = y;
    const put = (text, size, weight, rtl, gap) => {
        if (!text.trim())
            return;
        ctx.font = `${weight} ${size}px ${family}`;
        ctx.direction = rtl ? "rtl" : "ltr";
        for (const line of wrap(ctx, text, width)) {
            ctx.fillText(line, align === "center" ? x + width / 2 : align === "right" ? x + width : x, cy);
            cy += size * 1.25;
        }
        cy += gap;
    };
    put(t.ar, 92, 700, true, 24);
    put(t.en, 58, 600, false, 40);
    ctx.globalAlpha = 0.85;
    put(t.details, 42, 500, /[؀-ۿ]/.test(t.details), 0);
    ctx.globalAlpha = 1;
    return cy;
}
async function drawAnnouncement(canvas, template, size, t, designs, images) {
    const [w, h] = SIZES[size];
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const pad = 90;
    const footer = () => {
        ctx.font = `600 34px ${fontFamily()}`;
        ctx.textAlign = "center";
        ctx.direction = "rtl";
        ctx.globalAlpha = 0.9;
        ctx.fillText(t.school, w / 2, h - 110);
        ctx.globalAlpha = 1;
    };
    const middle = (color, top = pad, bottom = h - 180) => {
        // Measure first, then centre the block vertically.
        const probe = document.createElement("canvas").getContext("2d");
        const height = textBlock(probe, t, pad, 0, w - pad * 2, color) - 0;
        const y = top + Math.max(0, (bottom - top - height) / 2);
        textBlock(ctx, t, pad, y, w - pad * 2, color);
    };
    if (template.startsWith("design:")) {
        const d = designs.find((x) => `design:${x.path}` === template);
        const img = d ? images.get(d.url) : null;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        if (img) {
            const s = Math.max(w / img.width, h / img.height);
            ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
        }
        middle(t.ink);
        return;
    }
    switch (template) {
        case "clean":
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = t.accent;
            ctx.fillRect(0, 0, w, 40);
            ctx.fillRect(0, h - 40, w, 40);
            middle("#1b1d22");
            ctx.fillStyle = t.accent;
            footer();
            break;
        case "bold":
            ctx.fillStyle = t.accent;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "rgba(255,255,255,.08)";
            ctx.beginPath();
            ctx.arc(w * 0.85, h * 0.12, 320, 0, Math.PI * 2);
            ctx.fill();
            middle("#ffffff");
            ctx.fillStyle = "#ffffff";
            footer();
            break;
        case "split": {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = t.accent;
            ctx.fillRect(0, 0, w, h * 0.42);
            ctx.fillStyle = "#ffffff";
            ctx.font = `700 64px ${fontFamily()}`;
            ctx.textAlign = "center";
            ctx.direction = "rtl";
            ctx.fillText("إعلان · Announcement", w / 2, h * 0.2);
            middle("#1b1d22", h * 0.5);
            ctx.fillStyle = t.accent;
            footer();
            break;
        }
        case "notice":
            ctx.fillStyle = "#fffaf0";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = t.accent;
            ctx.lineWidth = 14;
            ctx.strokeRect(46, 46, w - 92, h - 92);
            ctx.fillStyle = t.accent;
            ctx.font = `700 46px ${fontFamily()}`;
            ctx.textAlign = "center";
            ctx.direction = "rtl";
            ctx.fillText("📢  تنبيه · Notice", w / 2, 130);
            middle("#1b1d22", 220);
            ctx.fillStyle = t.accent;
            footer();
            break;
        case "event": {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            const m = /(\d{1,2})/.exec(t.details);
            ctx.fillStyle = t.accent;
            ctx.beginPath();
            ctx.roundRect(w / 2 - 170, 120, 340, 300, 40);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = `700 180px ${fontFamily()}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.direction = "ltr";
            ctx.fillText(m ? m[1] : "★", w / 2, 280);
            middle("#1b1d22", 470);
            ctx.fillStyle = t.accent;
            footer();
            break;
        }
        case "holiday": {
            const g = ctx.createLinearGradient(0, 0, w, h);
            g.addColorStop(0, t.accent);
            g.addColorStop(1, "#1b1d22");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "rgba(255,255,255,.07)";
            for (const [cx, cy, r] of [[0.1, 0.2, 160], [0.9, 0.35, 220], [0.3, 0.9, 260], [0.75, 0.85, 120]]) {
                ctx.beginPath();
                ctx.arc(w * cx, h * cy, r, 0, Math.PI * 2);
                ctx.fill();
            }
            middle("#ffffff");
            ctx.fillStyle = "#ffffff";
            footer();
            break;
        }
    }
}
