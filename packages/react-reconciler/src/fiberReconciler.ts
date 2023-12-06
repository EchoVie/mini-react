import { Container } from 'hostConfig';
import { FiberNode, FiberRootNode } from './fiber';
import { HostRoot } from './workTags';
import { createUpdateQueue, createUpdate, enqueueUpdate, UpdateQueue } from './updateQueues';
import { ReactElementType } from 'shared/ReactTypes';
import { requestUpdateLane } from './fiberLanes';
import {
  unstable_ImmediatePriority,
  unstable_runWithPriority
} from 'scheduler';

export const createContainer = (container: Container) => {
  const hostRootFiber = new FiberNode(HostRoot, {}, null);
  const rootFiberNode = new FiberRootNode(container, hostRootFiber);
  hostRootFiber.updateQueue = createUpdateQueue();

  return rootFiberNode;
};

export const updateContainer = (
  element: ReactElementType | null,
  root: FiberRootNode
) => {
  unstable_runWithPriority(unstable_ImmediatePriority, () => {
    const hostRootFiber = root.current;
    const lane = requestUpdateLane(); // SyncLane

    // { action: element, lane: 'SyncLane', next: null, hasEagerState: false, eagerState: null }
    const update = createUpdate(element, lane);

    // 1. hostRootFiber.updateQueue.shared.pengding 后增加新update 2. hostRootFiber.lanes增加'SyncLane'
    enqueueUpdate(
      hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
      update,
      hostRootFiber,
      lane
    );
    // scheduleUpdateOnFiber(hostRootFiber, lane); // 调度更新
  });
};
