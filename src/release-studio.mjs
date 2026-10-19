// Poster Studio samples for the three independently styled Account 2 rows.
// Includes only public title/artwork/tag previews, no watchlist state or tokens.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED = new Set(['homeReleases', 'upcomingMovies', 'upcomingTV']);
export async function writeReleaseStudio({ outputDirectory, account, samples, generatedAt }) {
  if (!ALLOWED.has(account)) throw new Error(`Invalid Studio row: ${account}`);
  const directory = path.join(outputDirectory, 'studio');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${account}.json`),
    `${JSON.stringify({ account, generatedAt: new Date(generatedAt).toISOString(), samples }, null, 2)}\n`);
}
