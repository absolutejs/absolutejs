import type { Static, TObject, TProperties } from '@sinclair/typebox';

export type InferEnv<T extends TProperties> = Readonly<Static<TObject<T>>>;
