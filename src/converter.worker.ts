import { convertDocument } from './core/convert';

self.onmessage = async (event: MessageEvent) => {
  const { id, source, settings } = event.data;
  try { self.postMessage({ id, result: await convertDocument(source, settings) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'Conversion failed.' }); }
};
