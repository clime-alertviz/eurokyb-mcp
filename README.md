# eurokyb-mcp

Zero-dependency MCP server & stdio bridge backed by **EuroKYB** (`https://alertviz.com/eurokyb/`), giving Claude Desktop, Cursor, Windsurf, Codex CLI, and automated agents instant compliance verification tools across Europe.

## Tools Included
- `check_czech_company_kyb` — Verify Czech company via official ARES + Finanční správa ADIS §109 VAT unreliability & insolvency status (`ico`).
- `verify_eu_vat_vies` — Validate any EU 27-country VAT ID (`vat`) against European Commission VIES.
- `verify_iban` — Validate ISO 13616 Mod-97 IBAN checksums (`iban`).
- `audit_website_and_markdown` — SSRF-safe HTTP security/TLS audit or clean Markdown extraction (`url`, `mode`).

- `get_cnb_exchange_rates` — Read Czech National Bank rates and convert invoice amounts.

## Option A — Remote Streamable HTTP (No Install Required)
```json
{
  "mcpServers": {
    "eurokyb": {
      "url": "https://alertviz.com/api/eurokyb/mcp"
    }
  }
}
```

## Option B — Local `stdio` via `npx`
```json
{
  "mcpServers": {
    "eurokyb": {
      "command": "npx",
      "args": ["-y", "eurokyb-mcp"]
    }
  }
}
```

*(Built by Bc. Michal Novotný • IČO 01346521 • `info@alertviz.com` • MIT License)*
