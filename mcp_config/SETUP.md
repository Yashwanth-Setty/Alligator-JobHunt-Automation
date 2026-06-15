# MCP Setup Instructions

## Step 1 — Install Node.js
Download from nodejs.org if not installed.

## Step 2 — Copy config to Claude Desktop
Copy claude_desktop_config.json to:
Windows: %APPDATA%\Claude\claude_desktop_config.json

## Step 3 — Add to .env
GOOGLE_SHEET_ID=your_sheet_id_here
BRAVE_API_KEY=your_brave_key_here
(Brave free key at brave.com/search/api)

## Step 4 — Create Google Sheet
Create a Google Sheet with these tabs:
- Worker Reports  (worker fills this daily)
- Alert Log       (auto-populated by system)
- Audit Results   (Claude Code writes here)

Worker Reports tab columns:
A: Date | B: Company | C: Role | D: Applied? | E: Notes

## Step 5 — Restart Claude Desktop
MCP servers load on startup.

## Step 6 — Test
Open Claude Desktop, type:
/audit-today
