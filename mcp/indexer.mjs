#!/usr/bin/env node
/**
 * Indexes COMPONENTS.md into SQLite FTS5 for fast search.
 * Run once: node indexer.mjs
 */

import { readFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_PATH = join(__dirname, "..", "COMPONENTS.md");
const DB_PATH = join(__dirname, "packages.db");

// Remove existing DB
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'package',
    description TEXT NOT NULL DEFAULT '',
    db_interface TEXT NOT NULL DEFAULT '',
    types TEXT NOT NULL DEFAULT '',
    functions TEXT NOT NULL DEFAULT '',
    usage_example TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT ''
  );

  CREATE VIRTUAL TABLE packages_fts USING fts5(
    name, type, description, db_interface, types, functions, keywords, body,
    content='packages', content_rowid='id'
  );
`);

const insertPkg = db.prepare(`
  INSERT INTO packages (name, type, description, db_interface, types, functions, usage_example, keywords, body)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFts = db.prepare(`
  INSERT INTO packages_fts (rowid, name, type, description, db_interface, types, functions, keywords, body)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Parse COMPONENTS.md
const content = readFileSync(COMPONENTS_PATH, "utf-8");
const sections = content.split(/\n## (?!App Wiring)/).slice(1); // Split on ## headers, skip preamble

let count = 0;

const insertAll = db.transaction(() => {
  for (const section of sections) {
    const lines = section.split("\n");
    const name = lines[0].trim();

    if (!name || name.startsWith("App Wiring")) continue;

    // Extract description (first non-empty line after header)
    let description = "";
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith("#") && !line.startsWith("```")) {
        description = line;
        break;
      }
    }

    // Extract code blocks by subsection
    let dbInterface = "";
    let types = "";
    let functions = "";
    let usageExample = "";
    let currentSubsection = "";

    const body = section;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("### ")) {
        currentSubsection = line.replace("### ", "").trim().toLowerCase();
        continue;
      }

      if (line.startsWith("```")) {
        // Collect code block
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        const code = codeLines.join("\n");

        if (currentSubsection.includes("db interface") || currentSubsection.includes("app interface") || currentSubsection.includes("store interface")) {
          dbInterface += code + "\n";
        } else if (currentSubsection.includes("type")) {
          types += code + "\n";
        } else if (currentSubsection.includes("function")) {
          functions += code + "\n";
        } else if (currentSubsection.includes("usage")) {
          usageExample += code + "\n";
        } else {
          // Generic code block — add to types or functions based on content
          if (code.includes("interface ") || code.includes("type ")) {
            types += code + "\n";
          } else if (code.includes("function ") || code.includes("=> ") || code.includes("export ")) {
            functions += code + "\n";
          }
        }
      }
    }

    // Determine type
    let type_ = "package";
    if (name === "httputil" || name === "utils") type_ = "utility";
    else if (name === "middleware") type_ = "middleware";
    else if (name === "migrate" || name === "migrations") type_ = "utility";
    else if (name === "logger") type_ = "utility";
    else if (name === "storage") type_ = "infrastructure";
    else if (name === "database" || name === "db") type_ = "infrastructure";
    else type_ = "service";

    // Build keywords
    const keywords = [
      name,
      type_,
      ...description.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    ].join(" ");

    const result = insertPkg.run(
      name, type_, description, dbInterface.trim(), types.trim(),
      functions.trim(), usageExample.trim(), keywords, body.trim()
    );

    insertFts.run(
      result.lastInsertRowid,
      name, type_, description, dbInterface.trim(), types.trim(),
      functions.trim(), keywords, body.trim()
    );

    count++;
  }
});

insertAll();

console.log(`Indexed ${count} packages into ${DB_PATH}`);
db.close();
