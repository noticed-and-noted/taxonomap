/**
 * GBIF's SQL occurrence downloads (build scripts only). Credentials come from the caller and go in
 * an Authorization header, never in a URL or a log.
 */
import { GBIF_API_BASE } from './config';

const REQUEST_URL = `${GBIF_API_BASE}/v1/occurrence/download/request`;

/** A GBIF account's username (not email) and password. */
export interface GbifCredentials {
  username: string;
  password: string;
}

/** A download's state, as GBIF reports it. */
export interface SqlDownloadStatus {
  status: string;
  downloadLink?: string;
  doi?: string;
}

/**
 * Asks GBIF to run a query.
 * @returns The download's key.
 * @throws Error when GBIF refuses; its message holds GBIF's answer and no credentials.
 */
export async function requestSqlDownload(sql: string, { username, password }: GbifCredentials): Promise<string> {
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  const response = await fetch(REQUEST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${token}` },
    body: JSON.stringify({ format: 'SQL_TSV_ZIP', sendNotification: false, sql }),
  });
  const answer = await response.text();
  if (!response.ok) throw new Error(`GBIF refused the SQL download (${response.status}): ${answer.slice(0, 500)}`);
  return answer.trim();
}

/**
 * A download's current state.
 * @throws Error when GBIF can't say.
 */
export async function sqlDownloadStatus(key: string): Promise<SqlDownloadStatus> {
  const response = await fetch(`${GBIF_API_BASE}/v1/occurrence/download/${encodeURIComponent(key)}`);
  if (!response.ok) throw new Error(`GBIF download ${key} status answered ${response.status}`);
  return (await response.json()) as SqlDownloadStatus;
}
