#!/usr/bin/env node
/**
 * donkey-swift MCP Server — exposes TypeScript package documentation via MCP tools.
 * Tools: search_packages, get_package, list_packages, usage_example
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "packages.db");

// Auto-index if DB doesn't exist
if (!existsSync(DB_PATH)) {
  console.error("[donkey-swift-mcp] Building index...");
  execSync("node indexer.mjs", { cwd: __dirname, stdio: "inherit" });
}

const db = new Database(DB_PATH, { readonly: true });

// ── Tool Definitions ────────────────────────────────────────────────────────

const tools = [
  {
    name: "search_packages",
    description: "Search donkey-swift packages by keyword. Use for finding packages by functionality (e.g. 'auth apple', 'push notification', 'websocket chat').",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'auth', 'push', 'sync')" },
        type: { type: "string", description: "Filter by type: service, utility, middleware, infrastructure", enum: ["service", "utility", "middleware", "infrastructure"] },
      },
      required: ["query"],
    },
  },
  {
    name: "get_package",
    description: "Get full documentation for a specific donkey-swift package by name. Returns interfaces, types, functions, and usage examples.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package name (e.g. 'auth', 'push', 'middleware')" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_packages",
    description: "List all donkey-swift packages with their descriptions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "usage_example",
    description: "Get a quick usage example for a donkey-swift package.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package name" },
      },
      required: ["name"],
    },
  },
];

// ── Tool Implementations ────────────────────────────────────────────────────

function searchPackages(query, type_) {
  // FTS5 prefix search
  let rows;
  const ftsQuery = query.split(/\s+/).map((w) => w + "*").join(" ");

  if (type_) {
    rows = db.prepare(`
      SELECT p.name, p.type, p.description
      FROM packages_fts fts
      JOIN packages p ON p.id = fts.rowid
      WHERE packages_fts MATCH ? AND p.type = ?
      ORDER BY rank
      LIMIT 10
    `).all(ftsQuery, type_);
  } else {
    rows = db.prepare(`
      SELECT p.name, p.type, p.description
      FROM packages_fts fts
      JOIN packages p ON p.id = fts.rowid
      WHERE packages_fts MATCH ?
      ORDER BY rank
      LIMIT 10
    `).all(ftsQuery);
  }

  // Fallback to LIKE if FTS returns nothing
  if (rows.length === 0) {
    const like = `%${query}%`;
    rows = db.prepare(`
      SELECT name, type, description FROM packages
      WHERE name LIKE ? OR description LIKE ? OR keywords LIKE ? OR body LIKE ?
      ${type_ ? "AND type = ?" : ""}
      LIMIT 10
    `).all(...(type_ ? [like, like, like, like, type_] : [like, like, like, like]));
  }

  if (rows.length === 0) return `No packages found for "${query}"`;

  return rows
    .map((r) => `### ${r.name} (${r.type})\n${r.description}`)
    .join("\n\n");
}

function getPackage(name) {
  const row = db.prepare(`SELECT * FROM packages WHERE LOWER(name) = LOWER(?)`).get(name);
  if (!row) return `Package "${name}" not found. Use search_packages to find it.`;

  let result = `# ${row.name}\n\n${row.description}\n\n**Type:** ${row.type}\n`;

  if (row.db_interface) {
    result += `\n## DB Interface\n\n\`\`\`typescript\n${row.db_interface}\n\`\`\`\n`;
  }
  if (row.types) {
    result += `\n## Types\n\n\`\`\`typescript\n${row.types}\n\`\`\`\n`;
  }
  if (row.functions) {
    result += `\n## Functions\n\n\`\`\`typescript\n${row.functions}\n\`\`\`\n`;
  }
  if (row.usage_example) {
    result += `\n## Usage Example\n\n\`\`\`typescript\n${row.usage_example}\n\`\`\`\n`;
  }

  return result;
}

function listPackages() {
  const rows = db.prepare(`SELECT name, type, description FROM packages ORDER BY name`).all();
  if (rows.length === 0) return "No packages indexed.";

  return rows
    .map((r) => `- **${r.name}** (${r.type}) — ${r.description}`)
    .join("\n");
}

function usageExample(name) {
  const row = db.prepare(`SELECT name, usage_example, functions FROM packages WHERE LOWER(name) = LOWER(?)`).get(name);
  if (!row) return `Package "${name}" not found.`;

  if (row.usage_example) {
    return `# ${row.name} — Usage Example\n\n\`\`\`typescript\n${row.usage_example}\n\`\`\``;
  }

  if (row.functions) {
    return `# ${row.name} — Functions\n\n\`\`\`typescript\n${row.functions}\n\`\`\`\n\nSee COMPONENTS.md for full examples.`;
  }

  return `No usage example available for ${row.name}. Check COMPONENTS.md.`;
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "donkey-swift", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "search_packages":
      result = searchPackages(args.query, args.type);
      break;
    case "get_package":
      result = getPackage(args.name);
      break;
    case "list_packages":
      result = listPackages();
      break;
    case "usage_example":
      result = usageExample(args.name);
      break;
    default:
      result = `Unknown tool: ${name}`;
  }

  return { content: [{ type: "text", text: result }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
