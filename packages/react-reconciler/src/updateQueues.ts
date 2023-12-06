import { Lane, mergeLanes } from './fiberLanes';
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
  let pending = updateQueue.shared.pending;
  if (pending === null) {
    pending = update;
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
