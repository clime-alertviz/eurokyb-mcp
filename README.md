# EuroKYB MCP

EuroKYB gives agents read-only tools for checking Czech suppliers, EU VAT numbers, IBAN checksums, Czech National Bank rates and public web pages. Use the hosted endpoint directly or run the zero-dependency Node.js bridge in a client that uses stdio.

| Tool | When to use it | How to read the result |
| --- | --- | --- |
| `check_czech_company_kyb` | Look up a Czech business. Pass its IČO as text, e.g. `"00094943"`. | ARES supplies registry flags. ADIS supplies VAT reliability and published accounts for VAT payers. Treat unknown evidence as inconclusive. |
| `verify_eu_vat_vies` | Check a country-prefixed VAT number with the European Commission’s VIES service. | Read `status` as VALID, INVALID or UNKNOWN. An upstream connection failure can also return a tool error. |
| `verify_iban` | Check the format and checksum of an IBAN. Spaces and lowercase are accepted. | `valid` and `reason` describe the identifier. Ownership and account existence require separate evidence. |
| `get_cnb_exchange_rates` | Omit arguments for the whole table. To convert, pass e.g. `{"currency":"EUR","amount":100}`. Supply `date` as DD.MM.YYYY for a historical fixing. | Read `publishedDate`. The conversion reports both the CZK equivalent of 100 EUR and the EUR equivalent of 100 CZK. |
| `audit_website_and_markdown` | Pass a public HTTP(S) URL. Use `mode: "audit"` for header, TLS and DNS observations or `mode: "markdown"` for page text. | Both modes fetch the URL. Inspect the final HTTP status. For Markdown, check `truncated` before treating the text as complete. |

## Connect over HTTPS

```json
{
  "mcpServers": {
    "eurokyb": { "url": "https://alertviz.com/api/eurokyb/mcp" }
  }
}
```

## Connect over stdio

```json
{
  "mcpServers": {
    "eurokyb": { "command": "npx", "args": ["-y", "eurokyb-mcp"] }
  }
}
```

Node.js 18 or newer is required for the bridge. It sends tool arguments to the hosted EuroKYB service, including IBANs. IBAN checks are computed there without a bank lookup. Website requests contact the supplied destination. Direct access includes 50 completed checks per UTC calendar month and 5 checks/minute per public IP. Set EUROKYB_API_KEY to share a Pro allowance (1,000/month) or Business allowance (5,000/month) across tools at 300/min. HTTP 429 includes the retry delay. Read GET /v1/quota to see your balance.

Set `EUROKYB_MCP_URL` to use a compatible JSON-response endpoint for testing. Run `npm test` to check the stdio transport against a local fixture. The bridge repository is MIT licensed. [EuroKYB website and API](https://alertviz.com/eurokyb/)
