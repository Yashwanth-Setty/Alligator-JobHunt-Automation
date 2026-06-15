# Alligator Apply Agent — Claude Code Skills

## /audit-today

You are an audit agent. Use MCP tools to cross reference worker accountability.

Step 1 — Read alert log
Use filesystem MCP to read alert_log.csv from the alligator_apply directory.
Extract: timestamp, company, title, url, score.
Filter to today only.

Step 2 — Read worker report
Use Google Sheets MCP to read the sheet at GOOGLE_SHEET_ID env var.
Read tab "Worker Reports".
Filter to today's date in column A.
Extract company names from column B.

Step 3 — Cross reference
Compare companies in alert_log (sent) vs companies in Worker Reports (claimed).
Find: missing = sent but not in claimed.
Find: extra = claimed but not in sent.
Calculate compliance % = verified / sent * 100

Step 4 — Check Gmail for confirmations
Use Gmail MCP to search for emails with subject containing "application" OR
"thank you for applying" OR "received your" from the last 24 hours.
Extract company names from email subjects.
These are CONFIRMED applications.

Step 5 — Write audit to Google Sheet
Use Google Sheets MCP to write results to tab "Audit Results".
Columns: Date, Sent, Claimed, Confirmed, Missing (comma separated), Compliance %

Step 6 — Send Telegram summary
Run: python accountability/audit.py

Final output format:
Audit Complete
Sent: N | Claimed: N | Gmail confirmed: N
Compliance: N%
Missing: company1, company2...

---

## /review-top-jobs

Read the most recent Excel file from outputs/ folder using filesystem MCP.
Show top 5 GREEN jobs above 85% today.
For each:
- Why it fits in one sentence
- Resume bullet already suggested
- Apply link

---

## /check-liveness

Search for job liveness using Tavily API.
For each job URL call:
POST https://api.tavily.com/search
body: {
  "api_key": "${TAVILY_API_KEY}",
  "query": "{company} {role} job still open 2026",
  "max_results": 3
}
If results mention "filled" or "expired"
or "no longer" → mark as expired.
If results mention "apply" or "hiring"
or "open" → mark as active.

---

## /company-research

Research company using Tavily API.
POST https://api.tavily.com/search
body: {
  "api_key": "${TAVILY_API_KEY}",
  "query": "{company} AI funding hiring engineers 2026",
  "max_results": 5
}
Summarize results into 5 bullet points:
- Recent funding
- Team size signals
- Tech stack
- Hiring activity
- Any red flags
