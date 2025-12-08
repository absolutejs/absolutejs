import { ComponentType } from 'react';

/* Type for React component modules imported during HMR
   React components are exported as named exports (e.g., ReactExample) */
export interface ReactModule {
  ReactExample: ComponentType<Record<string, unknown>>;
  [key: string]: unknown; // Allow other exports
}

