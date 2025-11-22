// CRITICAL: Import patch module FIRST to ensure patches are applied at module resolution time
// This must happen before any Angular SSR code is loaded
import './angularPatch';

export * from './build';
export * from './pageHandlers';
export * from './lookup';
