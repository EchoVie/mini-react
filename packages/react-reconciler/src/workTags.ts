export type WorkTag =
  | typeof HostRoot
  | typeof HostComponent
  | typeof HostText
  | typeof Fragment
  | typeof ContextProvider
  | typeof SuspenseComponent
  | typeof OffscreenComponent
  | typeof LazyComponent
  | typeof MemoComponent;

export const Function = 0;
export const HostRoot = 3;
export const HostComponent = 5;
export const HostText = 6;
export const Fragment = 7;
export const ContextProvider = 8;
export const SuspenseComponent = 13;
export const OffscreenComponent = 14;
export const MemoComponent = 15;
export const LazyComponent = 16;
