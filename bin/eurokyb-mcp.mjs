#!/usr/bin/env node
import dns from 'node:dns';
import readline from 'node:readline';

dns.setDefaultResultOrder?.('ipv4first');

const endpoint = process.env.EUROKYB_MCP_URL || 'https://alertviz.com/api/eurokyb/mcp';
const apiKey = process.env.EUROKYB_API_KEY;
let protocolVersion;

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, data } });
}

function parseRequest(line) {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return error(null, -32700, 'Parse error');
  }
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
      !request.method || ('id' in request && typeof request.id !== 'string' && !Number.isSafeInteger(request.id))) {
    return error(null, -32600, 'Invalid JSON-RPC request');
  }

  return request;
}

async function forward(request) {
  const notification = !('id' in request);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (protocolVersion && request.method !== 'initialize') headers['MCP-Protocol-Version'] = protocolVersion;

  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify(request),
      signal: AbortSignal.timeout(90000), redirect: 'error',
    });
    if (notification) {
      await response.body?.cancel();
      return;
    }
    if (!response.ok || response.status === 202 || response.status === 204) {
      await response.body?.cancel();
      const delay = response.headers.get('Retry-After');
      const retry = response.status === 429 && /^\d+$/.test(delay || '') ? '. Retry after ' + delay + ' seconds.' : '';
      const body=await response.json().catch(()=>({}));
      const detail=body.error?.data || {};
      return error(request.id, -32000, 'Upstream HTTP ' + response.status + retry, {
        reason:detail.reason || body.reason, retryAfter:delay ? Number(delay) : undefined,
        resetsAt:response.headers.get('X-Quota-Reset'), remaining:response.headers.get('X-Checks-Remaining')
      });
    }
    const reply = await response.json();
    if (reply?.jsonrpc !== '2.0' || reply.id !== request.id ||
        Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error')) {
      return error(request.id, -32000, 'Invalid upstream JSON-RPC response');
    }
    if (request.method === 'initialize' && typeof reply.result?.protocolVersion === 'string') {
      protocolVersion = reply.result.protocolVersion;
    }
    send(reply);
  } catch (err) {
    if (!notification) error(request.id, -32000, err.message || 'Upstream request failed');
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const activeCalls = new Set();
for await (const line of lines) {
  const request = parseRequest(line);
  if (!request) continue;
  if (request.method !== 'tools/call') {
    await forward(request);
    continue;
  }
  if (activeCalls.size >= 8) await Promise.race(activeCalls);
  const call = forward(request).finally(() => activeCalls.delete(call));
  activeCalls.add(call);
}
await Promise.all(activeCalls);
