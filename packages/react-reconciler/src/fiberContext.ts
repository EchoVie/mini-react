import { ReactContext } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import {
  NoLane,
  includeSomeLanes,
  Lane,
  mergeLanes,
  isSubsetOfLanes
} from './fiberLanes';
import { markWipReceivedUpdate } from './beginWork';
import { ContextProvider } from './workTags';

let lastContextDep: ContextItem<any> | null = null;

export interface ContextItem<Value> {
  context: ReactContext<Value>;
  memoizedState: Value;
  next: ContextItem<Value> | null;
}

const prevContextValueStack: any[] = [];
let prevContextValue: any = null;

export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
  prevContextValueStack.push(prevContextValue);

  prevContextValue = context._currentValue;
  context._currentValue = newValue;
}

export function popProvider<T>(context: ReactContext<T>) {
  context._currentValue = prevContextValue;
  prevContextValue = prevContextValueStack.pop();
}

export function prepareToReadContext(wip: FiberNode, renderLane: Lane) {
  // 重置 lastContextDep 和 deps.firstContext
  lastContextDep = null;

  const deps = wip.dependencies;
  if (deps !== null) {
    const firstContext = deps.firstContext;
    if (firstContext !== null) {
      if (includeSomeLanes(deps.lanes, renderLane)) {
        markWipReceivedUpdate();
      }
      deps.firstContext = null;
    }
  }
}

// workInProgress.dependencies.firstContext 后新增 contextItem
export function readContext<T>(
  consumer: FiberNode | null,
  context: ReactContext<T>
): T {
  if (consumer === null) {
    throw Error('只能在函数组件中调用 useContext');
  }

  const value = context._currentValue;

  // 建立 fiber => context
  const contextItem: ContextItem<T> = {
    context,
    next: null,
    memoizedState: value
  };

  if (lastContextDep === null) {
    lastContextDep = contextItem;
    consumer.dependencies = {
      firstContext: contextItem,
      lanes: NoLane
    };
  } else {
    lastContextDep = lastContextDep.next = contextItem;
  }
  return value;
}

// 往下往右找子fiber，找到后并标记所有父的childLanes或者当前lanes为renderLane
export function propagateContextChange<T>(
  wip: FiberNode,
  context: ReactContext<T>,
  renderLane: Lane
) {
  let fiber = wip.child;

  if (fiber !== null) {
    fiber.return = wip;
  }

  while (fiber !== null) {
    let nextFiber = null;
    const deps = fiber.dependencies;

    // 1. 往下找
    if (deps !== null) {
      nextFiber = fiber.child;

      let contextItem = deps.firstContext;

      while (contextItem !== null) {
        if (contextItem.context === context) {
          // 找到了

          // fiber和alternate的lanes添加renderLane
          fiber.lanes = mergeLanes(fiber.lanes, renderLane);
          const alternate = fiber.alternate;
          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLane);
          }
          // 从fiber.return往上找到wip，并在fiber和alternate的childLanes添加renderLane
          scheduleContextWorkOnParentPath(fiber.return, wip, renderLane);

          // fiber.dependencies.lanes添加renderLane
          deps.lanes = mergeLanes(deps.lanes, renderLane);
          break;
        }
        contextItem = contextItem.next;
      }
    } else if (fiber.tag === ContextProvider) {
      // 往child找有dependencies的fiber，遇到ContextProvider访问其child
      nextFiber = fiber.type === wip.type ? null : fiber.child;
    } else {
      // 往child找有dependencies的fiber
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      nextFiber.return = fiber;
    } else {
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === wip) {
          nextFiber = null;
          break;
        }
        // 2. 往右找
        const siblings = nextFiber.sibling;
        if (siblings !== null) {
          siblings.return = nextFiber.return;
          nextFiber = siblings;
          break;
        }
        // 3. 往上找
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

// 从 from往上找到to，同时在fiber和alternate的childLanes上加renderLane
function scheduleContextWorkOnParentPath(
  from: FiberNode | null,
  to: FiberNode,
  renderLane: Lane
) {
  let node = from;

  while (node !== null) {
    const alternate = node.alternate;

    if (!isSubsetOfLanes(node.childLanes, renderLane)) {
      // node.childLanes 和 alternate.childLanes 加上 renderLane
      node.childLanes = mergeLanes(node.childLanes, renderLane);
      if (alternate !== null) {
        alternate.childLanes = mergeLanes(alternate.childLanes, renderLane);
      }
    } else if (
      alternate !== null &&
      !isSubsetOfLanes(alternate.childLanes, renderLane)
    ) {
      // node.childLanes 和 alternate.childLanes 加上 renderLane
      alternate.childLanes = mergeLanes(alternate.childLanes, renderLane);
    }

    if (node === to) {
      break;
    }
    node = node.return;
  }
}
