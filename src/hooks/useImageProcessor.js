import { useCallback, useEffect, useRef, useState } from 'react';

function failPending(pending, message) {
  for (const [id, slot] of pending.entries()) {
    pending.delete(id);
    slot.reject(new Error(message));
  }
}

export function useImageProcessor() {
  const workersRef = useRef(null);
  const pendingRef = useRef(new Map());
  const queueRef = useRef([]);
  const runningRef = useRef(false);
  const readyQueueRef = useRef([]);
  const waveRef = useRef({ done: 0, total: 0 });
  const [status, setStatus] = useState({
    state: 'idle',
    phase: 'WORKER IDLE',
    index: 0,
    total: 0,
  });

  useEffect(() => {
    const decodeWorker = new Worker(new URL('../workers/imageProcessor.worker.js', import.meta.url), {
      type: 'module',
    });
    const paintWorker = new Worker(new URL('../workers/outpaintModel.worker.js', import.meta.url), {
      type: 'module',
    });
    const subjectWorker = new Worker(new URL('../workers/subjectDetector.worker.js', import.meta.url), {
      type: 'module',
    });
    const pending = pendingRef.current;

    const onMessage = (event) => {
      const slot = pending.get(event.data.id);
      if (!slot) return;
      pending.delete(event.data.id);
      if (event.data.error) slot.reject(new Error(event.data.error));
      else slot.resolve(event.data);
    };

    const onError = (event) => {
      event.preventDefault?.();
      failPending(pending, 'The image worker stopped unexpectedly.');
    };

    decodeWorker.onmessage = onMessage;
    paintWorker.onmessage = onMessage;
    subjectWorker.onmessage = onMessage;
    decodeWorker.onerror = onError;
    paintWorker.onerror = onError;
    subjectWorker.onerror = onError;
    workersRef.current = { decodeWorker, paintWorker, subjectWorker };
    readyQueueRef.current.splice(0).forEach((resolve) => resolve());

    return () => {
      workersRef.current = null;
      runningRef.current = false;
      for (const job of queueRef.current) job.reject(new Error('cancelled'));
      queueRef.current = [];
      failPending(pending, 'cancelled');
      decodeWorker.terminate();
      paintWorker.terminate();
      subjectWorker.terminate();
    };
  }, []);

  const waitForWorkers = useCallback(async () => {
    if (workersRef.current) return workersRef.current;
    await new Promise((resolve) => readyQueueRef.current.push(resolve));
    if (!workersRef.current) throw new Error('cancelled');
    return workersRef.current;
  }, []);

  const callWorker = useCallback((worker, payload, transfer, timeoutMs = 45000) => {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pendingRef.current.has(id)) return;
        pendingRef.current.delete(id);
        reject(new Error('Framing timed out. Try a smaller photo.'));
      }, timeoutMs);
      const finish = (handler, value) => {
        clearTimeout(timer);
        handler(value);
      };
      pendingRef.current.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      });
      try {
        worker.postMessage({ id, ...payload }, transfer);
      } catch (error) {
        pendingRef.current.delete(id);
        finish(reject, error);
      }
    });
  }, []);

  const publish = useCallback((phase) => {
    const wave = waveRef.current;
    if (!wave.total || phase === 'WORKER IDLE') {
      setStatus({ state: 'idle', phase: 'WORKER IDLE', index: 0, total: 0 });
      return;
    }
    setStatus({
      state: 'processing',
      phase,
      index: Math.min(wave.total, wave.done + 1),
      total: wave.total,
    });
  }, []);

  const processOne = useCallback(
    async (job) => {
      const workers = await waitForWorkers();
      const copy = job.bytes.slice();
      publish('DECODING');
      const decodePromise = callWorker(
        workers.decodeWorker,
        {
          buffer: copy.buffer,
          mime: job.mime,
          orientation: job.orientation,
          rawWidth: job.rawWidth,
          rawHeight: job.rawHeight,
        },
        [copy.buffer],
      );
      let anchorPromise = Promise.resolve(job.anchor || null);
      if (job.autoFrame && !job.anchor) {
        const detectCopy = job.bytes.slice();
        publish('DETECTING');
        anchorPromise = callWorker(
          workers.subjectWorker,
          {
            buffer: detectCopy.buffer,
            mime: job.mime,
            orientation: job.orientation,
            rawWidth: job.rawWidth,
            rawHeight: job.rawHeight,
          },
          [detectCopy.buffer],
        )
          .then((message) => message.anchor || null)
          .catch(() => null);
      }
      const [decoded, anchor] = await Promise.all([decodePromise, anchorPromise]);
      try {
        publish('OUTPAINTING');
        const painted = await callWorker(
          workers.paintWorker,
          {
            bitmap: decoded.bitmap,
            options: { ...job.options, anchor: job.autoFrame ? anchor : null },
          },
          [decoded.bitmap],
          240000,
        );
        return {
          blob: new Blob([painted.buffer], { type: 'image/jpeg' }),
          anchor: job.autoFrame ? anchor : null,
          engine: painted.engine || job.options.mode || 'blend',
        };
      } catch (error) {
        try {
          decoded.bitmap?.close?.();
        } catch {
          // The bitmap was already transferred to the outpaint worker.
        }
        throw error;
      }
    },
    [callWorker, publish, waitForWorkers],
  );

  const pump = useCallback(() => {
    if (runningRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      waveRef.current = { done: 0, total: 0 };
      setStatus({ state: 'idle', phase: 'WORKER IDLE', index: 0, total: 0 });
      return;
    }
    runningRef.current = true;
    publish('DECODING');
    next
      .fn()
      .then(next.resolve, next.reject)
      .finally(() => {
        waveRef.current.done += 1;
        runningRef.current = false;
        if (typeof globalThis.gc === 'function') globalThis.gc();
        pump();
      });
  }, [publish]);

  const enqueue = useCallback(
    (createJob, priority = false) =>
      new Promise((resolve, reject) => {
        waveRef.current.total += 1;
        const task = {
          fn: async () => {
            const job = await createJob();
            if (!job) return null;
            return processOne(job);
          },
          resolve,
          reject,
        };
        if (priority) queueRef.current.unshift(task);
        else queueRef.current.push(task);
        publish('DECODING');
        pump();
      }),
    [processOne, publish, pump],
  );

  const inpaintBitmap = useCallback(
    (bitmap, rects) =>
      new Promise((resolve, reject) => {
        waveRef.current.total += 1;
        queueRef.current.push({
          fn: async () => {
            const workers = await waitForWorkers();
            publish('OUTPAINTING');
            const painted = await callWorker(
              workers.paintWorker,
              { kind: 'inpaint', bitmap, rects },
              [bitmap],
              240000,
            );
            return new Blob([painted.buffer], { type: 'image/jpeg' });
          },
          resolve,
          reject,
        });
        publish('DECODING');
        pump();
      }),
    [callWorker, publish, pump, waitForWorkers],
  );

  return { enqueue, inpaintBitmap, status };
}
