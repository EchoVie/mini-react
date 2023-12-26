import { scheduleMicroTask } from 'hostConfig';
import {
  Lane,
  mergeLanes,
  getNextLane,
  NoLane,
  SyncLane,
  lanesToSchedulerPriority,
  markRootSuspended,
  markRootFinished
} from './fiberLanes';
import {
  FiberNode,
  FiberRootNode,
  PendingPassiveEffects,
  createWorkInProgress
} from './fiber';
import { HostRoot } from './workTags';
import { resetHooksOnUnwind } from './fiberHooks';
import { SuspenseException, getSuspenseThenable } from './thenable';
import {
  unstable_cancelCallback,
  unstable_scheduleCallback,
  unstable_shouldYield,
  unstable_NormalPriority as NormalPriority
} from 'scheduler';
import { scheduleSyncCallback, flushSyncCallbacks } from './syncTaskQueue';
import { Passive, HookHasEffect } from './hookEffectTags';
import {
  commitHookEffectListCreate,
  commitHookEffectListDestroy,
  commitHookEffectListUnmount
} from './commitWork';
import {
  MutationMask,
  NoFlags,
  PassiveMask,
  HostEffectMask
} from './fiberFlags';
import { unwindWork } from './fiberUnwindWork';
import { completeWork } from './completeWork';
import { commitMutationEffects, commitLayoutEffects } from './commitWork';
import { beginWork } from './beginWork';
import { throwException } from './fiberThrow';

// 工作中的状态
const RootInProgress = 0;
// 并发中间状态
const RootInComplete = 1;
// 完成状态
const RootCompleted = 2;
// 未完成状态，不用进入commit阶段
const RootDidNotComplete = 3;

// Suspense
type SuspendedReason =
  | typeof NotSuspended
  | typeof SuspendedOnError
  | typeof SuspendedOnData
  | typeof SuspendedOnDeprecatedThrowPromise;
const NotSuspended = 0;
const SuspendedOnError = 1;
const SuspendedOnData = 2;
const SuspendedOnDeprecatedThrowPromise = 4;

let workInProgress: FiberNode | null = null;
let workInProgressRootExitStatus: number = RootInProgress;
let wipRootRenderLane: Lane = NoLane;
let workInProgressSuspendedReason: SuspendedReason = NotSuspended;
let workInProgressThrownValue: any = null;
let rootDoesHasPassiveEffects = false;

export const scheduleUpdateOnFiber = (fiber: FiberNode, lane: Lane) => {
  const root = markUpdateLaneFromFiberToRoot(fiber, lane);
  markRootUpdated(root, lane);
  ensureRootIsScheduled(root);
};

export const markUpdateLaneFromFiberToRoot = (fiber: FiberNode, lane: Lane) => {
  let node = fiber;
  let parent = fiber.return;

  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane);
    const alternate = parent.alternate;

    if (alternate) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane);
    }

    node = parent;
    parent = node.return;
  }

  if (node.tag === HostRoot) {
    return node.stateNode;
  }
  return null;
};

export function markRootUpdated(node: FiberRootNode, lane: Lane) {
  node.pendingLanes = mergeLanes(node.pendingLanes, lane);
}

export function ensureRootIsScheduled(root: FiberRootNode) {
  const updateLane = getNextLane(root);

  const existingCallback = root.callbackNode;

  // 最高优先级为 NoLane
  if (updateLane === NoLane) {
    if (existingCallback !== null) {
      unstable_cancelCallback(existingCallback);
    }

    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return;
  }

  const curPriority = updateLane;
  const prevPriority = root.callbackPriority;

  // 最高优先级不为 NoLane，且和 root.callbackPriority相同，则退出
  if (curPriority === prevPriority) {
    return;
  }

  // 最高优先级不为 NoLane，且和 root.callbackPriority不相同
  if (existingCallback !== null) {
    unstable_cancelCallback(existingCallback);
  }

  let newCallbackNode = null;

  if (__DEV__) {
    console.log('优先级：', updateLane);
  }

  if (updateLane === SyncLane) {
    // 同步队列增加performSyncWorkOnFiber函数
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
    // 在微任务中执行所有的同步队列
    scheduleMicroTask(flushSyncCallbacks);
  } else {
    const schedulerPriority = lanesToSchedulerPriority(updateLane);
    newCallbackNode = unstable_scheduleCallback(
      schedulerPriority,
      performConcurrentWorkOnRoot.bind(null, root)
    );
  }

  root.callbackNode = newCallbackNode;
  root.callbackPriority = curPriority;
}

export function performConcurrentWorkOnRoot(
  root: FiberRootNode,
  didTimeout: boolean
): any {
  const curCallback = root.callbackNode;
  // commitMutationOnFibers阶段
  // 会收集标记了Update的fiber的fiber.updateQueue.laseEffect到root.pendingPassiveEffects.update
  // 会收集标记了Deletion的fiber的fiber.updateQueue.laseEffect到root.pendingPassiveEffects.unmount

  const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffects);

  if (didFlushPassiveEffect) {
    if (root.callbackNode !== curCallback) {
      return null;
    }
  }

  const lane = getNextLane(root);
  const curCallbackNode = root.callbackNode;
  if (lane === NoLane) {
    return null;
  }

  const needSync = lane === SyncLane || didTimeout;
  const exitStatus = renderRoot(root, lane, !needSync);

  switch (exitStatus) {
    // 中断执行
    case RootInComplete:
      if (root.callbackNode !== curCallbackNode) {
        return null;
      }
      return performConcurrentWorkOnRoot.bind(null, root);

    case RootCompleted: {
      // 也就是 workInprogress
      const finishedWork: FiberNode | null = root.current.alternate;
      root.finishedWork = finishedWork;
      root.finishedLane = lane;
      wipRootRenderLane = NoLane;
      commitRoot(root);
      break;
    }
    // 被suspend
    case RootDidNotComplete:
      // root.suspendedLanes 增加lane，root.pingedLanes 去掉lane
      markRootSuspended(root, lane);
      wipRootRenderLane = NoLane;
      ensureRootIsScheduled(root);
      break;

    default:
      if (__DEV__) {
        console.error('还未实现的并发更新结束状态');
      }
  }
}

export function performSyncWorkOnRoot(root: FiberRootNode) {
  const lane = getNextLane(root);

  if (lane !== SyncLane) {
    ensureRootIsScheduled(root);
    return;
  }

  const exitStatus = renderRoot(root, lane, false);

  switch (exitStatus) {
    case RootCompleted: {
      const finishedWork: FiberNode | null = root.current.alternate;
      root.finishedWork = finishedWork;
      root.finishedLane = lane;
      wipRootRenderLane = NoLane;

      commitRoot(root);
      break;
    }

    case RootDidNotComplete:
      // root.suspendedLanes 增加lane，root.pingedLanes 去掉lane
      markRootSuspended(root, lane);
      wipRootRenderLane = NoLane;
      ensureRootIsScheduled(root);
  }
}

let c = 0;

export function renderRoot(
  root: FiberRootNode,
  lane: Lane,
  shouldTimeSlice: boolean
) {
  if (__DEV__) {
    console.log(`开始${shouldTimeSlice ? '并发' : '同步'}更新`, root);
  }

  if (wipRootRenderLane !== lane) {
    prepareFreshStack(root, lane);
  }

  do {
    try {
      if (
        workInProgressSuspendedReason !== NotSuspended &&
        workInProgress !== null
      ) {
        const thrownValue = workInProgressThrownValue;
        workInProgressSuspendedReason = NotSuspended;
        workInProgressThrownValue = null;
        throwAndUnwindWorkLoop(root, workInProgress, thrownValue, lane);
      }

      shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
      break;
    } catch (e) {
      if (__DEV__) {
        console.warn('workLoop发生错误', e);
      }
      c++;
      if (c > 20) {
        console.warn('break!');
        break;
      }
      handleThrow(root, e);
    }
  } while (true);

  if (workInProgressRootExitStatus !== RootInProgress) {
    return workInProgressRootExitStatus;
  }

  // 中断执行
  if (shouldTimeSlice && workInProgress !== null) {
    return RootInComplete;
  }

  // render阶段执行完成后
  if (!shouldTimeSlice && workInProgress !== null && __DEV) {
    console.error('render阶段结束时不应该是null');
  }

  return RootCompleted;
}

function throwAndUnwindWorkLoop(
  root: FiberRootNode,
  unitOfWork: FiberNode,
  thrownValue: any,
  lane: Lane
) {
  // unwind前的重置hook
  resetHooksOnUnwind();
  throwException(root, thrownValue, lane);
  unwindUnitOfWork(unitOfWork);
}

function workLoopConcurrent() {
  while (!unstable_shouldYield && workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

function performUnitOfWork(fiber: FiberNode) {
  const next = beginWork(fiber, wipRootRenderLane);
  fiber.memoizedProps = fiber.pendingProps;

  if (next === null) {
    completeUnitOfWork(fiber);
  } else {
    // 往下找
    workInProgress = next;
  }
}

function completeUnitOfWork(fiber: FiberNode) {
  let node: FiberNode | null = fiber;
  do {
    completeWork(node);
    const sibling = node.sibling;

    // 往右找
    if (node.sibling !== null) {
      workInProgress = sibling;
      return;
    }

    // 往上走，并调用completeWork
    node = node.return;
    workInProgress = node;
  } while (node !== null);
}

function prepareFreshStack(root: FiberRootNode, lane: Lane) {
  root.finishedWork = null;
  root.finishedLane = NoLane;
  // 复用 root.current的tag、key、memoizedState、memoizedProps等属性
  workInProgress = createWorkInProgress(root.current, {});
  wipRootRenderLane = lane;
  workInProgressRootExitStatus = RootInProgress;
  workInProgressSuspendedReason = NotSuspended;
  workInProgressThrownValue = null;
}

// commit阶段
export function commitRoot(root: FiberRootNode) {
  const finishedWork = root.finishedWork;

  if (finishedWork === null) {
    return;
  }

  if (__DEV__) {
    console.warn('commit阶段开始', finishedWork);
  }

  const lane = root.finishedLane;

  if (lane === NoLane && __DEV__) {
    console.error('commit阶段 finishedLane不应该是NoLane');
  }

  // 重置
  root.finishedLane = NoLane;
  root.finishedWork = null;

  // root.pendingLanes 去掉 lane
  // 重置 root.suspendedLanes 和 pingedLanes
  markRootFinished(root, lane);

  if (
    (finishedWork.flags & PassiveMask) !== NoFlags ||
    (finishedWork.subtreeFlags & PassiveMask) !== NoFlags
  ) {
    if (!rootDoesHasPassiveEffects) {
      rootDoesHasPassiveEffects = true;
      // 调度副作用
      unstable_scheduleCallback(NormalPriority, () => {
        flushPassiveEffects(root.pendingPassiveEffects);
      });
    }
  }

  // 判断是否存在3个子阶段需要执行的操作
  // root flags 和 subtreeFlags
  const subtreeHasEffect =
    (finishedWork.subtreeFlags & (MutationMask | PassiveMask)) !== NoFlags;

  const rootHasEffect =
    (finishedWork.flags & (MutationMask | Passive)) !== NoFlags;

  if (subtreeHasEffect || rootHasEffect) {
    commitMutationEffects(finishedWork, root);

    root.current = finishedWork;

    commitLayoutEffects(finishedWork, root);
  } else {
    root.current = finishedWork;
  }

  rootDoesHasPassiveEffects = false;
  ensureRootIsScheduled(root);
}

export function flushPassiveEffects(
  pendingPassiveEffects: PendingPassiveEffects
) {
  let didFlushPassiveEffect = false;

  pendingPassiveEffects.unmount.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListUnmount(Passive, effect);
  });

  pendingPassiveEffects.unmount = [];

  pendingPassiveEffects.update.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListDestroy(Passive | HookHasEffect, effect);
  });

  pendingPassiveEffects.update.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListCreate(Passive | HookHasEffect, effect);
  });

  pendingPassiveEffects.update = [];
  flushSyncCallbacks();
  return didFlushPassiveEffect;
}

function unwindUnitOfWork(unitOfWork: FiberNode) {
  {
    let incompleteWork: FiberNode | null = unitOfWork;

    do {
      const next = unwindWork(incompleteWork);

      if (next !== null) {
        next.flags &= HostEffectMask;
        workInProgress = next;
        return;
      }

      const returnFiber = incompleteWork.return as FiberNode;
      if (returnFiber !== null) {
        returnFiber.deletions = null;
      }

      incompleteWork = returnFiber;
    } while (incompleteWork !== null);

    workInProgress = null;
    workInProgressRootExitStatus = RootDidNotComplete;
  }
}

function handleThrow(root: FiberRootNode, thrownValue: any) {
  // use 中才抛的问题
  if (thrownValue === SuspenseException) {
    workInProgressSuspendedReason = SuspendedOnData;
    thrownValue = getSuspenseThenable();
  } else {
    const isWakeable =
      typeof thrownValue === 'object' &&
      thrownValue !== null &&
      typeof thrownValue.then === 'function';

    workInProgressThrownValue = thrownValue;
    workInProgressSuspendedReason = isWakeable
      ? SuspendedOnDeprecatedThrowPromise
      : SuspendedOnError;
  }

  workInProgressThrownValue = thrownValue;
}
