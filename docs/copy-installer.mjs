import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('./public/', import.meta.url), { recursive: true });
await copyFile(new URL('../install', import.meta.url), new URL('./public/install', import.meta.url));
