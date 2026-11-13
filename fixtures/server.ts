import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { findProduct } from './data';
import * as site from './site';

export interface FixtureServer {
  origin: string;
  host: string;
  state: () => site.FixtureState;
  reset: () => void;
  close: () => Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const html = (res: ServerResponse, body: string | null) => (body ? send(res, 200, 'text/html; charset=utf-8', body) : send(res, 404, 'text/html; charset=utf-8', site.notFound()));
const redirect = (res: ServerResponse, location: string) => {
  res.writeHead(303, { location });
  res.end();
};

/**
 * Serves the fixture sites on one origin with in-memory state, so each eval task
 * gets its own server and graders can read exactly what the agent changed.
 */
export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  let state = site.freshState();
  let nextOrder = 20001;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && !path.startsWith('/assets') && !path.startsWith('/__')) state.visits.push(`${path}${url.search}`);

    try {
      if (req.method === 'POST') {
        const raw = await readBody(req);
        const form = new URLSearchParams(raw);
        switch (path) {
          case '/api/cart': {
            const { productId } = JSON.parse(raw || '{}') as { productId?: string };
            if (!productId || !findProduct(productId)) return send(res, 400, 'application/json', '{"error":"unknown product"}');
            const line = state.cart.find((l) => l.productId === productId);
            if (line) line.qty += 1;
            else state.cart.push({ productId, qty: 1 });
            return send(res, 200, 'application/json', JSON.stringify({ cart: state.cart }));
          }
          case '/shop/checkout': {
            if (!state.cart.length) return redirect(res, '/shop/cart');
            const id = nextOrder++;
            state.orders.push({ id, lines: state.cart });
            state.cart = [];
            return html(res, site.orderPlaced(id));
          }
          case '/contact':
            state.contact.push({
              name: form.get('name') ?? '',
              email: form.get('email') ?? '',
              order: form.get('order') ?? '',
              message: form.get('message') ?? '',
            });
            return redirect(res, '/contact/sent');
          case '/account/settings': {
            const newsletter = form.get('newsletter') ?? state.settings.newsletter;
            state.settings = { newsletter, sms: form.has('sms'), email: form.has('email') };
            state.settingsSaves += 1;
            return redirect(res, '/account/settings?saved=1');
          }
          case '/__reset':
            state = site.freshState();
            return send(res, 204, 'text/plain', '');
          default:
            return send(res, 404, 'text/plain', 'not found');
        }
      }

      if (path === '/__state') return send(res, 200, 'application/json', JSON.stringify(state));
      if (path === '/assets/site.css') return send(res, 200, 'text/css', site.CSS);
      if (path === '/favicon.ico') return send(res, 204, 'image/x-icon', '');
      if (path === '/') return html(res, site.home());
      if (path === '/shop') return html(res, site.catalog());
      if (path === '/shop/search') return html(res, site.search(url.searchParams.get('q') ?? ''));
      if (path === '/shop/product') return html(res, site.product(url.searchParams.get('id') ?? ''));
      if (path === '/shop/cart') return html(res, site.cart(state));
      if (path === '/shop/checkout') return html(res, site.checkout(state));
      if (path === '/orders') return html(res, site.orders(Number(url.searchParams.get('page') ?? 1) || 1));
      if (path === '/docs' || path.startsWith('/docs/')) return html(res, site.docs(path.slice('/docs/'.length)));
      if (path === '/help' || path.startsWith('/help/')) return html(res, site.help(path.slice('/help/'.length)));
      if (path === '/contact') return html(res, site.contact());
      if (path === '/contact/sent') return html(res, site.contactSent());
      if (path === '/account/settings') return html(res, site.settings(state, url.searchParams.has('saved')));
      return html(res, null);
    } catch (error) {
      send(res, 500, 'text/plain', error instanceof Error ? error.message : 'error');
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const { port: bound } = server.address() as AddressInfo;
  const host = `localhost:${bound}`;
  return {
    origin: `http://${host}`,
    host,
    state: () => structuredClone(state),
    reset: () => {
      state = site.freshState();
    },
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
