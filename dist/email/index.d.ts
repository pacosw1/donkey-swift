export interface EmailProvider {
    /** Send an email. htmlBody is optional — if empty, sends plain text only. */
    send(to: string, subject: string, textBody: string, htmlBody?: string): Promise<void>;
}
export declare class LogProvider implements EmailProvider {
    send(to: string, subject: string, textBody: string): Promise<void>;
}
export declare class NoopProvider implements EmailProvider {
    send(): Promise<void>;
}
export interface SMTPConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
    from: string;
    fromName?: string;
}
export declare class SMTPProvider implements EmailProvider {
    private transport;
    private from;
    constructor(cfg: SMTPConfig);
    send(to: string, subject: string, textBody: string, htmlBody?: string): Promise<void>;
}
/** Creates an email provider. Returns SMTP if host is set, LogProvider otherwise. */
export declare function newProvider(cfg: Partial<SMTPConfig>): EmailProvider;
export interface EmailTemplate {
    subject: string;
    html?: string;
    text?: string;
}
/** Simple template renderer with {{.key}} interpolation. */
export declare class Renderer {
    private templates;
    register(name: string, template: EmailTemplate): void;
    render(name: string, data: Record<string, string>): {
        subject: string;
        html: string;
        text: string;
    };
}
//# sourceMappingURL=index.d.ts.map