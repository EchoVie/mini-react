import { Lane, includeSomeLanes } from './fiberLanes';
import {
  FiberNode,
  createFiberFromFragment,
  createWorkInProgress,
  createFiberFromOffscreen,
  OffscreenProps
} from './fiber';
import {
  HostComponent,
  HostText,
  HostRoot,
  LazyComponent,
  MemoComponent,
  SuspenseComponent,
  ContextProvider,
  FunctionComponent,
  OffscreenComponent
} from './workTags';
import {
  pushProvider,
  prepareToReadContext,
  propagateContextChange
} from './fiberContext';
import { cloneChildFibers } from './childFiber';
import { ReactElementType } from 'shared/ReactTypes';
import { shallowEqual } from 'shared/shallowEquals';
import { Fragment } from 'react';
import { processUpdateQueue, UpdateQueue } from './updateQueues';
import {
  Ref,
  DidCapture,
  NoFlags,
  Placement,
  ChildDeletion
} from './fiberFlags';
import { reconcileChildFibers, mountChildFibers } from './childFiber';
import { bailoutHook, renderWithHooks } from './fiberHooks';
import { pushSuspenseHandler } from './suspenseContext';

// 是否能命中bailout
let didReceiveUpdate: boolean = false;

export const beginWork = (
  wip: FiberNode,
  renderLane: Lane
): FiberNode | null => {
  didReceiveUpdate = false;
  const current = wip.alternate;
  // 非首次渲染
  if (current !== null) {
    const oldProps = current.memoizedProps;
    // reconcile阶段会将props转换成pendingProps
    const newProps = wip.pendingProps;

    if (oldProps !== newProps || current.type !== wip.type) {
      didReceiveUpdate = true;
    } else {
      // current.lanes 有 renderLane
      const hasScheduledStateOrContext = checkScheduledUpdateOrContext(
        current,
        renderLane
      );
      if (!hasScheduledStateOrContext) {
        // 命中bailout
        didReceiveUpdate = false;

        switch (wip.tag) {
          case ContextProvider: {
            const newValue = wip.memoizedProps.value;
            const context = wip.type._context;

            pushProvider(context, newValue);
            break;
          }
        }
        return bailoutOnAlreadyFinishedWork(wip, renderLane);
      }
    }
  }

  switch (wip.tag) {
    case HostRoot: // HostRootFiber
      return updateHostRoot(wip, renderLane);

    case HostComponent:
      return updateHostComponent(wip);

    case HostText:
      return null;

    case FunctionComponent:
      return updateFunctionComponent(wip, wip.type, renderLane);

    case Fragment:
      return updateFragment(wip);

    case ContextProvider:
      return updateContextProvider(wip, renderLane);

    case SuspenseComponent:
      return updateSuspenseComponent(wip);

    case OffscreenComponent:
      return updateOffscreenComponent(wip);

    case LazyComponent:
      return mountLazyComponent(wip, renderLane);

    case MemoComponent:
      return updateMemoComponent(wip, renderLane);

    default:
      if (__DEV__) {
        console.warn('beginWork未实现的类型');
      }
      break;
  }
  return null;
};

// current.lanes中是否包含 renderLane
function checkScheduledUpdateOrContext(current: FiberNode, renderLane: Lane) {
  const updateLane = current.lanes;

  if (includeSomeLanes(updateLane, renderLane)) {
    return true;
  }
  return false;
}

function bailoutOnAlreadyFinishedWork(wip: FiberNode, renderLane: Lane) {
  if (!includeSomeLanes(wip.childLanes, renderLane)) {
    if (__DEV__) {
      console.warn('bailout整棵子树', wip);
    }
    return null;
  }

  if (__DEV__) { 
    console.warn('bailout一个fiber', wip);
  }

  //  拷贝wip.current的 child及其 siblings 到wip;
  cloneChildFibers(wip);
  return wip.child;
}

function updateHostRoot(wip: FiberNode, renderLane: Lane) {
  const baseState = wip.memoizedState;
  const updateQueue = wip.updateQueue as UpdateQueue<Element>;
  const pending = updateQueue.shared.pending;
  updateQueue.shared.pending = null;

  // 处理 fiber.updateQueue.shared.pending中的updates之前存储的hostRootFiber
  const prevChildren = wip.memoizedState;

  const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
  wip.memoizedState = memoizedState;

  const current = wip.alternate;
  // 考虑到RootDidNotComplete的情况，需要复用memoizedState
  if (current !== null) {
    if (!current.memoizedState) {
      current.memoizedState = memoizedState;
    }
  }

  // 此时 nextChildren为ReactElement
  const nextChildren = wip.memoizedState;
  if (prevChildren === nextChildren) {
    // 复用 child及其sibling，并返回wip.child
    return bailoutOnAlreadyFinishedWork(wip, renderLane);
  }

  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateHostComponent(wip: FiberNode) {
  const nextProps = wip.pendingProps;
  const nextChildren = nextProps.children;
  markRef(wip.alternate, wip);
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateFunctionComponent(
  wip: FiberNode,
  Component: FiberNode['type'],
  renderLane: Lane
) {
  prepareToReadContext(wip, renderLane);

  const nextChildren = renderWithHooks(wip, Component, renderLane);
  const current = wip.alternate;
  if (current !== null && !didReceiveUpdate) {
    bailoutHook(wip, renderLane);
    return bailoutOnAlreadyFinishedWork(wip, renderLane);
  }
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateFragment(wip: FiberNode) {
  const nextChildren = wip.pendingProps;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateContextProvider(wip: FiberNode, renderLane: Lane) {
  const providerType = wip.type;
  const context = providerType._context;
  const newProps = wip.pendingProps;
  const oldProps = wip.memoizedProps;
  const newValue = newProps.value;

  // context._currentValue = newValue
  pushProvider(context, newValue);

  if (oldProps !== null) {
    const oldValue = oldProps.value;

    if (
      Object.is(oldValue, newValue) &&
      oldProps.children === newProps.children
    ) {
      return bailoutOnAlreadyFinishedWork(wip, renderLane);
    } else {
      propagateContextChange(wip, context, renderLane);
    }
  }
  const nextChildren = newProps.children;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function mountLazyComponent(wip: FiberNode, renderLane: Lane) {
  const lazyType = wip.type;
  const payload = lazyType._payload;
  const init = lazyType._init;
  const Component = init(payload); // payload中包含传入的函数组件
  wip.type = Component;
  wip.tag = FunctionComponent;
  const child = updateFunctionComponent(wip, Component, renderLane);
  return child;
}

function updateMemoComponent(wip: FiberNode, renderLane: Lane) {
  const current = wip.alternate;
  const nextProps = wip.pendingProps;
  const Component = wip.type.type;

  if (current !== null) {
    const prevProps = current.memoizedProps;

    if (!checkScheduledUpdateOrContext(current, renderLane)) {
      // 浅比较props
      if (shallowEqual(prevProps, nextProps) && current.ref === wip.ref) {
        didReceiveUpdate = false;
        wip.pendingProps = prevProps;

        wip.lanes = current.lanes;
        return bailoutOnAlreadyFinishedWork(wip, renderLane);
      }
    }
  }
  return updateFunctionComponent(wip, Component, renderLane);
}

function updateOffscreenComponent(wip: FiberNode) {
  const nextProps = wip.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateSuspenseComponent(workInProgress: FiberNode) {
  const current = workInProgress.alternate;
  const nextProps = workInProgress.pendingProps;

  let showFallback = false;
  const disSuspend = (workInProgress.flags & DidCapture) !== NoFlags;

  if (disSuspend) {
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  }

  const nextPrimaryChildren = nextProps.children;
  const nextFallbackChildren = nextProps.fallback;
  pushSuspenseHandler(workInProgress);

  if (current === null) {
    if (showFallback) {
      return mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren
      );
    } else {
      return mountSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
    }
  } else {
    if (showFallback) {
      return updateSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren
      );
    } else {
      return updateSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
    }
  }
}

function reconcileChildren(wip: FiberNode, children: ReactElementType) {
  const current = wip.alternate;

  if (current) {
    wip.child = reconcileChildFibers(wip, current?.child, children);
  } else {
    // mount
    wip.child = mountChildFibers(wip, null, children);
  }
}

// 没有current，有ref 或 有current，ref不同 都标记Ref
function markRef(current: FiberNode | null, workInprogress: FiberNode) {
  const ref = workInprogress.ref;
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    workInprogress.flags |= Ref;
  }
}

export function markWipReceivedUpdate() {
  didReceiveUpdate = true;
}

function mountSuspensePrimaryChildren(
  workInProgress: FiberNode,
  primaryChildren: any
) {
  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren
  };
  const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
  workInProgress.child = primaryChildFragment;
  primaryChildFragment.return = workInProgress;
  return primaryChildFragment;
}

function mountSuspenseFallbackChildren(
  workInProgress: FiberNode,
  primaryChildren: any,
  fallbackChildren: any
) {
  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren
  };
  const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
  const fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);

  fallbackChildFragment.flags |= Placement;

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return fallbackChildFragment;
}

function updateSuspensePrimaryChildren(
  workInProgress: FiberNode,
  primaryChildren: any
) {
  const current = workInProgress.alternate as FiberNode;
  const currentPrimaryChildFragment = current.child as FiberNode;
  const currentFallbackChildFragment: FiberNode | null = currentPrimaryChildFragment.sibling;

  // 复用current信息新建fiber
  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren
  };

  const primaryChildFragment = createWorkInProgress(
    currentPrimaryChildFragment,
    primaryChildProps
  );

  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = null;
  workInProgress.child = primaryChildFragment;

  // 如果有currentFallbackChildFragment 删除并标记ChildDeletion
  if (currentFallbackChildFragment !== null) {
    const deletions = workInProgress.deletions;
    if (deletions === null) {
      workInProgress.deletions = [currentFallbackChildFragment];
      workInProgress.flags |= ChildDeletion;
    } else {
      deletions.push(currentFallbackChildFragment);
    }
  }
  return primaryChildFragment;
}

function updateSuspenseFallbackChildren(
  workInProgress: FiberNode,
  primaryChildren: any,
  fallbackChildren: any
) {
  const current = workInProgress.alternate as FiberNode;
  const currentPrimaryChildFragment = current.child as FiberNode;
  const currentFallbackChildFragment: FiberNode | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren
  };

  const primaryChildFragment = createWorkInProgress(
    currentPrimaryChildFragment,
    primaryChildProps
  );

  let fallbackChildFragment;

  if (currentFallbackChildFragment !== null) {
    // 可以复用
    fallbackChildFragment = createWorkInProgress(
      currentFallbackChildFragment,
      fallbackChildren
    );
  } else {
    fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);
    fallbackChildFragment.flags |= Placement;
  }

  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return fallbackChildFragment;

}