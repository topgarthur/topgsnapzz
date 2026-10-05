const MODEL = 'fal-ai/flux-pro/v1/fill';
const PROMPT =
  'Continue this same photograph into the masked area. Match the lighting, colors, and background. If a head or hair is cut off, complete that same person. If an object is cut off, complete that same object. Keep the original person. No extra people, no text, no watermark.';

function apiKey() {
  return process.env.FAL_KEY || '';
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function uploadAsset(key, bytes, contentType, fileName) {
  const endpoints = [
    'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
    'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
  ];
  let lastError = 'Flux storage did not accept the photo.';
  for (const endpoint of endpoints) {
    const initiated = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ file_name: fileName, content_type: contentType }),
    });
    if (!initiated.ok) {
      lastError = `Flux storage returned ${initiated.status}.`;
      continue;
    }
    const target = await initiated.json();
    if (!target.upload_url || !target.file_url) {
      lastError = 'Flux storage did not return an upload address.';
      continue;
    }
    const uploaded = await fetch(target.upload_url, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: bytes,
    });
    if (!uploaded.ok) {
      lastError = `Flux upload returned ${uploaded.status}.`;
      continue;
    }
    return target.file_url;
  }
  throw new Error(lastError);
}

async function startFill(body) {
  const key = apiKey();
  if (!key) {
    return {
      status: 503,
      body: { error: 'Flux Fill needs FAL_KEY in the server settings.' },
    };
  }
  if (!body?.image || !body?.mask) {
    return { status: 400, body: { error: 'The framed photo was missing.' } };
  }
  if (body.image.length > 7000000 || body.mask.length > 7000000) {
    return { status: 413, body: { error: 'That photo is too large to send.' } };
  }
  const imageUrl = await uploadAsset(key, Buffer.from(body.image, 'base64'), 'image/jpeg', 'topgai-frame.jpg');
  const maskUrl = await uploadAsset(key, Buffer.from(body.mask, 'base64'), 'image/png', 'topgai-mask.png');
  const queued = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: PROMPT,
      image_url: imageUrl,
      mask_url: maskUrl,
      num_images: 1,
      output_format: 'jpeg',
      enhance_prompt: false,
      safety_tolerance: '2',
    }),
  });
  const queuedBody = await queued.json().catch(() => ({}));
  if (!queued.ok || !queuedBody.request_id) {
    return {
      status: queued.status || 502,
      body: { error: queuedBody.detail || queuedBody.error || 'Flux Fill did not start.' },
    };
  }
  return { status: 200, body: { requestId: queuedBody.request_id } };
}

async function pollFill(requestId) {
  const key = apiKey();
  if (!key) return { status: 'error', error: 'Flux Fill needs FAL_KEY in the server settings.' };
  if (!requestId || !/^[\w-]+$/.test(requestId)) return { status: 'error', error: 'That Flux request is not valid.' };
  const statusResponse = await fetch(`https://queue.fal.run/${MODEL}/requests/${requestId}/status`, {
    headers: { Authorization: `Key ${key}` },
  });
  const statusBody = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) return { status: 'error', error: statusBody.detail || 'Flux Fill status failed.' };
  if (statusBody.status !== 'COMPLETED') return { status: 'pending' };
  const resultResponse = await fetch(`https://queue.fal.run/${MODEL}/requests/${requestId}`, {
    headers: { Authorization: `Key ${key}` },
  });
  const result = await resultResponse.json().catch(() => ({}));
  const url = result.images?.[0]?.url;
  if (!resultResponse.ok || !url) return { status: 'error', error: result.detail || 'Flux Fill returned no image.' };
  const imageResponse = await fetch(url);
  if (!imageResponse.ok) return { status: 'error', error: 'Flux Fill image could not be downloaded.' };
  const image = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
  return { status: 'done', image };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      send(res, 200, await pollFill(id));
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const started = await startFill(await readJson(req));
    send(res, started.status, started.body);
  } catch (error) {
    send(res, 500, { error: error?.message || 'Flux Fill failed.' });
  }
}
