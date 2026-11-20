import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'eurokyb-mcp.mjs');

function runBridge(lines, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.write(lines.join('\n') + '\n');
    child.stdin.end();
  });
}

test('stdio bridge forwards JSON-RPC requests and wraps upstream HTTP failures', async () => {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c.toString()));
    req.on('end', () => {
      const msg = JSON.parse(body);
      if (msg.method === 'fail/http500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Error');
        return;
      }
      if (msg.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echo: msg.method } }));
    });
  });

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const { code, out, err } = await runBridge(
      [
        '{bad json',
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'fail/http500' }),
      ],
      { EUROKYB_MCP_URL: `http://127.0.0.1:${port}/mcp` }
    );
    assert.equal(code, 0, err);
    const parsed = out.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].error.code, -32700);
    assert.deepEqual(parsed[1], { jsonrpc: '2.0', id: 1, result: { echo: 'tools/list' } });
    assert.equal(parsed[2].id, 2);
    assert.equal(parsed[2].error.code, -32000);
    assert.match(parsed[2].error.message, /HTTP 500/);
  } finally {
    srv.close();
  }
});

test('malformed inputs and upstream replies cannot break framing or lose the next request', async () => {
  const headers = [];
  const srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const { id, method } = JSON.parse(raw);
    headers.push(req.headers);
    if (method === 'empty') return res.writeHead(202).end();
    if (method === 'html') return res.end('<html>');
    res.end(JSON.stringify({
      jsonrpc: '2.0', id: method === 'mismatch' ? 999 : id,
      result: method === 'initialize' ? { protocolVersion: '2025-06-18' } : {},
    }, null, 2));
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const methods = ['initialize', 'empty', 'html', 'mismatch', 'ping'];
    const inputs = ['null', '[]', '42', ...methods.map((method, id) => JSON.stringify({ jsonrpc: '2.0', id, method }))];
    const { code, out, err } = await runBridge(inputs, { EUROKYB_MCP_URL: 'http://127.0.0.1:' + srv.address().port });
    assert.equal(code, 0, err);
    const replies = out.trim().split('\n').map(JSON.parse);
    assert.deepEqual(replies.map(r => r.error?.code ?? 'ok'), [-32600, -32600, -32600, 'ok', -32000, -32000, -32000, 'ok']);
    assert.deepEqual(replies.slice(3).map(r => r.id), [0, 1, 2, 3, 4]);
    assert.equal(headers[1]['mcp-protocol-version'], '2025-06-18');
    assert.match(headers[0].accept, /application\/json, text\/event-stream/);
  } finally {
    srv.close();
  }
});

test('a slow registry lookup leaves the bridge responsive to a ping', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    if (msg.method === 'tools/call') await slow;
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
    if (msg.method === 'ping') setTimeout(release, 30);
  });
  const guard = setTimeout(release, 2500);
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  try {
    const messages = ['tools/call', 'ping'].map((method,id) => JSON.stringify({ jsonrpc: '2.0', id, method }));
    const { out, code } = await runBridge(messages, { EUROKYB_MCP_URL: 'http://127.0.0.1:' + srv.address().port });
    assert.equal(code, 0);
    assert.deepEqual(out.trim().split('\n').map(line => JSON.parse(line).id), [1, 0]);
  } finally {
    clearTimeout(guard);
    release();
    srv.close();
  }
});

test('the release descriptor identifies the bridge in this package', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = async name => JSON.parse(await readFile(path.join(__dirname, '..', name), 'utf8'));
  const [pkg, descriptor] = await Promise.all([read('package.json'), read('server.json')]);
  const entry = descriptor.packages.find(item => item.registryType === 'npm');
  assert.equal(entry.identifier, pkg.name);
  assert.equal(entry.version, pkg.version);
  assert.equal(descriptor.name, pkg.mcpName);
});

test('monthly exhaustion includes the reason from the upstream JSON body', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(429, {'Content-Type':'application/json','Retry-After':'86400','X-Checks-Remaining':'0'});
    res.end(JSON.stringify({error:{data:{reason:'monthly_quota'}}}));
  });
  await new Promise(resolve => srv.listen(0,'127.0.0.1',resolve));
  try {
    const {out} = await runBridge(['{"jsonrpc":"2.0","id":4,"method":"tools/list"}'],
      {EUROKYB_MCP_URL:'http://127.0.0.1:'+srv.address().port});
    const {data} = JSON.parse(out).error;
    assert.equal(data.reason,'monthly_quota');
    assert.equal(data.retryAfter,86400);
  } finally { srv.close(); }
});
