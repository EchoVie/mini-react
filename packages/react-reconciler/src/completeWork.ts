import { createInstance } from 'hostConfig';
import { FiberNode } from './fiber';
import {
  ContextProvider,
  FunctionComponent,
  HostComponent,
  HostRoot,
  HostText,
  MemoComponent,
  OffscreenComponent,
  SuspenseComponent
} from './workTags';
import { Update, Ref, NoFlags, Visibility } from './fiberFlags';
import { appendInitialChild } from 'hostConfig';
import { NoLane, mergeLanes } from './fiberLanes';
import { createTextInstance } from 'hostConfig';
import { Fragment } from 'react';
import { popProvider } from './fiberContext';
import { popSuspenseHandler } from './suspenseContext';

function markUpdate(fiber: FiberNode) {
  fiber.lanes |= Update;
}

function markRef(fiber: FiberNode) {
  fiber.lanes |= Ref;
}

export const completeWork = (wip: FiberNode) => {
  const newProps = wip.pendingProps;
  const current = wip.alternate;

  switch (wip.tag) {
    case HostComponent:
      if (current !== null && wip.stateNode) {
        // TODO update
        // 1. props是否变化 {onClick: xx} {onClick: xxx}
        // 2. 变了 Update flag
        markUpdate(wip);
        if (current.ref !== wip.ref) {
          markRef(wip);
        }
      } else {
        // mount
        // 1. 构建DOM
        const instance = createInstance(wip.type, newProps);
        // 2. 将DOM插入到DOM树中
        appendAllChildren(instance, wip);
        wip.stateNode = instance;
        // 3. 标记
        if (wip.ref !== null) {
          markRef(wip);
        }
      }
      bubbleProperties(wip);
      return null;

    case HostText:
      if (current !== null && wip.stateNode) {
        const oldText = current.memoizedProps.content;
        const newText = newProps.content;

        if (oldText !== newText) {
          markUpdate(wip);
        }
      } else {
        const instance = createTextInstance(newProps.content);
        wip.stateNode = instance;
      }
      bubbleProperties(wip);
      return null;
    case HostRoot:
    case FunctionComponent:
    case Fragment:
    case OffscreenComponent:
    case MemoComponent:
      bubbleProperties(wip);
      return null;
    case ContextProvider: {
      const context = wip.type._context;
      popProvider(context);
      bubbleProperties(wip);
      return null;
    }
    case SuspenseComponent: {
      popSuspenseHandler();

      const offscreenFiber = wip.child as FiberNode;
      const isHidden = offscreenFiber.pendingProps.mode === 'hidden';
      const currentOffscreenFiber = offscreenFiber.alternate;
      if (currentOffscreenFiber !== null) {
        const wasHidden = currentOffscreenFiber.pendingProps.mode === 'hidden';

        if (isHidden !== wasHidden) {
          offscreenFiber.flags |= Visibility;
          bubbleProperties(offscreenFiber);
        }
      } else if (isHidden) {
        offscreenFiber.flags |= Visibility;
        bubbleProperties(offscreenFiber);
      }
      bubbleProperties(wip);
      return null;
    }

    default:
      if (__DEV__) {
        console.warn('未处理的completeWork情况', wip);
      }
      break;
  }
};

function appendAllChildren(parent: HTMLElement, wip: FiberNode) {
  let node = wip.child;

  while (node !== null) {
    if (node.tag === HostComponent || node.tag === HostText) {
      appendInitialChild(parent, node.stateNode);
    } else if (node.child) {
      node.child.return = node;
      node = node.child;
      continue;
    }

    if (node === wip) {
      return;
    }

    while (node.sibling === null) {
      if (node.return === null || node.return === wip) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// 遍历 child，childLanes增加 child的lanes和childLanes
// subtreeFlags新增child的flags和subtreeFlags
function bubbleProperties(wip: FiberNode) {
  let subTreeFlags = NoFlags;
  let child = wip.child;
  let newChildLanes = NoLane;

  while (child !== null) {
    subTreeFlags |= child.subtreeFlags;
    subTreeFlags |= child.flags;

    newChildLanes = mergeLanes(
      newChildLanes,
      mergeLanes(child.lanes, child.childLanes)
    );

    child.return = wip;
    child = child.sibling;
  }

  wip.subtreeFlags |= subTreeFlags;
  wip.childLanes |= newChildLanes;
}
