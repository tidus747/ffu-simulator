/// <reference types="vite/client" />

import type { FfuApi } from '../../preload/api';

declare global {
  interface Window {
    ffu: FfuApi;
  }
}
