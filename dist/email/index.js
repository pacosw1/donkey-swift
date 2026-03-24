// ── Provider Interface ──────────────────────────────────────────────────────
// ── LogProvider ─────────────────────────────────────────────────────────────
export class LogProvider {
    async send(to, subject, textBody) {
        console.log(`[email/log] to=${to} subject="${subject}" body=${textBody.slice(0, 80)}`);
    }
}
// ── NoopProvider ────────────────────────────────────────────────────────────
export class NoopProvider {
    async send() { }
}
/** Simple template renderer with {{.key}} interpolation. */
export class Renderer {
    templates = new Map();
    register(name, template) {
        this.templates.set(name, template);
    }
    render(name, data) {
        const tmpl = this.templates.get(name);
        if (!tmpl)
            throw new Error(`email template "${name}" not found`);
        return {
            subject: interpolate(tmpl.subject, data),
            html: tmpl.html ? interpolate(tmpl.html, data) : "",
            text: tmpl.text ? interpolate(tmpl.text, data) : "",
        };
    }
}
function interpolate(template, data) {
    return template.replace(/\{\{\.(\w+)\}\}/g, (_, key) => data[key] ?? "");
}
//# sourceMappingURL=index.js.map