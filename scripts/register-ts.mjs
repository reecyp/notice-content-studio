/** Installs the resolver above for a child process. See ts-resolve.mjs. */
import { register } from 'node:module';
register(new URL('./ts-resolve.mjs', import.meta.url));
