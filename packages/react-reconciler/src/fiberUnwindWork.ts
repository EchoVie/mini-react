import { FiberNode } from './fiber';
import { DidCapture, NoFlags, ShouldCapture } from './fiberFlags';
import { ContextProvider, SuspenseComponent } from './workTags';
import { popSuspenseHandler } from './suspenseContext';
import { popProvider } from './fiberContext';

export function unwindWork(wip: FiberNode) {
  const flags = wip.flags;
  switch (flags) {
    case SuspenseComponent:
      popSuspenseHandler();
      if (
        (flags & ShouldCapture) !== NoFlags &&
        (flags & DidCapture) === NoFlags
      ) {
        wip.flags = (flags & ~ShouldCapture) | DidCapture;
        return wip;
      }

      return null;

    case ContextProvider: {
      const context = wip.type._context;
      popProvider(context);
      return null;
    }
    default:
      return null;
  }
}