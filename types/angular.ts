// Structural type — no @angular/core import needed
export type AngularComponent<T = unknown> = new (...args: any[]) => T;
