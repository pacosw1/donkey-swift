import { createTransport } from "nodemailer";
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
export class SMTPProvider {
    transport;
    from;
    constructor(cfg) {
        if (!cfg.host || !cfg.port || !cfg.from) {
            throw new Error("email: host, port, and from are required");
        }
        this.from = cfg.fromName ? `${cfg.fromName} <${cfg.from}>` : cfg.from;
        this.transport = createTransport({
            host: cfg.host,
            port: cfg.port,
            auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
        });
    }
    async send(to, subject, textBody, htmlBody) {
        await this.transport.sendMail({
            from: this.from,
            to,
            subject,
            text: textBody,
            html: htmlBody || undefined,
        });
    }
}
/** Creates an email provider. Returns SMTP if host is set, LogProvider otherwise. */
export function newProvider(cfg) {
    if (!cfg.host) {
        console.log("[email] no SMTP host — using log provider");
        return new LogProvider();
    }
    return new SMTPProvider(cfg);
}
/** Simple template renderer with {{key}} interpolation. */
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