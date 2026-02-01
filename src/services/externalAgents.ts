import axios from 'axios';

const DEFAULT_URL = process.env.EXTERNAL_AGENT_URL || 'http://localhost:1234';

export async function externalHealth(url: string = DEFAULT_URL) {
  try {
    const res = await axios.get(`${url}/health`, { timeout: 3000 });
    return { ok: true, data: res.data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'External agent health check failed' };
  }
}

export async function externalRun(url: string = DEFAULT_URL) {
  try {
    const res = await axios.get(`${url}/`, { timeout: 5000 });
    return { ok: true, data: res.data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'External agent run failed' };
  }
}

export function isExternalEnabled(): boolean {
  return process.env.EXTERNAL_AGENTS === '1';
}
