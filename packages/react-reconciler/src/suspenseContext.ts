import { FiberNode } from './fiber';

const suspenseHandlerStack: FiberNode[] = [];

export function getSuspenseHandler() {
  const length = suspenseHandlerStack.length;
  return suspenseHandlerStack[length - 1];
}
export function pushSuspenseHandler(handler: FiberNode) {
  suspenseHandlerStack.push(handler);
}
export function popSuspenseHandler() {
  suspenseHandlerStack.pop();
}
