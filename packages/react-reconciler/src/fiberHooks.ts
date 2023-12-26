import internals from 'shared/internals';
import { REACT_CONTEXT_TYPE } from 'shared/ReactSymbols';
import { Action, ReactContext, Thenable, Usable } from 'shared/ReactTypes';
import { Dispatch, Dispatcher } from 'react/src/currentDispatcher';
import { FiberNode } from './fiber';
import { Flags, PassiveEffect } from './fiberFlags';
import {
  removeLanes,
  Lane,
  NoLane,
  requestUpdateLane,
  mergeLanes
} from './fiberLanes';
import { markWipReceivedUpdate } from './beginWork';
import {
  Update,
  UpdateQueue,
  createUpdateQueue,
  createUpdate,
  basicStateReducer,
  enqueueUpdate,
  processUpdateQueue
} from './updateQueues';
import { NoLanes } from './fiberLanes';
import { scheduleUpdateOnFiber } from './workLoop';
import { HookHasEffect, Passive } from './hookEffectTags';
import { trackUsedThenable } from './thenable';
import { readContext as readContextOrigin } from './fiberContext';

interface Hook {
  memoizedState: any; // 上次计算出的值
  updateQueue: unknown; // 包括所有优先级的update环状链表
  next: Hook | null;
  baseState: any; // 上次最后一个满足优先级的Update的state
  baseQueue: Update<any> | null; // 高于本次渲染优先级的update环状链表，比如上次优先级不够的update
}

let workInProgressHook: Hook | null = null;
let currentHook: Hook | null = null;
let currentlyRenderingFiber: FiberNode | null = null;
let renderLane: Lane = NoLane;
const { currentDispatcher, currentBatchConfig } = internals;

const HooksDispatcherOnMount: Dispatcher = {
  useState: mountState,
  useEffect: mountEffect,
  useTransition: mountTransition,
  useRef: mountRef,
  useContext: readContext,
  use,
  useMemo: mountMemo,
  useCallback: mountCallback
};

const HooksDispatcherOnUpdate = {
  useState: updateState,
  useEffect: updateEffect,
  useTransition: updateTransition,
  useRef: updateRef,
  useContext: readContext,
  use,
  useMemo: updateMemo,
  useCallback: updateCallback
};

export interface FCUpdateQueue<State> extends UpdateQueue<State> {
  lastEffect: Effect | null;
  lastRenderedState: State;
}

export type HookDeps = any[] | null;
type EffectCallback = () => void;

export interface Effect {
  tag: Flags;
  create: EffectCallback | void;
  destroy: EffectCallback | void;
  deps: HookDeps;
  next: Effect | null;
}

export function bailoutHook(wip: FiberNode, renderLane: Lane) {
  const current = wip.alternate as FiberNode;

  // 1. current.updateQueue 赋值给wip
  wip.updateQueue = current.updateQueue;
  // 2. wip去掉PassiveEffect
  wip.flags &= ~PassiveEffect;

  // 3. current.lanes 去掉renderLane
  current.lanes = removeLanes(current.lanes, renderLane);
}

export function renderWithHooks(
  wip: FiberNode,
  Component: FiberNode['type'],
  lane: Lane
) {
  currentlyRenderingFiber = wip;
  const current = wip.alternate;
  // 重置 hooks链表
  wip.memoizedState = null;
  // 重置 effect链表
  wip.updateQueue = null;

  renderLane = lane;

  if (current !== null) {
    currentDispatcher.current = HooksDispatcherOnUpdate;
  } else {
    currentDispatcher.current = HooksDispatcherOnMount;
  }

  const props = wip.pendingProps;
  const children = Component(props);

  // 重置操作
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
  renderLane = NoLane;
  return children;
}

function mountState<State>(
  initialState: Action<State>
): [State, Dispatch<State>] {
  // 新建hook，并绑定/追加到currentlyRenderingFiber.memoizedState后面
  const hook = mountWorkInProgressHook();
  let memoizedState;
  if (initialState instanceof Function) {
    memoizedState = initialState();
  } else {
    memoizedState = initialState;
  }

  const queue = createFCUpdateQueue();
  hook.updateQueue = queue;
  hook.memoizedState = memoizedState;
  hook.baseState = memoizedState;

  const dispatch = dispatchSetState.bind(
    null,
    currentlyRenderingFiber as FiberNode,
    queue
  );
  queue.dispatch = dispatch;
  queue.lastRenderedState = memoizedState;
  return [memoizedState, dispatch];
}

function mountRef<T>(initialValue: T): { current: T } {
  const hook = mountWorkInProgressHook();
  const ref = { current: initialValue };
  hook.memoizedState = ref;

  return ref;
}

function mountMemo<T>(nextCreate: () => T, deps: HookDeps | undefined): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function mountCallback<T>(callback: T, deps: HookDeps | undefined): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function mountEffect(create: EffectCallback | void, deps: HookDeps | void) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  (currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;

  // 新建effect，并绑定/追加到currentlyRenderingFiber.updateQueue.lastEffect后面
  hook.memoizedState = pushEffect(
    Passive | HookHasEffect,
    create,
    undefined,
    nextDeps
  );
}

function mountTransition(): [boolean, (callback: () => void) => void] {
  const [isPending, setPending] = mountState(false);
  const hook = mountWorkInProgressHook();
  const start = startTransition.bind(null, setPending);
  hook.memoizedState = start;
  return [isPending, start];
}

function use<T>(usable: Usable<T>): T {
  if (usable !== null && typeof usable === 'object') {
    if (typeof (usable as Thenable<T>).then === 'function') {
      const thenable = usable as Thenable<T>;
      return trackUsedThenable(thenable);
    } else if ((usable as ReactContext<T>).$$typeof === REACT_CONTEXT_TYPE) {
      const context = usable as ReactContext<T>;
      return readContext(context);
    }
  }

  throw new Error('不支持的use参数' + usable);
}

function readContext<Value>(context: ReactContext<Value>): Value {
  const consumer = currentlyRenderingFiber as FiberNode;
  return readContextOrigin(consumer, context);
}

function updateState<State>(): [State, Dispatch<State>] {
  // 1. 根据currenkHook克隆hook
  // 2. 追加在workInProgres.memoizedState后面
  // 3. 更新workInProgressHook和currentHook
  const hook = updateWorkInProgressHook();

  const queue = hook.updateQueue as FCUpdateQueue<State>;
  const baseState = hook.baseState;
  const pending = queue.shared.pending;
  const current = currentHook as Hook;
  let baseQueue = hook.baseQueue;

  // 4. 合并 hook.baseQueue和hook.updateQueue.shared.pending
  // 5. 赋值给 currentHook.baseQueue 和 baseQueue;
  if (pending !== null) {
    if (baseQueue !== null) {
      // 将 baseQueue unshift到 pending的前面
      const baseFirst = baseQueue.next;
      const pendingFirst = pending.next;
      baseQueue.next = pendingFirst;
      pending.next = baseFirst; // pending的第一位即是baseQueue的第一位
    }
    // baseQueue u3 => u1 => u2 => u3
    // 原pending u5 => u4 => u5
    // 现pending u5 => u1 => u2 => u3 => u4 => u5
    // 保存在currentHook中
    current.baseQueue = baseQueue = pending;
    // 重置 hook.updateQueue.shared.pending
    queue.shared.pending = null;
  }

  // 6. 处理 baseQueue 上的update
  if (baseQueue !== null) {
    const prevState = hook.memoizedState;
    const {
      memoizedState,
      baseQueue: newBaseQueue,
      baseState: newBaseState
    } = processUpdateQueue(baseState, baseQueue, renderLane, (update) => {
      const skippedLane = update.lane;
      const fiber = currentlyRenderingFiber as FiberNode;
      // update优先级不够的lane
      fiber.lanes = mergeLanes(fiber.lanes, skippedLane);
    });

    if (!Object.is(prevState, memoizedState)) {
      markWipReceivedUpdate();
    }

    // 7. 重置 hook上的值
    hook.memoizedState = memoizedState;
    hook.baseState = newBaseState;
    hook.baseQueue = newBaseQueue;

    queue.lastRenderedState = memoizedState;
  }

  return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

function updateRef<T>(): { current: T } {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

function updateMemo<T>(nextCreate: () => T, deps: HookDeps): T {
  const hook = updateWorkInProgressHook();
  const prevState = hook.memoizedState;
  const nextDeps = deps === undefined ? null : deps;

  // nextDeps 为null 每次都会渲染
  if (nextDeps !== null) {
    if (areHookInputsEqual(prevState[1], nextDeps)) {
      return prevState[0];
    }
  }

  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function updateCallback<T>(callback: T, deps: HookDeps): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;

  if (nextDeps !== null) {
    if (areHookInputsEqual(prevState[1], nextDeps)) {
      return prevState[0];
    }
  }

  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function updateEffect(create: EffectCallback, deps: HookDeps | void) {
  // 1. 根据currenkHook克隆hook
  // 2. 追加在workInProgres.memoizedState后面
  // 3. 更新workInProgressHook和currentHook
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy: EffectCallback | void;

  // 新建effect，并绑定/追加到currentlyRenderingFiber.updateQueue.lastEffect后面
  // 浅比较不相等，会标记 currentlyRenderingFibe.flags PassiveEffect
  if (currentHook !== null) {
    const prevEffect = currentHook.memoizedState as Effect;
    destroy = prevEffect.destroy;

    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;
      // 浅比较 相等
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        hook.memoizedState = pushEffect(Passive, create, destroy, nextDeps);
        return;
      }

      // 浅比较 不相等
      (currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
      hook.memoizedState = pushEffect(
        Passive | HookHasEffect,
        create,
        destroy,
        nextDeps
      );
    }
  }
}

function updateTransition() {
  const [isPending] = updateState();
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  return [isPending as boolean, start];
}

// 1. 新增hook 2. 赋值/挪动 currentlyRenderingFiber.memoizedState和workInProgressHook
function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    memoizedState: null,
    baseState: null,
    baseQueue: null,
    updateQueue: null,
    next: null
  };

  if (workInProgressHook === null) {
    // mount时第一个hook
    workInProgressHook = hook;
    if (currentlyRenderingFiber === null) {
      throw new Error('请在函数内调用hook');
    } else {
      currentlyRenderingFiber.memoizedState = workInProgressHook = hook;
    }
  } else {
    // mount时 后续的hook
    // currentlyRenderingFiber.memoizedState一直在往后加 hook
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

function updateWorkInProgressHook(): Hook {
  // 1.获取 nextCurrentHook
  let nextCurrentHook: Hook | null;
  if (currentHook === null) {
    const current = (currentlyRenderingFiber as FiberNode).alternate;
    if (current !== null) {
      nextCurrentHook = current.memoizedState;
    } else {
      nextCurrentHook = null;
    }
  } else {
    // 这个FC update时 后续的hook
    nextCurrentHook = currentHook.next;
  }

  // if (nextCurrentHook === null) {
  if (nextCurrentHook === null) {
    throw new Error(
      `组件 ${currentlyRenderingFiber?.type.name} 本次执行时Hook 比上次执行时多`
    );
  }

  // 2. 获取 根据nextCurrentHook克隆hook，追加在fiber.memoizedState后，更细workInProgressHook和currentHook
  currentHook = nextCurrentHook as Hook;
  const { memoizedState, baseState, baseQueue, updateQueue } = currentHook;
  const hook: Hook = {
    memoizedState,
    baseState,
    baseQueue,
    updateQueue,
    next: null
  };
  if (workInProgressHook === null) {
    if (currentlyRenderingFiber === null) {
      throw Error('请在函数组件内调用hook');
    }
    // 首个hook
    currentlyRenderingFiber.memoizedState  = workInProgressHook = hook;
  } else {
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

// { shared: { pending: null }, dispatch: null, lastEffect: null }
function createFCUpdateQueue<State>() {
  const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;
  updateQueue.lastEffect = null;
  return updateQueue;
}

function dispatchSetState<State>(
  fiber: FiberNode,
  updateQueue: FCUpdateQueue<State>,
  action: Action<State>
) {
  const lane = requestUpdateLane(); // 获取当前正在执行的lane
  const update = createUpdate(action, lane);

  // eager策略
  const current = fiber.alternate;
  if (
    fiber.lanes === NoLane &&
    (current === null || current.lanes === NoLanes)
  ) {
    const currentState = updateQueue.lastRenderedState;
    const eagerState = basicStateReducer(currentState, action);
    update.hasEagerState = true;
    update.eagerState = eagerState;

    if (Object.is(currentState, eagerState)) {
      enqueueUpdate(updateQueue, update, fiber, NoLane);

      if (__DEV__) {
        console.warn('命中eagerState', fiber);
      }

      return;
    }
  }

  enqueueUpdate(updateQueue, update, fiber, lane);

  scheduleUpdateOnFiber(fiber, lane);
}

function pushEffect(
  hookFlags: Flags,
  create: EffectCallback | void,
  destroy: EffectCallback | void,
  deps: HookDeps
): Effect {
  const effect: Effect = {
    tag: hookFlags,
    create,
    destroy,
    deps,
    next: null
  };

  const fiber = currentlyRenderingFiber as FiberNode;
  const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
  if (updateQueue === null) {
    // 初始化fiber.updateQueue，fiber.updateQueue.lastEffect后增加effect
    const updateQueue = createFCUpdateQueue();
    fiber.updateQueue = updateQueue;
    effect.next = effect;
    updateQueue.lastEffect = effect;
  } else {
    // fiber.updateQueue.lastEffect后增加effect
    const lastEffect = updateQueue.lastEffect;
    if (lastEffect === null) {
      effect.next = effect;
      updateQueue.lastEffect = effect;
    } else {
      effect.next = lastEffect.next;
      lastEffect.next = effect;
      // 挪到 effct，以保证updateQueue.lastEffect.next始终指向第一个
      updateQueue.lastEffect = effect;
    }
  }

  return effect;
}

function areHookInputsEqual(nextDeps: HookDeps, prevDeps: HookDeps) {
  if (prevDeps === null || nextDeps === null) {
    return false;
  }

  for (let i = 0; i < prevDeps.length; i++) {
    if (Object.is(prevDeps[i], nextDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

function startTransition(setPending: Dispatch<boolean>, callback: () => void) {
  setPending(true);
  const prevTransation = currentBatchConfig.transition;
  currentBatchConfig.transition = 1;

  callback();
  setPending(false);

  currentBatchConfig.transition = prevTransation;
}

export function resetHooksOnUnwind() {
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
}
