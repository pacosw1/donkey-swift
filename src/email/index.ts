// ── Provider Interface ──────────────────────────────────────────────────────

export interface EmailProvider {
  /** Send an email. htmlBody is optional — if empty, sends plain text only. */
  send(to: string, subject: string, textBody: string, htmlBody?: string): Promise<void>;
}

// ── LogProvider ─────────────────────────────────────────────────────────────

export class LogProvider implements EmailProvider {
  async send(to: string, subject: string, textBody: string): Promise<void> {
    console.log(`[email/log] to=${to} subject="${subject}" body=${textBody.slice(0, 80)}`);
  }
}

// ── NoopProvider ────────────────────────────────────────────────────────────

export class NoopProvider implements EmailProvider {
  async send(): Promise<void> {}
}

// ── SMTP Config (for reference — implement SMTPProvider in your app) ────────

export interface SMTPConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  from: string;
  fromName?: string;
}

// ── Template Renderer ───────────────────────────────────────────────────────

export interface EmailTemplate {
  subject: string;
  html?: string;
  text?: string;
}

/** Simple template renderer with {{.key}} interpolation. */
export class Renderer {
  private templates = new Map<string, EmailTemplate>();

  register(name: string, template: EmailTemplate): void {
    this.templates.set(name, template);
  }

  render(
    name: string,
    data: Record<string, string>
  ): { subject: string; html: string; text: string } {
    const tmpl = this.templates.get(name);
    if (!tmpl) throw new Error(`email template "${name}" not found`);

    return {
      subject: interpolate(tmpl.subject, data),
      html: tmpl.html ? interpolate(tmpl.html, data) : "",
      text: tmpl.text ? interpolate(tmpl.text, data) : "",
    };
  }
}

function interpolate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{\.(\w+)\}\}/g, (_, key) => data[key] ?? "");
}
