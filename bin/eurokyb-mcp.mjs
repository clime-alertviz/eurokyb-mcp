#!/usr/bin/env node
/**
 * Zero-dependency MCP stdio-to-Streamable-HTTP bridge for https://alertviz.com/api/eurokyb/mcp
 */
import dns from 'node:dns';
import readline from 'node:readline';

dns.setDefaultResultOrder?.('ipv4first');

const ENDPOINT = process.env.EUROKYB_MCP_URL || 'https://alertviz.com/api/eurokyb/mcp';
const API_KEY = process.env.EUROKYB_API_KEY || '';

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'
    );
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(parsed),
    });
    if (res.status === 202 || parsed.id === undefined) return;
    if (!res.ok) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -32000, message: `Upstream HTTP ${res.status}` },
        }) + '\n'
      );
      return;
    }
    const text = await res.text();
    if (text.trim()) process.stdout.write(text.trim() + '\n');
  } catch (err) {
    if (parsed.id !== undefined) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        }) + '\n'
      );
    }
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', (line) => {
  queue = queue.then(() => handleLine(line));
});
