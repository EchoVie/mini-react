import { Lane, mergeLanes, isSubsetOfLanes, NoLane } from './fiberLanes';
import { Action } from 'shared/ReactTypes';
import { Dispatch } from 'react/src/currentDispatcher';
import { FiberNode } from './fiber';

export interface Update<State> {
  action: Action<State>;
  lane: Lane;
  next: Update<any> | null;
  hasEagerState: boolean;
  eagerState: State | null;
}

export interface UpdateQueue<State> {
  shared: {
    pending: Update<State> | null;
  };
  dispatch: Dispatch<State> | null;
}

export const createUpdateQueue = <State>() => {
  return {
    shared: {
      pending: null
    },
    dispatch: null
  } as UpdateQueue<State>;
};

export const createUpdate = <State>(
  action: Action<State>,
  lane: Lane,
  hasEagerState = false,
  eagerState = null
): Update<State> => {
  return {
    action,
    lane,
    next: null,
    hasEagerState,
    eagerState
  };
};

export const enqueueUpdate = <State>(
  updateQueue: UpdateQueue<State>,
  update: Update<State>,
  fiber: FiberNode,
  lane: Lane
) => {
  const pending = updateQueue.shared.pending;
  if (pending === null) {
    update.next = update;
  } else {
    // b => a => b, 假设c为待插入数据
    // pending.next始终为第一个update即a
    // c的next指向a，b的next由a转为c，此时b => a 转变为 b => c => a
    update.next = pending.next;
    pending.next = update;
  }

  updateQueue.shared.pending = update; // c => a => b => c

  fiber.lanes = mergeLanes(fiber.lanes, lane);
  const alternate = fiber.alternate;

  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
};

export function basicStateReducer<State>(
  state: State, // preState
  action: Action<State> // curState 或者 (preState) => curState
): State {
  if (action instanceof Function) {
    return action(state);
  } else {
    return action;
  }
}

export const processUpdateQueue = <State>(
  baseState: State,
  pendingUpdate: Update<State> | null,
  renderLane: Lane,
  onSkipUpdate?: <State>(update: Update<State>) => void
): {
  memoizedState: State,
  baseState: State,
  baseQueue: Update<State> | null;
} => {
  const result: ReturnType<typeof processUpdateQueue<State>> = {
    memoizedState: baseState,
    baseState,
    baseQueue: null
  };

  if (pendingUpdate !== null) {
    const first = pendingUpdate.next;
    let pending = pendingUpdate.next as Update<any>;

    let newBaseState = baseState;
    let newBaseQueueFirst: Update<State> | null = null;
    let newBaseQueueLast: Update<State> | null = null;
    let newState = baseState;

    do {
      const updateLane = pending.lane;
      // 判断 renderLane是否包含updateLane
      if (!isSubsetOfLanes(renderLane, updateLane)) {
        // 优先级不够

        // 复用当前lane创建Update
        const clone = createUpdate(pending.action, pending.lane);

        onSkipUpdate?.(clone);

        if (newBaseQueueFirst === null) {
          newBaseQueueFirst = clone;
          newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          (newBaseQueueLast as Update<State>).next = clone;
          newBaseQueueLast = clone;
        }
      } else {
        // 优先级足够

        // 当前优先级足够但前面有优先级不够的Update
        if (newBaseQueueLast !== null) {
          // 创建 lane为NoLane的Update
          const clone = createUpdate(pending.action, NoLane);
          newBaseQueueLast.next = clone;
          newBaseQueueLast = clone;
        }

        const action = pending.action;
        if (pending.hasEagerState) {
          newState = pending.eagerState;
        } else {
          newState = basicStateReducer(baseState, action);
        }

        pending = pending.next as Update<any>;
      }
    } while (pending !== first);

    if (newBaseQueueLast === null) {
      // 没有update被跳过
      newBaseState = newState;
    } else {
      // 最后一个update.next指向第一个update，形成环状链表
      (newBaseQueueLast as Update<State>).next = newBaseQueueFirst;
    }
    // 最后一个满足优先级的Update的state
    result.memoizedState = newState;
    // 第一个不满足优先级前一个满足优先级的state，如果都优先级都满足则和newState一致
    result.baseState = newBaseState;
    // 第一个不满足优先级的update及其之后的update
    result.baseQueue = newBaseQueueLast;
  }
  return result;
};
